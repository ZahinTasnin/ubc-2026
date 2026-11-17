import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import type { Escrow } from "../../target/types/escrow";

export const OFFER = 5_000_000n; // 5 mock USD, 6 decimals
export const DECIMALS = 6;

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
export const program = anchor.workspace.escrow as Program<Escrow>;
export const connection = provider.connection;
export const payer = (provider.wallet as anchor.Wallet).payer;

const u64le = (n: bigint | number) => new anchor.BN(n.toString()).toArrayLike(Buffer, "le", 8);

export const configPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
export const promoPda = (merchant: PublicKey, nonce: bigint | number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("promo"), merchant.toBuffer(), u64le(nonce)],
    program.programId,
  )[0];
export const purchasePda = (promo: PublicKey, customer: PublicKey, id: Uint8Array) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("purchase"), promo.toBuffer(), customer.toBuffer(), Buffer.from(id)],
    program.programId,
  )[0];
export const vaultAddress = (promo: PublicKey, mint: PublicKey) =>
  getAssociatedTokenAddressSync(mint, promo, true);

export const newPurchaseId = () =>
  Uint8Array.from(Keypair.generate().publicKey.toBytes().slice(0, 16));

export async function fundedWallet(sol = 2): Promise<Keypair> {
  const kp = Keypair.generate();
  const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
  return kp;
}

export async function newMint(decimals = DECIMALS): Promise<PublicKey> {
  return createMint(connection, payer, payer.publicKey, null, decimals);
}

/** Funded customer wallet with an ATA holding `tokens` base units of `mint`. */
export async function customerWithTokens(mint: PublicKey, tokens: bigint) {
  const wallet = await fundedWallet();
  const ata = await createAssociatedTokenAccount(connection, payer, mint, wallet.publicKey);
  if (tokens > 0n) await mintTo(connection, payer, mint, ata, payer, tokens);
  return { wallet, ata };
}

export async function chainNow(): Promise<number> {
  const slot = await connection.getSlot("confirmed");
  return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

export async function waitUntilChainTime(ts: number) {
  while ((await chainNow()) < ts) await new Promise((r) => setTimeout(r, 500));
}

/** Asserts `p` rejects with the named Anchor error code (or a message/log substring). */
export async function expectError(p: Promise<unknown>, expected: string) {
  try {
    await p;
  } catch (e) {
    const err = e as {
      error?: { errorCode?: { code?: string } };
      message?: string;
      logs?: string[];
    };
    const code = err.error?.errorCode?.code;
    const text = `${err.message ?? ""} ${(err.logs ?? []).join(" ")}`;
    if (code === expected || text.includes(expected)) return;
    throw new Error(`expected "${expected}", got code=${code} message=${err.message}`);
  }
  expect.fail(`expected failure "${expected}" but the call succeeded`);
}

/** Returns the configured mint, creating the singleton Config first if this run has none yet. */
export async function ensureConfig(): Promise<{ mint: PublicKey }> {
  const existing = await program.account.config.fetchNullable(configPda());
  if (existing) return { mint: existing.mint };
  const mint = await newMint();
  await program.methods
    .initializeConfig(Keypair.generate().publicKey)
    .accounts({ admin: payer.publicKey, mint } as never)
    .rpc();
  return { mint };
}

export async function setPaused(paused: boolean) {
  await program.methods
    .setPaused(paused)
    .accounts({ admin: payer.publicKey } as never)
    .rpc();
}

/** Decoded program events of one confirmed tx (name is lower-cased, e.g. "depositevent"). */
export async function eventsFromTx(sig: string) {
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
  return (tx!.meta?.logMessages ?? [])
    .filter((l) => l.startsWith("Program data: "))
    .map((l) => coder.decode(l.slice("Program data: ".length)))
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .map((e) => ({ name: e.name.toLowerCase(), data: e.data as Record<string, unknown> }));
}
