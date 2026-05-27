/**
 * Sui operations — core keypair management, USDC payments, balance reads.
 *
 * All RPC calls go through Tatum's Sui gateway when an env var is set,
 * otherwise fall back to the public Sui fullnode for the active network.
 *
 * Agent secret keys (Ed25519, 32 bytes) are NEVER stored in the database.
 * They are held server-side in environment variables (`TALOS_AGENT_SECRET_<id>`).
 */
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { fromBase64, MIST_PER_SUI } from "@mysten/sui/utils";

export type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

const SUI_NETWORK: SuiNetwork =
  (process.env.SUI_NETWORK as SuiNetwork) ?? "testnet";

/** Returns the RPC URL: Tatum gateway when configured, public fullnode otherwise. */
export function getSuiRpcUrl(network: SuiNetwork = SUI_NETWORK): string {
  if (process.env.SUI_RPC_URL) return process.env.SUI_RPC_URL;
  switch (network) {
    case "mainnet":
      return "https://sui-mainnet.gateway.tatum.io";
    case "testnet":
      return "https://sui-testnet.gateway.tatum.io";
    case "devnet":
      return "https://sui-devnet.gateway.tatum.io";
    default:
      return getFullnodeUrl(network);
  }
}

/**
 * Cached SuiClient. The Tatum gateway requires an API key header when present.
 */
let _client: SuiClient | null = null;
export function getSuiClient(): SuiClient {
  if (_client) return _client;
  const apiKey = process.env.TATUM_API_KEY;
  _client = new SuiClient({
    url: getSuiRpcUrl(),
    ...(apiKey
      ? {
          // The Tatum gateway accepts the API key as a header on every RPC call.
          // SuiClient takes a `fetch` override which we use to inject it.
          fetch: ((input, init) =>
            fetch(input, {
              ...init,
              headers: {
                ...(init?.headers ?? {}),
                "x-api-key": apiKey,
              },
            })) as typeof fetch,
        }
      : {}),
  });
  return _client;
}

// ─── USDC on Sui ────────────────────────────────────────────────────
// Wormhole-wrapped USDC and native Circle USDC have different type tags
// per network. Set USDC_COIN_TYPE in env to override.

const USDC_TYPE_MAINNET =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"; // native CCTP USDC mainnet
const USDC_TYPE_TESTNET =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC"; // Circle testnet USDC

export function getUsdcType(): string {
  if (process.env.USDC_COIN_TYPE) return process.env.USDC_COIN_TYPE;
  return SUI_NETWORK === "mainnet" ? USDC_TYPE_MAINNET : USDC_TYPE_TESTNET;
}

/** USDC has 6 decimals on Sui. */
export const USDC_DECIMALS = 6;

export function usdcToMicros(human: string | number): bigint {
  const n =
    typeof human === "number" ? human.toString() : String(human).trim();
  const [whole, fracRaw = ""] = n.split(".");
  const frac = (fracRaw + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(whole || "0") * 1_000_000n + BigInt(frac || "0");
}

export function microsToUsdc(micros: bigint | string | number): string {
  const m = BigInt(micros);
  const whole = m / 1_000_000n;
  const frac = (m % 1_000_000n).toString().padStart(USDC_DECIMALS, "0");
  return `${whole}.${frac}`.replace(/\.?0+$/, "") || "0";
}

// ─── Keypair management ─────────────────────────────────────────────

/**
 * Create a fresh Ed25519 keypair for an agent wallet.
 * Returns:
 *   - publicKey: 0x-prefixed Sui address (32 bytes, hex)
 *   - secretKey: suiprivkey1... bech32-encoded private key (Mysten std)
 */
export async function createAgentKeypair(): Promise<{
  publicKey: string;
  secretKey: string;
}> {
  const kp = new Ed25519Keypair();
  return {
    publicKey: kp.getPublicKey().toSuiAddress(),
    secretKey: kp.getSecretKey(),
  };
}

/** Rebuild an Ed25519Keypair from a `suiprivkey1...` bech32 string. */
export function keypairFromSecret(secretKey: string): Ed25519Keypair {
  if (secretKey.startsWith("suiprivkey")) {
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  // Legacy: raw base64-encoded 32-byte secret
  const decoded = decodeSuiPrivateKey(secretKey);
  return Ed25519Keypair.fromSecretKey(decoded.secretKey);
}

/**
 * Fund a new Sui testnet address via the public faucet. Best-effort.
 */
export async function fundTestnetAccount(address: string): Promise<void> {
  if (SUI_NETWORK !== "testnet" && SUI_NETWORK !== "devnet") return;
  try {
    const url =
      SUI_NETWORK === "devnet"
        ? "https://faucet.devnet.sui.io/v2/gas"
        : "https://faucet.testnet.sui.io/v2/gas";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
    });
    if (res.ok) {
      console.log(`[sui] Faucet funded ${address}`);
    } else {
      console.warn(`[sui] Faucet returned ${res.status} for ${address}`);
    }
  } catch (err) {
    console.warn("[sui] Faucet request failed:", err);
  }
}

