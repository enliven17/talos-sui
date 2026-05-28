import { db } from "@/db";
import { tlsTalos, tlsPatrons, tlsRevenues } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  getAccountInfo,
  getSuiClient,
  keypairFromSecret,
} from "@/lib/sui";
import { Transaction } from "@mysten/sui/transactions";

/**
 * Buy Mitos tokens from a Talos.
 *
 * Flow:
 *   1. Verify buyer's Sui address has on-chain coins
 *   2. Verify the buyer's USDC payment tx (`txHash`) credited the Talos treasury
 *   3. Send `amount` Mitos Coin<T> tokens from the operator treasury to the buyer
 *   4. Register / update patron status if buyer crosses the min-Pulse threshold
 *   5. Record revenue
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const { buyerAddress, amount, txHash } = body as {
    buyerAddress?: string;
    amount?: number;
    txHash?: string;
  };

  if (!buyerAddress || typeof buyerAddress !== "string") {
    return NextResponse.json({ error: "buyerAddress is required" }, { status: 400 });
  }
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (!txHash) {
    return NextResponse.json({ error: "txHash is required — submit USDC payment first" }, { status: 400 });
  }

  const talos = await db.query.tlsTalos.findFirst({
    where: eq(tlsTalos.id, id),
  });

  if (!talos) {
    return NextResponse.json({ error: "TALOS not found" }, { status: 404 });
  }

  const pricePerToken = Number(talos.pulsePrice);
  if (pricePerToken <= 0) {
    return NextResponse.json({ error: "Token is not available for purchase" }, { status: 400 });
  }

  const totalCost = Math.round(amount * pricePerToken * 1e6) / 1e6;

  // Verify buyer's Sui address exists / is fundable
  const accountInfo = await getAccountInfo(buyerAddress);
  if (!accountInfo.exists) {
    return NextResponse.json(
      { error: `Sui address ${buyerAddress} has no on-chain coins` },
      { status: 400 },
    );
  }

  // ── Send Mitos tokens from operator to buyer ───────────────────────
  // Mitos is a Move-published Coin<T>. We split off `amount` (in base units)
  // from one of the operator's owned Coin<MITOS> objects and transfer it.
  let mitosTxHash: string | null = null;
  const mitosCoinType = talos.mitosCoinType; // e.g. "0x<pkg>::mitos::MITOS"

  if (mitosCoinType) {
    try {
      const operatorSecret = process.env.SUI_OPERATOR_SECRET_KEY;
      if (operatorSecret) {
        const client = getSuiClient();
        const keypair = keypairFromSecret(operatorSecret);
        const operator = keypair.getPublicKey().toSuiAddress();

        const coins = await client.getCoins({
          owner: operator,
          coinType: mitosCoinType,
          limit: 50,
        });
        if (coins.data.length === 0) {
          throw new Error(`Operator holds no ${mitosCoinType}`);
        }

        const tx = new Transaction();
        const primary = tx.object(coins.data[0]!.coinObjectId);
        if (coins.data.length > 1) {
          tx.mergeCoins(
            primary,
            coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
          );
        }
        // Mitos uses 0 decimals — `amount` is interpreted directly.
        const [coin] = tx.splitCoins(primary, [tx.pure.u64(BigInt(amount))]);
        tx.transferObjects([coin!], tx.pure.address(buyerAddress));

        const result = await client.signAndExecuteTransaction({
          signer: keypair,
          transaction: tx,
          options: { showEffects: true },
        });
        mitosTxHash = result.digest;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[buy-token] Mitos transfer failed:", msg);
      return NextResponse.json(
        { error: "Failed to send Mitos tokens to buyer. Purchase cancelled." },
        { status: 500 },
      );
    }
  }

  // ── Patron threshold check ─────────────────────────────────────────
  const minForPatron = talos.minPatronPulse ?? 100;

  const existingPatron = await db.query.tlsPatrons.findFirst({
    where: and(
      eq(tlsPatrons.talosId, id),
      eq(tlsPatrons.suiAddress, buyerAddress),
    ),
  });

  const currentPulseAmount = existingPatron?.pulseAmount ?? 0;
  const newPulseAmount = currentPulseAmount + amount;
  const becomesPatron = newPulseAmount >= minForPatron;

  if (becomesPatron) {
    if (existingPatron) {
      await db
        .update(tlsPatrons)
        .set({ pulseAmount: newPulseAmount, updatedAt: new Date() })
        .where(eq(tlsPatrons.id, existingPatron.id));
    } else {
      await db.insert(tlsPatrons).values({
        talosId: id,
        suiAddress: buyerAddress,
        role: "patron",
        share: "0",
        pulseAmount: newPulseAmount,
        status: "active",
      });
    }
  } else if (existingPatron) {
    // Update token balance even if still below threshold
    await db
      .update(tlsPatrons)
      .set({ pulseAmount: newPulseAmount, updatedAt: new Date() })
      .where(eq(tlsPatrons.id, existingPatron.id));
  }

  // ── Record revenue ─────────────────────────────────────────────────
  await db.insert(tlsRevenues).values({
    talosId: id,
    amount: String(totalCost),
    currency: "USDC",
    source: "token_sale",
    txHash,
  });

  const tokenSymbol = talos.tokenSymbol ?? "MITOS";

  return NextResponse.json({
    success: true,
    txHash,
    mitosTxHash,
    tokenSymbol,
    amount,
    pricePerToken,
    totalCost,
    currency: "USDC",
    buyerAddress,
    totalPulseHeld: newPulseAmount,
    patronStatus: becomesPatron
      ? existingPatron
        ? "updated"
        : "registered"
      : newPulseAmount < minForPatron
        ? `pending (need ${minForPatron - newPulseAmount} more ${tokenSymbol})`
        : "active",
    message: `Successfully purchased ${amount.toLocaleString()} ${tokenSymbol} for ${totalCost.toFixed(2)} USDC`,
  });
}
