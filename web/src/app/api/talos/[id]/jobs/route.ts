import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsCommerceServices, tlsCommerceJobs, tlsRevenues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fulfillInstant } from "@/lib/fulfillment";
import { verifyX402Payment, settleX402Payment } from "@/lib/sui-x402";
import { storeJsonOnWalrus } from "@/lib/walrus";

/**
 * POST /api/talos/:id/jobs
 *
 * Human user requests a service from an agent.
 * Accepts either:
 *   - paymentToken: a Sui USDC tx digest (the user already paid)
 *   - txHash:        same as paymentToken (legacy alias)
 *
 * Body: { buyerAddress, paymentToken?, txHash?, payload? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { buyerAddress, paymentToken, txHash: legacyTxHash, payload } = body as {
      buyerAddress?: string;
      paymentToken?: string;
      txHash?: string;
      payload?: Record<string, unknown>;
    };

    if (!buyerAddress) {
      return Response.json({ error: "buyerAddress is required" }, { status: 400 });
    }
    const candidate = paymentToken ?? legacyTxHash;
    if (!candidate) {
      return Response.json({ error: "paymentToken (Sui tx digest) is required" }, { status: 400 });
    }

    const [service, talos] = await Promise.all([
      db.select().from(tlsCommerceServices).where(eq(tlsCommerceServices.talosId, id)).limit(1).then(r => r[0] ?? null),
      db.select({ id: tlsTalos.id, agentOnline: tlsTalos.agentOnline, name: tlsTalos.name, agentWalletAddress: tlsTalos.agentWalletAddress })
        .from(tlsTalos).where(eq(tlsTalos.id, id)).limit(1).then(r => r[0] ?? null),
    ]);

    if (!talos) return Response.json({ error: "TALOS not found" }, { status: 404 });
    if (!service) return Response.json({ error: "This agent offers no services" }, { status: 404 });

    // Verify the on-chain Sui payment to the expected recipient
    const recipient = service.suiAddress ?? talos.agentWalletAddress ?? "";
    if (!recipient) {
      return Response.json({ error: "No payment recipient configured" }, { status: 500 });
    }
    const verified = await verifyX402Payment(
      candidate,
      String(service.price),
      recipient,
      buyerAddress,
    );
    if (!verified) {
      return Response.json(
        { error: "Sui payment could not be verified for the expected USDC amount and recipient" },
        { status: 402 },
      );
    }

    let txHash: string;
    try {
      ({ txHash } = await settleX402Payment(candidate));
    } catch (err) {
      console.error("[jobs] settle failed:", err);
      return Response.json({ error: "Payment finality wait failed" }, { status: 502 });
    }

    // Replay prevention — same txHash can't be used twice
    const duplicate = await db.select({ id: tlsCommerceJobs.id })
      .from(tlsCommerceJobs).where(eq(tlsCommerceJobs.txHash, txHash)).limit(1).then(r => r[0] ?? null);
    if (duplicate) {
      return Response.json({ error: "Transaction already used for a job (replay)" }, { status: 409 });
    }

    // ── Instant fulfillment: run handler now and return result ────────
    if (service.fulfillmentMode === "instant") {
      let result: Record<string, unknown>;
      try {
        result = await fulfillInstant(service.serviceName, payload ?? {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        return Response.json(
          { error: `Fulfillment failed: ${msg}` },
          { status: 502 },
        );
      }

      // Push the rich result to Walrus and keep only its blob id + a
      // summary in Postgres — same pattern as /api/talos/:id/service so
      // both buyer flows produce identical verifiable artefacts.
      let walrusResultBlobId: string | null = null;
      try {
        const blob = await storeJsonOnWalrus({
          talosId: id,
          requesterTalosId: `human:${buyerAddress}`,
          serviceName: service.serviceName,
          payload,
          result,
          txHash,
          recordedAt: new Date().toISOString(),
        });
        walrusResultBlobId = blob.blobId;
      } catch (walrusErr) {
        console.warn("[jobs] Walrus store failed, falling back to inline result:", walrusErr);
      }

      const [job] = await db.transaction(async (tx) => {
        const [job] = await tx.insert(tlsCommerceJobs).values({
          talosId: id,
          requesterTalosId: `human:${buyerAddress}`,
          serviceName: service.serviceName,
          payload: payload ?? {},
          result,
          walrusResultBlobId,
          paymentSig: txHash,
          txHash,
          amount: service.price,
          status: "completed",
        }).returning();
        await tx.insert(tlsRevenues).values({
          talosId: id,
          amount: service.price,
          currency: service.currency ?? "USDC",
          source: "commerce",
          txHash,
        });
        return [job];
      });

      return Response.json(
        { jobId: job.id, status: "completed", serviceName: service.serviceName, result, walrusResultBlobId, txHash },
        { status: 201 },
      );
    }

    // ── Async: queue for agent to process ─────────────────────────────
    const [job] = await db.transaction(async (tx) => {
      const [job] = await tx.insert(tlsCommerceJobs).values({
        talosId: id,
        requesterTalosId: `human:${buyerAddress}`,
        serviceName: service.serviceName,
        payload: payload ?? {},
        paymentSig: txHash,
        txHash,
        amount: service.price,
        status: "pending",
      }).returning();

      await tx.insert(tlsRevenues).values({
        talosId: id,
        amount: service.price,
        currency: service.currency ?? "USDC",
        source: "commerce",
        txHash,
      });

      return [job];
    });

    return Response.json(
      {
        jobId: job.id,
        status: "pending",
        serviceName: service.serviceName,
        amount: Number(service.price),
        txHash,
        message: `Job queued. The agent will process your request and you can poll for results.`,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    if (e?.code === "23505") {
      return Response.json({ error: "Transaction already used for a job (replay)" }, { status: 409 });
    }
    console.error("[jobs POST]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/talos/:id/jobs?txHash=xxx  or  ?jobId=xxx
 * Poll job status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  const txHash = searchParams.get("txHash");

  if (!jobId && !txHash) {
    return Response.json({ error: "Provide jobId or txHash" }, { status: 400 });
  }

  try {
    const job = jobId
      ? await db.select().from(tlsCommerceJobs)
          .where(eq(tlsCommerceJobs.id, jobId)).limit(1).then(r => r[0] ?? null)
      : await db.select().from(tlsCommerceJobs)
          .where(eq(tlsCommerceJobs.txHash, txHash!)).limit(1).then(r => r[0] ?? null);

    if (!job || job.talosId !== id) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    return Response.json({
      jobId: job.id,
      status: job.status,
      serviceName: job.serviceName,
      result: job.result,
      walrusResultBlobId: job.walrusResultBlobId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
