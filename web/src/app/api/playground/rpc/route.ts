import { NextRequest } from "next/server";
import { getSuiRpcUrl } from "@/lib/sui";

/**
 * POST /api/playground/rpc
 *
 * Server-side proxy for the Sui JSON-RPC. The /playground page lets users
 * pick a method (suix_getBalance, sui_getLatestCheckpointSequenceNumber,
 * suix_getCoinMetadata, etc.) and we forward the call to the configured
 * Tatum gateway with our server-side `TATUM_API_KEY`.
 *
 * Acts as the "MCP-style" tool surface for AI agents that don't have
 * direct Tatum credentials — they hit this proxy with a structured
 * request and we return the raw RPC result.
 *
 * Body:
 *   { method: string, params: unknown[] }
 *
 * Whitelisted methods only; anything not in METHOD_ALLOWLIST is rejected
 * so this proxy can't be turned into an arbitrary RPC tunnel.
 */
const METHOD_ALLOWLIST = new Set([
  "sui_getLatestCheckpointSequenceNumber",
  "sui_getChainIdentifier",
  "suix_getReferenceGasPrice",
  "suix_getBalance",
  "suix_getAllBalances",
  "suix_getCoins",
  "suix_getCoinMetadata",
  "suix_getOwnedObjects",
  "sui_getObject",
  "sui_getTransactionBlock",
  "suix_queryEvents",
  "suix_resolveNameServiceAddress",
]);

export async function POST(request: NextRequest) {
  let body: { method?: string; params?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const method = body.method;
  if (!method || typeof method !== "string") {
    return Response.json({ error: "method is required" }, { status: 400 });
  }
  if (!METHOD_ALLOWLIST.has(method)) {
    return Response.json(
      {
        error: `Method '${method}' is not allowed. Whitelisted methods: ${Array.from(METHOD_ALLOWLIST).join(", ")}`,
      },
      { status: 403 },
    );
  }

  const params = Array.isArray(body.params) ? body.params : [];
  const apiKey = process.env.TATUM_API_KEY;
  const url = getSuiRpcUrl();

  try {
    const t0 = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const latencyMs = Date.now() - t0;
    const json = await res.json();
    return Response.json(
      {
        method,
        params,
        provider: url.includes("gateway.tatum.io") ? "tatum" : "public",
        latencyMs,
        result: json.result,
        error: json.error,
      },
      { status: res.ok ? 200 : 502 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "RPC call failed";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function GET() {
  // Discoverability — agents can hit GET to learn what's allowed.
  return Response.json({
    description:
      "Tatum-backed Sui JSON-RPC proxy. POST { method, params } with one of the whitelisted methods.",
    rpc: getSuiRpcUrl(),
    provider: getSuiRpcUrl().includes("gateway.tatum.io") ? "tatum" : "public",
    methods: Array.from(METHOD_ALLOWLIST),
  });
}
