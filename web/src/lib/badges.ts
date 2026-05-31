/**
 * Talos Badges — on-chain commemorative NFTs.
 *
 * The Move package `talos_badges` exposes three mint entries
 * (founder/patron/reviewer). The protocol operator holds the
 * `MinterCap` and signs every mint server-side.
 *
 * This file builds the PTBs and submits them through the same Tatum-backed
 * SuiClient used elsewhere. The package + cap object ids come from env.
 *
 * Set `TALOS_BADGES_PACKAGE` and `TALOS_BADGES_MINTER_CAP` after running
 * `sui client publish talos_badges` and `sui client objects` to find the
 * cap.
 */
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient, keypairFromSecret } from "./sui";

const PACKAGE_ID =
  process.env.TALOS_BADGES_PACKAGE ??
  process.env.NEXT_PUBLIC_TALOS_BADGES_PACKAGE ??
  "";

const MINTER_CAP =
  process.env.TALOS_BADGES_MINTER_CAP ??
  process.env.NEXT_PUBLIC_TALOS_BADGES_MINTER_CAP ??
  "";

function ready(): boolean {
  return !!(
    PACKAGE_ID &&
    MINTER_CAP &&
    process.env.SUI_OPERATOR_SECRET_KEY
  );
}

interface MintResult {
  ok: boolean;
  digest?: string;
  reason?: string;
}

async function executeMint(tx: Transaction): Promise<MintResult> {
  if (!process.env.SUI_OPERATOR_SECRET_KEY) {
    return { ok: false, reason: "SUI_OPERATOR_SECRET_KEY not set" };
  }
  try {
    const client = getSuiClient();
    const kp = keypairFromSecret(process.env.SUI_OPERATOR_SECRET_KEY);
    const result = await client.signAndExecuteTransaction({
      signer: kp,
      transaction: tx,
      options: { showEffects: true },
    });
    return { ok: true, digest: result.digest };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

export async function mintFounderBadge(args: {
  talosId: number;
  creator: string;
  name: string;
  walrusProfileBlob: string;
}): Promise<MintResult> {
  if (!ready()) {
    return { ok: false, reason: "badges package not configured" };
  }
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::badges::mint_founder`,
    arguments: [
      tx.object(MINTER_CAP),
      tx.pure.u64(BigInt(args.talosId)),
      tx.pure.address(args.creator),
      tx.pure.string(args.name),
      tx.pure.string(args.walrusProfileBlob),
      tx.pure.u64(BigInt(Date.now())),
    ],
  });
  return executeMint(tx);
}

export async function mintPatronBadge(args: {
  talosId: number;
  patron: string;
  pulseAmount: number;
  name: string;
}): Promise<MintResult> {
  if (!ready()) {
    return { ok: false, reason: "badges package not configured" };
  }
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::badges::mint_patron`,
    arguments: [
      tx.object(MINTER_CAP),
      tx.pure.u64(BigInt(args.talosId)),
      tx.pure.address(args.patron),
      tx.pure.u64(BigInt(args.pulseAmount)),
      tx.pure.string(args.name),
      tx.pure.u64(BigInt(Date.now())),
    ],
  });
  return executeMint(tx);
}

export async function mintReviewerBadge(args: {
  jobId: string;
  reviewer: string;
  rating: number;
  walrusReviewBlob: string;
}): Promise<MintResult> {
  if (!ready()) {
    return { ok: false, reason: "badges package not configured" };
  }
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::badges::mint_reviewer`,
    arguments: [
      tx.object(MINTER_CAP),
      tx.pure.string(args.jobId),
      tx.pure.address(args.reviewer),
      tx.pure.u8(Math.max(1, Math.min(5, args.rating))),
      tx.pure.string(args.walrusReviewBlob),
      tx.pure.u64(BigInt(Date.now())),
    ],
  });
  return executeMint(tx);
}

export const TALOS_BADGES_PACKAGE = PACKAGE_ID;
export const TALOS_BADGES_MINTER_CAP = MINTER_CAP;
