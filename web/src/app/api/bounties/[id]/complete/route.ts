import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsBounties } from "@/db/schema-bounties";
import { tlsTalos } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { storeJsonOnWalrus } from "@/lib/walrus";
import { sendUSDC } from "@/lib/sui";

/**
 * POST /api/bounties/:id/complete
 *
 * Authorization: Bearer <agent_api_key>
 *
 * Marks a claimed bounty as completed by the same Talos that claimed it.
 *   1. Pushes the result payload to Walrus → `completionWalrusBlobId`.
 *   2. If `SUI_OPERATOR_SECRET_KEY` is configured, releases the escrowed
 *      USDC from the operator wallet → the Talos's `agentWalletAddress`
 *      and records the resulting digest as `payoutTxHash`.
 *   3. Flips status to "completed".
 *
 * Body: { resultPayload: any }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // ── Auth ────────────────────────────────────────────────────────
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return Response.json(
        { error: "Missing Authorization header. Use: Bearer <api_key>" },
        { status: 401 },
      );
    }
    const token = authHeader.slice(7);

    const talos = await db
      .select({
        id: tlsTalos.id,
        name: tlsTalos.name,
        agentWalletAddress: tlsTalos.agentWalletAddress,
      })
      .from(tlsTalos)
      .where(eq(tlsTalos.apiKey, token))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!talos) {
      return Response.json({ error: "Invalid API key" }, { status: 403 });
    }

    // ── Body ────────────────────────────────────────────────────────
    const body = await request.json().catch(() => ({}));
    const { resultPayload } = body as { resultPayload?: unknown };
    if (resultPayload === undefined || resultPayload === null) {
      return Response.json(
        { error: "resultPayload is required" },
        { status: 400 },
      );
    }

    // ── Load + authorize ────────────────────────────────────────────
    const bounty = await db
      .select()
      .from(tlsBounties)
      .where(eq(tlsBounties.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!bounty) {
      return Response.json({ error: "Bounty not found" }, { status: 404 });
    }
    if (bounty.status !== "claimed") {
      return Response.json(
        { error: `Bounty is not claimed (status: ${bounty.status})` },
        { status: 409 },
      );
    }
    if (bounty.claimedByTalosId !== talos.id) {
      return Response.json(
        { error: "Only the Talos that claimed this bounty can complete it" },
        { status: 403 },
      );
    }

    // ── Walrus: store the result payload ────────────────────────────
    let completionWalrusBlobId: string | null = null;
    try {
      const blob = await storeJsonOnWalrus({
        bountyId: bounty.id,
        completedByTalosId: talos.id,
        completedByName: talos.name,
        result: resultPayload,
        completedAt: new Date().toISOString(),
      });
      completionWalrusBlobId = blob.blobId;
    } catch (walrusErr) {
      console.warn(
        "[bounties/:id/complete POST] Walrus store failed, continuing without blob:",
        walrusErr,
      );
    }

    // ── Sui: release the escrow from operator → claimant wallet ─────
    let payoutTxHash: string | null = null;
    const operatorSecret = process.env.SUI_OPERATOR_SECRET_KEY;
    if (operatorSecret) {
      if (!talos.agentWalletAddress) {
        console.warn(
          "[bounties/:id/complete POST] Talos has no agentWalletAddress — skipping payout",
        );
      } else {
        try {
          const { txHash } = await sendUSDC(
            operatorSecret,
            talos.agentWalletAddress,
            String(bounty.rewardUsdc),
          );
          payoutTxHash = txHash;
        } catch (payoutErr) {
          console.error(
            "[bounties/:id/complete POST] Operator payout failed:",
            payoutErr,
          );
          return Response.json(
            {
              error:
                "Result stored, but the escrow payout transaction failed. Please retry.",
              completionWalrusBlobId,
            },
            { status: 502 },
          );
        }
      }
    } else {
      console.warn(
        "[bounties/:id/complete POST] SUI_OPERATOR_SECRET_KEY not set — skipping on-chain payout",
      );
    }

    // ── Persist completion ──────────────────────────────────────────
    const [updated] = await db
      .update(tlsBounties)
      .set({
        status: "completed",
        completedAt: new Date(),
        completionWalrusBlobId,
        payoutTxHash,
      })
      .where(
        and(eq(tlsBounties.id, id), eq(tlsBounties.status, "claimed")),
      )
      .returning();

    if (!updated) {
      return Response.json(
        { error: "Bounty state changed during completion; please retry" },
        { status: 409 },
      );
    }

    return Response.json({
      bounty: updated,
      completionWalrusBlobId,
      payoutTxHash,
    });
  } catch (err) {
    console.error("[bounties/:id/complete POST]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
