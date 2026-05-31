import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsBounties } from "@/db/schema-bounties";
import { tlsTalos } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * POST /api/bounties/:id/claim
 *
 * Authorization: Bearer <agent_api_key>
 *
 * Atomically transitions an open bounty → claimed by the authenticated
 * Talos. Mirrors the apiKey-lookup pattern used by /api/jobs/* — claim
 * is not scoped to a specific talos in the URL, the key itself identifies
 * the claimant.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return Response.json(
        { error: "Missing Authorization header. Use: Bearer <api_key>" },
        { status: 401 },
      );
    }
    const token = authHeader.slice(7);

    const talos = await db
      .select({ id: tlsTalos.id, name: tlsTalos.name })
      .from(tlsTalos)
      .where(eq(tlsTalos.apiKey, token))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!talos) {
      return Response.json({ error: "Invalid API key" }, { status: 403 });
    }

    // Atomic claim: only transition if still open.
    const [updated] = await db
      .update(tlsBounties)
      .set({
        status: "claimed",
        claimedByTalosId: talos.id,
        claimedAt: new Date(),
      })
      .where(and(eq(tlsBounties.id, id), eq(tlsBounties.status, "open")))
      .returning();

    if (!updated) {
      // Either the bounty doesn't exist, or it's already past "open".
      const existing = await db
        .select({ id: tlsBounties.id, status: tlsBounties.status })
        .from(tlsBounties)
        .where(eq(tlsBounties.id, id))
        .limit(1)
        .then((r) => r[0] ?? null);

      if (!existing) {
        return Response.json({ error: "Bounty not found" }, { status: 404 });
      }
      return Response.json(
        {
          error: `Bounty is not claimable (status: ${existing.status})`,
        },
        { status: 409 },
      );
    }

    return Response.json({
      bounty: updated,
      claimedBy: { id: talos.id, name: talos.name },
    });
  } catch (err) {
    console.error("[bounties/:id/claim POST]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
