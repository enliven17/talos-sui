import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsBounties } from "@/db/schema-bounties";
import { tlsTalos } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/bounties/:id
 *
 * Returns the bounty row and — if claimed — the public profile of the
 * Talos that claimed it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const bounty = await db
      .select()
      .from(tlsBounties)
      .where(eq(tlsBounties.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!bounty) {
      return Response.json({ error: "Bounty not found" }, { status: 404 });
    }

    let claimedBy: {
      id: string;
      name: string;
      agentName: string | null;
      agentWalletAddress: string | null;
    } | null = null;
    if (bounty.claimedByTalosId) {
      claimedBy = await db
        .select({
          id: tlsTalos.id,
          name: tlsTalos.name,
          agentName: tlsTalos.agentName,
          agentWalletAddress: tlsTalos.agentWalletAddress,
        })
        .from(tlsTalos)
        .where(eq(tlsTalos.id, bounty.claimedByTalosId))
        .limit(1)
        .then((r) => r[0] ?? null);
    }

    return Response.json({ bounty, claimedBy });
  } catch (err) {
    console.error("[bounties/:id GET]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/bounties/:id
 *
 * Poster-only edit. The only allowed transition is open → cancelled.
 * Body: { posterAddress, action: "cancel" }
 *
 * Authentication here is intentionally light (we trust the body-supplied
 * posterAddress) — a real implementation would require a signed message
 * from the poster's wallet. Documented as a hackathon shortcut.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { posterAddress, action } = body as {
      posterAddress?: string;
      action?: string;
    };

    if (!posterAddress) {
      return Response.json(
        { error: "posterAddress is required" },
        { status: 400 },
      );
    }
    if (action !== "cancel") {
      return Response.json(
        { error: "Only action=\"cancel\" is supported (open → cancelled)" },
        { status: 400 },
      );
    }

    const bounty = await db
      .select()
      .from(tlsBounties)
      .where(eq(tlsBounties.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!bounty) {
      return Response.json({ error: "Bounty not found" }, { status: 404 });
    }

    if (bounty.posterAddress.toLowerCase() !== posterAddress.toLowerCase()) {
      return Response.json(
        { error: "Only the original poster can edit this bounty" },
        { status: 403 },
      );
    }

    if (bounty.status !== "open") {
      return Response.json(
        { error: `Cannot cancel a bounty in status "${bounty.status}"` },
        { status: 409 },
      );
    }

    const [updated] = await db
      .update(tlsBounties)
      .set({ status: "cancelled" })
      .where(eq(tlsBounties.id, id))
      .returning();

    return Response.json(updated);
  } catch (err) {
    console.error("[bounties/:id PATCH]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
