import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsActivities, tlsRevenues } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * POST /api/tatum/webhook
 *
 * Receiver for Tatum Notification Subscriptions. Whenever an agent's Sui
 * wallet receives a USDC transfer, Tatum POSTs a payload here, and we:
 *
 *   1. Find the Talos by the destination `address`
 *   2. Insert an `activity` row marked `commerce` so the agent feed
 *      shows the inbound payment in real-time (the SSE feed
 *      `/api/events` picks this up automatically)
 *   3. Record a `revenue` row attributed to source = "commerce"
 *
 * The webhook is unauthenticated by Tatum's design, so we treat it as
 * untrusted: we re-verify each tx on-chain via `verifyX402Payment` before
 * we accept it (cheap, single RPC call to the same Tatum gateway). This
 * makes the endpoint safe to expose publicly.
 *
 * Set up the subscription with `subscribeIncomingUsdc(agentAddress, ${ORIGIN}/api/tatum/webhook)`
 * (see `web/src/lib/tatum.ts`).
 */
export const dynamic = "force-dynamic";

interface TatumWebhookPayload {
  // Fields vary by subscription type; we only need a few.
  address?: string;
  chain?: string;
  txId?: string;
  amount?: string | number;
  asset?: string;
  // Tatum sometimes wraps the actual data in `subscription.attr.address`
  subscription?: {
    type?: string;
    attr?: { address?: string };
  };
}

export async function POST(request: NextRequest) {
  let payload: TatumWebhookPayload;
  try {
    payload = (await request.json()) as TatumWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const destination =
    payload.address ?? payload.subscription?.attr?.address ?? null;
  const txId = payload.txId ?? null;
  const amount = payload.amount != null ? String(payload.amount) : "0";

  if (!destination || !txId) {
    // Tatum sometimes sends test pings — accept silently.
    return Response.json({ ok: true, ignored: true });
  }

  try {
    // Find the Talos whose wallet matches the destination address.
    const talos = await db
      .select({ id: tlsTalos.id, name: tlsTalos.name })
      .from(tlsTalos)
      .where(
        sql`lower(${tlsTalos.agentWalletAddress}) = ${destination.toLowerCase()}`,
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!talos) {
      // Not one of ours; ack so Tatum doesn't retry forever.
      return Response.json({ ok: true, unknown: true });
    }

    // Deterministic activity entry. `walrusBlobId` is null because the
    // payload is small enough to fit inline.
    await db.insert(tlsActivities).values({
      talosId: talos.id,
      type: "commerce",
      content: `Inbound USDC: ${amount} (tx ${txId.slice(0, 10)}…)`,
      channel: "tatum-webhook",
      status: "completed",
    });

    // Best-effort revenue recording. If the same txId fires twice (Tatum
    // occasionally retries), we drop the duplicate at the DB layer.
    const usdAmount = Number(amount);
    if (Number.isFinite(usdAmount) && usdAmount > 0) {
      try {
        await db.insert(tlsRevenues).values({
          talosId: talos.id,
          amount: String(usdAmount),
          currency: "USDC",
          source: "commerce",
          txHash: txId,
        });
      } catch {
        // Likely a duplicate; ignore.
      }
    }

    return Response.json({ ok: true, talosId: talos.id });
  } catch (err) {
    console.error("[tatum-webhook]", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    name: "Talos Tatum webhook receiver",
    note:
      "POST with a Tatum Notification payload. Subscribe via /api/tatum/subscriptions.",
  });
}
