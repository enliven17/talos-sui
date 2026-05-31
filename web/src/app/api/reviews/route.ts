import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsReviews, tlsReviewStats, tlsCommerceJobs, tlsTalos } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { storeJsonOnWalrus } from "@/lib/walrus";
import { mintReviewerBadge } from "@/lib/badges";
import { z } from "zod/v4";

/**
 * POST /api/reviews — create a review for a completed job.
 * GET  /api/reviews?talosId=... — list reviews for a talos.
 */
const createReviewSchema = z.object({
  jobId: z.string().min(1),
  reviewerAddress: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/),
  rating: z.number().int().min(1).max(5),
  headline: z.string().min(1).max(120),
  body: z.string().max(20_000).optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const talosId = searchParams.get("talosId");
  if (!talosId) {
    return Response.json({ error: "talosId param required" }, { status: 400 });
  }

  const [reviews, stats] = await Promise.all([
    db
      .select({
        id: tlsReviews.id,
        jobId: tlsReviews.jobId,
        reviewerAddress: tlsReviews.reviewerAddress,
        rating: tlsReviews.rating,
        headline: tlsReviews.headline,
        walrusBlobId: tlsReviews.walrusBlobId,
        badgeMintTxHash: tlsReviews.badgeMintTxHash,
        createdAt: tlsReviews.createdAt,
      })
      .from(tlsReviews)
      .where(eq(tlsReviews.talosId, talosId))
      .orderBy(desc(tlsReviews.createdAt))
      .limit(50),
    db
      .select()
      .from(tlsReviewStats)
      .where(eq(tlsReviewStats.talosId, talosId))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  return Response.json({ reviews, stats });
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  }
  const { jobId, reviewerAddress, rating, headline, body } = parsed.data;

  // Verify the job exists and is completed
  const job = await db
    .select({
      id: tlsCommerceJobs.id,
      talosId: tlsCommerceJobs.talosId,
      status: tlsCommerceJobs.status,
      requesterTalosId: tlsCommerceJobs.requesterTalosId,
    })
    .from(tlsCommerceJobs)
    .where(eq(tlsCommerceJobs.id, jobId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "completed") {
    return Response.json(
      { error: "Only completed jobs can be reviewed", status: job.status },
      { status: 400 },
    );
  }
  // The reviewer must match the buyer (we stored `human:<addr>` for UI buyers)
  const expectedBuyer = job.requesterTalosId.startsWith("human:")
    ? job.requesterTalosId.slice("human:".length).toLowerCase()
    : null;
  if (expectedBuyer && expectedBuyer !== reviewerAddress.toLowerCase()) {
    return Response.json(
      { error: "Only the buyer of this job can review it" },
      { status: 403 },
    );
  }

  // Push the full review body to Walrus (best-effort)
  let walrusBlobId: string | null = null;
  if (body) {
    try {
      const blob = await storeJsonOnWalrus({
        kind: "review",
        jobId,
        talosId: job.talosId,
        reviewerAddress,
        rating,
        headline,
        body,
        recordedAt: new Date().toISOString(),
      });
      walrusBlobId = blob.blobId;
    } catch (err) {
      console.warn("[reviews] Walrus push failed:", err);
    }
  }

  // Insert the review + update the stats in a single transaction
  let insertedId: string;
  try {
    insertedId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tlsReviews)
        .values({
          talosId: job.talosId,
          jobId,
          reviewerAddress,
          rating,
          headline,
          walrusBlobId,
        })
        .returning({ id: tlsReviews.id });

      // Upsert review stats — average rating + total count
      await tx
        .insert(tlsReviewStats)
        .values({
          talosId: job.talosId,
          averageRating: String(rating),
          totalReviews: 1,
        })
        .onConflictDoUpdate({
          target: tlsReviewStats.talosId,
          set: {
            averageRating: sql`(${tlsReviewStats.averageRating} * ${tlsReviewStats.totalReviews} + ${rating}) / (${tlsReviewStats.totalReviews} + 1)`,
            totalReviews: sql`${tlsReviewStats.totalReviews} + 1`,
            updatedAt: new Date(),
          },
        });
      return row.id;
    });
  } catch (err) {
    const e = err as Record<string, unknown>;
    if (e?.code === "23505") {
      return Response.json(
        { error: "You already reviewed this job" },
        { status: 409 },
      );
    }
    console.error("[reviews POST]", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }

  // Best-effort: mint a ReviewerBadge NFT to the reviewer (Move + Sui)
  let badgeMintTxHash: string | null = null;
  if (walrusBlobId) {
    try {
      const mint = await mintReviewerBadge({
        jobId,
        reviewer: reviewerAddress,
        rating,
        walrusReviewBlob: walrusBlobId,
      });
      if (mint.ok && mint.digest) {
        badgeMintTxHash = mint.digest;
        await db
          .update(tlsReviews)
          .set({ badgeMintTxHash })
          .where(eq(tlsReviews.id, insertedId));
      }
    } catch (err) {
      console.warn("[reviews] badge mint failed:", err);
    }
  }

  // Reflect the new talos name on the response so the UI can fetch the
  // updated stats in one go
  const talosName = await db
    .select({ name: tlsTalos.name })
    .from(tlsTalos)
    .where(eq(tlsTalos.id, job.talosId))
    .limit(1)
    .then((r) => r[0]?.name ?? null);

  return Response.json(
    {
      id: insertedId,
      talosId: job.talosId,
      talosName,
      walrusBlobId,
      badgeMintTxHash,
    },
    { status: 201 },
  );
}
// Suppress unused-import warning until the `and` clause is needed for
// future filtering (e.g. min rating, since timestamp).
void and;
