import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsActivities, tlsTalos } from "@/db/schema";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { verifyAgentApiKey } from "@/lib/auth";
import { storeJsonOnWalrus } from "@/lib/walrus";

/**
 * Walrus Quilt — append-only stream of agent thoughts.
 *
 * A "thought" is a small JSON blob the agent writes every ReAct cycle.
 * Talos stores each thought as an Activity row with `type="thought"` and
 * pushes the full payload (including the model's chain-of-reasoning, tool
 * choices, and tool outputs) to Walrus. Only the blob id + a short
 * summary lands in Postgres.
 *
 * GET  /api/talos/:id/quilt        — list recent thoughts (cursor pagination + SSE option).
 * POST /api/talos/:id/quilt        — agent writes a new thought.
 */

export const dynamic = "force-dynamic";

interface PostBody {
  summary?: string;
  reasoning?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Optional SSE mode — long-lived stream of new thoughts.
  if (request.headers.get("accept")?.includes("text/event-stream")) {
    return streamThoughts(id);
  }

  const cursor = request.nextUrl.searchParams.get("cursor");
  const limit = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30, 1),
    100,
  );

  const conditions = [
    eq(tlsActivities.talosId, id),
    eq(tlsActivities.type, "thought"),
  ];
  if (cursor) {
    conditions.push(gt(tlsActivities.id, cursor));
  }

  const rows = await db
    .select({
      id: tlsActivities.id,
      content: tlsActivities.content,
      walrusBlobId: tlsActivities.walrusBlobId,
      channel: tlsActivities.channel,
      createdAt: tlsActivities.createdAt,
    })
    .from(tlsActivities)
    .where(and(...conditions))
    .orderBy(desc(tlsActivities.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return Response.json({
    data: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const auth = await verifyAgentApiKey(request, id);
    if (!auth.ok) return auth.response;

    let body: PostBody;
    try {
      body = (await request.json()) as PostBody;
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const summary = (body.summary ?? "").slice(0, 240);
    if (!summary) {
      return Response.json({ error: "summary is required" }, { status: 400 });
    }

    // Push the full thought to Walrus
    let walrusBlobId: string | null = null;
    try {
      const blob = await storeJsonOnWalrus({
        kind: "thought",
        talosId: id,
        summary,
        reasoning: body.reasoning ?? "",
        toolName: body.toolName ?? null,
        toolArgs: body.toolArgs ?? null,
        toolResult: body.toolResult ?? null,
        recordedAt: new Date().toISOString(),
      });
      walrusBlobId = blob.blobId;
    } catch (err) {
      console.warn("[quilt] Walrus push failed:", err);
    }

    const [activity] = await db
      .insert(tlsActivities)
      .values({
        talosId: id,
        type: "thought",
        content: summary,
        walrusBlobId,
        channel: body.toolName ?? "reasoning",
        status: "completed",
      })
      .returning();

    return Response.json(activity, { status: 201 });
  } catch (err) {
    console.error("[quilt POST]", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

/** SSE stream — polls for new thoughts every 2 seconds. */
function streamThoughts(talosId: string): Response {
  const encoder = new TextEncoder();
  let lastSeenId: string | null = null;
  let alive = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (!alive) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("hello", { talosId, ts: Date.now() });

      // Seed with the most recent thought
      try {
        const initial = await db
          .select({ id: tlsActivities.id })
          .from(tlsActivities)
          .where(
            and(eq(tlsActivities.talosId, talosId), eq(tlsActivities.type, "thought")),
          )
          .orderBy(desc(tlsActivities.createdAt))
          .limit(1)
          .then((r) => r[0] ?? null);
        if (initial) lastSeenId = initial.id;
      } catch {
        /* ignore */
      }

      while (alive) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!alive) break;
        try {
          const fresh = await db
            .select({
              id: tlsActivities.id,
              content: tlsActivities.content,
              walrusBlobId: tlsActivities.walrusBlobId,
              channel: tlsActivities.channel,
              createdAt: tlsActivities.createdAt,
            })
            .from(tlsActivities)
            .where(
              and(
                eq(tlsActivities.talosId, talosId),
                eq(tlsActivities.type, "thought"),
                isNotNull(tlsActivities.walrusBlobId),
                lastSeenId ? gt(tlsActivities.id, lastSeenId) : eq(tlsActivities.talosId, talosId),
              ),
            )
            .orderBy(desc(tlsActivities.createdAt))
            .limit(20);

          for (const row of fresh.reverse()) {
            send("thought", row);
            lastSeenId = row.id;
          }
        } catch {
          send("error", { message: "poll failed" });
        }
      }
      controller.close();
    },
    cancel() {
      alive = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
