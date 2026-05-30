import { getSuiClient, getSuiRpcUrl } from "@/lib/sui";
import { tatumStatus } from "@/lib/tatum";

/**
 * GET /api/rpc-status
 *
 * Lightweight health probe for the configured Sui RPC (Tatum gateway by
 * default). The dashboard header pings this every minute to surface a
 * "Tatum RPC: online" indicator and the current epoch.
 *
 * Cached at the Vercel edge for 30s to avoid hammering Tatum on dashboard
 * polling.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const url = getSuiRpcUrl();
  const status = tatumStatus();
  const provider = url.includes("gateway.tatum.io")
    ? "tatum"
    : status.provider;

  try {
    const client = getSuiClient();
    const t0 = Date.now();
    // `getLatestCheckpointSequenceNumber` is the cheapest live RPC we have;
    // it confirms the gateway, the upstream fullnode, and the network are
    // all responsive.
    const checkpoint = await client.getLatestCheckpointSequenceNumber();
    const latencyMs = Date.now() - t0;

    return Response.json(
      {
        ok: true,
        provider,
        url,
        latencyMs,
        latestCheckpoint: checkpoint,
        hasTatumKey: status.hasKey,
        network: status.network,
        ts: Date.now(),
      },
      {
        headers: {
          // CDN cache for 30s, browser revalidates after that
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "RPC unreachable";
    return Response.json(
      { ok: false, provider, url, error: message, ts: Date.now() },
      { status: 503 },
    );
  }
}
