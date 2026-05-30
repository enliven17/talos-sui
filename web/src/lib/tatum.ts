/**
 * Tatum Data API helpers (beyond JSON-RPC).
 *
 * Tatum exposes two surfaces for Sui:
 *
 *   1. JSON-RPC gateway: `https://sui-<network>.gateway.tatum.io` — the
 *      Mysten-spec RPC, used by `getSuiClient()` for transactions and
 *      cheap reads. Implemented in `web/src/lib/sui.ts`.
 *
 *   2. REST Data API: `https://api.tatum.io/v3/...` and v4 endpoints —
 *      indexed views (account balances across chains, NFT ownership,
 *      transaction history) backed by Tatum's own indexer. This file
 *      wraps the v3/v4 endpoints we actually use.
 *
 * Both surfaces share the same `TATUM_API_KEY`, sent as the `x-api-key`
 * header. The helpers below default-fail-soft so the dashboard keeps
 * rendering even when the Tatum free tier rate-limits.
 *
 * Docs: https://docs.tatum.io/reference/rpc-sui (RPC)
 *       https://docs.tatum.io/reference/data-api (Data)
 */
const TATUM_BASE = "https://api.tatum.io";

function key(): string | null {
  return process.env.TATUM_API_KEY ?? null;
}

async function tatumGet<T>(path: string): Promise<T | null> {
  const apiKey = key();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${TATUM_BASE}${path}`, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface TatumGatewayStatus {
  ok: boolean;
  provider: "tatum" | "public";
  hasKey: boolean;
  network: string;
}

/**
 * Return whether the current process can talk to Tatum and which Sui
 * gateway URL we will route through. Used by `/api/rpc-status` and the
 * header status pill.
 */
export function tatumStatus(): TatumGatewayStatus {
  const network = process.env.SUI_NETWORK ?? "testnet";
  const hasKey = !!key();
  return {
    ok: hasKey,
    provider: hasKey ? "tatum" : "public",
    hasKey,
    network,
  };
}

/**
 * Look up a Sui address's holdings via Tatum's cross-chain Data API.
 *
 * On the Tatum side this powers a wallet-level view rather than a single
 * coin-type call; useful for showing every Mitos coin a patron owns
 * without grepping every Coin<T> type. Returns null on free-tier 404.
 *
 * Endpoint: GET /v4/data/wallet/balances?chain=sui-${network}&addresses=…
 */
export async function getAddressPortfolio(
  address: string,
): Promise<unknown | null> {
  const network = process.env.SUI_NETWORK ?? "testnet";
  return tatumGet(
    `/v4/data/wallet/balances?chain=sui-${network}&addresses=${address}`,
  );
}

/**
 * Recent transaction history for an address via Tatum's indexer.
 *
 * Endpoint: GET /v4/data/transaction/history?chain=sui-${network}&addresses=…
 */
export async function getAddressTxHistory(
  address: string,
  pageSize = 25,
): Promise<unknown | null> {
  const network = process.env.SUI_NETWORK ?? "testnet";
  return tatumGet(
    `/v4/data/transaction/history?chain=sui-${network}&addresses=${address}&pageSize=${pageSize}`,
  );
}

/**
 * Build a Tatum dashboard share-link for the configured API key.
 *
 * Surfaced in the docs / `/playground` page so judges can see exactly
 * where to set up the same gateway.
 */
export function tatumDashboardUrl(): string {
  return "https://dashboard.tatum.io";
}

// ─── Webhook subscriptions ──────────────────────────────────────────
// Tatum's Notification Subscriptions API lets us subscribe to on-chain
// events and receive callbacks at our own webhook URL. For Talos we
// subscribe to incoming USDC transfers on every agent's Sui wallet so
// the marketplace gets a real-time push the moment an agent gets paid.
// Docs: https://docs.tatum.io/reference/createnotification

const TATUM_NOTIFICATIONS = `${TATUM_BASE}/v3/subscription`;

export type TatumNotificationType =
  | "INCOMING_NATIVE_TX"
  | "INCOMING_FUNGIBLE_TX"
  | "ADDRESS_TRANSACTION";

export interface TatumSubscription {
  id: string;
  type: TatumNotificationType;
  attr: Record<string, unknown>;
}

async function tatumPost<T>(
  path: string,
  body: unknown,
): Promise<T | null> {
  const apiKey = key();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${TATUM_BASE}${path}`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(
        `[tatum] POST ${path} → ${res.status} ${await res.text().catch(() => "")}`,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn("[tatum] webhook subscribe failed:", err);
    return null;
  }
}

/**
 * Subscribe to incoming USDC transfers on a Sui address. Returns the
 * resulting Tatum subscription id (null if Tatum isn't configured).
 *
 * The callback URL should point at `/api/tatum/webhook` on this Vercel
 * deployment. Tatum will POST a `TatumWebhookPayload` (see receiver
 * route) every time the address receives a fungible token.
 */
export async function subscribeIncomingUsdc(
  suiAddress: string,
  callbackUrl: string,
): Promise<TatumSubscription | null> {
  const network = process.env.SUI_NETWORK ?? "testnet";
  return tatumPost<TatumSubscription>(`/v3/subscription`, {
    type: "INCOMING_FUNGIBLE_TX",
    attr: {
      chain: `sui-${network}`,
      address: suiAddress,
      url: callbackUrl,
    },
  });
}

/**
 * Generic helper for "watch this address for any tx" — used by the
 * activity feed on the home page so any agent that's just been topped
 * up or paid is reflected without polling.
 */
export async function subscribeAddressTransactions(
  suiAddress: string,
  callbackUrl: string,
): Promise<TatumSubscription | null> {
  const network = process.env.SUI_NETWORK ?? "testnet";
  return tatumPost<TatumSubscription>(`/v3/subscription`, {
    type: "ADDRESS_TRANSACTION",
    attr: {
      chain: `sui-${network}`,
      address: suiAddress,
      url: callbackUrl,
    },
  });
}

/**
 * Cancel a subscription (Talos calls this when an agent is decommissioned).
 */
export async function unsubscribe(subscriptionId: string): Promise<boolean> {
  const apiKey = key();
  if (!apiKey) return false;
  try {
    const res = await fetch(`${TATUM_NOTIFICATIONS}/${subscriptionId}`, {
      method: "DELETE",
      headers: { "x-api-key": apiKey },
    });
    return res.ok;
  } catch {
    return false;
  }
}
