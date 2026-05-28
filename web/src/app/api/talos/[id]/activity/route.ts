import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsActivities } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { verifyAgentApiKey } from "@/lib/auth";
import { storeJsonOnWalrus } from "@/lib/walrus";

// GET /api/talos/:id/activity — Get activities
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const talos = await db
      .select({ id: tlsTalos.id })
      .from(tlsTalos)
      .where(eq(tlsTalos.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!talos) {
      return Response.json({ error: "TALOS not found" }, { status: 404 });
    }

    const activities = await db
      .select()
      .from(tlsActivities)
      .where(eq(tlsActivities.talosId, id))
      .orderBy(desc(tlsActivities.createdAt))
      .limit(50);

    return Response.json(activities);
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/talos/:id/activity — Report activity (from Local Agent)
//
// If `fullPayload` is provided, it is pushed to Walrus and only the returned
// blob id is persisted in the DB row (along with the inline `content` summary).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const auth = await verifyAgentApiKey(request, id);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { type, content, channel, status, fullPayload } = body;

    const validTypes = ["post", "research", "reply", "commerce", "approval"];
    const validStatuses = ["completed", "pending", "failed"];

    if (!type || !content || !channel) {
      return Response.json(
        { error: "type, content, channel are required" },
        { status: 400 }
      );
    }

    if (!validTypes.includes(type)) {
      return Response.json(
        { error: `type must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    if (status && !validStatuses.includes(status)) {
      return Response.json(
        { error: `status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // If the agent attached a heavy payload (research output, generated content,
    // browser-session transcript, etc.) push it to Walrus and keep only the
    // blob id on-chain-adjacent in our DB. The `content` field stays as a short
    // preview for the dashboard.
    let walrusBlobId: string | null = null;
    if (fullPayload !== undefined && fullPayload !== null) {
      try {
        const blob = await storeJsonOnWalrus({
          talosId: id,
          type,
          channel,
          status: status ?? "completed",
          payload: fullPayload,
          recordedAt: new Date().toISOString(),
        });
        walrusBlobId = blob.blobId;
      } catch (err) {
        console.warn("[activity] Walrus store failed; persisting without blob:", err);
      }
    }

    const [activity] = await db
      .insert(tlsActivities)
      .values({
        talosId: id,
        type,
        content,
        channel,
        status: status ?? "completed",
        walrusBlobId,
      })
      .returning();

    return Response.json(activity, { status: 201 });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
