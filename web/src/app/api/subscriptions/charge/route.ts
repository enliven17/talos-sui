import { NextRequest } from "next/server";
import { db } from "@/db";
import {
  tlsSubscriptions,
  tlsSubscriptionInvoices,
  tlsTalos,
  tlsRevenues,
} from "@/db/schema";
import { and, eq, lte } from "drizzle-orm";
import { signX402Payment } from "@/lib/sui-x402";

export const dynamic = "force-dynamic";

/**
 * POST /api/subscriptions/charge
 *
 * Charges every subscription whose `nextChargeAt` is in the past. Meant
 * to be invoked from a cron (Vercel Cron, GitHub Actions, etc.) every
 * ~minute on production. Auth: requires `Authorization: Bearer
 * ${CRON_SECRET}` (env var `CRON_SECRET`).
 *
 * Each charge:
 *   1. Loads the buyer agent's secret key from `TALOS_AGENT_SECRET_<id>`.
 *   2. Builds + signs + submits a Sui USDC transfer to the provider's
 *      service `suiAddress`.
 *   3. Inserts an invoice row + a revenue row.
 *   4. Bumps `nextChargeAt` by `periodDays`.
 *
 * If the buyer agent secret is missing, the subscription is marked
 * `failed` and the run is skipped.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const due = await db
    .select({
      id: tlsSubscriptions.id,
      providerTalosId: tlsSubscriptions.providerTalosId,
      buyerTalosId: tlsSubscriptions.buyerTalosId,
      pricePerPeriod: tlsSubscriptions.pricePerPeriod,
      currency: tlsSubscriptions.currency,
      periodDays: tlsSubscriptions.periodDays,
      nextChargeAt: tlsSubscriptions.nextChargeAt,
    })
    .from(tlsSubscriptions)
    .where(
      and(
        eq(tlsSubscriptions.status, "active"),
        lte(tlsSubscriptions.nextChargeAt, now),
      ),
    )
    .limit(50);

  const summary: Array<{ id: string; status: string; reason?: string; tx?: string }> = [];

  for (const sub of due) {
    try {
      const [buyer, providerService] = await Promise.all([
        db
          .select({ agentWalletAddress: tlsTalos.agentWalletAddress })
          .from(tlsTalos)
          .where(eq(tlsTalos.id, sub.buyerTalosId))
          .limit(1)
          .then((r) => r[0] ?? null),
        db
          .select({ payee: tlsTalos.agentWalletAddress })
          .from(tlsTalos)
          .where(eq(tlsTalos.id, sub.providerTalosId))
          .limit(1)
          .then((r) => r[0] ?? null),
      ]);

      const buyerSecret = process.env[`TALOS_AGENT_SECRET_${sub.buyerTalosId}`];
      if (!buyer?.agentWalletAddress || !providerService?.payee || !buyerSecret) {
        await db
          .update(tlsSubscriptions)
          .set({ status: "failed" })
          .where(eq(tlsSubscriptions.id, sub.id));
        await db.insert(tlsSubscriptionInvoices).values({
          subscriptionId: sub.id,
          amount: sub.pricePerPeriod,
          currency: sub.currency,
          status: "failed",
          failureReason: !buyerSecret
            ? "Buyer agent secret not configured"
            : "Missing wallet address",
          periodStart: sub.nextChargeAt,
          periodEnd: new Date(
            sub.nextChargeAt.getTime() + sub.periodDays * 24 * 60 * 60 * 1000,
          ),
        });
        summary.push({ id: sub.id, status: "failed", reason: "missing secret/address" });
        continue;
      }

      const { txHash } = await signX402Payment(buyerSecret, {
        from: buyer.agentWalletAddress,
        to: providerService.payee,
        amount: String(sub.pricePerPeriod),
      });

      const periodStart = sub.nextChargeAt;
      const periodEnd = new Date(
        sub.nextChargeAt.getTime() + sub.periodDays * 24 * 60 * 60 * 1000,
      );

      await db.transaction(async (tx) => {
        await tx.insert(tlsSubscriptionInvoices).values({
          subscriptionId: sub.id,
          amount: sub.pricePerPeriod,
          currency: sub.currency,
          status: "succeeded",
          txHash,
          periodStart,
          periodEnd,
        });
        await tx.insert(tlsRevenues).values({
          talosId: sub.providerTalosId,
          amount: sub.pricePerPeriod,
          currency: sub.currency,
          source: "commerce",
          txHash,
        });
        await tx
          .update(tlsSubscriptions)
          .set({
            lastChargeAt: now,
            nextChargeAt: periodEnd,
          })
          .where(eq(tlsSubscriptions.id, sub.id));
      });
      summary.push({ id: sub.id, status: "succeeded", tx: txHash });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.insert(tlsSubscriptionInvoices).values({
        subscriptionId: sub.id,
        amount: sub.pricePerPeriod,
        currency: sub.currency,
        status: "failed",
        failureReason: msg,
        periodStart: sub.nextChargeAt,
        periodEnd: new Date(
          sub.nextChargeAt.getTime() + sub.periodDays * 24 * 60 * 60 * 1000,
        ),
      });
      summary.push({ id: sub.id, status: "failed", reason: msg });
    }
  }

  return Response.json({ charged: summary, processedAt: now.toISOString() });
}

export async function GET() {
  return Response.json({
    description: "POST to charge all due subscriptions. Cron-only.",
  });
}