// ─── Balances ───────────────────────────────────────────────────────

/** Sum of all SUI coin balances for an address, returned as decimal SUI. */
export async function getSuiBalance(address: string): Promise<string> {
  try {
    const client = getSuiClient();
    const { totalBalance } = await client.getBalance({ owner: address });
    const total = BigInt(totalBalance);
    const whole = total / MIST_PER_SUI;
    const frac = (total % MIST_PER_SUI).toString().padStart(9, "0");
    return `${whole}.${frac}`.replace(/\.?0+$/, "") || "0";
  } catch {
    return "0";
  }
}

/** Returns USDC balance as a human string. */
export async function getUSDCBalance(address: string): Promise<string> {
  try {
    const client = getSuiClient();
    const { totalBalance } = await client.getBalance({
      owner: address,
      coinType: getUsdcType(),
    });
    return microsToUsdc(BigInt(totalBalance));
  } catch {
    return "0";
  }
}

// ─── Transfers ──────────────────────────────────────────────────────

/**
 * Send USDC from `fromSecretKey` to `to`, amount in human-readable USDC units.
 * Returns the resulting Sui transaction digest.
 */
export async function sendUSDC(
  fromSecretKey: string,
  to: string,
  amount: string,
): Promise<{ txHash: string }> {
  const client = getSuiClient();
  const keypair = keypairFromSecret(fromSecretKey);
  const sender = keypair.getPublicKey().toSuiAddress();
  const micros = usdcToMicros(amount);

  // Find a USDC coin object to split from
  const coins = await client.getCoins({
    owner: sender,
    coinType: getUsdcType(),
    limit: 50,
  });
  if (coins.data.length === 0) {
    throw new Error("No USDC coins on sender to send from");
  }

  const tx = new Transaction();
  // Merge if necessary, then split & transfer
  const primary = tx.object(coins.data[0]!.coinObjectId);
  if (coins.data.length > 1) {
    tx.mergeCoins(
      primary,
      coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }
  const [coin] = tx.splitCoins(primary, [tx.pure.u64(micros)]);
  tx.transferObjects([coin!], tx.pure.address(to));

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  return { txHash: result.digest };
}

/**
 * Record an approval decision on-chain by emitting a minimal SUI self-transfer
 * carrying the approval reference in a small payload. Returns null if no
 * operator key is configured.
 */
export async function recordApprovalOnChain(
  approvalId: string,
  talosId: string,
  status: "approved" | "rejected",
  _decidedBy: string,
): Promise<{ txHash: string } | null> {
  const operatorSecret = process.env.SUI_OPERATOR_SECRET_KEY;
  if (!operatorSecret) {
    console.warn("[sui] SUI_OPERATOR_SECRET_KEY not set, skipping on-chain record");
    return null;
  }
  try {
    const client = getSuiClient();
    const keypair = keypairFromSecret(operatorSecret);
    const operator = keypair.getPublicKey().toSuiAddress();
    const memo = `${talosId.slice(0, 8)}:${approvalId.slice(0, 8)}:${status[0]}`;

    const tx = new Transaction();
    // Tiny self-transfer (1 MIST) — cheap, deterministic.
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1)]);
    tx.transferObjects([coin!], tx.pure.address(operator));
    // Attach the memo as a pure-byte arg so it appears in the tx input list.
    tx.pure.vector("u8", Array.from(new TextEncoder().encode(memo)));

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });
    return { txHash: result.digest };
  } catch (err) {
    console.error("[sui] Failed to record approval on-chain:", err);
    return null;
  }
}

// ─── Account info ───────────────────────────────────────────────────

export async function getAccountInfo(address: string): Promise<{
  exists: boolean;
  suiBalance: string;
  usdcBalance: string;
}> {
  try {
    const [sui, usdc] = await Promise.all([
      getSuiBalance(address),
      getUSDCBalance(address),
    ]);
    return { exists: true, suiBalance: sui, usdcBalance: usdc };
  } catch {
    return { exists: false, suiBalance: "0", usdcBalance: "0" };
  }
}

// ─── Address validation ─────────────────────────────────────────────

/** Validate a Sui address (0x-prefixed, 32-byte hex). */
export function isValidSuiAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(addr);
}

export { fromBase64 };
