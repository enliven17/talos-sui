import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsActivities } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { verifyAgentApiKey } from "@/lib/auth";
import { storeJsonOnWalrus } from "@/lib/walrus";
import {
  buildRecordActivityBatchTx,
  TALOS_REGISTRY_PACKAGE_ID,
} from "@/lib/sui-move";
import { getSuiClient, keypairFromSecret } from "@/lib/sui";

/**
 * POST /api/talos/:id/activity/flush
 *
 * Aggregates this TALOS's recent un-flushed activities, ships the full
 * batch to Walrus, then calls `registry::record_activity_batch` on the
 * shared Talos object so the resulting `walrusBlobId` becomes part of
 * the on-chain audit ring.
 *
 * Body (optional):
 *   {
 *     "limit": 50,                 // how many recent activities to include (default 50)
 *     "talosObjectId": "0x..."     // override the on-chain object id (else uses talos.onChainObjectId)
 *   }
 *
 * Returns:
 *   {
 *     batchSize: number,
 *     walrusBlobId: string,
 *     txHash: string | null,
 *     activityIds: string[],
 *   }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const auth = await verifyAgentApiKey(request, id);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({})) as {
      limit?: number;
      talosObjectId?: string;
    };
    const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);

    const talos = await db
      .select({
        id: tlsTalos.id,
        name: tlsTalos.name,
        onChainObjectId: tlsTalos.onChainObjectId,
      })
      .from(tlsTalos)
      .where(eq(tlsTalos.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!talos) {
      return Response.json({ error: "TALOS not found" }, { status: 404 });
    }

    // Pull recent activities that haven't already been batched to Walrus.
    // We use `walrusBlobId IS NULL` as the "not yet flushed" marker.
    const rows = await db
      .select({
        id: tlsActivities.id,
        type: tlsActivities.type,
        content: tlsActivities.content,
        channel: tlsActivities.channel,
        status: tlsActivities.status,
        createdAt: tlsActivities.createdAt,
      })
      .from(tlsActivities)
      .where(and(eq(tlsActivities.talosId, id), isNull(tlsActivities.walrusBlobId)))
      .orderBy(desc(tlsActivities.createdAt))
      .limit(limit);

    if (rows.length === 0) {
      return Response.json({
        batchSize: 0,
        walrusBlobId: null,
        txHash: null,
        activityIds: [],
        message: "No un-flushed activities to batch.",
      });
    }

    // Build the batch payload and push to Walrus
    const batchPayload = {
      talosId: id,
      talosName: talos.name,
      flushedAt: new Date().toISOString(),
      count: rows.length,
      activities: rows.map((r) => ({
        id: r.id,
        type: r.type,
        content: r.content,
        channel: r.channel,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };

    const blob = await storeJsonOnWalrus(batchPayload);

    // Best-effort: write blob id back onto the per-activity rows so a
    // subsequent flush won't include them again. Done in a single UPDATE
    // per row inside one transaction.
    await db.transaction(async (tx) => {
      for (const r of rows) {
        await tx
          .update(tlsActivities)
          .set({ walrusBlobId: blob.blobId })
          .where(eq(tlsActivities.id, r.id));
      }
    });

    // Best-effort: record the blob on-chain so the shared Talos object's
    // `walrus_activity_blobs` vector keeps a verifiable ring of recent
    // batches. Requires operator secret + the talos object id.
    let txHash: string | null = null;
    const operatorSecret = process.env.SUI_OPERATOR_SECRET_KEY;
    const talosObjectId = body.talosObjectId ?? talos.onChainObjectId;
    if (
      operatorSecret &&
      talosObjectId &&
      TALOS_REGISTRY_PACKAGE_ID
    ) {
      try {
        const tx = buildRecordActivityBatchTx(talosObjectId, blob.blobId);
        const client = getSuiClient();
        const kp = keypairFromSecret(operatorSecret);
        const result = await client.signAndExecuteTransaction({
          signer: kp,
          transaction: tx,
          options: { showEffects: true },
        });
        txHash = result.digest;
      } catch (err) {
        console.warn(
          "[activity/flush] on-chain record_activity_batch failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return Response.json({
      batchSize: rows.length,
      walrusBlobId: blob.blobId,
      walrusUrl: blob.url,
      txHash,
      activityIds: rows.map((r) => r.id),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Flush failed";
    console.error("[activity/flush]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
