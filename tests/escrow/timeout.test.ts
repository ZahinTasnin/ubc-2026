// Dev 2 — tests for the approved D2 scope: customer-signed timeout recovery of purchases that are
// still `Deposited` (`cancel_expired_deposit`) and the admin `set_cancel_timeout`.
// Hedged purchases are NEVER cancelled by timeout (an on-chain timeout does not prove an off-chain
// hedge was unwound) and keep waiting for resolution. The hedge here is only the relayer's
// on-chain flag; token movement is real (valueless) localnet SPL transfers.
//
// The EXACT boundary (timeout-1 / timeout / timeout+1, overflow) is covered by the Rust unit tests
// in programs/escrow/src/state/mod.rs, because a transaction cannot be steered onto an exact
// second; here we test clearly-before and clearly-after.
import * as anchor from "@coral-xyz/anchor";
import { createAssociatedTokenAccount, getAccount } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  CANCEL_TIMEOUT_S,
  OFFER,
  PROMO_WINDOW_S,
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
  waitForPromoDeadline,
  waitUntilChainTime,
} from "./helpers";

const BN = anchor.BN;
type Wallet = { wallet: Keypair; ata: PublicKey };

describe("escrow customer timeout recovery (cancel_expired_deposit / set_cancel_timeout)", () => {
  let mint: PublicKey;
  let relayer: Keypair;
  let merchant: Keypair;
  let merchantAta: PublicKey;
  let nonce = 8000;

  async function createPromo(windowS = 3600) {
    const n = ++nonce;
    const promo = promoPda(merchant.publicKey, n);
    await program.methods
      .initializePromo(
        new BN(n),
        new BN(OFFER.toString()),
        new BN((await chainNow()) + windowS),
        "GEMI-TEXAS-WIN",
      )
      .accounts({ merchant: merchant.publicKey, mint, vault: vaultAddress(promo, mint) } as never)
      .signers([merchant])
      .rpc();
    return { promo, vault: vaultAddress(promo, mint) };
  }

  async function deposit(promo: PublicKey, c?: Wallet) {
    const customer = c ?? (await customerWithTokens(mint, OFFER));
    const id = newPurchaseId();
    const purchase = purchasePda(promo, customer.wallet.publicKey, id);
    await program.methods
      .deposit(Array.from(id), new BN(OFFER.toString()))
      .accounts({
        customer: customer.wallet.publicKey,
        promo,
        mint,
        purchase,
        customerTokenAccount: customer.ata,
        vault: vaultAddress(promo, mint),
      } as never)
      .signers([customer.wallet])
      .rpc();
    return { purchase, customer };
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
  const resolveRaw = (promo: PublicKey, o: "yes" | "no") =>
    program.methods
      .resolvePromo(o === "yes" ? { yes: {} } : { no: {} })
      .accounts({ relayer: relayer.publicKey, promo } as never)
      .signers([relayer])
      .rpc();

  const cancelIx = (promo: PublicKey, purchase: PublicKey, signer: Keypair, over = {}) =>
    program.methods
      .cancelExpiredDeposit()
      .accounts({ customer: signer.publicKey, promo, purchase, ...over } as never)
      .signers([signer]);

  const claimRefund = (promo: PublicKey, purchase: PublicKey, c: Wallet) =>
    program.methods
      .claimRefund()
      .accounts({
        customer: c.wallet.publicKey,
        promo,
        purchase,
        mint,
        vault: vaultAddress(promo, mint),
        customerTokenAccount: c.ata,
      } as never)
      .signers([c.wallet])
      .rpc();

  const bal = async (a: PublicKey) => (await getAccount(connection, a)).amount;
  const pState = async (p: PublicKey) =>
    Object.keys((await program.account.purchase.fetch(p)).state)[0];

  /** Waits until chain time is safely past deposited_at + the promo's snapshotted timeout. */
  async function waitForTimeout(promo: PublicKey, purchase: PublicKey) {
    const [pr, pu] = await Promise.all([
      program.account.promo.fetch(promo),
      program.account.purchase.fetch(purchase),
    ]);
    await waitUntilChainTime(pu.depositedAt.toNumber() + pr.cancelTimeoutSecs.toNumber() + 1);
  }

  async function expectConserved(promo: PublicKey, vault: PublicKey) {
    const p = await program.account.promo.fetch(promo);
    expect(await bal(vault)).to.equal(
      BigInt(p.totalDeposited.toString()) - BigInt(p.totalPaidOut.toString()),
    );
    return p;
  }

  const setTimeout_ = (secs: number, signer?: Keypair) => {
    const b = program.methods
      .setCancelTimeout(new BN(secs))
      .accounts({ admin: (signer ?? payer).publicKey } as never);
    return (signer ? b.signers([signer]) : b).rpc();
  };

  before(async () => {
    ({ mint } = await ensureConfig());
    relayer = Keypair.generate();
    merchant = await fundedWallet();
    merchantAta = await createAssociatedTokenAccount(connection, payer, mint, merchant.publicKey);
    await program.methods
      .setRelayer(relayer.publicKey)
      .accounts({ admin: payer.publicKey } as never)
      .rpc();
    // other test files may have changed it; this file assumes the standard test value
    await setTimeout_(CANCEL_TIMEOUT_S);
  });

  afterEach(async () => {
    const cfg = await program.account.config.fetch(configPda());
    if (cfg.paused) await setPaused(false);
    if (cfg.cancelTimeoutSecs.toNumber() !== CANCEL_TIMEOUT_S) await setTimeout_(CANCEL_TIMEOUT_S);
  });

  // ------------------------------------------------------------------------ set_cancel_timeout
  describe("set_cancel_timeout", () => {
    it("is admin-only", async () => {
      const rando = await fundedWallet();
      await expectError(setTimeout_(60, rando), "Unauthorized");
      await expectError(setTimeout_(60, relayer), "Unauthorized");
      await expectError(setTimeout_(60, merchant), "Unauthorized");
      expect(
        (await program.account.config.fetch(configPda())).cancelTimeoutSecs.toNumber(),
      ).to.equal(CANCEL_TIMEOUT_S);
    });

    it("rejects values outside [1 second, 30 days]", async () => {
      for (const bad of [0, -5, 30 * 24 * 60 * 60 + 1]) {
        await expectError(setTimeout_(bad), "InvalidTimeout");
      }
      await setTimeout_(1); // minimum is allowed
      await setTimeout_(30 * 24 * 60 * 60); // maximum is allowed
    });

    it("works while paused", async () => {
      await setPaused(true);
      await setTimeout_(120);
      expect(
        (await program.account.config.fetch(configPda())).cancelTimeoutSecs.toNumber(),
      ).to.equal(120);
    });

    it("applies to FUTURE promos only: existing promos keep their snapshot", async () => {
      const old = await createPromo();
      await setTimeout_(3600);
      const fresh = await createPromo();
      expect((await program.account.promo.fetch(old.promo)).cancelTimeoutSecs.toNumber()).to.equal(
        CANCEL_TIMEOUT_S,
      );
      expect(
        (await program.account.promo.fetch(fresh.promo)).cancelTimeoutSecs.toNumber(),
      ).to.equal(3600);

      // the old promo's purchase is cancellable after ITS snapshotted timeout, not the new one
      const { purchase, customer } = await deposit(old.promo);
      await waitForTimeout(old.promo, purchase);
      await cancelIx(old.promo, purchase, customer.wallet).rpc();
      expect(await pState(purchase)).to.equal("cancelled");
      // the fresh promo's purchase is still locked for an hour
      const { purchase: p2, customer: c2 } = await deposit(fresh.promo);
      await expectError(cancelIx(fresh.promo, p2, c2.wallet).rpc(), "TimeoutNotElapsed");
    });
  });

  // ------------------------------------------------------------------ cancel_expired_deposit
  describe("cancel_expired_deposit — success path", () => {
    it("is rejected before the timeout (TimeoutNotElapsed) and changes nothing", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await expectError(cancelIx(promo, purchase, customer.wallet).rpc(), "TimeoutNotElapsed");
      const pu = await program.account.purchase.fetch(purchase);
      expect(pu.state).to.deep.equal({ deposited: {} });
      expect(pu.cancelledAt.toNumber()).to.equal(0);
      expect(await bal(vault)).to.equal(OFFER);
    });

    it("cancels a Deposited purchase after the timeout: refund entitlement, event, no tokens moved", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await waitForTimeout(promo, purchase);
      const sig = await cancelIx(promo, purchase, customer.wallet).rpc();

      const pu = await program.account.purchase.fetch(purchase);
      expect(pu.state).to.deep.equal({ cancelled: {} });
      expect(pu.cancelledAt.toNumber()).to.be.greaterThan(pu.depositedAt.toNumber());
      expect(pu.hedgedAt.toNumber()).to.equal(0);
      // entitlement only: tokens stay in the vault until claim_refund; accounting unchanged
      const p = await expectConserved(promo, vault);
      expect(p.totalPaidOut.toNumber()).to.equal(0);
      expect(await bal(customer.ata)).to.equal(0n);

      const ev = (await eventsFromTx(sig)).filter((e) => e.name === "purchasecancelledevent");
      expect(ev).to.have.length(1);
      expect((ev[0]!.data.purchase as PublicKey).toBase58()).to.equal(purchase.toBase58());
      expect((ev[0]!.data.customer as PublicKey).toBase58()).to.equal(
        customer.wallet.publicKey.toBase58(),
      );
      expect((ev[0]!.data.amount as anchor.BN).toString()).to.equal(OFFER.toString());
    });

    it("feeds the EXISTING refund flow: claim_refund pays exactly the deposit, once", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await deposit(promo); // keep extra funds in the vault that a double claim could drain
      await waitForTimeout(promo, purchase);
      await cancelIx(promo, purchase, customer.wallet).rpc();
      await claimRefund(promo, purchase, customer);
      expect(await bal(customer.ata)).to.equal(OFFER);
      expect(await pState(purchase)).to.equal("refunded");
      await expectError(claimRefund(promo, purchase, customer), "AlreadyClaimed");
      expect(await bal(customer.ata)).to.equal(OFFER);
      const p = await expectConserved(promo, vault);
      expect(p.totalPaidOut.toString()).to.equal(OFFER.toString());
    });

    it("works while paused, including the follow-up refund (own funds only)", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await waitForTimeout(promo, purchase);
      await setPaused(true);
      await cancelIx(promo, purchase, customer.wallet).rpc();
      await claimRefund(promo, purchase, customer);
      expect(await bal(customer.ata)).to.equal(OFFER);
      await expectConserved(promo, vault);
    });

    it("works on a resolved promo (the purchase can no longer be hedged)", async () => {
      const { promo } = await createPromo(PROMO_WINDOW_S);
      const { purchase, customer } = await deposit(promo);
      await waitForPromoDeadline(promo); // D4: resolution only from the deposit deadline on
      await resolveRaw(promo, "yes");
      await waitForTimeout(promo, purchase);
      await cancelIx(promo, purchase, customer.wallet).rpc();
      expect(await pState(purchase)).to.equal("cancelled");
    });

    it("is per purchase: an older purchase unlocks before a newer one, other purchases untouched", async () => {
      const { promo } = await createPromo();
      const older = await deposit(promo);
      await waitUntilChainTime((await chainNow()) + 5); // newer purchase deposited later
      const newer = await deposit(promo);
      await waitForTimeout(promo, older.purchase);
      // older is past its timeout; the newer one (deposited >= 5s later) is still locked
      await cancelIx(promo, older.purchase, older.customer.wallet).rpc();
      expect(await pState(older.purchase)).to.equal("cancelled");
      await expectError(
        cancelIx(promo, newer.purchase, newer.customer.wallet).rpc(),
        "TimeoutNotElapsed",
      );
      expect(await pState(newer.purchase)).to.equal("deposited");
    });
  });

  // ------------------------------------------------------------------------- authorization
  describe("cancel_expired_deposit — authorization and account validation", () => {
    it("only the purchase's own customer can call it (not relayer, merchant, admin, another customer)", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      const other = await customerWithTokens(mint, 0n);
      await waitForTimeout(promo, purchase); // timeout is NOT the obstacle here
      await expectError(cancelIx(promo, purchase, other.wallet).rpc(), "Unauthorized");
      await expectError(cancelIx(promo, purchase, relayer).rpc(), "Unauthorized");
      await expectError(cancelIx(promo, purchase, merchant).rpc(), "Unauthorized");
      await expectError(cancelIx(promo, purchase, payer).rpc(), "Unauthorized");
      expect(await pState(purchase)).to.equal("deposited");
    });

    it("requires the customer's signature", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await waitForTimeout(promo, purchase);
      await expectError(
        program.methods
          .cancelExpiredDeposit()
          .accounts({ customer: customer.wallet.publicKey, promo, purchase } as never)
          .rpc(), // only the provider wallet signs
        "Signature verification failed",
      );
    });

    it("rejects a purchase passed with a different promo", async () => {
      const a = await createPromo();
      const b = await createPromo();
      const { purchase, customer } = await deposit(a.promo);
      await waitForTimeout(a.promo, purchase);
      await expectError(cancelIx(b.promo, purchase, customer.wallet).rpc(), "ConstraintSeeds");
    });

    it("rejects a Promo account passed as the purchase", async () => {
      const { promo } = await createPromo();
      const c = await customerWithTokens(mint, 0n);
      await expectError(cancelIx(promo, promo, c.wallet).rpc(), "AccountDiscriminatorMismatch");
    });

    it("a customer cannot cancel someone else's purchase even after the timeout", async () => {
      const { promo, vault } = await createPromo();
      const alice = await deposit(promo);
      const bob = await deposit(promo);
      await waitForTimeout(promo, alice.purchase);
      await expectError(cancelIx(promo, alice.purchase, bob.customer.wallet).rpc(), "Unauthorized");
      expect(await bal(vault)).to.equal(2n * OFFER);
    });
  });

  // ------------------------------------------------------------------------------ state rules
  describe("cancel_expired_deposit — state rules, replay and races", () => {
    it("NEVER cancels a Hedged purchase by timeout (InvalidState) — it keeps waiting for resolution", async () => {
      const { promo, vault } = await createPromo(PROMO_WINDOW_S);
      const { purchase, customer } = await deposit(promo);
      await relayerCall("markHedged", promo, purchase);
      await waitForTimeout(promo, purchase); // far past the timeout
      await expectError(cancelIx(promo, purchase, customer.wallet).rpc(), "InvalidState");
      expect(await pState(purchase)).to.equal("hedged");
      expect(await bal(vault)).to.equal(OFFER);

      // late resolution still works and settles the hedged purchase normally (YES -> customer)
      await waitForPromoDeadline(promo);
      await resolveRaw(promo, "yes");
      await expectError(cancelIx(promo, purchase, customer.wallet).rpc(), "InvalidState");
      await claimRefund(promo, purchase, customer);
      expect(await pState(purchase)).to.equal("claimedByCustomer");
      expect(await bal(customer.ata)).to.equal(OFFER);
    });

    it("hedged purchase, NO outcome: still goes to the merchant after a long delay", async () => {
      const { promo, vault } = await createPromo(PROMO_WINDOW_S);
      const { purchase, customer } = await deposit(promo);
      await relayerCall("markHedged", promo, purchase);
      await waitForTimeout(promo, purchase);
      await expectError(cancelIx(promo, purchase, customer.wallet).rpc(), "InvalidState");
      await waitForPromoDeadline(promo);
      await resolveRaw(promo, "no");
      const before = await bal(merchantAta);
      await program.methods
        .claimMerchant()
        .accounts({
          merchant: merchant.publicKey,
          promo,
          purchase,
          mint,
          vault,
          merchantTokenAccount: merchantAta,
        } as never)
        .signers([merchant])
        .rpc();
      expect((await bal(merchantAta)) - before).to.equal(OFFER);
    });

    it("cannot be replayed: AlreadyCancelled after cancel and after refund", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await waitForTimeout(promo, purchase);
      await cancelIx(promo, purchase, customer.wallet).rpc();
      const before = await program.account.purchase.fetch(purchase);
      await expectError(cancelIx(promo, purchase, customer.wallet).rpc(), "AlreadyCancelled");
      expect((await program.account.purchase.fetch(purchase)).cancelledAt.toNumber()).to.equal(
        before.cancelledAt.toNumber(),
      );
      await claimRefund(promo, purchase, customer);
      await expectError(cancelIx(promo, purchase, customer.wallet).rpc(), "AlreadyCancelled");
    });

    it("a purchase already cancelled by the relayer reports AlreadyCancelled", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await relayerCall("cancelUnhedged", promo, purchase);
      await waitForTimeout(promo, purchase);
      await expectError(cancelIx(promo, purchase, customer.wallet).rpc(), "AlreadyCancelled");
    });

    it("leaves the relayer's cancel_unhedged and mark_hedged working as before", async () => {
      const { promo } = await createPromo();
      const a = await deposit(promo);
      const b = await deposit(promo);
      await relayerCall("cancelUnhedged", promo, a.purchase); // immediately, no timeout needed
      await relayerCall("markHedged", promo, b.purchase);
      expect(await pState(a.purchase)).to.equal("cancelled");
      expect(await pState(b.purchase)).to.equal("hedged");
    });

    it("mark_hedged after the customer timed the purchase out fails (InvalidState)", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await waitForTimeout(promo, purchase);
      await cancelIx(promo, purchase, customer.wallet).rpc();
      await expectError(relayerCall("markHedged", promo, purchase), "InvalidState");
    });

    it("races mark_hedged: after the timeout exactly one of them wins and state is consistent", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await waitForTimeout(promo, purchase);
      const r = await Promise.allSettled([
        relayerCall("markHedged", promo, purchase),
        cancelIx(promo, purchase, customer.wallet).rpc(),
      ]);
      expect(r.filter((x) => x.status === "fulfilled")).to.have.length(1);
      const state = await pState(purchase);
      expect(state).to.equal(r[0]!.status === "fulfilled" ? "hedged" : "cancelled");
      await expectConserved(promo, vault);
    });

    it("races its own double submission: exactly one of two distinct transactions succeeds", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await waitForTimeout(promo, purchase);
      const cu = (units: number) => ComputeBudgetProgram.setComputeUnitLimit({ units });
      const r = await Promise.allSettled([
        cancelIx(promo, purchase, customer.wallet)
          .preInstructions([cu(200_000)])
          .rpc(),
        cancelIx(promo, purchase, customer.wallet)
          .preInstructions([cu(200_001)])
          .rpc(),
      ]);
      expect(r.filter((x) => x.status === "fulfilled")).to.have.length(1);
      expect(await pState(purchase)).to.equal("cancelled");
    });
  });

  // -------------------------------------------------------------------------- conservation
  describe("fund conservation", () => {
    it("mixed relayer + timeout cancellations, hedged and resolved purchases balance to zero", async () => {
      const { promo, vault } = await createPromo(PROMO_WINDOW_S + 16);
      const hedged = await deposit(promo);
      const byRelayer = await deposit(promo);
      const byTimeout = await deposit(promo);
      await relayerCall("markHedged", promo, hedged.purchase);
      await relayerCall("cancelUnhedged", promo, byRelayer.purchase);
      await waitForTimeout(promo, byTimeout.purchase);
      await cancelIx(promo, byTimeout.purchase, byTimeout.customer.wallet).rpc();
      await expectConserved(promo, vault);

      await claimRefund(promo, byRelayer.purchase, byRelayer.customer);
      await claimRefund(promo, byTimeout.purchase, byTimeout.customer);
      await waitForPromoDeadline(promo);
      await resolveRaw(promo, "yes");
      await claimRefund(promo, hedged.purchase, hedged.customer);
      const p = await expectConserved(promo, vault);
      expect(p.totalPaidOut.toString()).to.equal(p.totalDeposited.toString());
      expect(await bal(vault)).to.equal(0n);
    });
  });
});
