/**
 * Sui Move contract interactions — registry + name service.
 *
 * Read-only calls use `devInspectTransactionBlock` against the Tatum-backed
 * SuiClient. Write calls (create_talos, register_name) build a Transaction
 * that the user signs via the dApp Kit wallet.
 */
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { getSuiClient } from "./sui";

// Client-importable: prefix with NEXT_PUBLIC_ where needed.
const REGISTRY_PACKAGE =
  process.env.NEXT_PUBLIC_TALOS_REGISTRY_PACKAGE ??
  process.env.TALOS_REGISTRY_PACKAGE ??
  "";

const REGISTRY_OBJECT =
  process.env.NEXT_PUBLIC_TALOS_REGISTRY_OBJECT ??
  process.env.TALOS_REGISTRY_OBJECT ??
  "";

const NAME_SERVICE_PACKAGE =
  process.env.NEXT_PUBLIC_TALOS_NAME_SERVICE_PACKAGE ??
  process.env.TALOS_NAME_SERVICE_PACKAGE ??
  "";

const NAME_SERVICE_OBJECT =
  process.env.NEXT_PUBLIC_TALOS_NAME_SERVICE_OBJECT ??
  process.env.TALOS_NAME_SERVICE_OBJECT ??
  "";

const CLOCK_OBJECT = "0x6"; // Sui system clock

export const TALOS_REGISTRY_PACKAGE_ID = REGISTRY_PACKAGE;
export const TALOS_REGISTRY_OBJECT_ID = REGISTRY_OBJECT;
export const TALOS_NAME_SERVICE_PACKAGE_ID = NAME_SERVICE_PACKAGE;
export const TALOS_NAME_SERVICE_OBJECT_ID = NAME_SERVICE_OBJECT;

export interface TalosCreateInput {
  name: string;
  category: string;
  description: string;
  creatorShareBps: number; // 0..10_000
  investorShareBps: number;
  treasuryShareBps: number;
  investorAddr: string;
  treasuryAddr: string;
  approvalThresholdMicros: bigint;
  gtmBudgetMicros: bigint;
  minPatronPulse: bigint;
  totalSupply: bigint;
  priceUsdMicros: bigint;
  tokenSymbol: string;
  walrusProfileBlob: string; // utf-8 string of the Walrus blob id
}

/**
 * Build a Transaction that calls `registry::create_talos`.
 * The caller is responsible for signing & dispatching it via dApp Kit.
 */
export function buildCreateTalosTx(input: TalosCreateInput): Transaction {
  if (!REGISTRY_PACKAGE || !REGISTRY_OBJECT) {
    throw new Error(
      "TALOS_REGISTRY_PACKAGE / TALOS_REGISTRY_OBJECT not configured. Run contracts/deploy.sh first.",
    );
  }
  const tx = new Transaction();
  tx.moveCall({
    target: `${REGISTRY_PACKAGE}::registry::create_talos`,
    arguments: [
      tx.object(REGISTRY_OBJECT),
      tx.pure.string(input.name),
      tx.pure.string(input.category),
      tx.pure.string(input.description),
      tx.pure.u16(input.creatorShareBps),
      tx.pure.u16(input.investorShareBps),
      tx.pure.u16(input.treasuryShareBps),
      tx.pure.address(input.investorAddr),
      tx.pure.address(input.treasuryAddr),
      tx.pure.u64(input.approvalThresholdMicros),
      tx.pure.u64(input.gtmBudgetMicros),
      tx.pure.u64(input.minPatronPulse),
      tx.pure.u64(input.totalSupply),
      tx.pure.u64(input.priceUsdMicros),
      tx.pure.string(input.tokenSymbol),
      tx.pure.vector(
        "u8",
        Array.from(new TextEncoder().encode(input.walrusProfileBlob)),
      ),
      // clock_ms — read off-chain so we don't depend on the Clock object here
      tx.pure.u64(BigInt(Date.now())),
    ],
  });
  return tx;
}

export function buildRegisterNameTx(talosId: bigint, name: string): Transaction {
  if (!NAME_SERVICE_PACKAGE || !NAME_SERVICE_OBJECT) {
    throw new Error("TALOS_NAME_SERVICE not configured. Run contracts/deploy.sh first.");
  }
  const tx = new Transaction();
  tx.moveCall({
    target: `${NAME_SERVICE_PACKAGE}::name_service::register_name`,
    arguments: [
      tx.object(NAME_SERVICE_OBJECT),
      tx.pure.u64(talosId),
      tx.pure.string(name),
    ],
  });
  return tx;
}

export function buildRecordActivityBatchTx(
  talosObjectId: string,
  walrusBlobId: string,
): Transaction {
  if (!REGISTRY_PACKAGE) {
    throw new Error("TALOS_REGISTRY_PACKAGE not configured");
  }
  const tx = new Transaction();
  tx.moveCall({
    target: `${REGISTRY_PACKAGE}::registry::record_activity_batch`,
    arguments: [
      tx.object(talosObjectId),
      tx.pure.vector(
        "u8",
        Array.from(new TextEncoder().encode(walrusBlobId)),
      ),
    ],
  });
  return tx;
}

// ─── Read-only views via devInspect ─────────────────────────────────

const SENTINEL = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Check whether a name is available on-chain. Falls back to format-only
 * validation if the contract isn't deployed yet.
 */
export async function isNameAvailableOnChain(name: string): Promise<boolean> {
  if (!NAME_SERVICE_PACKAGE || !NAME_SERVICE_OBJECT) {
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) && !/--/.test(name);
  }
  try {
    const client = getSuiClient();
    const tx = new Transaction();
    tx.moveCall({
      target: `${NAME_SERVICE_PACKAGE}::name_service::is_name_available`,
      arguments: [tx.object(NAME_SERVICE_OBJECT), tx.pure.string(name)],
    });
    const result = await client.devInspectTransactionBlock({
      sender: SENTINEL,
      transactionBlock: tx,
    });
    const ret = result.results?.[0]?.returnValues?.[0];
    if (!ret) return true;
    const [bytes] = ret;
    return bcs.Bool.parse(Uint8Array.from(bytes));
  } catch {
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) && !/--/.test(name);
  }
}

/**
 * Resolve a name to a talos_id on-chain. Returns null if not registered.
 */
export async function resolveNameOnChain(name: string): Promise<number | null> {
  if (!NAME_SERVICE_PACKAGE || !NAME_SERVICE_OBJECT) return null;
  try {
    const client = getSuiClient();
    const tx = new Transaction();
    tx.moveCall({
      target: `${NAME_SERVICE_PACKAGE}::name_service::try_resolve_name`,
      arguments: [tx.object(NAME_SERVICE_OBJECT), tx.pure.string(name)],
    });
    const result = await client.devInspectTransactionBlock({
      sender: SENTINEL,
      transactionBlock: tx,
    });
    const found = result.results?.[0]?.returnValues?.[0];
    const id = result.results?.[0]?.returnValues?.[1];
    if (!found || !id) return null;
    const isFound = bcs.Bool.parse(Uint8Array.from(found[0]));
    if (!isFound) return null;
    const value = bcs.U64.parse(Uint8Array.from(id[0]));
    return Number(value);
  } catch {
    return null;
  }
}

export { CLOCK_OBJECT };
