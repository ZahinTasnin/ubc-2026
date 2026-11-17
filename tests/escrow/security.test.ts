// Dev 2 — security regression tests (see programs/escrow/docs/SECURITY.md). Real localnet SPL
// transfers of valueless tokens; the hedge is only the relayer's on-chain flag.
import * as anchor from "@coral-xyz/anchor";
import { createAssociatedTokenAccount, getAccount, transfer } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import {
  OFFER,
  PROMO_WINDOW_S,
  chainNow,
  configPda,
  connection,
  customerWithTokens,
  ensureConfig,
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
} from "./helpers";

const BN = anchor.BN;
// Distinct compute limits make otherwise-identical transactions differ (different signature).
// Identical transactions are deduplicated by the network and would trivially "succeed" twice.
const cuLimit = (units: number) => ComputeBudgetProgram.setComputeUnitLimit({ units });
type Wallet = { wallet: Keypair; ata: PublicKey };

describe("escrow security regressions", () => {
  let mint: PublicKey;
  let relayer: Keypair;
  let merchant: Keypair;
  let merchantAta: PublicKey;
  let nonce = 5000;

  const initPromoIx = (n: number, owner: Keypair, deadline: number) =>
    program.methods
      .initializePromo(new BN(n), new BN(OFFER.toString()), new BN(deadline), "GEMI-TEXAS-WIN")
      .accounts({
        merchant: owner.publicKey,
        mint,
        vault: vaultAddress(promoPda(owner.publicKey, n), mint),
      } as never)
      .signers([owner]);

  // D4: resolve_promo only works from the deposit deadline on, so promos that get resolved use a
  // short deposit window and `resolve` waits it out (`resolveRaw` does not, for race tests).
  async function createPromo(deadlineOffset = PROMO_WINDOW_S) {
    const n = ++nonce;
    await initPromoIx(n, merchant, (await chainNow()) + deadlineOffset).rpc();
    const promo = promoPda(merchant.publicKey, n);
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
    over = {},
  ) =>
    program.methods[name]()
      .accounts({ relayer: relayer.publicKey, promo, purchase, ...over } as never)
      .signers([relayer])
      .rpc();
  const resolveRaw = (promo: PublicKey, o: "yes" | "no") =>
    program.methods
      .resolvePromo(o === "yes" ? { yes: {} } : { no: {} })
      .accounts({ relayer: relayer.publicKey, promo } as never)
      .signers([relayer])
      .rpc();
  const resolve = async (promo: PublicKey, o: "yes" | "no") => {
    await waitForPromoDeadline(promo);
    return resolveRaw(promo, o);
  };
  const claimRefundIx = (promo: PublicKey, purchase: PublicKey, c: Wallet, over = {}) =>
    program.methods
      .claimRefund()
      .accounts({
        customer: c.wallet.publicKey,
        promo,
        purchase,
        mint,
        vault: vaultAddress(promo, mint),
        customerTokenAccount: c.ata,
        ...over,
      } as never)
      .signers([c.wallet]);
  const claimMerchantIx = (promo: PublicKey, purchase: PublicKey, over = {}) =>
    program.methods
      .claimMerchant()
      .accounts({
        merchant: merchant.publicKey,
        promo,
        purchase,
        mint,
        vault: vaultAddress(promo, mint),
        merchantTokenAccount: merchantAta,
        ...over,
      } as never)
      .signers([merchant]);

  const bal = async (a: PublicKey) => (await getAccount(connection, a)).amount;
  const promoStateName = async (p: PublicKey) =>
    Object.keys((await program.account.promo.fetch(p)).state)[0];

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

  describe("vault pre-creation griefing", () => {
    it("initialize_promo still succeeds when someone pre-created the vault ATA", async () => {
      const n = ++nonce;
      const promo = promoPda(merchant.publicKey, n);
      const vault = await createAssociatedTokenAccount(
        connection,
        payer,
        mint,
        promo,
        undefined,
        undefined,
        undefined,
        true,
      );
      expect(vault.toBase58()).to.equal(vaultAddress(promo, mint).toBase58());
      // attacker also donates tokens into the pre-created vault
      const donor = await customerWithTokens(mint, 1_000_000n);
      await transfer(connection, donor.wallet, donor.ata, vault, donor.wallet, 1_000_000n);

      await initPromoIx(n, merchant, (await chainNow()) + 3600).rpc();

      const v = await getAccount(connection, vault);
      expect(v.owner.toBase58()).to.equal(promo.toBase58());
      expect(v.mint.toBase58()).to.equal(mint.toBase58());
      expect(v.delegate).to.equal(null);
      expect(v.closeAuthority).to.equal(null);
      expect((await program.account.promo.fetch(promo)).vault.toBase58()).to.equal(
        vault.toBase58(),
      );

      // funds are still exactly accounted: the donation is not claimable, purchase pays its amount
      const { purchase, customer } = await deposit(promo);
      await relayerCall("cancelUnhedged", promo, purchase);
      await claimRefundIx(promo, purchase, customer).rpc();
      expect(await bal(customer.ata)).to.equal(OFFER);
      expect(await bal(vault)).to.equal(1_000_000n);
      const p = await program.account.promo.fetch(promo);
      expect(p.totalDeposited.toString()).to.equal(OFFER.toString());
      expect(p.totalPaidOut.toString()).to.equal(OFFER.toString());
    });

    it("cannot re-initialize an existing promo (and its vault) to reset accounting", async () => {
      const n = ++nonce;
      await initPromoIx(n, merchant, (await chainNow()) + 3600).rpc();
      const promo = promoPda(merchant.publicKey, n);
      await deposit(promo);
      await expectError(
        initPromoIx(n, merchant, (await chainNow()) + 7200).rpc(),
        "already in use",
      );
      expect((await program.account.promo.fetch(promo)).totalDeposited.toString()).to.equal(
        OFFER.toString(),
      );
    });
  });

  describe("account substitution / type confusion", () => {
    it("rejects a Promo account passed as the purchase", async () => {
      const { promo } = await createPromo();
      await expectError(relayerCall("markHedged", promo, promo), "AccountDiscriminatorMismatch");
      await expectError(
        relayerCall("cancelUnhedged", promo, promo),
        "AccountDiscriminatorMismatch",
      );
    });

    it("rejects a Purchase account passed as the promo", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await expectError(
        relayerCall("markHedged", purchase, purchase),
        "AccountDiscriminatorMismatch",
      );
      await expectError(resolveRaw(purchase, "yes"), "AccountDiscriminatorMismatch");
    });

    it("rejects a non-config account in the config slot", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      await expectError(
        relayerCall("markHedged", promo, purchase, { config: promo }),
        "AccountDiscriminatorMismatch",
      );
      await expectError(
        relayerCall("cancelUnhedged", promo, purchase, { config: Keypair.generate().publicKey }),
        "AccountNotInitialized",
      );
    });

    it("rejects a substituted token program on claims", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await relayerCall("cancelUnhedged", promo, purchase);
      await expectError(
        claimRefundIx(promo, purchase, customer, { tokenProgram: SystemProgram.programId }).rpc(),
        "InvalidProgramId",
      );
      expect(await bal(vaultAddress(promo, mint))).to.equal(OFFER);
    });

    it("rejects a substituted token program on deposit", async () => {
      const { promo } = await createPromo();
      const c = await customerWithTokens(mint, OFFER);
      const id = newPurchaseId();
      await expectError(
        program.methods
          .deposit(Array.from(id), new BN(OFFER.toString()))
          .accounts({
            customer: c.wallet.publicKey,
            promo,
            mint,
            purchase: purchasePda(promo, c.wallet.publicKey, id),
            customerTokenAccount: c.ata,
            vault: vaultAddress(promo, mint),
            tokenProgram: SystemProgram.programId,
          } as never)
          .signers([c.wallet])
          .rpc(),
        "InvalidProgramId",
      );
      expect(await bal(c.ata)).to.equal(OFFER);
    });
  });

  describe("pooled-vault isolation", () => {
    it("a customer with a valid purchase in promo A cannot drain promo B's vault", async () => {
      const a = await createPromo();
      const b = await createPromo();
      const victim = await deposit(b.promo);
      const mine = await deposit(a.promo);
      await relayerCall("cancelUnhedged", a.promo, mine.purchase);
      // try: A's purchase + A's promo, but B's vault as the source
      await expectError(
        claimRefundIx(a.promo, mine.purchase, mine.customer, { vault: b.vault }).rpc(),
        "WrongTokenAccount",
      );
      // try: B's promo (whose PDA signs for B's vault) with A's purchase
      await expectError(
        claimRefundIx(b.promo, mine.purchase, mine.customer, { vault: b.vault }).rpc(),
        "ConstraintSeeds",
      );
      expect(await bal(b.vault)).to.equal(OFFER);
      expect((await program.account.purchase.fetch(victim.purchase)).state).to.deep.equal({
        deposited: {},
      });
    });

    it("total payouts across all claims never exceed total deposits", async () => {
      const { promo, vault } = await createPromo();
      const ps = [await deposit(promo), await deposit(promo), await deposit(promo)];
      await relayerCall("markHedged", promo, ps[0]!.purchase);
      await relayerCall("markHedged", promo, ps[1]!.purchase);
      await relayerCall("cancelUnhedged", promo, ps[2]!.purchase);
      await resolve(promo, "no");
      await claimMerchantIx(promo, ps[0]!.purchase).rpc();
      await claimMerchantIx(promo, ps[1]!.purchase).rpc();
      await claimRefundIx(promo, ps[2]!.purchase, ps[2]!.customer).rpc();
      const p = await program.account.promo.fetch(promo);
      expect(p.totalPaidOut.toString()).to.equal(p.totalDeposited.toString());
      expect(await bal(vault)).to.equal(0n);
      // nothing is left to claim: every further attempt fails
      await expectError(claimMerchantIx(promo, ps[0]!.purchase).rpc(), "AlreadyClaimed");
      await expectError(
        claimRefundIx(promo, ps[2]!.purchase, ps[2]!.customer).rpc(),
        "AlreadyClaimed",
      );
    });
  });

  describe("races (concurrent transactions)", () => {
    // Two identical claims in flight at once: the runtime serializes writes to the same
    // purchase/vault accounts, so exactly one may pay out.
    it("two concurrent claim_refund calls pay exactly once", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await deposit(promo); // keep extra funds in the vault that a double-pay would drain
      await relayerCall("cancelUnhedged", promo, purchase);
      const r = await Promise.allSettled([
        claimRefundIx(promo, purchase, customer)
          .preInstructions([cuLimit(200_000)])
          .rpc(),
        claimRefundIx(promo, purchase, customer)
          .preInstructions([cuLimit(200_001)])
          .rpc(),
      ]);
      expect(r.filter((x) => x.status === "fulfilled")).to.have.length(1);
      expect(await bal(customer.ata)).to.equal(OFFER);
      expect(await bal(vault)).to.equal(OFFER);
    });

    it("two concurrent claim_merchant calls pay exactly once", async () => {
      const { promo, vault } = await createPromo();
      const { purchase } = await deposit(promo);
      await deposit(promo);
      await relayerCall("markHedged", promo, purchase);
      await resolve(promo, "no");
      const before = await bal(merchantAta);
      const r = await Promise.allSettled([
        claimMerchantIx(promo, purchase)
          .preInstructions([cuLimit(200_000)])
          .rpc(),
        claimMerchantIx(promo, purchase)
          .preInstructions([cuLimit(200_001)])
          .rpc(),
      ]);
      expect(r.filter((x) => x.status === "fulfilled")).to.have.length(1);
      expect((await bal(merchantAta)) - before).to.equal(OFFER);
      expect(await bal(vault)).to.equal(OFFER);
    });

    it("concurrent YES and NO resolutions: exactly one wins and it is final", async () => {
      const { promo } = await createPromo();
      await waitForPromoDeadline(promo); // D4: only resolvable from the deadline on
      const r = await Promise.allSettled([resolveRaw(promo, "yes"), resolveRaw(promo, "no")]);
      expect(r.filter((x) => x.status === "fulfilled")).to.have.length(1);
      const winner = r[0]!.status === "fulfilled" ? "resolvedYes" : "resolvedNo";
      expect(await promoStateName(promo)).to.equal(winner);
      await expectError(resolve(promo, winner === "resolvedYes" ? "no" : "yes"), "AlreadyResolved");
    });

    it("mark_hedged racing resolve_promo: a purchase can never be Hedged under a resolved promo unless hedged first", async () => {
      const { promo } = await createPromo();
      const { purchase } = await deposit(promo);
      // mark_hedged only needs the promo Active (not before the deadline), so after the deadline
      // both transactions are legal and genuinely race each other.
      await waitForPromoDeadline(promo);
      const r = await Promise.allSettled([
        relayerCall("markHedged", promo, purchase),
        resolveRaw(promo, "no"),
      ]);
      expect(r[1]!.status).to.equal("fulfilled");
      const state = Object.keys((await program.account.purchase.fetch(purchase)).state)[0];
      // either order is legal on-chain; both leave consistent state: hedged-before-resolve, or
      // rejected (PromoNotActive) and still Deposited (refund-only).
      expect(["hedged", "deposited"]).to.include(state);
      if (r[0]!.status === "rejected") expect(state).to.equal("deposited");
    });
  });

  describe("pause matrix (full table, docs/interfaces.md §2)", () => {
    it("blocks exactly the instructions the spec says while paused", async () => {
      const promoA = await createPromo();
      const hedgedYes = await deposit(promoA.promo);
      const openDep = await deposit(promoA.promo);
      const cancelled = await deposit(promoA.promo);
      await relayerCall("markHedged", promoA.promo, hedgedYes.purchase);
      await relayerCall("cancelUnhedged", promoA.promo, cancelled.purchase);
      await resolve(promoA.promo, "yes");
      const promoB = await createPromo();
      const hedgedNo = await deposit(promoB.promo);
      await relayerCall("markHedged", promoB.promo, hedgedNo.purchase);
      await resolve(promoB.promo, "no");
      const promoC = await createPromo(); // still Active, for mark_hedged/resolve/deposit/init
      const forHedge = await deposit(promoC.promo);
      const forCancel = await deposit(promoC.promo);
      const newCustomer = await customerWithTokens(mint, OFFER);

      await setPaused(true);

      // BLOCKED while paused
      await expectError(initPromoIx(++nonce, merchant, (await chainNow()) + 3600).rpc(), "Paused");
      const id = newPurchaseId();
      await expectError(
        program.methods
          .deposit(Array.from(id), new BN(OFFER.toString()))
          .accounts({
            customer: newCustomer.wallet.publicKey,
            promo: promoC.promo,
            mint,
            purchase: purchasePda(promoC.promo, newCustomer.wallet.publicKey, id),
            customerTokenAccount: newCustomer.ata,
            vault: promoC.vault,
          } as never)
          .signers([newCustomer.wallet])
          .rpc(),
        "Paused",
      );
      await expectError(relayerCall("markHedged", promoC.promo, forHedge.purchase), "Paused");
      await expectError(resolveRaw(promoC.promo, "yes"), "Paused"); // pause check precedes timing
      await expectError(
        claimRefundIx(promoA.promo, hedgedYes.purchase, hedgedYes.customer).rpc(),
        "Paused",
      );
      await expectError(claimMerchantIx(promoB.promo, hedgedNo.purchase).rpc(), "Paused");

      // ALLOWED while paused: the paths that only return a customer's own funds, and admin ops
      await relayerCall("cancelUnhedged", promoC.promo, forCancel.purchase);
      await claimRefundIx(promoA.promo, cancelled.purchase, cancelled.customer).rpc();
      await program.methods
        .setRelayer(relayer.publicKey)
        .accounts({ admin: payer.publicKey } as never)
        .rpc();
      await setPaused(false);
      void openDep;
    });
  });

  describe("characterization of OPEN decisions (programs/escrow/docs/SECURITY.md D2–D4) — update deliberately", () => {
    // D4 was approved and is now ENFORCED (the old characterization — early resolution succeeding
    // and closing deposits — is gone). Timing details: lifecycle.test.ts "(D4)" + Rust unit tests.
    it("D4 (enforced): a promo cannot be resolved early, so it cannot be used to cut deposits short", async () => {
      const { promo } = await createPromo(3600); // deadline an hour away
      await expectError(resolveRaw(promo, "no"), "ResolutionTooEarly");
      expect(await promoStateName(promo)).to.equal("active");
      // deposits still work: nothing closed the promo early
      const { purchase } = await deposit(promo);
      expect((await program.account.purchase.fetch(purchase)).amount.toString()).to.equal(
        OFFER.toString(),
      );
    });

    it("D2a: a Deposited purchase at resolution is refund-only and needs the relayer to cancel it", async () => {
      const { promo } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await resolve(promo, "yes");
      await expectError(claimRefundIx(promo, purchase, customer).rpc(), "InvalidState");
      await expectError(claimMerchantIx(promo, purchase).rpc(), "InvalidState");
      await relayerCall("cancelUnhedged", promo, purchase);
      await claimRefundIx(promo, purchase, customer).rpc();
      expect(await bal(customer.ata)).to.equal(OFFER);
    });

    it("D2b: with no resolution, hedged funds stay locked (no timeout path exists)", async () => {
      const { promo, vault } = await createPromo(4);
      const { purchase, customer } = await deposit(promo);
      await relayerCall("markHedged", promo, purchase);
      await expectError(claimRefundIx(promo, purchase, customer).rpc(), "InvalidState");
      await expectError(claimMerchantIx(promo, purchase).rpc(), "InvalidState");
      expect(await bal(vault)).to.equal(OFFER);
    });

    it("D3: pause alone can freeze hedged payouts indefinitely, but never moves funds", async () => {
      const { promo, vault } = await createPromo();
      const { purchase, customer } = await deposit(promo);
      await relayerCall("markHedged", promo, purchase);
      await resolve(promo, "yes");
      await setPaused(true);
      await expectError(claimRefundIx(promo, purchase, customer).rpc(), "Paused");
      expect(await bal(vault)).to.equal(OFFER);
    });
  });
});
