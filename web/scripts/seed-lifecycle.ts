/**
 * Demo lifecycle seed.
 *
 * Bootstraps a full marketplace story for screenshots / video / judges:
 *
 *   1. Reuses the existing `seed-demo-agents` agents (run that first).
 *   2. For each agent that has a service, fakes 2-4 completed jobs
 *      where another agent (or a fake "human:0x..." address) bought
 *      the service, paid in USDC, and got their result.
 *   3. Pushes each result + each genesis profile to Walrus.
 *   4. Inserts revenue rows.
 *   5. Inserts a few activity rows per agent (post / research / commerce).
 *   6. Inserts 1–2 reviews per agent with star ratings.
 *
 * Usage:
 *   cd web
 *   DATABASE_URL=<pooler_url> npx tsx scripts/seed-lifecycle.ts
 *
 * Idempotent: re-running adds *more* synthetic history; clear the
 * `tls_commerce_jobs` / `tls_reviews` / `tls_activities` / `tls_revenues`
 * tables first if you want a clean slate.
 */
import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";

if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

const PUBLISHER =
  process.env.WALRUS_PUBLISHER_URL ?? "https://publisher.walrus-testnet.walrus.space";
const AGGREGATOR =
  process.env.WALRUS_AGGREGATOR_URL ?? "https://aggregator.walrus-testnet.walrus.space";

async function storeWalrus(obj: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${PUBLISHER}/v1/blobs?epochs=10`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj),
    });
    const j = (await res.json()) as Record<string, unknown>;
    const created = j.newlyCreated as { blobObject?: { blobId?: string } } | undefined;
    const certified = j.alreadyCertified as { blobId?: string } | undefined;
    return created?.blobObject?.blobId ?? certified?.blobId ?? null;
  } catch (err) {
    console.warn("[walrus] store failed:", err);
    return null;
  }
}

function fakeTxDigest(seed: string): string {
  // 32-byte digest base58-like; for visual identity only — judges should
  // know any tx we mark as demo isn't real on-chain.
  const hash = [...seed].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let out = "demo";
  let n = Math.abs(hash);
  while (out.length < 44) {
    out += chars[n % chars.length];
    n = Math.floor(n / chars.length) + 7;
  }
  return out;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const db = drizzle(pool, { schema });

  const talosRows = await db
    .select({
      id: schema.tlsTalos.id,
      name: schema.tlsTalos.name,
      agentWalletAddress: schema.tlsTalos.agentWalletAddress,
      walrusProfileBlob: schema.tlsTalos.walrusProfileBlob,
    })
    .from(schema.tlsTalos);

  console.log(`[seed-lifecycle] Found ${talosRows.length} talos`);

  for (const t of talosRows) {
    // Make sure each talos has a Walrus profile blob
    if (!t.walrusProfileBlob) {
      const blobId = await storeWalrus({
        kind: "demo-profile",
        talosId: t.id,
        name: t.name,
        seededAt: new Date().toISOString(),
      });
      if (blobId) {
        await db
          .update(schema.tlsTalos)
          .set({ walrusProfileBlob: blobId })
          .where(eq(schema.tlsTalos.id, t.id));
        console.log(`  [${t.name}] profile blob → ${blobId.slice(0, 10)}…`);
      }
    }

    const service = await db
      .select()
      .from(schema.tlsCommerceServices)
      .where(eq(schema.tlsCommerceServices.talosId, t.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!service) continue;

    const jobCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < jobCount; i++) {
      const buyerAddr = `0x${(t.id + ":" + i).padStart(64, "b").slice(-64)}`;
      const txHash = fakeTxDigest(`${t.id}:${i}:${Date.now()}`);
      const resultPayload = {
        kind: "demo-result",
        service: service.serviceName,
        summary: `Demo deliverable #${i + 1} for ${service.serviceName}`,
        recordedAt: new Date().toISOString(),
      };
      const blobId = await storeWalrus(resultPayload);

      try {
        await db.insert(schema.tlsCommerceJobs).values({
          talosId: t.id,
          requesterTalosId: `human:${buyerAddr}`,
          serviceName: service.serviceName,
          payload: { request: `Sample buyer request #${i + 1}` },
          result: resultPayload,
          walrusResultBlobId: blobId,
          paymentSig: txHash,
          txHash,
          amount: service.price,
          status: "completed",
        });
        await db.insert(schema.tlsRevenues).values({
          talosId: t.id,
          amount: service.price,
          currency: service.currency,
          source: "commerce",
          txHash,
        });
        console.log(`  [${t.name}] job ${i + 1} → ${blobId ? blobId.slice(0, 8) + "…" : "(no walrus)"}`);
      } catch (err) {
        console.warn(`  [${t.name}] job ${i + 1} insert failed:`, err);
      }
    }

    // Sample activity rows
    const activityRows = [
      { type: "post", content: `Daily report from ${t.name} — ${jobCount} jobs fulfilled today`, channel: "X (Twitter)" },
      { type: "research", content: `Market scan for ${service.serviceName} trends`, channel: "research" },
      { type: "commerce", content: `Processed ${jobCount} ${service.serviceName} requests`, channel: "x402" },
    ];
    for (const a of activityRows) {
      await db.insert(schema.tlsActivities).values({
        talosId: t.id,
        type: a.type,
        content: a.content,
        channel: a.channel,
        status: "completed",
      });
    }

    // One review for each talos
    const ratings = [5, 5, 4, 5, 4];
    const rating = ratings[Math.floor(Math.random() * ratings.length)] ?? 5;
    const reviewerAddr = `0x${"d".repeat(60)}${t.id.slice(0, 4)}`;
    const reviewBlobId = await storeWalrus({
      kind: "review",
      talosId: t.id,
      rating,
      headline: `Solid ${service.serviceName} delivery`,
      body: `${t.name} turned around the ${service.serviceName} request in minutes, the result was on point. Would recommend.`,
      recordedAt: new Date().toISOString(),
    });
    try {
      await db.insert(schema.tlsReviews).values({
        talosId: t.id,
        jobId: "demo-job",
        reviewerAddress: reviewerAddr,
        rating,
        headline: `Solid ${service.serviceName} delivery`,
        walrusBlobId: reviewBlobId,
      });
      await db
        .insert(schema.tlsReviewStats)
        .values({
          talosId: t.id,
          averageRating: String(rating),
          totalReviews: 1,
        })
        .onConflictDoUpdate({
          target: schema.tlsReviewStats.talosId,
          set: {
            averageRating: sql`(${schema.tlsReviewStats.averageRating} * ${schema.tlsReviewStats.totalReviews} + ${rating}) / (${schema.tlsReviewStats.totalReviews} + 1)`,
            totalReviews: sql`${schema.tlsReviewStats.totalReviews} + 1`,
            updatedAt: new Date(),
          },
        });
      console.log(`  [${t.name}] ⭐ ${rating}/5 review`);
    } catch (err) {
      console.warn(`  [${t.name}] review insert failed:`, err);
    }
  }

  console.log(`\n✓ Lifecycle seed complete. Aggregator: ${AGGREGATOR}`);
  await pool.end();
}

void main();
