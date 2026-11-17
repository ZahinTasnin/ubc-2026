// Dev 2 — local-validator tests for initialize_config, set_paused, initialize_promo, deposit.
// Token movement here is REAL (valueless) localnet SPL transfers; nothing is simulated.
import * as anchor from "@coral-xyz/anchor";
import { getAccount } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  CANCEL_TIMEOUT_S,
  OFFER,
  chainNow,
  configAccounts,
  configPda,
  connection,
  customerWithTokens,
  expectError,
  fundedWallet,
  newMint,
  newPurchaseId,
  payer,
  program,
  promoPda,
  purchasePda,
  vaultAddress,
  waitUntilChainTime,
} from "./helpers";

const BN = anchor.BN;
let nonceCounter = 1;
const FAR_FUTURE = () => chainNow().then((n) => new BN(n + 3600));

describe("escrow foundation", () => {
  let mint: PublicKey;
  let relayer: Keypair;
  let merchant: Keypair;
  let nonce = 0;

  async function createPromo(
    opts: {
      merchant?: Keypair;
      nonce?: number;
      offer?: bigint;
      deadline?: anchor.BN;
      marketId?: string;
      mint?: PublicKey;
    } = {},
  ) {
    const m = opts.merchant ?? merchant;
    const n = opts.nonce ?? ++nonceCounter;
    const promo = promoPda(m.publicKey, n);
    const useMint = opts.mint ?? mint;
    const sig = await program.methods
      .initializePromo(
        new BN(n),
        new BN((opts.offer ?? OFFER).toString()),
        opts.deadline ?? (await FAR_FUTURE()),
        opts.marketId ?? "GEMI-TEXAS-WIN",
      )
      .accounts({
        merchant: m.publicKey,
        mint: useMint,
        vault: vaultAddress(promo, useMint),
      } as never)
      .signers([m])
      .rpc();
    return { promo, vault: vaultAddress(promo, useMint), sig };
  }

  async function deposit(
    promo: PublicKey,
    customer: { wallet: Keypair; ata: PublicKey },
    over: {
      id?: Uint8Array;
      amount?: bigint;
      vault?: PublicKey;
      tokenAccount?: PublicKey;
      mint?: PublicKey;
    } = {},
  ) {
    const id = over.id ?? newPurchaseId();
    const purchase = purchasePda(promo, customer.wallet.publicKey, id);
    const sig = await program.methods
      .deposit(Array.from(id), new BN((over.amount ?? OFFER).toString()))
      .accounts({
        customer: customer.wallet.publicKey,
        promo,
        mint: over.mint ?? mint,
        purchase,
        customerTokenAccount: over.tokenAccount ?? customer.ata,
        vault: over.vault ?? vaultAddress(promo, mint),
      } as never)
      .signers([customer.wallet])
      .rpc();
    return { id, purchase, sig };
  }

  before(async () => {
    relayer = Keypair.generate();
    merchant = await fundedWallet();
  });

  describe("initialize_config", () => {
    it("rejects a mint that does not have 6 decimals", async () => {
      const bad = await newMint(9);
      await expectError(
        program.methods
          .initializeConfig(relayer.publicKey, new BN(CANCEL_TIMEOUT_S))
          .accounts(configAccounts(payer.publicKey, bad) as never)
          .rpc(),
        "WrongDecimals",
      );
    });

    // SECURITY regression: runs while Config does not exist yet. Before the fix, anyone could
    // call initialize_config first and become admin / pick the relayer.
    it("rejects initialization by anyone but the program's upgrade authority", async () => {
      const attacker = await fundedWallet();
      const m = await newMint(6);
      await expectError(
        program.methods
          .initializeConfig(attacker.publicKey, new BN(CANCEL_TIMEOUT_S))
          .accounts(configAccounts(attacker.publicKey, m) as never)
          .signers([attacker])
          .rpc(),
        "Unauthorized",
      );
      expect(await program.account.config.fetchNullable(configPda())).to.equal(null);
    });

    it("rejects initialization with a program_data account that is not this program's", async () => {
      const m = await newMint(6);
      await expectError(
        program.methods
          .initializeConfig(relayer.publicKey, new BN(CANCEL_TIMEOUT_S))
          .accounts({
            ...configAccounts(payer.publicKey, m),
            programData: m, // any other account
          } as never)
          .rpc(),
        "AccountOwnedByWrongProgram",
      );
      expect(await program.account.config.fetchNullable(configPda())).to.equal(null);
    });

    it("rejects the all-zero relayer", async () => {
      const m = await newMint(6);
      await expectError(
        program.methods
          .initializeConfig(PublicKey.default, new BN(CANCEL_TIMEOUT_S))
          .accounts(configAccounts(payer.publicKey, m) as never)
          .rpc(),
        "InvalidRelayer",
      );
    });

    it("rejects a cancel timeout outside the allowed range", async () => {
      const m = await newMint(6);
      for (const bad of [0, -1, 30 * 24 * 60 * 60 + 1]) {
        await expectError(
          program.methods
            .initializeConfig(relayer.publicKey, new BN(bad))
            .accounts(configAccounts(payer.publicKey, m) as never)
            .rpc(),
          "InvalidTimeout",
        );
      }
      expect(await program.account.config.fetchNullable(configPda())).to.equal(null);
    });

    it("creates the singleton config", async () => {
      mint = await newMint(6);
      await program.methods
        .initializeConfig(relayer.publicKey, new BN(CANCEL_TIMEOUT_S))
        .accounts(configAccounts(payer.publicKey, mint) as never)
        .rpc();
      const cfg = await program.account.config.fetch(configPda());
      expect(cfg.admin.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(cfg.relayer.toBase58()).to.equal(relayer.publicKey.toBase58());
      expect(cfg.mint.toBase58()).to.equal(mint.toBase58());
      expect(cfg.paused).to.equal(false);
      expect(cfg.cancelTimeoutSecs.toNumber()).to.equal(CANCEL_TIMEOUT_S);
    });

    it("cannot be initialized twice", async () => {
      await expectError(
        program.methods
          .initializeConfig(Keypair.generate().publicKey, new BN(CANCEL_TIMEOUT_S))
          .accounts(configAccounts(payer.publicKey, mint) as never)
          .rpc(),
        "already in use",
      );
    });
  });

  describe("set_paused", () => {
    it("rejects a non-admin", async () => {
      const rando = await fundedWallet();
      await expectError(
        program.methods
          .setPaused(true)
          .accounts({ admin: rando.publicKey } as never)
          .signers([rando])
          .rpc(),
        "Unauthorized",
      );
    });
  });

  describe("initialize_promo", () => {
    it("creates the promo and its pooled vault", async () => {
      nonce = 1;
      const { promo, vault } = await createPromo({ nonce });
      const p = await program.account.promo.fetch(promo);
      expect(p.merchant.toBase58()).to.equal(merchant.publicKey.toBase58());
      expect(p.mint.toBase58()).to.equal(mint.toBase58());
      expect(p.vault.toBase58()).to.equal(vault.toBase58());
      expect(p.offerAmount.toString()).to.equal(OFFER.toString());
      expect(p.marketId).to.equal("GEMI-TEXAS-WIN");
      expect(p.state).to.deep.equal({ active: {} });
      expect(p.totalDeposited.toNumber()).to.equal(0);
      expect(p.totalPaidOut.toNumber()).to.equal(0);
      expect(p.purchaseCount.toNumber()).to.equal(0);
      // the Config's recovery timeout is snapshotted into the promo
      expect(p.cancelTimeoutSecs.toNumber()).to.equal(CANCEL_TIMEOUT_S);
      const v = await getAccount(connection, vault);
      expect(v.owner.toBase58()).to.equal(promo.toBase58());
      expect(v.mint.toBase58()).to.equal(mint.toBase58());
      expect(v.amount).to.equal(0n);
    });

    it("allows one merchant several promos via different nonces", async () => {
      const a = await createPromo();
      const b = await createPromo();
      expect(a.promo.toBase58()).to.not.equal(b.promo.toBase58());
    });

    it("rejects a duplicate (merchant, nonce)", async () => {
      await expectError(createPromo({ nonce }), "already in use");
    });

    it("rejects zero offer amount", async () => {
      await expectError(createPromo({ offer: 0n }), "InvalidOfferAmount");
    });

    it("rejects an empty market id", async () => {
      await expectError(createPromo({ marketId: "" }), "EmptyMarketId");
    });

    it("rejects a market id over 64 bytes", async () => {
      await expectError(createPromo({ marketId: "x".repeat(65) }), "MarketIdTooLong");
    });

    it("accepts a market id of exactly 64 bytes", async () => {
      const { promo } = await createPromo({ marketId: "m".repeat(64) });
      expect((await program.account.promo.fetch(promo)).marketId).to.have.length(64);
    });

    it("rejects a deadline in the past", async () => {
      await expectError(
        createPromo({ deadline: new BN((await chainNow()) - 10) }),
        "InvalidDeadline",
      );
    });

    it("rejects a mint other than the configured one", async () => {
      const other = await newMint(6);
      await expectError(createPromo({ mint: other }), "WrongMint");
    });

    it("is blocked while paused", async () => {
      await program.methods
        .setPaused(true)
        .accounts({ admin: payer.publicKey } as never)
        .rpc();
      try {
        await expectError(createPromo(), "Paused");
      } finally {
        await program.methods
          .setPaused(false)
          .accounts({ admin: payer.publicKey } as never)
          .rpc();
      }
    });
  });

  describe("deposit", () => {
    let promo: PublicKey;
    let vault: PublicKey;

    before(async () => {
      ({ promo, vault } = await createPromo());
    });

    it("locks tokens in the vault and creates a Deposited purchase", async () => {
      const customer = await customerWithTokens(mint, 20_000_000n);
      const { id, purchase } = await deposit(promo, customer);

      const pu = await program.account.purchase.fetch(purchase);
      expect(pu.promo.toBase58()).to.equal(promo.toBase58());
      expect(pu.customer.toBase58()).to.equal(customer.wallet.publicKey.toBase58());
      expect(Buffer.from(pu.purchaseId).equals(Buffer.from(id))).to.equal(true);
      expect(pu.amount.toString()).to.equal(OFFER.toString());
      expect(pu.state).to.deep.equal({ deposited: {} });
      expect(pu.depositedAt.toNumber()).to.be.greaterThan(0);
      expect(pu.hedgedAt.toNumber()).to.equal(0);

      const p = await program.account.promo.fetch(promo);
      expect(p.totalDeposited.toString()).to.equal(OFFER.toString());
      expect(p.purchaseCount.toNumber()).to.equal(1);
      expect((await getAccount(connection, vault)).amount).to.equal(OFFER);
      expect((await getAccount(connection, customer.ata)).amount).to.equal(15_000_000n);
    });

    it("emits a DepositEvent", async () => {
      const customer = await customerWithTokens(mint, OFFER);
      const id = newPurchaseId();
      const purchase = purchasePda(promo, customer.wallet.publicKey, id);
      const sig = (await deposit(promo, customer, { id })).sig;
      let tx = null;
      for (let i = 0; i < 20 && !tx; i++) {
        tx = await connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx) await new Promise((r) => setTimeout(r, 300));
      }
      expect(tx, "transaction not found").to.not.equal(null);
      const coder = new anchor.BorshEventCoder(program.idl);
      const events = (tx?.meta?.logMessages ?? [])
        .filter((l) => l.startsWith("Program data: "))
        .map((l) => coder.decode(l.slice("Program data: ".length)))
        .filter((e) => e?.name.toLowerCase() === "depositevent");
      expect(events).to.have.length(1);
      const d = events[0]!.data as { purchase: PublicKey; amount: anchor.BN; customer: PublicKey };
      expect(d.purchase.toBase58()).to.equal(purchase.toBase58());
      expect(d.customer.toBase58()).to.equal(customer.wallet.publicKey.toBase58());
      expect(d.amount.toString()).to.equal(OFFER.toString());
    });

    it("rejects an amount different from the offer", async () => {
      const customer = await customerWithTokens(mint, 20_000_000n);
      await expectError(deposit(promo, customer, { amount: OFFER - 1n }), "WrongAmount");
      await expectError(deposit(promo, customer, { amount: OFFER * 2n }), "WrongAmount");
    });

    it("rejects a reused purchase_id for the same customer", async () => {
      const customer = await customerWithTokens(mint, 20_000_000n);
      const id = newPurchaseId();
      await deposit(promo, customer, { id });
      await expectError(deposit(promo, customer, { id }), "already in use");
    });

    it("rejects insufficient token balance without creating a purchase", async () => {
      const customer = await customerWithTokens(mint, OFFER - 1n);
      const id = newPurchaseId();
      await expectError(deposit(promo, customer, { id }), "insufficient funds");
      expect(
        await connection.getAccountInfo(purchasePda(promo, customer.wallet.publicKey, id)),
      ).to.equal(null);
    });

    it("rejects a token account of the wrong mint", async () => {
      const other = await newMint(6);
      const customer = await customerWithTokens(mint, OFFER);
      const wrong = await customerWithTokens(other, OFFER);
      // customer signs, but passes an ATA holding another mint (owned by another wallet too)
      await expectError(deposit(promo, customer, { tokenAccount: wrong.ata }), "WrongMint");
      const own = await customerWithTokens(other, OFFER);
      await expectError(deposit(promo, { wallet: own.wallet, ata: own.ata }), "WrongMint");
    });

    it("rejects spending from a token account owned by someone else", async () => {
      const victim = await customerWithTokens(mint, 20_000_000n);
      const attacker = await customerWithTokens(mint, 0n);
      await expectError(
        deposit(promo, attacker, { tokenAccount: victim.ata }),
        "WrongTokenAccount",
      );
      expect((await getAccount(connection, victim.ata)).amount).to.equal(20_000_000n);
    });

    it("rejects a mint account other than the promo's", async () => {
      const other = await newMint(6);
      const customer = await customerWithTokens(mint, OFFER);
      await expectError(deposit(promo, customer, { mint: other }), "WrongMint");
    });

    it("rejects a vault other than the promo's vault", async () => {
      const second = await createPromo();
      const customer = await customerWithTokens(mint, OFFER);
      await expectError(deposit(promo, customer, { vault: second.vault }), "WrongTokenAccount");
    });

    it("rejects deposits after the deadline", async () => {
      const deadline = (await chainNow()) + 4;
      const short = await createPromo({ deadline: new BN(deadline) });
      const customer = await customerWithTokens(mint, 2n * OFFER);
      await deposit(short.promo, customer); // still open
      await waitUntilChainTime(deadline);
      await expectError(deposit(short.promo, customer), "DepositClosed");
    });

    it("is blocked while paused", async () => {
      const customer = await customerWithTokens(mint, OFFER);
      await program.methods
        .setPaused(true)
        .accounts({ admin: payer.publicKey } as never)
        .rpc();
      try {
        await expectError(deposit(promo, customer), "Paused");
      } finally {
        await program.methods
          .setPaused(false)
          .accounts({ admin: payer.publicKey } as never)
          .rpc();
      }
    });

    it("fails if the customer does not sign", async () => {
      const customer = await customerWithTokens(mint, OFFER);
      const id = newPurchaseId();
      const purchase = purchasePda(promo, customer.wallet.publicKey, id);
      await expectError(
        program.methods
          .deposit(Array.from(id), new BN(OFFER.toString()))
          .accounts({
            customer: customer.wallet.publicKey,
            promo,
            mint,
            purchase,
            customerTokenAccount: customer.ata,
            vault,
          } as never)
          .rpc(), // provider wallet signs only as fee payer, not as the customer
        "Signature verification failed",
      );
    });
  });

  describe("multiple purchases under one promotion", () => {
    it("tracks each purchase separately while pooling funds in one vault", async () => {
      const { promo, vault } = await createPromo();
      const alice = await customerWithTokens(mint, 3n * OFFER);
      const bob = await customerWithTokens(mint, OFFER);

      const a1 = await deposit(promo, alice);
      const a2 = await deposit(promo, alice); // same customer, second purchase
      const b1 = await deposit(promo, bob);

      const pdas = [a1.purchase, a2.purchase, b1.purchase].map((k) => k.toBase58());
      expect(new Set(pdas).size).to.equal(3);

      const [pa1, pa2, pb1] = await Promise.all(
        [a1, a2, b1].map((x) => program.account.purchase.fetch(x.purchase)),
      );
      expect(pa1.customer.toBase58()).to.equal(alice.wallet.publicKey.toBase58());
      expect(pa2.customer.toBase58()).to.equal(alice.wallet.publicKey.toBase58());
      expect(pb1.customer.toBase58()).to.equal(bob.wallet.publicKey.toBase58());
      for (const pu of [pa1, pa2, pb1]) {
        expect(pu.amount.toString()).to.equal(OFFER.toString());
        expect(pu.state).to.deep.equal({ deposited: {} });
      }

      const p = await program.account.promo.fetch(promo);
      expect(p.purchaseCount.toNumber()).to.equal(3);
      expect(p.totalDeposited.toString()).to.equal((3n * OFFER).toString());
      // conservation: vault == totalDeposited - totalPaidOut
      expect((await getAccount(connection, vault)).amount).to.equal(
        BigInt(p.totalDeposited.toString()) - BigInt(p.totalPaidOut.toString()),
      );
      expect((await getAccount(connection, alice.ata)).amount).to.equal(OFFER);
      expect((await getAccount(connection, bob.ata)).amount).to.equal(0n);
    });

    it("keeps separate promos' vaults and accounting independent", async () => {
      const p1 = await createPromo();
      const p2 = await createPromo();
      const c = await customerWithTokens(mint, 3n * OFFER);
      await deposit(p1.promo, c);
      await deposit(p2.promo, c);
      await deposit(p2.promo, c);
      expect((await getAccount(connection, p1.vault)).amount).to.equal(OFFER);
      expect((await getAccount(connection, p2.vault)).amount).to.equal(2n * OFFER);
      expect((await program.account.promo.fetch(p1.promo)).purchaseCount.toNumber()).to.equal(1);
      expect((await program.account.promo.fetch(p2.promo)).purchaseCount.toNumber()).to.equal(2);
    });

    it("lets the same purchase_id be used by different customers", async () => {
      const { promo } = await createPromo();
      const id = newPurchaseId();
      const a = await customerWithTokens(mint, OFFER);
      const b = await customerWithTokens(mint, OFFER);
      const x = await deposit(promo, a, { id });
      const y = await deposit(promo, b, { id });
      expect(x.purchase.toBase58()).to.not.equal(y.purchase.toBase58());
    });
  });
});
