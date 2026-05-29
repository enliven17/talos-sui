import { NextRequest } from "next/server";

/**
 * GET /api/walrus/blob/:blobId
 *
 * Server-side proxy that streams a Walrus blob from the configured
 * aggregator. Exposed so MCP clients (and any browser that can't
 * CORS-talk directly to a Walrus aggregator) get a stable origin to
 * fetch from.
 *
 * The response preserves the original content-type and adds a cache
 * header — Walrus blobs are immutable, so long caching is safe.
 */
export const dynamic = "force-dynamic";

const AGGREGATOR =
  process.env.WALRUS_AGGREGATOR_URL ??
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ??
  "https://aggregator.walrus-testnet.walrus.space";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ blobId: string }> },
) {
  const { blobId } = await params;
  if (!blobId || blobId.length < 10) {
    return Response.json({ error: "Invalid blobId" }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${AGGREGATOR}/v1/blobs/${blobId}`);
    if (upstream.status === 404) {
      return Response.json(
        { error: "Blob not found or epochs expired", blobId },
        { status: 404 },
      );
    }
    if (!upstream.ok) {
      return Response.json(
        { error: `Aggregator returned ${upstream.status}`, blobId },
        { status: 502 },
      );
    }

    const buf = await upstream.arrayBuffer();
    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";

    return new Response(buf, {
      headers: {
        "Content-Type": contentType,
        // Walrus blobs are content-addressed → safe to cache aggressively.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Walrus-Aggregator": AGGREGATOR,
        "X-Walrus-Blob-Id": blobId,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Walrus fetch failed";
    return Response.json({ error: message, blobId }, { status: 502 });
  }
}
