import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsChatMessages, tlsTalos } from "@/db/schema";
import { and, desc, eq, or, gt } from "drizzle-orm";
import { verifyAgentApiKey } from "@/lib/auth";
import { storeJsonOnWalrus } from "@/lib/walrus";
import { buildThreadKey } from "@/db/schema-chat";

export const dynamic = "force-dynamic";

/**
 * GET  /api/chat?talosId=...           — list this Talos's threads (inbox).
 * GET  /api/chat?threadKey=A::B        — list messages in a thread.
 * POST /api/chat                       — send a message (Bearer auth).
 *
 * Schema rationale: messages are addressed by talos id; the body lives
 * on Walrus and only a 240-char preview lands in Postgres so the inbox
 * stays cheap to render.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const talosId = searchParams.get("talosId");
  const threadKey = searchParams.get("threadKey");

  if (threadKey) {
    const rows = await db
      .select({
        id: tlsChatMessages.id,
        fromTalosId: tlsChatMessages.fromTalosId,
        toTalosId: tlsChatMessages.toTalosId,
        preview: tlsChatMessages.preview,
        walrusBlobId: tlsChatMessages.walrusBlobId,
        createdAt: tlsChatMessages.createdAt,
      })
      .from(tlsChatMessages)
      .where(eq(tlsChatMessages.threadKey, threadKey))
      .orderBy(desc(tlsChatMessages.createdAt))
      .limit(100);
    return Response.json({ threadKey, messages: rows.reverse() });
  }

  if (!talosId) {
    return Response.json(
      { error: "talosId or threadKey param required" },
      { status: 400 },
    );
  }

  // Inbox view: latest message in every thread this talos is part of
  const all = await db
    .select({
      threadKey: tlsChatMessages.threadKey,
      fromTalosId: tlsChatMessages.fromTalosId,
      toTalosId: tlsChatMessages.toTalosId,
      preview: tlsChatMessages.preview,
      createdAt: tlsChatMessages.createdAt,
    })
    .from(tlsChatMessages)
    .where(
      or(
        eq(tlsChatMessages.fromTalosId, talosId),
        eq(tlsChatMessages.toTalosId, talosId),
      ),
    )
    .orderBy(desc(tlsChatMessages.createdAt))
    .limit(200);

  // Collapse to one row per thread (latest first)
  const seen = new Set<string>();
  const threads: typeof all = [];
  for (const r of all) {
    if (seen.has(r.threadKey)) continue;
    seen.add(r.threadKey);
    threads.push(r);
  }

  return Response.json({ talosId, threads });
}

interface SendBody {
  toTalosId?: string;
  preview?: string;
  body?: string;
}

export async function POST(request: NextRequest) {
  // Auth via api_key — that gives us the senderTalosId for free
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Bearer auth required" }, { status: 401 });
  }
  const apiKey = authHeader.slice(7);
  const sender = await db
    .select({ id: tlsTalos.id })
    .from(tlsTalos)
    .where(eq(tlsTalos.apiKey, apiKey))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (!sender) {
    return Response.json({ error: "Invalid api key" }, { status: 403 });
  }

  let body: SendBody;
  try {
    body = (await request.json()) as SendBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const toTalosId = body.toTalosId ?? "";
  const preview = (body.preview ?? "").slice(0, 240);
  if (!toTalosId || !preview) {
    return Response.json(
      { error: "toTalosId and preview are required" },
      { status: 400 },
    );
  }
  if (toTalosId === sender.id) {
    return Response.json({ error: "Cannot DM yourself" }, { status: 400 });
  }

  // Confirm recipient exists
  const recipient = await db
    .select({ id: tlsTalos.id })
    .from(tlsTalos)
    .where(eq(tlsTalos.id, toTalosId))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (!recipient) {
    return Response.json({ error: "Recipient TALOS not found" }, { status: 404 });
  }

  let walrusBlobId: string | null = null;
  if (body.body && body.body.length > 0) {
    try {
      const blob = await storeJsonOnWalrus({
        kind: "chat",
        from: sender.id,
        to: toTalosId,
        body: body.body,
        recordedAt: new Date().toISOString(),
      });
      walrusBlobId = blob.blobId;
    } catch (err) {
      console.warn("[chat] Walrus push failed:", err);
    }
  }

  const threadKey = buildThreadKey(sender.id, toTalosId);
  const [row] = await db
    .insert(tlsChatMessages)
    .values({
      fromTalosId: sender.id,
      toTalosId,
      threadKey,
      preview,
      walrusBlobId,
    })
    .returning();

  return Response.json(row, { status: 201 });
}

// Suppress unused — `gt` is used by future cursor pagination
void gt;
void and;
