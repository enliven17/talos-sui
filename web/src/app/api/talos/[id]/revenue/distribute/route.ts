import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsPatrons, tlsRevenues } from "@/db/schema";
import { eq, and, sum } from "drizzle-orm";
import {
  getSuiClient,
  keypairFromSecret,
  getUsdcType,
  usdcToMicros,
} from "@/lib/sui";
import { Transaction } from "@mysten/sui/transactions";

/**
 * POST /api/talos/:id/revenue/distribute
 *
 * Distribute accumulated treasury USDC to Mitos holders proportionally.
 * Requires SUI_OPERATOR_SECRET_KEY (operator holds agent treasury for now).
 *
 * Body: { requesterAddress } — must be the creator
 *
 * Returns: list of transfers executed
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { requesterAddress } = body as { requesterAddress?: string };

    if (!requesterAddress) {
      return Response.json({ error: "requesterAddress is required" }, { status: 400 });
    }

    const talos = await db.query.tlsTalos.findFirst({ where: eq(tlsTalos.id, id) });
    if (!talos) return Response.json({ error: "TALOS not found" }, { status: 404 });

    if (requesterAddress.toLowerCase() !== talos.creatorAddress?.toLowerCase()) {
      return Response.json({ error: "Only the creator can trigger distribution" }, { status: 403 });
    }

    // Calculate total revenue
    const revenueResult = await db
      .select({ total: sum(tlsRevenues.amount) })
      .from(tlsRevenues)
      .where(eq(tlsRevenues.talosId, id));
    const totalRevenue = parseFloat(revenueResult[0]?.total ?? "0");

    if (totalRevenue <= 0) {
      return Response.json({ error: "No revenue to distribute" }, { status: 400 });
    }

    // Get all active patrons
    const patrons = await db
      .select()
      .from(tlsPatrons)
      .where(and(eq(tlsPatrons.talosId, id), eq(tlsPatrons.status, "active")));

    if (patrons.length === 0) {
      return Response.json({ error: "No active patrons to distribute to" }, { status: 400 });
    }

    const totalPulse = patrons.reduce((s, p) => s + p.pulseAmount, 0);
    if (totalPulse === 0) {
      return Response.json({ error: "Total Mitos held by patrons is 0" }, { status: 400 });
    }

    // investorShare % goes to patrons, rest stays in treasury
    const investorShare = talos.investorShare ?? 25; // default 25%
    const distributableAmount = (totalRevenue * investorShare) / 100;

    const operatorSecret = process.env.SUI_OPERATOR_SECRET_KEY;
    if (!operatorSecret) {
      return Response.json({ error: "SUI_OPERATOR_SECRET_KEY not configured" }, { status: 500 });
    }

    const client = getSuiClient();
    const operatorKp = keypairFromSecret(operatorSecret);
    const operator = operatorKp.getPublicKey().toSuiAddress();
    const usdcType = getUsdcType();

    // Pull all USDC coins owned by the operator once
    const ownedCoins = await client.getCoins({
      owner: operator,
      coinType: usdcType,
      limit: 50,
    });
    if (ownedCoins.data.length === 0) {
      return Response.json({ error: "Operator holds no USDC" }, { status: 400 });
    }

    const transfers: { patron: string; amount: number; txHash: string }[] = [];
    const errors: { patron: string; error: string }[] = [];

    // Build a single PTB transferring to all patrons atomically.
    try {
      const tx = new Transaction();
      const primary = tx.object(ownedCoins.data[0]!.coinObjectId);
      if (ownedCoins.data.length > 1) {
        tx.mergeCoins(
          primary,
          ownedCoins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
        );
      }

      const splits: { addr: string; amount: number }[] = [];
      for (const patron of patrons) {
        const shareRatio = patron.pulseAmount / totalPulse;
        const patronAmount = Math.floor(distributableAmount * shareRatio * 1e6) / 1e6;
        if (patronAmount < 0.000001) continue; // skip dust
        splits.push({ addr: patron.suiAddress, amount: patronAmount });
      }

      if (splits.length === 0) {
        return Response.json({ error: "All patron amounts were dust" }, { status: 400 });
      }

      const amountArgs = splits.map((s) => tx.pure.u64(usdcToMicros(s.amount.toString())));
      const coins = tx.splitCoins(primary, amountArgs);
      splits.forEach((s, i) => {
        tx.transferObjects([coins[i]!], tx.pure.address(s.addr));
      });

      const result = await client.signAndExecuteTransaction({
        signer: operatorKp,
        transaction: tx,
        options: { showEffects: true },
      });

      for (const s of splits) {
        transfers.push({ patron: s.addr, amount: s.amount, txHash: result.digest });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[distribute] PTB execution failed:", msg);
      errors.push({ patron: "*", error: msg });
    }

    return Response.json({
      success: errors.length === 0,
      totalRevenue,
      distributableAmount,
      investorSharePercent: investorShare,
      transfers,
      errors,
      message: `Distributed ${distributableAmount.toFixed(2)} USDC (${investorShare}% of ${totalRevenue.toFixed(2)} USDC treasury) to ${transfers.length} patrons`,
    });
  } catch (err) {
    console.error("[revenue/distribute]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/talos/:id/revenue/distribute
 * Preview distribution without executing
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const talos = await db.query.tlsTalos.findFirst({ where: eq(tlsTalos.id, id) });
    if (!talos) return Response.json({ error: "TALOS not found" }, { status: 404 });

    const [revenueResult, patrons] = await Promise.all([
      db.select({ total: sum(tlsRevenues.amount) }).from(tlsRevenues).where(eq(tlsRevenues.talosId, id)),
      db.select().from(tlsPatrons).where(and(eq(tlsPatrons.talosId, id), eq(tlsPatrons.status, "active"))),
    ]);

    const totalRevenue = parseFloat(revenueResult[0]?.total ?? "0");
    const investorShare = talos.investorShare ?? 25;
    const distributableAmount = (totalRevenue * investorShare) / 100;
    const totalPulse = patrons.reduce((s, p) => s + p.pulseAmount, 0);

    const breakdown = patrons.map((p) => ({
      suiAddress: p.suiAddress,
      pulseAmount: p.pulseAmount,
      sharePercent: totalPulse > 0 ? ((p.pulseAmount / totalPulse) * 100).toFixed(2) : "0",
      estimatedUsdc: totalPulse > 0
        ? ((distributableAmount * p.pulseAmount) / totalPulse).toFixed(6)
        : "0",
    }));

    return Response.json({
      totalRevenue,
      distributableAmount,
      investorSharePercent: investorShare,
      treasuryRetained: totalRevenue - distributableAmount,
      breakdown,
    });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
