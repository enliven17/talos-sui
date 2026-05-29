import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsCommerceServices, tlsRevenues, tlsReviewStats } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { storeWalrusBlob } from "@/lib/walrus";

/**
 * POST /api/talos/:id/walrus-site
 *
 * Build a static HTML "Walrus Site" snapshot of a Talos profile and
 * publish it to Walrus. The resulting blob is a fully self-contained
 * HTML document any aggregator can serve — `https://<aggregator>/v1/
 * blobs/<blobId>` becomes the agent's permanent decentralised landing
 * page.
 *
 * This is the closest in-band equivalent to running `walrus-sites publish`
 * — for the full SuiNS-mapped `<agent>.wal.app` URL, the operator still
 * runs the Walrus CLI separately. The blob id returned here is the same
 * blob that CLI would produce.
 */

export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [talos, service, revenue, stats] = await Promise.all([
    db
      .select()
      .from(tlsTalos)
      .where(eq(tlsTalos.id, id))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select()
      .from(tlsCommerceServices)
      .where(eq(tlsCommerceServices.talosId, id))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        total: sql<string>`coalesce(sum(${tlsRevenues.amount}), 0)`,
      })
      .from(tlsRevenues)
      .where(eq(tlsRevenues.talosId, id))
      .then((r) => r[0]?.total ?? "0"),
    db
      .select()
      .from(tlsReviewStats)
      .where(eq(tlsReviewStats.talosId, id))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  if (!talos) {
    return Response.json({ error: "TALOS not found" }, { status: 404 });
  }

  const network = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet";
  const suivisionBase =
    network === "mainnet" ? "https://suivision.xyz" : `https://${network}.suivision.xyz`;

  const aggregator =
    process.env.WALRUS_AGGREGATOR_URL ??
    "https://aggregator.walrus-testnet.walrus.space";

  // Build a deterministic static HTML page. Tailwind via CDN keeps the
  // bundle to ~3 KB. The image src points at the Walrus profile blob if
  // the agent published one.
  const imageUrl = talos.walrusProfileBlob
    ? `${aggregator}/v1/blobs/${talos.walrusProfileBlob}`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(talos.name)} — Talos Protocol</title>
<meta name="description" content="${escapeHtml(talos.description.slice(0, 160))}" />
<meta property="og:title" content="${escapeHtml(talos.name)} — Talos on Sui" />
<meta property="og:description" content="${escapeHtml(talos.description.slice(0, 160))}" />
${imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : ""}
<script src="https://cdn.tailwindcss.com"></script>
<style>body{font-family:ui-monospace,SFMono-Regular,monospace;background:#FCF8F8;color:#2D2D2D;}</style>
</head>
<body class="min-h-screen p-8 md:p-16">
  <main class="max-w-3xl mx-auto">
    <header class="mb-12 flex items-center gap-6">
      ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(talos.name)}" class="w-20 h-20 object-cover border border-[#F9DFDF]" />` : ""}
      <div>
        <div class="text-xs tracking-widest text-[#8E8383] mb-1">${escapeHtml(talos.category.toUpperCase())}</div>
        <h1 class="text-3xl font-bold text-[#F5AFAF]">${escapeHtml(talos.name)}</h1>
        ${talos.agentName ? `<div class="font-mono text-sm text-[#8E8383] mt-1">${escapeHtml(talos.agentName)}.talos</div>` : ""}
      </div>
    </header>

    <p class="text-base leading-relaxed mb-12">${escapeHtml(talos.description)}</p>

    <section class="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#F9DFDF] mb-12">
      <div class="bg-white px-4 py-5 text-center">
        <div class="text-xl font-bold text-[#F5AFAF]">${Number(revenue).toFixed(2)}</div>
        <div class="text-[10px] uppercase tracking-widest text-[#8E8383] mt-1">USDC earned</div>
      </div>
      <div class="bg-white px-4 py-5 text-center">
        <div class="text-xl font-bold text-[#F5AFAF]">${talos.totalSupply.toLocaleString()}</div>
        <div class="text-[10px] uppercase tracking-widest text-[#8E8383] mt-1">${escapeHtml(talos.tokenSymbol ?? "MITOS")} supply</div>
      </div>
      <div class="bg-white px-4 py-5 text-center">
        <div class="text-xl font-bold text-[#F5AFAF]">${stats?.averageRating ?? "—"}</div>
        <div class="text-[10px] uppercase tracking-widest text-[#8E8383] mt-1">${stats?.totalReviews ?? 0} reviews</div>
      </div>
      <div class="bg-white px-4 py-5 text-center">
        <div class="text-xl font-bold ${talos.agentOnline ? "text-emerald-500" : "text-[#8E8383]"}">${talos.agentOnline ? "ONLINE" : "OFFLINE"}</div>
        <div class="text-[10px] uppercase tracking-widest text-[#8E8383] mt-1">Status</div>
      </div>
    </section>

    ${
      service
        ? `<section class="border border-[#F9DFDF] bg-white p-6 mb-12">
            <div class="text-[10px] uppercase tracking-widest text-[#F5AFAF] mb-2">[Service]</div>
            <h2 class="text-xl font-bold mb-2">${escapeHtml(service.serviceName)}</h2>
            ${service.description ? `<p class="text-sm text-[#8E8383] mb-4">${escapeHtml(service.description)}</p>` : ""}
            <div class="flex items-center justify-between text-sm">
              <span class="font-bold text-[#F5AFAF]">${Number(service.price).toFixed(2)} USDC / request</span>
              <span class="text-[#8E8383] font-mono">${service.fulfillmentMode}</span>
            </div>
          </section>`
        : ""
    }

    ${
      talos.agentWalletAddress
        ? `<section class="text-xs text-[#8E8383] space-y-1 mb-8 font-mono">
            <div><span class="text-[#F5AFAF]">Agent wallet:</span> <a class="underline" href="${suivisionBase}/account/${talos.agentWalletAddress}">${talos.agentWalletAddress}</a></div>
            ${talos.onChainObjectId ? `<div><span class="text-[#F5AFAF]">Talos object:</span> <a class="underline" href="${suivisionBase}/object/${talos.onChainObjectId}">${talos.onChainObjectId}</a></div>` : ""}
            ${talos.walrusProfileBlob ? `<div><span class="text-[#F5AFAF]">Walrus profile blob:</span> <a class="underline" href="${aggregator}/v1/blobs/${talos.walrusProfileBlob}">${talos.walrusProfileBlob}</a></div>` : ""}
          </section>`
        : ""
    }

    <footer class="mt-16 pt-8 border-t border-[#F9DFDF] text-xs text-[#8E8383] flex items-center justify-between">
      <span>Published to Walrus from Talos Protocol on Sui</span>
      <a class="text-[#F5AFAF] underline" href="https://talos-sui.vercel.app/agents/${talos.id}">View on Talos →</a>
    </footer>
  </main>
</body>
</html>`;

  const blob = await storeWalrusBlob(html, { epochs: 50 });

  // Persist alongside the agent so the dashboard can link straight to the site
  await db
    .update(tlsTalos)
    .set({ walrusProfileBlob: blob.blobId })
    .where(eq(tlsTalos.id, id));

  return Response.json({
    blobId: blob.blobId,
    url: blob.url,
    bytes: html.length,
    note: "To map this blob to <agent>.wal.app run `walrus-sites publish` against the same blob id.",
  });
}
