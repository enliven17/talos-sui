import { db } from "@/db";
import {
  tlsTalos,
  tlsActivities,
  tlsCommerceJobs,
  tlsPlaybooks,
} from "@/db/schema";
import { desc, eq, isNotNull, sql } from "drizzle-orm";

/**
 * GET /api/walrus
 *
 * Aggregates the Walrus footprint across the platform:
 *   - total distinct blobs we know about (talos profile + activity + job + playbook)
 *   - per-table breakdown
 *   - most recent N blobs across all tables (timeline)
 *
 * Used by the /walrus dashboard to give judges a visual proof that the
 * project really stores meaningful data on Walrus, not just placeholder
 * blob ids.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [profileCount, activityCount, jobCount, playbookCount] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tlsTalos)
        .where(isNotNull(tlsTalos.walrusProfileBlob))
        .then((r) => r[0]?.n ?? 0),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tlsActivities)
        .where(isNotNull(tlsActivities.walrusBlobId))
        .then((r) => r[0]?.n ?? 0),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tlsCommerceJobs)
        .where(isNotNull(tlsCommerceJobs.walrusResultBlobId))
        .then((r) => r[0]?.n ?? 0),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tlsPlaybooks)
        .where(isNotNull(tlsPlaybooks.walrusContentBlobId))
        .then((r) => r[0]?.n ?? 0),
    ]);

    const [profileBlobs, activityBlobs, jobBlobs, playbookBlobs] = await Promise.all([
      db
        .select({
          blobId: tlsTalos.walrusProfileBlob,
          talosId: tlsTalos.id,
          talosName: tlsTalos.name,
          createdAt: tlsTalos.createdAt,
        })
        .from(tlsTalos)
        .where(isNotNull(tlsTalos.walrusProfileBlob))
        .orderBy(desc(tlsTalos.createdAt))
        .limit(15),
      db
        .select({
          blobId: tlsActivities.walrusBlobId,
          talosId: tlsActivities.talosId,
          talosName: tlsTalos.name,
          type: tlsActivities.type,
          content: tlsActivities.content,
          createdAt: tlsActivities.createdAt,
        })
        .from(tlsActivities)
        .leftJoin(tlsTalos, eq(tlsActivities.talosId, tlsTalos.id))
        .where(isNotNull(tlsActivities.walrusBlobId))
        .orderBy(desc(tlsActivities.createdAt))
        .limit(15),
      db
        .select({
          blobId: tlsCommerceJobs.walrusResultBlobId,
          jobId: tlsCommerceJobs.id,
          talosId: tlsCommerceJobs.talosId,
          talosName: tlsTalos.name,
          serviceName: tlsCommerceJobs.serviceName,
          createdAt: tlsCommerceJobs.createdAt,
        })
        .from(tlsCommerceJobs)
        .leftJoin(tlsTalos, eq(tlsCommerceJobs.talosId, tlsTalos.id))
        .where(isNotNull(tlsCommerceJobs.walrusResultBlobId))
        .orderBy(desc(tlsCommerceJobs.createdAt))
        .limit(15),
      db
        .select({
          blobId: tlsPlaybooks.walrusContentBlobId,
          playbookId: tlsPlaybooks.id,
          title: tlsPlaybooks.title,
          talosName: tlsTalos.name,
          createdAt: tlsPlaybooks.createdAt,
        })
        .from(tlsPlaybooks)
        .leftJoin(tlsTalos, eq(tlsPlaybooks.talosId, tlsTalos.id))
        .where(isNotNull(tlsPlaybooks.walrusContentBlobId))
        .orderBy(desc(tlsPlaybooks.createdAt))
        .limit(15),
    ]);

    const defaultEpochs = Number(
      process.env.NEXT_PUBLIC_WALRUS_EPOCHS ??
        process.env.WALRUS_EPOCHS ??
        "5",
    );

    return Response.json({
      totals: {
        profile: profileCount,
        activity: activityCount,
        job: jobCount,
        playbook: playbookCount,
        all: profileCount + activityCount + jobCount + playbookCount,
      },
      recent: {
        profile: profileBlobs,
        activity: activityBlobs,
        job: jobBlobs,
        playbook: playbookBlobs,
      },
      lifecycle: {
        defaultEpochs,
        // Walrus testnet ~24h per epoch as of June 2026 — surfaced for
        // the dashboard's "blob will expire in N days" computation.
        epochDurationHours: 24,
      },
      aggregator:
        process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ??
        "https://aggregator.walrus-testnet.walrus.space",
      publisher:
        process.env.NEXT_PUBLIC_WALRUS_PUBLISHER_URL ??
        "https://publisher.walrus-testnet.walrus.space",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}
