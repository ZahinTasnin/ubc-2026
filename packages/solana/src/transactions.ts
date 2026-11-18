import { DEMO_PURCHASE_AMOUNT, type Base58, type PurchaseIdHex } from "@hedged/shared";
import BN from "bn.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { getConfigAccount, getPromoState, getPurchaseState } from "./accounts";
import { createEscrowProgram, ESCROW_PROGRAM_ID } from "./idl";
import {
  deriveConfigPda,
  derivePromoPda,
  derivePurchasePda,
  deriveTokenAccount,
  deriveVaultAddress,
  newPurchaseId,
  purchaseIdToBytes,
} from "./pda";
import { MAX_MARKET_ID_LEN } from "@hedged/shared";

/**
 * Customer/merchant-signed transaction BUILDERS (browser-safe). Each returns an UNSIGNED legacy
 * Transaction with `feePayer` = the signer and a recent blockhash; the wallet signs and sends
 * (`wallet.sendTransaction(tx, connection)` with Solana Wallet Adapter). Accounts are passed
 * explicitly (`accountsStrict`) in IDL order (programs/escrow/docs/INTEGRATION.md).
 */

export interface BuiltTransaction {
  transaction: Transaction;
  /** The same instruction, for callers that compose their own transaction. */
  instruction: TransactionInstruction;
  /** Blockhash validity, for `confirmTransaction({ signature, blockhash, lastValidBlockHeight })`. */
  blockhash: string;
  lastValidBlockHeight: number;
}

interface Common {
  connection: Connection;
  programId?: Base58;
}

const pk = (v: Base58 | PublicKey) => (typeof v === "string" ? new PublicKey(v) : v);
const progId = (c: Common) => (c.programId ? new PublicKey(c.programId) : ESCROW_PROGRAM_ID);

async function finish(
  c: Common,
  payer: PublicKey,
  ix: TransactionInstruction,
): Promise<BuiltTransaction> {
  const { blockhash, lastValidBlockHeight } = await c.connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(ix);
  return { transaction, instruction: ix, blockhash, lastValidBlockHeight };
}

async function requireMint(c: Common, mint?: Base58): Promise<PublicKey> {
  if (mint) return new PublicKey(mint);
  const cfg = await getConfigAccount(c.connection, progId(c));
  if (!cfg) throw new Error("escrow Config is not initialized on this cluster");
  return new PublicKey(cfg.mint);
}

