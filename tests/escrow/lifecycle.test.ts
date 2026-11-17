// Dev 2 — local-validator tests for set_relayer, mark_hedged, cancel_unhedged, resolve_promo.
// On-chain state transitions only: the "hedge" itself is an off-chain SIMULATION by the backend;
// these tests exercise the relayer's attestation, not any real Gemini position.
import * as anchor from "@coral-xyz/anchor";
import { getAccount } from "@solana/spl-token";
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
const outcomeArg = (o: Outcome) => (o === "yes" ? { yes: {} } : { no: {} });

describe("escrow relayer & hedge lifecycle", () => {
  let mint: PublicKey;
  let relayer: Keypair;
  let merchant: Keypair;
  let nonce = 100;

  async function createPromo() {
    const n = ++nonce;
    const promo = promoPda(merchant.publicKey, n);
    await program.methods
      .initializePromo(
        new BN(n),
        new BN(OFFER.toString()),
        new BN((await chainNow()) + 3600),
        "GEMI-TEXAS-WIN",
      )
      .accounts({
        merchant: merchant.publicKey,
        mint,
        vault: vaultAddress(promo, mint),
      } as never)
      .signers([merchant])
      .rpc();
    return { promo, vault: vaultAddress(promo, mint) };
  }

  async function deposit(promo: PublicKey, customer?: { wallet: Keypair; ata: PublicKey }) {
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

  const markHedged = (promo: PublicKey, purchase: PublicKey, signer: Keypair = relayer) =>
    program.methods
      .markHedged()
      .accounts({ relayer: signer.publicKey, promo, purchase } as never)
      .signers([signer])
      .rpc();

  const cancelUnhedged = (promo: PublicKey, purchase: PublicKey, signer: Keypair = relayer) =>
    program.methods
      .cancelUnhedged()
      .accounts({ relayer: signer.publicKey, promo, purchase } as never)
      .signers([signer])
      .rpc();

  const resolve = (promo: PublicKey, outcome: Outcome, signer: Keypair = relayer) =>
    program.methods
      .resolvePromo(outcomeArg(outcome))
      .accounts({ relayer: signer.publicKey, promo } as never)
      .signers([signer])
      .rpc();

  const purchaseState = async (p: PublicKey) =>
    Object.keys((await program.account.purchase.fetch(p)).state)[0];
  const promoState = async (p: PublicKey) =>
    Object.keys((await program.account.promo.fetch(p)).state)[0];

  /** Asserts accounting/vault are exactly as after deposit (lifecycle moves no tokens). */
  async function expectFundsUntouched(promo: PublicKey, vault: PublicKey, deposits: number) {
    const p = await program.account.promo.fetch(promo);
    expect(p.totalDeposited.toString()).to.equal((BigInt(deposits) * OFFER).toString());
    expect(p.totalPaidOut.toNumber()).to.equal(0);
    expect((await getAccount(connection, vault)).amount).to.equal(BigInt(deposits) * OFFER);
  }

  before(async () => {
    ({ mint } = await ensureConfig());
    relayer = Keypair.generate();
    merchant = await fundedWallet();
    await program.methods
      .setRelayer(relayer.publicKey)
      .accounts({ admin: payer.publicKey } as never)
      .rpc();
  });

  afterEach(async () => {
    // never leak a paused state into the next test
    if ((await program.account.config.fetch(configPda())).paused) await setPaused(false);
  });

  describe("set_relayer", () => {
    it("rotates the relayer: old key loses authority, new key gains it", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      const next = await fundedWallet();

      await program.methods
        .setRelayer(next.publicKey)
        .accounts({ admin: payer.publicKey } as never)
        .rpc();
      expect((await program.account.config.fetch(configPda())).relayer.toBase58()).to.equal(
        next.publicKey.toBase58(),
      );

      await expectError(markHedged(promo, purchase, relayer), "Unauthorized");
      await markHedged(promo, purchase, next);
      expect(await purchaseState(purchase)).to.equal("hedged");

      // restore for the remaining tests
      await program.methods
        .setRelayer(relayer.publicKey)
        .accounts({ admin: payer.publicKey } as never)
        .rpc();
    });

    it("rejects a non-admin (including the current relayer)", async () => {
      await expectError(
        program.methods
          .setRelayer(Keypair.generate().publicKey)
          .accounts({ admin: relayer.publicKey } as never)
          .signers([relayer])
          .rpc(),
        "Unauthorized",
      );
      const rando = await fundedWallet();
      await expectError(
        program.methods
          .setRelayer(rando.publicKey)
          .accounts({ admin: rando.publicKey } as never)
          .signers([rando])
          .rpc(),
        "Unauthorized",
      );
    });

    it("rejects the all-zero key", async () => {
      await expectError(
        program.methods
          .setRelayer(PublicKey.default)
          .accounts({ admin: payer.publicKey } as never)
          .rpc(),
        "InvalidRelayer",
      );
    });

    it("works while paused", async () => {
      await setPaused(true);
      await program.methods
        .setRelayer(relayer.publicKey)
        .accounts({ admin: payer.publicKey } as never)
        .rpc();
    });

    it("gives the admin no relayer powers of its own", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await expectError(markHedged(promo, purchase, payer), "Unauthorized");
      await expectError(cancelUnhedged(promo, purchase, payer), "Unauthorized");
      await expectError(resolve(promo, "yes", payer), "Unauthorized");
    });
  });

  describe("mark_hedged", () => {
    it("moves Deposited -> Hedged, stamps hedged_at, emits HedgeMarkedEvent, moves no tokens", async () => {
      const { promo, vault } = await createPromo();
      const { purchase } = await deposit(promo);
      const sig = await markHedged(promo, purchase);

      const pu = await program.account.purchase.fetch(purchase);
      expect(pu.state).to.deep.equal({ hedged: {} });
      expect(pu.hedgedAt.toNumber()).to.be.greaterThan(0);
      expect(pu.cancelledAt.toNumber()).to.equal(0);
      expect(pu.amount.toString()).to.equal(OFFER.toString());
      await expectFundsUntouched(promo, vault, 1);

      const ev = (await eventsFromTx(sig)).filter((e) => e.name === "hedgemarkedevent");
      expect(ev).to.have.length(1);
      expect((ev[0]!.data.purchase as PublicKey).toBase58()).to.equal(purchase.toBase58());
      expect((ev[0]!.data.promo as PublicKey).toBase58()).to.equal(promo.toBase58());
      expect((ev[0]!.data.relayer as PublicKey).toBase58()).to.equal(relayer.publicKey.toBase58());
    });

    it("rejects a non-relayer, including the customer and the merchant", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await expectError(markHedged(promo, purchase, customer.wallet), "Unauthorized");
      await expectError(markHedged(promo, purchase, merchant), "Unauthorized");
      await expectError(markHedged(promo, purchase, Keypair.generate()), "Unauthorized");
      expect(await purchaseState(purchase)).to.equal("deposited");
    });

    it("requires the relayer to actually sign", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await expectError(
        program.methods
          .markHedged()
          .accounts({ relayer: relayer.publicKey, promo, purchase } as never)
          .rpc(), // only the provider wallet signs
        "Signature verification failed",
      );
    });

    it("cannot be replayed: second call fails with AlreadyHedged and changes nothing", async () => {
      const { promo, vault } = await createPromo();
      const { purchase } = await deposit(promo);
      await markHedged(promo, purchase);
      const before = await program.account.purchase.fetch(purchase);
      await expectError(markHedged(promo, purchase), "AlreadyHedged");
      const after = await program.account.purchase.fetch(purchase);
      expect(after.hedgedAt.toNumber()).to.equal(before.hedgedAt.toNumber());
      await expectFundsUntouched(promo, vault, 1);
    });

    it("rejects marking a cancelled purchase (InvalidState)", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await cancelUnhedged(promo, purchase);
      await expectError(markHedged(promo, purchase), "InvalidState");
      expect(await purchaseState(purchase)).to.equal("cancelled");
    });

    it("is blocked while paused", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await setPaused(true);
      await expectError(markHedged(promo, purchase), "Paused");
      await setPaused(false);
      await markHedged(promo, purchase); // works again after unpause
    });

    it("only affects the named purchase", async () => {
      const { promo } = await createPromo();
      const a = await deposit(promo);
      const b = await deposit(promo);
      await markHedged(promo, a.purchase);
      expect(await purchaseState(a.purchase)).to.equal("hedged");
      expect(await purchaseState(b.purchase)).to.equal("deposited");
    });

    it("rejects a purchase passed with a different promo", async () => {
      const p1 = await createPromo();
      const p2 = await createPromo();
      const { purchase } = await deposit(p1.promo);
      await expectError(markHedged(p2.promo, purchase), "ConstraintSeeds");
      expect(await purchaseState(purchase)).to.equal("deposited");
    });

    it("rejects a Deposited purchase once the promo is resolved (PromoNotActive)", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await resolve(promo, "yes");
      await expectError(markHedged(promo, purchase), "PromoNotActive");
      expect(await purchaseState(purchase)).to.equal("deposited");
    });

    it("keeps reporting AlreadyHedged for a hedged purchase after resolution", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await markHedged(promo, purchase);
      await resolve(promo, "no");
      await expectError(markHedged(promo, purchase), "AlreadyHedged");
    });
  });

  describe("cancel_unhedged", () => {
    it("moves Deposited -> Cancelled, emits PurchaseCancelledEvent, keeps funds escrowed", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      const sig = await cancelUnhedged(promo, purchase);

      const pu = await program.account.purchase.fetch(purchase);
      expect(pu.state).to.deep.equal({ cancelled: {} });
      expect(pu.cancelledAt.toNumber()).to.be.greaterThan(0);
      expect(pu.hedgedAt.toNumber()).to.equal(0);
      // refund entitlement only: tokens stay in the vault until claim_refund
      await expectFundsUntouched(promo, vault, 1);
      expect((await getAccount(connection, customer.ata)).amount).to.equal(0n);

      const ev = (await eventsFromTx(sig)).filter((e) => e.name === "purchasecancelledevent");
      expect(ev).to.have.length(1);
      expect((ev[0]!.data.purchase as PublicKey).toBase58()).to.equal(purchase.toBase58());
      expect((ev[0]!.data.customer as PublicKey).toBase58()).to.equal(
        customer.wallet.publicKey.toBase58(),
      );
      expect((ev[0]!.data.amount as anchor.BN).toString()).to.equal(OFFER.toString());
    });

    it("rejects a non-relayer", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await expectError(cancelUnhedged(promo, purchase, customer.wallet), "Unauthorized");
      await expectError(cancelUnhedged(promo, purchase, merchant), "Unauthorized");
      expect(await purchaseState(purchase)).to.equal("deposited");
    });

    it("can never cancel a hedged purchase (InvalidState)", async () => {
      const { promo, vault } = await createPromo();
      const { purchase } = await deposit(promo);
      await markHedged(promo, purchase);
      await expectError(cancelUnhedged(promo, purchase), "InvalidState");
      expect(await purchaseState(purchase)).to.equal("hedged");
      await expectFundsUntouched(promo, vault, 1);
    });

    it("cannot cancel a hedged purchase after resolution either", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await markHedged(promo, purchase);
      await resolve(promo, "yes");
      await expectError(cancelUnhedged(promo, purchase), "InvalidState");
    });

    it("cannot be replayed: second call fails with AlreadyCancelled", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await cancelUnhedged(promo, purchase);
      const before = await program.account.purchase.fetch(purchase);
      await expectError(cancelUnhedged(promo, purchase), "AlreadyCancelled");
      const after = await program.account.purchase.fetch(purchase);
      expect(after.cancelledAt.toNumber()).to.equal(before.cancelledAt.toNumber());
    });

    it("is allowed while paused", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await setPaused(true);
      await cancelUnhedged(promo, purchase);
      expect(await purchaseState(purchase)).to.equal("cancelled");
    });

    it("is allowed after the promo is resolved (un-hedged purchase gets its refund entitlement)", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await resolve(promo, "no");
      await cancelUnhedged(promo, purchase);
      expect(await purchaseState(purchase)).to.equal("cancelled");
    });

    it("only affects the named purchase", async () => {
      const { promo } = await createPromo();
      const a = await deposit(promo);
      const b = await deposit(promo);
      await cancelUnhedged(promo, a.purchase);
      expect(await purchaseState(a.purchase)).to.equal("cancelled");
      expect(await purchaseState(b.purchase)).to.equal("deposited");
    });

    it("rejects a purchase passed with a different promo", async () => {
      const p1 = await createPromo();
      const p2 = await createPromo();
      const { purchase } = await deposit(p1.promo);
      await expectError(cancelUnhedged(p2.promo, purchase), "ConstraintSeeds");
    });
  });

  describe("mark_hedged vs cancel_unhedged are mutually exclusive", () => {
    it("exactly one of two racing transactions wins", async () => {
      const { promo, vault } = await createPromo();
      const { purchase } = await deposit(promo);
      const results = await Promise.allSettled([
        markHedged(promo, purchase),
        cancelUnhedged(promo, purchase),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).to.have.length(1);
      expect(["hedged", "cancelled"]).to.include(await purchaseState(purchase));
      await expectFundsUntouched(promo, vault, 1);
    });
  });

  describe("resolve_promo", () => {
    for (const [outcome, state] of [
      ["yes", "resolvedYes"],
      ["no", "resolvedNo"],
    ] as const) {
      it(`records ${outcome.toUpperCase()} once and emits ResolutionEvent`, async () => {
        const { promo, vault } = await createPromo();
        const sig = await resolve(promo, outcome);
        const p = await program.account.promo.fetch(promo);
        expect(Object.keys(p.state)[0]).to.equal(state);
        expect(p.resolvedAt.toNumber()).to.be.greaterThan(0);
        expect((await getAccount(connection, vault)).amount).to.equal(0n);

        const ev = (await eventsFromTx(sig)).filter((e) => e.name === "resolutionevent");
        expect(ev).to.have.length(1);
        expect(ev[0]!.data.outcome).to.deep.equal(outcomeArg(outcome));
        expect((ev[0]!.data.promo as PublicKey).toBase58()).to.equal(promo.toBase58());
      });
    }

    it("rejects a non-relayer (merchant, customer, random)", async () => {
      const { promo } = await createPromo();
      const { customer } = await deposit(promo);
      await expectError(resolve(promo, "yes", merchant), "Unauthorized");
      await expectError(resolve(promo, "no", customer.wallet), "Unauthorized");
      await expectError(resolve(promo, "yes", Keypair.generate()), "Unauthorized");
      expect(await promoState(promo)).to.equal("active");
    });

    it("requires the relayer to actually sign", async () => {
      const { promo } = await createPromo();
      await expectError(
        program.methods
          .resolvePromo({ yes: {} })
          .accounts({ relayer: relayer.publicKey, promo } as never)
          .rpc(),
        "Signature verification failed",
      );
    });

    it("is one-time: same-outcome replay fails with AlreadyResolved", async () => {
      const { promo } = await createPromo();
      await resolve(promo, "yes");
      const before = await program.account.promo.fetch(promo);
      await expectError(resolve(promo, "yes"), "AlreadyResolved");
      expect((await program.account.promo.fetch(promo)).resolvedAt.toNumber()).to.equal(
        before.resolvedAt.toNumber(),
      );
    });

    it("cannot be flipped: a conflicting outcome is rejected and the first stands", async () => {
      const { promo } = await createPromo();
      await resolve(promo, "yes");
      await expectError(resolve(promo, "no"), "AlreadyResolved");
      expect(await promoState(promo)).to.equal("resolvedYes");
    });

    it("is blocked while paused, and works after unpausing", async () => {
      const { promo } = await createPromo();
      await setPaused(true);
      await expectError(resolve(promo, "yes"), "Paused");
      expect(await promoState(promo)).to.equal("active");
      await setPaused(false);
      await resolve(promo, "yes");
    });

    it("only resolves the named promo", async () => {
      const p1 = await createPromo();
      const p2 = await createPromo();
      await resolve(p1.promo, "yes");
      expect(await promoState(p2.promo)).to.equal("active");
    });

    it("rejects a forged promo account", async () => {
      const fake = Keypair.generate().publicKey;
      await expectError(resolve(fake, "yes"), "AccountNotInitialized");
    });

    it("closes the promo to new deposits", async () => {
      const { promo } = await createPromo();
      await resolve(promo, "no");
      const c = await customerWithTokens(mint, OFFER);
      await expectError(deposit(promo, c), "PromoNotActive");
    });

    it("does not touch existing purchases or the vault", async () => {
      const { promo, vault } = await createPromo();
      const hedged = await deposit(promo);
      const open = await deposit(promo);
      const cancelled = await deposit(promo);
      await markHedged(promo, hedged.purchase);
      await cancelUnhedged(promo, cancelled.purchase);
      await resolve(promo, "yes");

      expect(await purchaseState(hedged.purchase)).to.equal("hedged");
      expect(await purchaseState(open.purchase)).to.equal("deposited");
      expect(await purchaseState(cancelled.purchase)).to.equal("cancelled");
      await expectFundsUntouched(promo, vault, 3);
    });

    it("resolves a promo with no purchases", async () => {
      const { promo } = await createPromo();
      await resolve(promo, "no");
      expect(await promoState(promo)).to.equal("resolvedNo");
    });
  });

  describe("conservation", () => {
    it("vault always equals total_deposited - total_paid_out across a mixed lifecycle", async () => {
      const { promo, vault } = await createPromo();
      const ps = [await deposit(promo), await deposit(promo), await deposit(promo)];
      await markHedged(promo, ps[0]!.purchase);
      await cancelUnhedged(promo, ps[1]!.purchase);
      await resolve(promo, "yes");
      const p = await program.account.promo.fetch(promo);
      expect((await getAccount(connection, vault)).amount).to.equal(
        BigInt(p.totalDeposited.toString()) - BigInt(p.totalPaidOut.toString()),
      );
      expect(p.purchaseCount.toNumber()).to.equal(3);
    });
  });
});
