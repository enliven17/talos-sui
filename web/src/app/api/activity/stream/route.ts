import { db } from "@/db";
import { tlsActivities, tlsCommerceJobs, tlsTalos } from "@/db/schema";
import { desc, eq, gt, and, or } from "drizzle-orm";

/**
 * GET /api/activity/stream — public real-time activity feed.
 *
 * Open to anyone, no auth. Emits an SSE event every time a new Activity
 * row or completed Job lands. Used by the homepage live ticker so judges
 * see the agent economy moving the instant something happens.
 */

export const dynamic = "force-dynamic";

interface FeedEvent {
  id: string;
  type: "activity" | "job";
  kind: string; // activity.type | job.serviceName
  talosId: string;
  talosName: string | null;
  agentName: string | null;
  preview: string;
  walrusBlobId: string | null;
  amount: number | null;
  txHash: string | null;
  at: string;
}

export async function GET() {
  const encoder = new TextEncoder();
  let alive = true;
  let lastActivityAt = new Date(Date.now() - 60 * 1000);
  let lastJobAt = lastActivityAt;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (!alive) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("hello", { ts: Date.now() });

      while (alive) {
        try {
          const [activities, jobs] = await Promise.all([
            db
              .select({
                id: tlsActivities.id,
                type: tlsActivities.type,
                content: tlsActivities.content,
                walrusBlobId: tlsActivities.walrusBlobId,
                createdAt: tlsActivities.createdAt,
                talosId: tlsActivities.talosId,
                talosName: tlsTalos.name,
                agentName: tlsTalos.agentName,
              })
              .from(tlsActivities)
              .innerJoin(tlsTalos, eq(tlsActivities.talosId, tlsTalos.id))
              .where(gt(tlsActivities.createdAt, lastActivityAt))
              .orderBy(desc(tlsActivities.createdAt))
              .limit(20),
            db
              .select({
                id: tlsCommerceJobs.id,
                serviceName: tlsCommerceJobs.serviceName,
                amount: tlsCommerceJobs.amount,
                txHash: tlsCommerceJobs.txHash,
                status: tlsCommerceJobs.status,
                walrusBlobId: tlsCommerceJobs.walrusResultBlobId,
                createdAt: tlsCommerceJobs.createdAt,
                talosId: tlsCommerceJobs.talosId,
                talosName: tlsTalos.name,
                agentName: tlsTalos.agentName,
              })
              .from(tlsCommerceJobs)
              .innerJoin(tlsTalos, eq(tlsCommerceJobs.talosId, tlsTalos.id))
              .where(
                and(
                  gt(tlsCommerceJobs.createdAt, lastJobAt),
                  or(
                    eq(tlsCommerceJobs.status, "completed"),
                    eq(tlsCommerceJobs.status, "pending"),
                  ),
                ),
              )
              .orderBy(desc(tlsCommerceJobs.createdAt))
              .limit(20),
          ]);

          for (const a of activities.reverse()) {
            const evt: FeedEvent = {
              id: a.id,
              type: "activity",
              kind: a.type,
              talosId: a.talosId,
              talosName: a.talosName,
              agentName: a.agentName,
              preview: a.content.slice(0, 200),
              walrusBlobId: a.walrusBlobId,
              amount: null,
              txHash: null,
              at: a.createdAt.toISOString(),
            };
            send("event", evt);
            if (a.createdAt > lastActivityAt) lastActivityAt = a.createdAt;
          }

          for (const j of jobs.reverse()) {
            const evt: FeedEvent = {
              id: j.id,
              type: "job",
              kind: j.serviceName,
              talosId: j.talosId,
              talosName: j.talosName,
              agentName: j.agentName,
              preview: `${j.status} · ${j.serviceName}`,
              walrusBlobId: j.walrusBlobId,
              amount: Number(j.amount),
              txHash: j.txHash,
              at: j.createdAt.toISOString(),
            };
            send("event", evt);
            if (j.createdAt > lastJobAt) lastJobAt = j.createdAt;
          }
        } catch {
          /* keep stream alive on transient db errors */
        }

        // Heartbeat every 25s to keep proxies from closing the stream
        send("ping", { ts: Date.now() });

        await new Promise((r) => setTimeout(r, 4000));
      }
      controller.close();
    },
    cancel() {
      alive = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
