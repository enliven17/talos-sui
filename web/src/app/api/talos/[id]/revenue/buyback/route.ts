import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsRevenues } from "@/db/schema";
import { and, eq, sum } from "drizzle-orm";
import { getSuiClient, keypairFromSecret } from "@/lib/sui";
import { Transaction } from "@mysten/sui/transactions";

/**
 * POST /api/talos/:id/revenue/buyback
 *
 * Treasury buyback on Sui: operator burns `mitosAmount` of the Talos's Mitos
 * Coin<T> and records `usdcAmount` as a negative revenue entry. On Sui, "burn"
 * is achieved by sending the coin to the `0x0` sentinel address (no key can
 * spend it) — we use the standard Sui transfer-to-burn pattern.
 *
 * Body: { requesterAddress, usdcAmount, mitosAmount }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { requesterAddress, usdcAmount, mitosAmount } = body as {
      requesterAddress?: string;
      usdcAmount?: number;
      mitosAmount?: number;
    };

    if (!requesterAddress) {
      return Response.json({ error: "requesterAddress is required" }, { status: 400 });
    }
    if (!usdcAmount || usdcAmount <= 0) {
      return Response.json({ error: "usdcAmount must be positive" }, { status: 400 });
    }
    if (!mitosAmount || mitosAmount <= 0) {
      return Response.json({ error: "mitosAmount must be positive" }, { status: 400 });
    }

    const talos = await db.query.tlsTalos.findFirst({ where: eq(tlsTalos.id, id) });
    if (!talos) return Response.json({ error: "TALOS not found" }, { status: 404 });

    if (requesterAddress.toLowerCase() !== talos.creatorAddress?.toLowerCase()) {
      return Response.json({ error: "Only the creator can trigger buyback" }, { status: 403 });
    }

    const mitosCoinType = talos.mitosCoinType;
    if (!mitosCoinType) {
      return Response.json({ error: "No Mitos Coin<T> configured for this TALOS" }, { status: 400 });
    }

    const operatorSecret = process.env.SUI_OPERATOR_SECRET_KEY;
    if (!operatorSecret) {
      return Response.json({ error: "SUI_OPERATOR_SECRET_KEY not configured" }, { status: 500 });
    }

    const client = getSuiClient();
    const operatorKp = keypairFromSecret(operatorSecret);
    const operator = operatorKp.getPublicKey().toSuiAddress();

    // Locate Mitos coins owned by the operator
    const coins = await client.getCoins({
      owner: operator,
      coinType: mitosCoinType,
      limit: 50,
    });
    if (coins.data.length === 0) {
      return Response.json({ error: "Operator holds no Mitos to burn" }, { status: 400 });
    }

    const tx = new Transaction();
    const primary = tx.object(coins.data[0]!.coinObjectId);
    if (coins.data.length > 1) {
      tx.mergeCoins(
        primary,
        coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
      );
    }
    const [burnCoin] = tx.splitCoins(primary, [tx.pure.u64(BigInt(mitosAmount))]);
    // Burn = transfer to the 0x0 sentinel (no key can spend it).
    tx.transferObjects([burnCoin!], tx.pure.address("0x0"));

    const result = await client.signAndExecuteTransaction({
      signer: operatorKp,
      transaction: tx,
      options: { showEffects: true },
    });
    const txHash = result.digest;

    // Record as negative revenue (treasury expense)
    await db.insert(tlsRevenues).values({
      talosId: id,
      amount: String(-usdcAmount),
      currency: "USDC",
      source: "buyback",
      txHash,
    });

    const symbol = talos.tokenSymbol ?? "MITOS";
    return Response.json({
      success: true,
      txHash,
      mitosBurned: mitosAmount,
      usdcSpent: usdcAmount,
      message: `Buyback: burned ${mitosAmount.toLocaleString()} ${symbol} tokens. tx: ${txHash.slice(0, 12)}...`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Buyback failed";
    console.error("[buyback]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/talos/:id/revenue/buyback
 * Preview: treasury balance + buyback stats
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const talos = await db.query.tlsTalos.findFirst({ where: eq(tlsTalos.id, id) });
    if (!talos) return Response.json({ error: "TALOS not found" }, { status: 404 });

    const [revenueResult, buybackResult] = await Promise.all([
      db.select({ total: sum(tlsRevenues.amount) }).from(tlsRevenues).where(eq(tlsRevenues.talosId, id)),
      db.select({ total: sum(tlsRevenues.amount) })
        .from(tlsRevenues)
        .where(and(eq(tlsRevenues.talosId, id), eq(tlsRevenues.source, "buyback"))),
    ]);

    const totalRevenue = parseFloat(revenueResult[0]?.total ?? "0");
    const totalBuyback = Math.abs(parseFloat(buybackResult[0]?.total ?? "0"));
    const treasuryShare = talos.treasuryShare ?? 15;
    const investorShare = talos.investorShare ?? 25;
    const treasuryBalance = (totalRevenue * treasuryShare) / 100;

    // Check on-chain Mitos balance of operator
    let operatorMitosBalance = 0;
    if (talos.mitosCoinType) {
      try {
        const operatorAddr = process.env.SUI_OPERATOR_ADDRESS;
        if (operatorAddr) {
          const client = getSuiClient();
          const { totalBalance } = await client.getBalance({
            owner: operatorAddr,
            coinType: talos.mitosCoinType,
          });
          operatorMitosBalance = Number(BigInt(totalBalance));
        }
      } catch { /* offline */ }
    }

    return Response.json({
      totalRevenue,
      treasuryBalance,
      treasurySharePercent: treasuryShare,
      investorSharePercent: investorShare,
      totalBuybackExecuted: totalBuyback,
      operatorMitosBalance,
      tokenSymbol: talos.tokenSymbol ?? "MITOS",
      circulatingSupply: talos.totalSupply - operatorMitosBalance,
    });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
