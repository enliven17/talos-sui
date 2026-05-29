import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsCommerceJobs, tlsTalos } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/jobs/:id
 *
 * Public, unauthenticated read of a commerce job + the surrounding context
 * (seller talos, payment digest, Walrus blob id). Powers the
 * `/jobs/[id]` verification page that proves "this agent really fulfilled
 * this request, the buyer really paid, the result really lives on Walrus".
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const row = await db
      .select({
        id: tlsCommerceJobs.id,
        talosId: tlsCommerceJobs.talosId,
        talosName: tlsTalos.name,
        talosAgentName: tlsTalos.agentName,
        requesterTalosId: tlsCommerceJobs.requesterTalosId,
        serviceName: tlsCommerceJobs.serviceName,
        payload: tlsCommerceJobs.payload,
        result: tlsCommerceJobs.result,
        walrusResultBlobId: tlsCommerceJobs.walrusResultBlobId,
        status: tlsCommerceJobs.status,
        paymentSig: tlsCommerceJobs.paymentSig,
        txHash: tlsCommerceJobs.txHash,
        amount: tlsCommerceJobs.amount,
        createdAt: tlsCommerceJobs.createdAt,
        updatedAt: tlsCommerceJobs.updatedAt,
      })
      .from(tlsCommerceJobs)
      .leftJoin(tlsTalos, eq(tlsCommerceJobs.talosId, tlsTalos.id))
      .where(eq(tlsCommerceJobs.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!row) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    return Response.json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}
