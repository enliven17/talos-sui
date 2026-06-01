import { NextRequest } from "next/server";
import { db } from "@/db";
import {
  tlsSubscriptions,
  tlsCommerceServices,
  tlsTalos,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { verifyAgentApiKey } from "@/lib/auth";
import { storeJsonOnWalrus } from "@/lib/walrus";

export const dynamic = "force-dynamic";

/**
 * GET  /api/subscriptions?role=buyer|provider&talosId=...
 * POST /api/subscriptions     (buyer auth → create new subscription)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const role = searchParams.get("role") ?? "buyer";
  const talosId = searchParams.get("talosId");
  if (!talosId) {
    return Response.json({ error: "talosId param required" }, { status: 400 });
  }
  const column = role === "provider" ? tlsSubscriptions.providerTalosId : tlsSubscriptions.buyerTalosId;
  const rows = await db
    .select()
    .from(tlsSubscriptions)
    .where(eq(column, talosId));
  return Response.json({ role, talosId, subscriptions: rows });
}

interface CreateSubscription {
  providerTalosId?: string;
  periodDays?: number;
  termsBody?: string;
}

export async function POST(request: NextRequest) {
  // Buyer authenticates with their TALOS_API_KEY; identity = their talos id
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Bearer auth required" }, { status: 401 });
  }
  const apiKey = authHeader.slice(7);
  const buyer = await db
    .select({ id: tlsTalos.id, name: tlsTalos.name })
    .from(tlsTalos)
    .where(eq(tlsTalos.apiKey, apiKey))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (!buyer) {
    return Response.json({ error: "Invalid api key" }, { status: 403 });
  }

  let body: CreateSubscription;
  try {
    body = (await request.json()) as CreateSubscription;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const providerTalosId = body.providerTalosId ?? "";
  const periodDays = Math.min(Math.max(body.periodDays ?? 30, 1), 365);
  if (!providerTalosId) {
    return Response.json({ error: "providerTalosId is required" }, { status: 400 });
  }
  if (providerTalosId === buyer.id) {
    return Response.json({ error: "Cannot subscribe to yourself" }, { status: 400 });
  }

  const service = await db
    .select()
    .from(tlsCommerceServices)
    .where(eq(tlsCommerceServices.talosId, providerTalosId))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (!service) {
    return Response.json({ error: "Provider has no service" }, { status: 404 });
  }

  // Persist contract on Walrus for verifiable terms
  let contractBlobId: string | null = null;
  try {
    const blob = await storeJsonOnWalrus({
      kind: "subscription-contract",
      providerTalosId,
      buyerTalosId: buyer.id,
      serviceName: service.serviceName,
      pricePerPeriod: String(service.price),
      currency: service.currency ?? "USDC",
      periodDays,
      termsBody: body.termsBody ?? null,
      signedAt: new Date().toISOString(),
    });
    contractBlobId = blob.blobId;
  } catch (err) {
    console.warn("[subs] Walrus contract push failed:", err);
  }

  const nextCharge = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(tlsSubscriptions)
    .values({
      providerTalosId,
      buyerTalosId: buyer.id,
      serviceName: service.serviceName,
      pricePerPeriod: String(service.price),
      currency: service.currency ?? "USDC",
      periodDays,
      status: "active",
      nextChargeAt: nextCharge,
      contractWalrusBlobId: contractBlobId,
    })
    .returning();

  return Response.json(row, { status: 201 });
}

// silence unused
void and;
void verifyAgentApiKey;
