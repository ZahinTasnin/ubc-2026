// Dev 2 — local-validator tests for claim_refund and claim_merchant (settlement layer).
// Token movement is REAL (valueless) localnet SPL transfers out of the escrow vault. The hedge
// itself is an off-chain simulation; here it is only the relayer's on-chain `mark_hedged` flag.
import * as anchor from "@coral-xyz/anchor";
import { createAccount, createAssociatedTokenAccount, getAccount } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  OFFER,
  chainNow,
  configPda,
  connection,
  customerWithTokens,
  ensureConfig,
  eventsFromTx,
  expectError,
  fundedWallet,
  newMint,
  newPurchaseId,
  payer,
  program,
  promoPda,
  purchasePda,
  setPaused,
  vaultAddress,
} from "./helpers";

const BN = anchor.BN;
type Outcome = "yes" | "no";
type Wallet = { wallet: Keypair; ata: PublicKey };

describe("escrow settlement (claim_refund / claim_merchant)", () => {
  let mint: PublicKey;
  let relayer: Keypair;
  let merchant: Keypair;
  let merchantAta: PublicKey;
  let nonce = 1000;

  async function createPromo(owner: Keypair = merchant) {
    const n = ++nonce;
    const promo = promoPda(owner.publicKey, n);
    await program.methods
      .initializePromo(
        new BN(n),
        new BN(OFFER.toString()),
        new BN((await chainNow()) + 3600),
        "GEMI-TEXAS-WIN",
      )
      .accounts({ merchant: owner.publicKey, mint, vault: vaultAddress(promo, mint) } as never)
      .signers([owner])
      .rpc();
    return { promo, vault: vaultAddress(promo, mint) };
  }

  async function deposit(promo: PublicKey, customer?: Wallet) {
    const c = customer ?? (await customerWithTokens(mint, OFFER));
    const id = newPurchaseId();
    const purchase = purchasePda(promo, c.wallet.publicKey, id);
    await program.methods
      .deposit(Array.from(id), new BN(OFFER.toString()))
      .accounts({
        customer: c.wallet.publicKey,
        promo,
        mint,
        purchase,
        customerTokenAccount: c.ata,
        vault: vaultAddress(promo, mint),
      } as never)
      .signers([c.wallet])
      .rpc();
    return { purchase, customer: c };
  }

  const relayerCall = (
    name: "markHedged" | "cancelUnhedged",
    promo: PublicKey,
    purchase: PublicKey,
  ) =>
    program.methods[name]()
      .accounts({ relayer: relayer.publicKey, promo, purchase } as never)
      .signers([relayer])
      .rpc();
  const markHedged = (promo: PublicKey, purchase: PublicKey) =>
    relayerCall("markHedged", promo, purchase);
  const cancelUnhedged = (promo: PublicKey, purchase: PublicKey) =>
    relayerCall("cancelUnhedged", promo, purchase);
  const resolve = (promo: PublicKey, o: Outcome) =>
    program.methods
      .resolvePromo(o === "yes" ? { yes: {} } : { no: {} })
      .accounts({ relayer: relayer.publicKey, promo } as never)
      .signers([relayer])
      .rpc();

  async function claimRefund(
    promo: PublicKey,
    purchase: PublicKey,
    signer: Keypair,
    dest: PublicKey,
    over: { mint?: PublicKey; vault?: PublicKey } = {},
  ) {
    return program.methods
      .claimRefund()
      .accounts({
        customer: signer.publicKey,
        promo,
        purchase,
        mint: over.mint ?? mint,
        vault: over.vault ?? vaultAddress(promo, mint),
        customerTokenAccount: dest,
      } as never)
      .signers([signer])
      .rpc();
  }

  async function claimMerchant(
    promo: PublicKey,
    purchase: PublicKey,
    signer: Keypair,
    dest: PublicKey,
    over: { mint?: PublicKey; vault?: PublicKey } = {},
  ) {
    return program.methods
      .claimMerchant()
      .accounts({
        merchant: signer.publicKey,
        promo,
        purchase,
        mint: over.mint ?? mint,
        vault: over.vault ?? vaultAddress(promo, mint),
        merchantTokenAccount: dest,
      } as never)
      .signers([signer])
      .rpc();
  }

  const bal = async (a: PublicKey) => (await getAccount(connection, a)).amount;
  const pState = async (p: PublicKey) =>
    Object.keys((await program.account.purchase.fetch(p)).state)[0];

  /** vault == total_deposited - total_paid_out, and total_paid_out <= total_deposited. */
  async function expectConserved(promo: PublicKey, vault: PublicKey) {
    const p = await program.account.promo.fetch(promo);
    const dep = BigInt(p.totalDeposited.toString());
    const paid = BigInt(p.totalPaidOut.toString());
    expect(paid <= dep).to.equal(true);
    expect(await bal(vault)).to.equal(dep - paid);
    return { dep, paid };
  }

  /** Deposit + (optionally) cancel/hedge so the purchase is in the requested state. */
  async function purchaseIn(
    promo: PublicKey,
    state: "deposited" | "hedged" | "cancelled",
    c?: Wallet,
  ) {
    const d = await deposit(promo, c);
    if (state === "hedged") await markHedged(promo, d.purchase);
    if (state === "cancelled") await cancelUnhedged(promo, d.purchase);
    return d;
  }

  before(async () => {
    ({ mint } = await ensureConfig());
    relayer = Keypair.generate();
    merchant = await fundedWallet();
    merchantAta = await createAssociatedTokenAccount(connection, payer, mint, merchant.publicKey);
    await program.methods
      .setRelayer(relayer.publicKey)
      .accounts({ admin: payer.publicKey } as never)
      .rpc();
  });

  afterEach(async () => {
    if ((await program.account.config.fetch(configPda())).paused) await setPaused(false);
  });

  // ------------------------------------------------------------------ claim_refund: cancel path
  describe("claim_refund — cancelled purchase", () => {
    it("refunds exactly the purchase amount, goes terminal, updates accounting, emits CancelRefund", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "cancelled");
      expect(await bal(customer.ata)).to.equal(0n);

      const sig = await claimRefund(promo, purchase, customer.wallet, customer.ata);

      expect(await bal(customer.ata)).to.equal(OFFER);
      expect(await bal(vault)).to.equal(0n);
      const pu = await program.account.purchase.fetch(purchase);
      expect(pu.state).to.deep.equal({ refunded: {} });
      expect(pu.settledAt.toNumber()).to.be.greaterThan(0);
      const p = await program.account.promo.fetch(promo);
      expect(p.totalPaidOut.toString()).to.equal(OFFER.toString());
      expect(p.totalDeposited.toString()).to.equal(OFFER.toString());
      await expectConserved(promo, vault);

      const ev = (await eventsFromTx(sig)).filter((e) => e.name === "claimevent");
      expect(ev).to.have.length(1);
      expect(ev[0]!.data.kind).to.deep.equal({ cancelRefund: {} });
      expect((ev[0]!.data.recipient as PublicKey).toBase58()).to.equal(
        customer.wallet.publicKey.toBase58(),
      );
      expect((ev[0]!.data.purchase as PublicKey).toBase58()).to.equal(purchase.toBase58());
      expect((ev[0]!.data.amount as anchor.BN).toString()).to.equal(OFFER.toString());
    });

    it("works while paused (cancel path is never blocked)", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "cancelled");
      await setPaused(true);
      await claimRefund(promo, purchase, customer.wallet, customer.ata);
      expect(await bal(customer.ata)).to.equal(OFFER);
      await expectConserved(promo, vault);
    });

    for (const o of ["yes", "no"] as const) {
      it(`works after the promo resolved ${o.toUpperCase()}`, async () => {
        const { promo, vault } = await createPromo();
        const { purchase, customer } = await purchaseIn(promo, "cancelled");
        await resolve(promo, o);
        await claimRefund(promo, purchase, customer.wallet, customer.ata);
        expect(await pState(purchase)).to.equal("refunded");
        await expectConserved(promo, vault);
      });
    }

    it("cannot be claimed twice (AlreadyClaimed) and moves no more tokens", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "cancelled");
      // a second purchase keeps funds in the vault: a double claim must not drain it
      const other = await purchaseIn(promo, "deposited");
      await claimRefund(promo, purchase, customer.wallet, customer.ata);
      await expectError(
        claimRefund(promo, purchase, customer.wallet, customer.ata),
        "AlreadyClaimed",
      );
      expect(await bal(customer.ata)).to.equal(OFFER);
      expect(await bal(vault)).to.equal(OFFER);
      expect(await pState(other.purchase)).to.equal("deposited");
      await expectConserved(promo, vault);
    });
  });

  // ---------------------------------------------------------------- claim_refund: YES (hedged)
  describe("claim_refund — hedged purchase", () => {
    it("pays the customer after YES and emits YesRefund", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "hedged");
      await resolve(promo, "yes");
      const sig = await claimRefund(promo, purchase, customer.wallet, customer.ata);

      expect(await bal(customer.ata)).to.equal(OFFER);
      const pu = await program.account.purchase.fetch(purchase);
      expect(pu.state).to.deep.equal({ claimedByCustomer: {} });
      expect(pu.settledAt.toNumber()).to.be.greaterThan(0);
      await expectConserved(promo, vault);
      const ev = (await eventsFromTx(sig)).filter((e) => e.name === "claimevent");
      expect(ev[0]!.data.kind).to.deep.equal({ yesRefund: {} });
      expect((ev[0]!.data.recipient as PublicKey).toBase58()).to.equal(
        customer.wallet.publicKey.toBase58(),
      );
    });

    it("is blocked while paused, then works after unpausing", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "hedged");
      await resolve(promo, "yes");
      await setPaused(true);
      await expectError(claimRefund(promo, purchase, customer.wallet, customer.ata), "Paused");
      expect(await pState(purchase)).to.equal("hedged");
      await setPaused(false);
      await claimRefund(promo, purchase, customer.wallet, customer.ata);
      expect(await pState(purchase)).to.equal("claimedByCustomer");
    });

    it("cannot be claimed twice after YES", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "hedged");
      await purchaseIn(promo, "deposited"); // extra funds in the vault
      await resolve(promo, "yes");
      await claimRefund(promo, purchase, customer.wallet, customer.ata);
      await expectError(
        claimRefund(promo, purchase, customer.wallet, customer.ata),
        "AlreadyClaimed",
      );
      expect(await bal(customer.ata)).to.equal(OFFER);
      expect(await bal(vault)).to.equal(OFFER);
    });

    it("is rejected before resolution (promo still Active)", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "hedged");
      await expectError(
        claimRefund(promo, purchase, customer.wallet, customer.ata),
        "InvalidState",
      );
      expect(await pState(purchase)).to.equal("hedged");
    });

    it("is rejected after NO (the merchant is entitled, not the customer)", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "hedged");
      await resolve(promo, "no");
      await expectError(
        claimRefund(promo, purchase, customer.wallet, customer.ata),
        "InvalidState",
      );
      expect(await bal(vault)).to.equal(OFFER);
    });

    it("is rejected after the merchant already claimed (NO)", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "hedged");
      await resolve(promo, "no");
      await claimMerchant(promo, purchase, merchant, merchantAta);
      await expectError(
        claimRefund(promo, purchase, customer.wallet, customer.ata),
        "AlreadyClaimed",
      );
    });
  });

  // ------------------------------------------------------------ claim_refund: validation
  describe("claim_refund — authorization and account validation", () => {
    it("rejects a Deposited (un-hedged, un-cancelled) purchase", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "deposited");
      await expectError(
        claimRefund(promo, purchase, customer.wallet, customer.ata),
        "InvalidState",
      );
      await resolve(promo, "yes");
      await expectError(
        claimRefund(promo, purchase, customer.wallet, customer.ata),
        "InvalidState",
      );
    });

    it("rejects any signer other than purchase.customer", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "cancelled");
      const attacker = await customerWithTokens(mint, 0n);
      // attacker signs and uses their own ATA
      await expectError(
        claimRefund(promo, purchase, attacker.wallet, attacker.ata),
        "Unauthorized",
      );
      // attacker signs but points the payout at the victim's ATA
      await expectError(
        claimRefund(promo, purchase, attacker.wallet, customer.ata),
        "Unauthorized",
      );
      await expectError(claimRefund(promo, purchase, merchant, merchantAta), "Unauthorized");
      await expectError(claimRefund(promo, purchase, relayer, merchantAta), "Unauthorized");
      expect(await pState(purchase)).to.equal("cancelled");
      expect(await bal(vault)).to.equal(OFFER);
    });

    it("rejects a destination owned by someone else", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "cancelled");
      const other = await customerWithTokens(mint, 0n);
      await expectError(
        claimRefund(promo, purchase, customer.wallet, other.ata),
        "WrongTokenAccount",
      );
      await expectError(
        claimRefund(promo, purchase, customer.wallet, merchantAta),
        "WrongTokenAccount",
      );
      // paying out into the vault itself is also owner-mismatched
      await expectError(claimRefund(promo, purchase, customer.wallet, vault), "WrongTokenAccount");
      expect(await pState(purchase)).to.equal("cancelled");
    });

    it("rejects a destination of the wrong mint", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "cancelled");
      const otherMint = await newMint(6);
      const wrongAta = await createAssociatedTokenAccount(
        connection,
        payer,
        otherMint,
        customer.wallet.publicKey,
      );
      await expectError(claimRefund(promo, purchase, customer.wallet, wrongAta), "WrongMint");
    });

    it("rejects a wrong mint account", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "cancelled");
      const otherMint = await newMint(6);
      await expectError(
        claimRefund(promo, purchase, customer.wallet, customer.ata, { mint: otherMint }),
        "WrongMint",
      );
    });

    it("rejects a vault that is not the promo's vault", async () => {
      const a = await createPromo();
      const b = await createPromo();
      await purchaseIn(b.promo, "deposited"); // fund the other vault so the attack is meaningful
      const { purchase, customer } = await purchaseIn(a.promo, "cancelled");
      await expectError(
        claimRefund(a.promo, purchase, customer.wallet, customer.ata, { vault: b.vault }),
        "WrongTokenAccount",
      );
      expect(await bal(b.vault)).to.equal(OFFER);
    });

    it("rejects a purchase passed with a different promo", async () => {
      const a = await createPromo();
      const b = await createPromo();
      const { purchase, customer } = await purchaseIn(a.promo, "cancelled");
      await expectError(
        claimRefund(b.promo, purchase, customer.wallet, customer.ata),
        "ConstraintSeeds",
      );
    });

    it("cannot use one purchase to claim another customer's funds", async () => {
      const { promo, vault } = await createPromo();
      const alice = await purchaseIn(promo, "cancelled");
      const bob = await purchaseIn(promo, "cancelled");
      await expectError(
        claimRefund(promo, bob.purchase, alice.customer.wallet, alice.customer.ata),
        "Unauthorized",
      );
      expect(await bal(vault)).to.equal(2n * OFFER);
    });

    it("requires the customer to actually sign", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "cancelled");
      await expectError(
        program.methods
          .claimRefund()
          .accounts({
            customer: customer.wallet.publicKey,
            promo,
            purchase,
            mint,
            vault: vaultAddress(promo, mint),
            customerTokenAccount: customer.ata,
          } as never)
          .rpc(), // only the provider wallet signs
        "Signature verification failed",
      );
    });
  });

  // ---------------------------------------------------------------------------- claim_merchant
  describe("claim_merchant", () => {
    it("pays the merchant for a hedged purchase after NO and emits MerchantPayout", async () => {
      const { promo, vault } = await createPromo();
      const { purchase } = await purchaseIn(promo, "hedged");
      await resolve(promo, "no");
      const before = await bal(merchantAta);
      const sig = await claimMerchant(promo, purchase, merchant, merchantAta);

      expect((await bal(merchantAta)) - before).to.equal(OFFER);
      expect(await bal(vault)).to.equal(0n);
      const pu = await program.account.purchase.fetch(purchase);
      expect(pu.state).to.deep.equal({ claimedByMerchant: {} });
      expect(pu.settledAt.toNumber()).to.be.greaterThan(0);
      const p = await program.account.promo.fetch(promo);
      expect(p.totalPaidOut.toString()).to.equal(OFFER.toString());
      await expectConserved(promo, vault);

      const ev = (await eventsFromTx(sig)).filter((e) => e.name === "claimevent");
      expect(ev).to.have.length(1);
      expect(ev[0]!.data.kind).to.deep.equal({ merchantPayout: {} });
      expect((ev[0]!.data.recipient as PublicKey).toBase58()).to.equal(
        merchant.publicKey.toBase58(),
      );
      expect((ev[0]!.data.amount as anchor.BN).toString()).to.equal(OFFER.toString());
    });

    it("pays out to a merchant-owned token account other than the ATA", async () => {
      const { promo } = await createPromo();
      const { purchase } = await purchaseIn(promo, "hedged");
      await resolve(promo, "no");
      // a plain (non-associated) token account owned by the merchant
      const second = await createAccount(
        connection,
        payer,
        mint,
        merchant.publicKey,
        Keypair.generate(),
      );
      expect(second.toBase58()).to.not.equal(merchantAta.toBase58());
      await claimMerchant(promo, purchase, merchant, second);
      expect(await bal(second)).to.equal(OFFER);
      expect(await pState(purchase)).to.equal("claimedByMerchant");
    });

    it("cannot be claimed twice (AlreadyClaimed)", async () => {
      const { promo, vault } = await createPromo();
      const { purchase } = await purchaseIn(promo, "hedged");
      await purchaseIn(promo, "deposited"); // extra funds a double claim must not drain
      await resolve(promo, "no");
      await claimMerchant(promo, purchase, merchant, merchantAta);
      const after = await bal(merchantAta);
      await expectError(claimMerchant(promo, purchase, merchant, merchantAta), "AlreadyClaimed");
      expect(await bal(merchantAta)).to.equal(after);
      expect(await bal(vault)).to.equal(OFFER);
    });

    it("is rejected before resolution and after YES", async () => {
      const { promo, vault } = await createPromo();
      const { purchase } = await purchaseIn(promo, "hedged");
      await expectError(claimMerchant(promo, purchase, merchant, merchantAta), "InvalidState");
      await resolve(promo, "yes");
      await expectError(claimMerchant(promo, purchase, merchant, merchantAta), "InvalidState");
      expect(await bal(vault)).to.equal(OFFER);
      expect(await pState(purchase)).to.equal("hedged");
    });

    it("can never pay a Deposited or Cancelled purchase to the merchant, even after NO", async () => {
      const { promo, vault } = await createPromo();
      const open = await purchaseIn(promo, "deposited");
      const cancelled = await purchaseIn(promo, "cancelled");
      await resolve(promo, "no");
      await expectError(claimMerchant(promo, open.purchase, merchant, merchantAta), "InvalidState");
      await expectError(
        claimMerchant(promo, cancelled.purchase, merchant, merchantAta),
        "InvalidState",
      );
      expect(await bal(vault)).to.equal(2n * OFFER);
    });

    it("is rejected for an already refunded / customer-claimed purchase", async () => {
      const { promo } = await createPromo();
      const refunded = await purchaseIn(promo, "cancelled");
      await claimRefund(promo, refunded.purchase, refunded.customer.wallet, refunded.customer.ata);
      await resolve(promo, "no");
      await expectError(
        claimMerchant(promo, refunded.purchase, merchant, merchantAta),
        "AlreadyClaimed",
      );

      const yes = await createPromo();
      const hedged = await purchaseIn(yes.promo, "hedged");
      await resolve(yes.promo, "yes");
      await claimRefund(yes.promo, hedged.purchase, hedged.customer.wallet, hedged.customer.ata);
      await expectError(
        claimMerchant(yes.promo, hedged.purchase, merchant, merchantAta),
        "AlreadyClaimed",
      );
    });

    it("rejects any signer other than promo.merchant", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "hedged");
      await resolve(promo, "no");
      const otherMerchant = await fundedWallet();
      const otherAta = await createAssociatedTokenAccount(
        connection,
        payer,
        mint,
        otherMerchant.publicKey,
      );
      await expectError(
        claimMerchant(promo, purchase, customer.wallet, customer.ata),
        "Unauthorized",
      );
      await expectError(claimMerchant(promo, purchase, otherMerchant, otherAta), "Unauthorized");
      await expectError(claimMerchant(promo, purchase, relayer, merchantAta), "Unauthorized");
      await expectError(claimMerchant(promo, purchase, payer, merchantAta), "Unauthorized");
      expect(await bal(vault)).to.equal(OFFER);
    });

    it("rejects a destination owned by someone else", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "hedged");
      await resolve(promo, "no");
      await expectError(
        claimMerchant(promo, purchase, merchant, customer.ata),
        "WrongTokenAccount",
      );
    });

    it("rejects a destination or mint account of the wrong mint", async () => {
      const { promo } = await createPromo();
      const { purchase } = await purchaseIn(promo, "hedged");
      await resolve(promo, "no");
      const otherMint = await newMint(6);
      const wrongAta = await createAssociatedTokenAccount(
        connection,
        payer,
        otherMint,
        merchant.publicKey,
      );
      await expectError(claimMerchant(promo, purchase, merchant, wrongAta), "WrongMint");
      await expectError(
        claimMerchant(promo, purchase, merchant, merchantAta, { mint: otherMint }),
        "WrongMint",
      );
    });

    it("rejects a vault that is not the promo's vault", async () => {
      const a = await createPromo();
      const b = await createPromo();
      await purchaseIn(b.promo, "deposited");
      const { purchase } = await purchaseIn(a.promo, "hedged");
      await resolve(a.promo, "no");
      await expectError(
        claimMerchant(a.promo, purchase, merchant, merchantAta, { vault: b.vault }),
        "WrongTokenAccount",
      );
    });

    it("rejects a purchase from a different promo, and a different merchant's promo", async () => {
      const a = await createPromo();
      const b = await createPromo();
      const { purchase } = await purchaseIn(a.promo, "hedged");
      await resolve(a.promo, "no");
      await resolve(b.promo, "no");
      await expectError(claimMerchant(b.promo, purchase, merchant, merchantAta), "ConstraintSeeds");

      // another merchant's own promo: they can't claim a purchase from `a` through their promo
      const m2 = await fundedWallet();
      const m2Ata = await createAssociatedTokenAccount(connection, payer, mint, m2.publicKey);
      const c = await createPromo(m2);
      await resolve(c.promo, "no");
      await expectError(claimMerchant(c.promo, purchase, m2, m2Ata), "ConstraintSeeds");
      await expectError(claimMerchant(a.promo, purchase, m2, m2Ata), "Unauthorized");
    });

    it("is blocked while paused, then works after unpausing", async () => {
      const { promo } = await createPromo();
      const { purchase } = await purchaseIn(promo, "hedged");
      await resolve(promo, "no");
      await setPaused(true);
      await expectError(claimMerchant(promo, purchase, merchant, merchantAta), "Paused");
      expect(await pState(purchase)).to.equal("hedged");
      await setPaused(false);
      await claimMerchant(promo, purchase, merchant, merchantAta);
      expect(await pState(purchase)).to.equal("claimedByMerchant");
    });

    it("requires the merchant to actually sign", async () => {
      const { promo } = await createPromo();
      const { purchase } = await purchaseIn(promo, "hedged");
      await resolve(promo, "no");
      await expectError(
        program.methods
          .claimMerchant()
          .accounts({
            merchant: merchant.publicKey,
            promo,
            purchase,
            mint,
            vault: vaultAddress(promo, mint),
            merchantTokenAccount: merchantAta,
          } as never)
          .rpc(),
        "Signature verification failed",
      );
    });
  });

  // ------------------------------------------------------------------------------ shared vault
  describe("multiple purchases sharing one vault", () => {
    it("NO: merchant gets hedged purchases, customers get cancelled ones, nothing leaks", async () => {
      const { promo, vault } = await createPromo();
      const h1 = await purchaseIn(promo, "hedged");
      const h2 = await purchaseIn(promo, "hedged");
      const c1 = await purchaseIn(promo, "cancelled");
      const open = await purchaseIn(promo, "deposited");
      expect(await bal(vault)).to.equal(4n * OFFER);
      await resolve(promo, "no");

      const merchantBefore = await bal(merchantAta);
      await claimMerchant(promo, h1.purchase, merchant, merchantAta);
      expect(await bal(vault)).to.equal(3n * OFFER);
      await expectConserved(promo, vault);
      await claimMerchant(promo, h2.purchase, merchant, merchantAta);
      await claimRefund(promo, c1.purchase, c1.customer.wallet, c1.customer.ata);
      expect((await bal(merchantAta)) - merchantBefore).to.equal(2n * OFFER);
      expect(await bal(c1.customer.ata)).to.equal(OFFER);

      // the still-Deposited purchase's funds are untouched and cannot be taken
      expect(await bal(vault)).to.equal(OFFER);
      await expectError(claimMerchant(promo, open.purchase, merchant, merchantAta), "InvalidState");
      await expectError(
        claimRefund(promo, open.purchase, open.customer.wallet, open.customer.ata),
        "InvalidState",
      );
      const mid = await expectConserved(promo, vault);
      expect(mid.paid).to.equal(3n * OFFER);

      // relayer cancels it later -> customer refunded, vault fully drained, books balance
      await cancelUnhedged(promo, open.purchase);
      await claimRefund(promo, open.purchase, open.customer.wallet, open.customer.ata);
      const end = await expectConserved(promo, vault);
      expect(end.paid).to.equal(end.dep);
      expect(await bal(vault)).to.equal(0n);
      const p = await program.account.promo.fetch(promo);
      expect(p.purchaseCount.toNumber()).to.equal(4);
    });

    it("YES: each hedged customer claims only their own amount; merchant gets nothing", async () => {
      const { promo, vault } = await createPromo();
      const alice = await customerWithTokens(mint, 2n * OFFER);
      const a1 = await purchaseIn(promo, "hedged", alice);
      const a2 = await purchaseIn(promo, "hedged", alice); // same customer, two purchases
      const b1 = await purchaseIn(promo, "hedged");
      await resolve(promo, "yes");
      const merchantBefore = await bal(merchantAta);

      await claimRefund(promo, a1.purchase, alice.wallet, alice.ata);
      expect(await bal(alice.ata)).to.equal(OFFER);
      expect(await bal(vault)).to.equal(2n * OFFER);
      // Bob cannot claim Alice's second purchase
      await expectError(
        claimRefund(promo, a2.purchase, b1.customer.wallet, b1.customer.ata),
        "Unauthorized",
      );
      await claimRefund(promo, a2.purchase, alice.wallet, alice.ata);
      await claimRefund(promo, b1.purchase, b1.customer.wallet, b1.customer.ata);

      expect(await bal(alice.ata)).to.equal(2n * OFFER);
      expect(await bal(b1.customer.ata)).to.equal(OFFER);
      expect(await bal(merchantAta)).to.equal(merchantBefore);
      for (const x of [a1, a2, b1]) {
        await expectError(
          claimMerchant(promo, x.purchase, merchant, merchantAta),
          "AlreadyClaimed",
        );
      }
      const end = await expectConserved(promo, vault);
      expect(end.paid).to.equal(3n * OFFER);
      expect(await bal(vault)).to.equal(0n);
    });

    it("claims in one promo never move another promo's vault", async () => {
      const a = await createPromo();
      const b = await createPromo();
      const pa = await purchaseIn(a.promo, "cancelled");
      await purchaseIn(b.promo, "deposited");
      await claimRefund(a.promo, pa.purchase, pa.customer.wallet, pa.customer.ata);
      expect(await bal(a.vault)).to.equal(0n);
      expect(await bal(b.vault)).to.equal(OFFER);
      await expectConserved(b.promo, b.vault);
    });

    it("tokens donated to the vault are not claimable and do not break accounting", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await purchaseIn(promo, "cancelled");
      const donor = await customerWithTokens(mint, 3_000_000n);
      const { transfer } = await import("@solana/spl-token");
      await transfer(connection, donor.wallet, donor.ata, vault, donor.wallet, 3_000_000n);
      await claimRefund(promo, purchase, customer.wallet, customer.ata);
      // exactly purchase.amount paid; the donation stays (vault >= deposited - paid)
      expect(await bal(customer.ata)).to.equal(OFFER);
      expect(await bal(vault)).to.equal(3_000_000n);
      const p = await program.account.promo.fetch(promo);
      expect(p.totalPaidOut.toString()).to.equal(OFFER.toString());
    });
  });
});
