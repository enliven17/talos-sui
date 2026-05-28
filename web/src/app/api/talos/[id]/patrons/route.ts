import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsPatrons } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getAccountInfo } from "@/lib/sui";

// GET /api/talos/:id/patrons — List patrons for a TALOS
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const talos = await db
      .select({ id: tlsTalos.id })
      .from(tlsTalos)
      .where(eq(tlsTalos.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!talos) {
      return Response.json({ error: "TALOS not found" }, { status: 404 });
    }

    const patrons = await db
      .select()
      .from(tlsPatrons)
      .where(and(eq(tlsPatrons.talosId, id), eq(tlsPatrons.status, "active")))
      .orderBy(desc(tlsPatrons.createdAt));

    return Response.json(patrons);
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/talos/:id/patrons — Register as patron (requires min Pulse holding)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const body = await request.json();
    const { suiAddress, pulseAmount } = body;

    if (!suiAddress) {
      return Response.json(
        { error: "suiAddress is required" },
        { status: 400 }
      );
    }

    if (pulseAmount == null || typeof pulseAmount !== "number" || pulseAmount <= 0) {
      return Response.json(
        { error: "pulseAmount must be a positive number" },
        { status: 400 }
      );
    }

    const talos = await db
      .select({
        id: tlsTalos.id,
        totalSupply: tlsTalos.totalSupply,
        minPatronPulse: tlsTalos.minPatronPulse,
      })
      .from(tlsTalos)
      .where(eq(tlsTalos.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!talos) {
      return Response.json({ error: "TALOS not found" }, { status: 404 });
    }

    // Calculate minimum threshold: explicit setting or 0.1% of totalSupply
    const minRequired = talos.minPatronPulse ?? Math.floor(talos.totalSupply * 0.001);

    if (pulseAmount < minRequired) {
      return Response.json(
        {
          error: `Minimum ${minRequired} Pulse required to become Patron`,
          minRequired,
          current: pulseAmount,
        },
        { status: 403 }
      );
    }

    // Verify on-chain balance via Sui RPC (Tatum-backed)
    const accountInfo = await getAccountInfo(suiAddress);
    if (!accountInfo.exists) {
      return Response.json(
        { error: `Sui address ${suiAddress} has no on-chain coins` },
        { status: 400 }
      );
    }

    // Sanity check: account must hold either SUI for gas or USDC
    const hasFunds =
      parseFloat(accountInfo.suiBalance) > 0 ||
      parseFloat(accountInfo.usdcBalance) > 0;
    if (!hasFunds) {
      return Response.json(
        { error: "Account has no SUI or USDC. Fund the address first." },
        { status: 400 }
      );
    }

    // Check for existing active patron
    const existing = await db
      .select()
      .from(tlsPatrons)
      .where(
        and(eq(tlsPatrons.talosId, id), eq(tlsPatrons.suiAddress, suiAddress))
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (existing && existing.status === "active") {
      return Response.json(
        { error: "Already a Patron of this TALOS" },
        { status: 409 }
      );
    }

    // Calculate share based on holdings
    const sharePercent = ((pulseAmount / talos.totalSupply) * 100).toFixed(2);

    // Re-activate revoked patron or create new one
    if (existing && existing.status === "revoked") {
      const [patron] = await db
        .update(tlsPatrons)
        .set({ status: "active", pulseAmount, role: "Investor", share: sharePercent })
        .where(eq(tlsPatrons.id, existing.id))
        .returning();
      return Response.json(patron, { status: 200 });
    }

    const [patron] = await db
      .insert(tlsPatrons)
      .values({
        talosId: id,
        suiAddress,
        role: "Investor",
        pulseAmount,
        share: sharePercent,
      })
      .returning();

    return Response.json(patron, { status: 201 });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/talos/:id/patrons — Withdraw patron status
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const body = await request.json();
    const { suiAddress } = body;

    if (!suiAddress) {
      return Response.json(
        { error: "suiAddress is required" },
        { status: 400 }
      );
    }

    const patron = await db
      .select()
      .from(tlsPatrons)
      .where(
        and(eq(tlsPatrons.talosId, id), eq(tlsPatrons.suiAddress, suiAddress))
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!patron || patron.status !== "active") {
      return Response.json(
        { error: "No active Patron found for this wallet" },
        { status: 404 }
      );
    }

    // Creator cannot withdraw
    if (patron.role === "Creator") {
      return Response.json(
        { error: "Creator cannot withdraw Patron status" },
        { status: 403 }
      );
    }

    const [updated] = await db
      .update(tlsPatrons)
      .set({ status: "revoked" })
      .where(eq(tlsPatrons.id, patron.id))
      .returning();

    return Response.json(updated);
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
