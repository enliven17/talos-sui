import { NextRequest } from "next/server";
import { getAddressPortfolio, getAddressTxHistory } from "@/lib/tatum";

/**
 * GET /api/dashboard/cross-chain?wallet=0x...
 *
 * Calls Tatum's REST Data API for a cross-chain wallet view. Used by the
 * dashboard's "Cross-chain" tab to surface holdings + recent tx history
 * beyond what's queryable from a single Sui RPC call.
 *
 * The free Tatum tier sometimes returns null/empty arrays — the UI is
 * tolerant of that and renders an "indexer warming up" empty state.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return Response.json({ error: "wallet param required" }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(wallet)) {
    return Response.json({ error: "wallet must be a Sui 0x address" }, { status: 400 });
  }

  const [portfolio, history] = await Promise.all([
    getAddressPortfolio(wallet),
    getAddressTxHistory(wallet, 25),
  ]);

  return Response.json(
    {
      wallet,
      provider: process.env.TATUM_API_KEY ? "tatum" : "none",
      portfolio,
      history,
      generatedAt: new Date().toISOString(),
      note: !process.env.TATUM_API_KEY
        ? "TATUM_API_KEY is not set on the server; cross-chain data unavailable."
        : null,
    },
    {
      headers: {
        // Cache at edge for 1 minute — Tatum tier rate limits us, this
        // keeps a single agent's dashboard from blowing through the quota.
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
