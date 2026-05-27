import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsPatrons, tlsCommerceServices } from "@/db/schema";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { createAgentKeypair, fundTestnetAccount } from "@/lib/sui";
import { subscribeIncomingUsdc } from "@/lib/tatum";
import { createTalosSchema, parseBody } from "@/lib/schemas";

// GET /api/talos — List TALOS entries with cursor-based pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const cursor = searchParams.get("cursor");
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);

    const patronCount = db
      .select({
        talosId: tlsPatrons.talosId,
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(tlsPatrons)
      .groupBy(tlsPatrons.talosId)
      .as("patronCount");

    const conditions = [];
    if (cursor) {
      const [cursorDate, cursorId] = cursor.split("|");
      if (cursorDate && cursorId) {
        conditions.push(
          or(
            lt(tlsTalos.createdAt, new Date(cursorDate)),
            and(
              eq(tlsTalos.createdAt, new Date(cursorDate)),
              lt(tlsTalos.id, cursorId),
            ),
          )!,
        );
      }
    }

    const entries = await db
      .select({
        id: tlsTalos.id,
        onChainId: tlsTalos.onChainId,
        onChainObjectId: tlsTalos.onChainObjectId,
        agentName: tlsTalos.agentName,
        name: tlsTalos.name,
        category: tlsTalos.category,
        description: tlsTalos.description,
        status: tlsTalos.status,
        mitosCoinType: tlsTalos.mitosCoinType,
        tokenSymbol: tlsTalos.tokenSymbol,
        pulsePrice: tlsTalos.pulsePrice,
        totalSupply: tlsTalos.totalSupply,
        creatorShare: tlsTalos.creatorShare,
        investorShare: tlsTalos.investorShare,
        treasuryShare: tlsTalos.treasuryShare,
        persona: tlsTalos.persona,
        targetAudience: tlsTalos.targetAudience,
        channels: tlsTalos.channels,
        toneVoice: tlsTalos.toneVoice,
        approvalThreshold: tlsTalos.approvalThreshold,
        gtmBudget: tlsTalos.gtmBudget,
        minPatronPulse: tlsTalos.minPatronPulse,
        agentOnline: tlsTalos.agentOnline,
        agentLastSeen: tlsTalos.agentLastSeen,
        walletAddress: tlsTalos.walletAddress,
        creatorAddress: tlsTalos.creatorAddress,
        investorAddress: tlsTalos.investorAddress,
        treasuryAddress: tlsTalos.treasuryAddress,
        walrusProfileBlob: tlsTalos.walrusProfileBlob,
        createdAt: tlsTalos.createdAt,
        updatedAt: tlsTalos.updatedAt,
        patrons: patronCount.count,
      })
      .from(tlsTalos)
      .leftJoin(patronCount, eq(tlsTalos.id, patronCount.talosId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tlsTalos.createdAt), desc(tlsTalos.id))
      .limit(limit + 1);

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const data = page.map((c) => ({ ...c, patrons: c.patrons ?? 0 }));

    const lastItem = page[page.length - 1];
    const nextCursor = hasMore && lastItem
      ? `${lastItem.createdAt.toISOString()}|${lastItem.id}`
      : null;

    return Response.json({ data, nextCursor });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/talos — Create a new TALOS (Genesis)
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseBody(request, createTalosSchema);
    if (parsed.error) return parsed.error;

    const {
      name,
      category,
      description,
      totalSupply: supply,
      persona,
      targetAudience,
      channels,
      approvalThreshold,
      gtmBudget,
      creatorAddress,
      walletAddress,
      onChainId,
      onChainObjectId,
      agentName,
      toneVoice,
      initialPrice,
      minPatronPulse,
      mitosCoinType,
      tokenSymbol,
      walrusProfileBlob,
      serviceName,
      serviceDescription,
      servicePrice,
    } = parsed.data;

    // Generate API key (tak_ prefix = TALOS API Key)
    const apiKey = `tak_${randomBytes(24).toString("hex")}`;

    // Create Sui keypair for the agent wallet
    // Keypair creation happens BEFORE the DB transaction.
    // If the transaction later fails, the keypair is simply discarded — Sui
    // addresses only exist once funded, so an unfunded keypair has no on-chain state.
    let agentWalletId: string | null = null;
    let agentWalletAddress: string | null = null;
    let agentWalletPublicKey: string | null = null;
    try {
      const keypair = await createAgentKeypair();
      agentWalletId = keypair.publicKey;
      agentWalletAddress = keypair.publicKey;
      agentWalletPublicKey = keypair.publicKey;
    } catch (err) {
      console.error("Sui keypair creation failed:", err);
      // Non-fatal: TALOS can be created without an agent wallet
    }

    // Atomic genesis: TALOS + Patron + Service created together or not at all
    const { talos, generatedKey } = await db.transaction(async (tx) => {
      const [talos] = await tx
        .insert(tlsTalos)
        .values({
          name,
          category,
          description,
          apiKey,
          totalSupply: supply,
          creatorShare: 0,
          investorShare: 0,
          treasuryShare: 100,
          persona,
          targetAudience,
          channels: channels ?? [],
          toneVoice: toneVoice ?? null,
          approvalThreshold: String(approvalThreshold ?? 10),
          gtmBudget: String(gtmBudget ?? 200),
          pulsePrice: String(initialPrice ?? 0),
          minPatronPulse: minPatronPulse ?? null,
          creatorAddress,
          walletAddress,
          onChainId: onChainId ?? null,
          onChainObjectId: onChainObjectId ?? null,
          agentName: agentName ?? null,
          mitosCoinType: mitosCoinType ?? null,
          tokenSymbol: tokenSymbol ?? null,
          walrusProfileBlob: walrusProfileBlob ?? null,
          agentWalletId,
          agentWalletAddress,
        })
        .returning();

      // Create initial Patron (Creator)
      const CREATOR_GOVERNANCE_FRACTION = 0.6;
      if (creatorAddress) {
        await tx.insert(tlsPatrons).values({
          talosId: talos.id,
          suiAddress: creatorAddress,
          role: "Creator",
          pulseAmount: Math.floor(supply * CREATOR_GOVERNANCE_FRACTION),
          share: "0",
        });
      }

      // Create Commerce Service if provided
      if (serviceName && servicePrice) {
        const serviceWallet = agentWalletAddress || creatorAddress || walletAddress;
        if (serviceWallet) {
          await tx.insert(tlsCommerceServices).values({
            talosId: talos.id,
            serviceName,
            description: serviceDescription ?? description,
            price: String(servicePrice),
            suiAddress: serviceWallet,
          });
        }
      }

      return { talos, generatedKey: apiKey };
    });

    // DB transaction succeeded — now fund the testnet wallet (best-effort, non-blocking).
    // Kept outside the transaction deliberately: the Sui faucet is an external call
    // and must not cause a DB rollback if it fails.
    if (agentWalletPublicKey) {
      fundTestnetAccount(agentWalletPublicKey).catch(() => {});

      // Subscribe to incoming USDC transfers on this fresh wallet via Tatum's
      // Notification Subscriptions API. The receiver at /api/tatum/webhook
      // will turn each inbound payment into an Activity + Revenue row so the
      // SSE feed picks it up in real time. Fire-and-forget — fully optional;
      // Talos works fine without Tatum webhooks if the api key is missing.
      const origin =
        process.env.NEXT_PUBLIC_ORIGIN ??
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
      if (origin) {
        subscribeIncomingUsdc(agentWalletPublicKey, `${origin}/api/tatum/webhook`)
          .catch(() => {});
      }
    }

    const { apiKey: _key, ...safeTalos } = talos;
    return Response.json(
      { ...safeTalos, apiKeyOnce: generatedKey },
      { status: 201 },
    );
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    console.error("POST /api/talos error:", JSON.stringify({
      message: e?.message,
      code: e?.code,
      detail: e?.detail,
      constraint: e?.constraint,
    }, null, 2));
    const message = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
