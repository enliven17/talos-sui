import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsBounties } from "@/db/schema-bounties";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { storeJsonOnWalrus } from "@/lib/walrus";
import { verifyX402Payment } from "@/lib/sui-x402";
import { isValidSuiAddress } from "@/lib/sui";

/**
 * GET /api/bounties
 *
 * List bounties. Supports:
 *   - ?status=open|claimed|completed|cancelled  (default: open)
 *   - ?cursor=<createdAtISO>|<id>               (createdAt-desc pagination)
 *   - ?limit=N                                  (1..100, default 50)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") ?? "open";
    const cursor = searchParams.get("cursor");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1),
      100,
    );

    const conditions = [eq(tlsBounties.status, status)];

    if (cursor) {
      const [cursorDate, cursorId] = cursor.split("|");
      if (cursorDate && cursorId) {
        conditions.push(
          or(
            lt(tlsBounties.createdAt, new Date(cursorDate)),
            and(
              eq(tlsBounties.createdAt, new Date(cursorDate)),
              lt(tlsBounties.id, cursorId),
            ),
          )!,
        );
      }
    }

    const rows = await db
      .select()
      .from(tlsBounties)
      .where(and(...conditions))
      .orderBy(desc(tlsBounties.createdAt), desc(tlsBounties.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null;

    return Response.json({ data: page, nextCursor });
  } catch (err) {
    console.error("[bounties GET]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

const VALID_CATEGORIES = [
  "marketing",
  "development",
  "research",
  "design",
  "finance",
  "analytics",
  "operations",
  "sales",
  "support",
  "education",
];

/**
 * POST /api/bounties
 *
 * Create a bounty. The poster has already escrowed `rewardUsdc` USDC by
 * transferring it on-chain to the operator address — we verify that
 * digest before persisting the row.
 *
 * Body:
 *   - posterAddress:  Sui 0x... of the poster (must match the tx sender)
 *   - title:          short headline
 *   - descriptionFull: long description; pushed to Walrus, blob id stored
 *   - category:       one of the 10 marketplace categories
 *   - rewardUsdc:     reward amount (human-readable USDC, e.g. "5.00")
 *   - escrowTxHash:   Sui tx digest of the USDC transfer to the operator
 *   - expiresInDays:  number of days from now until the bounty expires
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      posterAddress,
      title,
      descriptionFull,
      category,
      rewardUsdc,
      escrowTxHash,
      expiresInDays,
    } = body as {
      posterAddress?: string;
      title?: string;
      descriptionFull?: string;
      category?: string;
      rewardUsdc?: string | number;
      escrowTxHash?: string;
      expiresInDays?: number;
    };

    // ── Validation ──────────────────────────────────────────────────
    if (!posterAddress || !isValidSuiAddress(posterAddress)) {
      return Response.json(
        { error: "posterAddress must be a valid Sui address" },
        { status: 400 },
      );
    }
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return Response.json({ error: "title is required" }, { status: 400 });
    }
    if (!descriptionFull || typeof descriptionFull !== "string") {
      return Response.json(
        { error: "descriptionFull is required" },
        { status: 400 },
      );
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return Response.json(
        { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 },
      );
    }
    const rewardStr = String(rewardUsdc ?? "").trim();
    const rewardNum = Number(rewardStr);
    if (!Number.isFinite(rewardNum) || rewardNum <= 0) {
      return Response.json(
        { error: "rewardUsdc must be a positive number" },
        { status: 400 },
      );
    }
    if (!escrowTxHash || typeof escrowTxHash !== "string") {
      return Response.json(
        { error: "escrowTxHash is required" },
        { status: 400 },
      );
    }
    const expiresDays =
      typeof expiresInDays === "number" && expiresInDays > 0
        ? Math.min(Math.floor(expiresInDays), 365)
        : 14;

    // ── On-chain escrow verification ────────────────────────────────
    const operatorAddress = process.env.SUI_OPERATOR_ADDRESS;
    if (operatorAddress) {
      const verified = await verifyX402Payment(
        escrowTxHash,
        rewardStr,
        operatorAddress,
        posterAddress,
      );
      if (!verified) {
        return Response.json(
          {
            error:
              "Escrow transfer could not be verified — expected USDC amount to operator address from poster",
          },
          { status: 402 },
        );
      }
    } else {
      console.warn(
        "[bounties POST] SUI_OPERATOR_ADDRESS is not set — skipping on-chain escrow verification",
      );
    }

    // ── Walrus: store the long description ──────────────────────────
    const descriptionPreview =
      descriptionFull.length > 240
        ? descriptionFull.slice(0, 237) + "..."
        : descriptionFull;

    let walrusBlobId: string | null = null;
    try {
      const blob = await storeJsonOnWalrus({
        title,
        category,
        description: descriptionFull,
        posterAddress,
        rewardUsdc: rewardStr,
        postedAt: new Date().toISOString(),
      });
      walrusBlobId = blob.blobId;
    } catch (walrusErr) {
      console.warn(
        "[bounties POST] Walrus store failed, continuing without blob:",
        walrusErr,
      );
    }

    // ── Persist ─────────────────────────────────────────────────────
    const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);
    const [bounty] = await db
      .insert(tlsBounties)
      .values({
        posterAddress,
        title: title.trim(),
        descriptionPreview,
        walrusBlobId,
        category,
        rewardUsdc: rewardStr,
        escrowTxHash,
        status: "open",
        expiresAt,
      })
      .returning();

    return Response.json(bounty, { status: 201 });
  } catch (err) {
    console.error("[bounties POST]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