/** Merchant creates a promotion + its vault. Returns the Promo PDA too. */
export async function buildInitializePromoTransaction(
  args: Common & {
    merchant: Base58;
    /** Any unused u64; default = current unix ms (unique enough per merchant). */
    promoNonce?: bigint;
    /** Base units (6 decimals). Default 5_000_000 = 5 mock USD. */
    offerAmount?: string;
    /** Unix seconds; must be in the future and no later than the event end. */
    depositDeadline: number;
    /** Exact Gemini instrument symbol (1–64 bytes). */
    marketId: string;
    /** Config.mint; fetched when omitted. */
    mint?: Base58;
  },
): Promise<BuiltTransaction & { promoPda: Base58; promoNonce: string; vault: Base58 }> {
  const marketBytes = new TextEncoder().encode(args.marketId).length;
  if (marketBytes < 1 || marketBytes > MAX_MARKET_ID_LEN) {
    throw new Error(`marketId must be 1–${MAX_MARKET_ID_LEN} bytes`);
  }
  const programId = progId(args);
  const merchant = pk(args.merchant);
  const mint = await requireMint(args, args.mint);
  const promoNonce = args.promoNonce ?? BigInt(Date.now());
  const promo = derivePromoPda({
    programId: programId.toBase58(),
    merchant: merchant.toBase58(),
    promoNonce,
  }).address;
  const vault = deriveVaultAddress({ promo, mint: mint.toBase58() });
  const ix = await createEscrowProgram(args.connection, programId)
    .methods.initializePromo(
      new BN(promoNonce.toString()),
      new BN(args.offerAmount ?? DEMO_PURCHASE_AMOUNT),
      new BN(args.depositDeadline),
      args.marketId,
    )
    .accountsStrict({
      merchant,
      config: new PublicKey(deriveConfigPda(programId.toBase58()).address),
      mint,
      promo: new PublicKey(promo),
      vault: new PublicKey(vault),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return {
    ...(await finish(args, merchant, ix)),
    promoPda: promo,
    promoNonce: promoNonce.toString(),
    vault,
  };
}

/** Customer deposits exactly `promo.offerAmount` into the promotion vault. */
export async function buildDepositTransaction(
  args: Common & {
    customer: Base58;
    promoPda: Base58;
    /** 32 hex chars; generated when omitted. Store it: it identifies the purchase. */
    purchaseId?: PurchaseIdHex;
    /** Source token account; default = the customer's ATA for the promo mint. */
    customerTokenAccount?: Base58;
  },
): Promise<BuiltTransaction & { purchasePda: Base58; purchaseId: PurchaseIdHex; amount: string }> {
  const programId = progId(args);
  const promo = await getPromoState(args.connection, args.promoPda, { programId });
  if (!promo) throw new Error(`promotion ${args.promoPda} not found`);
  if (promo.state !== "Active") throw new Error(`promotion is ${promo.state}, deposits are closed`);
  const customer = pk(args.customer);
  const purchaseId = (args.purchaseId ?? newPurchaseId()).replace(/-/g, "").toLowerCase();
  const purchasePda = derivePurchasePda({
    programId: programId.toBase58(),
    promo: args.promoPda,
    customer: customer.toBase58(),
    purchaseId,
  }).address;
  const ix = await createEscrowProgram(args.connection, programId)
    .methods.deposit(Array.from(purchaseIdToBytes(purchaseId)), new BN(promo.offerAmount))
    .accountsStrict({
      customer,
      config: new PublicKey(deriveConfigPda(programId.toBase58()).address),
      promo: new PublicKey(args.promoPda),
      mint: new PublicKey(promo.mint),
      purchase: new PublicKey(purchasePda),
      customerTokenAccount: new PublicKey(
        args.customerTokenAccount ??
          deriveTokenAccount({ owner: customer.toBase58(), mint: promo.mint }),
      ),
      vault: new PublicKey(promo.vault),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return {
    ...(await finish(args, customer, ix)),
    purchasePda,
    purchaseId,
    amount: promo.offerAmount,
  };
}

async function loadPurchaseAndPromo(c: Common, purchasePda: Base58) {
  const programId = progId(c);
  const purchase = await getPurchaseState(c.connection, purchasePda, { programId });
  if (!purchase) throw new Error(`purchase ${purchasePda} not found`);
  const promo = await getPromoState(c.connection, purchase.promoPda, { programId });
  if (!promo) throw new Error(`promotion ${purchase.promoPda} not found`);
  return { programId, purchase, promo };
}

/**
 * Customer claims their refund: the cancel path (`Cancelled → Refunded`) or the YES path
 * (`Hedged → ClaimedByCustomer` once the promo resolved YES).
 */
export async function buildClaimRefundTransaction(
  args: Common & { purchasePda: Base58; customerTokenAccount?: Base58 },
): Promise<BuiltTransaction> {
  const { programId, purchase, promo } = await loadPurchaseAndPromo(args, args.purchasePda);
  const customer = new PublicKey(purchase.customer);
  const ix = await createEscrowProgram(args.connection, programId)
    .methods.claimRefund()
    .accountsStrict({
      customer,
      config: new PublicKey(deriveConfigPda(programId.toBase58()).address),
      promo: new PublicKey(promo.promoPda),
      purchase: new PublicKey(purchase.purchasePda),
      mint: new PublicKey(promo.mint),
      vault: new PublicKey(promo.vault),
      customerTokenAccount: new PublicKey(
        args.customerTokenAccount ??
          deriveTokenAccount({ owner: customer.toBase58(), mint: promo.mint }),
      ),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  return finish(args, customer, ix);
}

/** Merchant claims one hedged purchase after the promo resolved NO (one purchase per tx). */
export async function buildClaimMerchantTransaction(
  args: Common & { purchasePda: Base58; merchantTokenAccount?: Base58 },
): Promise<BuiltTransaction> {
  const { programId, purchase, promo } = await loadPurchaseAndPromo(args, args.purchasePda);
  const merchant = new PublicKey(promo.merchant);
  const ix = await createEscrowProgram(args.connection, programId)
    .methods.claimMerchant()
    .accountsStrict({
      merchant,
      config: new PublicKey(deriveConfigPda(programId.toBase58()).address),
      promo: new PublicKey(promo.promoPda),
      purchase: new PublicKey(purchase.purchasePda),
      mint: new PublicKey(promo.mint),
      vault: new PublicKey(promo.vault),
      merchantTokenAccount: new PublicKey(
        args.merchantTokenAccount ??
          deriveTokenAccount({ owner: merchant.toBase58(), mint: promo.mint }),
      ),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  return finish(args, merchant, ix);
}

/** Customer cancels their own still-Deposited purchase after the promo's cancel timeout. */
export async function buildCancelExpiredDepositTransaction(
  args: Common & { purchasePda: Base58 },
): Promise<BuiltTransaction> {
  const { programId, purchase, promo } = await loadPurchaseAndPromo(args, args.purchasePda);
  const customer = new PublicKey(purchase.customer);
  const ix = await createEscrowProgram(args.connection, programId)
    .methods.cancelExpiredDeposit()
    .accountsStrict({
      customer,
      config: new PublicKey(deriveConfigPda(programId.toBase58()).address),
      promo: new PublicKey(promo.promoPda),
      purchase: new PublicKey(purchase.purchasePda),
    })
    .instruction();
  return finish(args, customer, ix);
}
