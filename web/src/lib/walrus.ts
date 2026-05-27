/**
 * Walrus client — decentralized blob storage on Sui.
 *
 * Walrus exposes two REST roles: a "publisher" that stores blobs and a
 * "aggregator" that serves them back. We use the public testnet endpoints
 * by default and accept overrides via env vars.
 *
 * Talos stores the following on Walrus:
 *   - Agent activity log batches  (JSON-encoded, ~KB each)
 *   - Commerce job results        (arbitrary JSON / text)
 *   - Playbook content & avatars  (binary or JSON)
 *
 * Only the returned `blobId` is persisted on-chain (in the Talos shared
 * object) and in our database, keeping per-row storage cheap while making
 * full audit trails publicly retrievable from any Walrus aggregator.
 */

const PUBLISHER_URL =
  process.env.WALRUS_PUBLISHER_URL ??
  process.env.NEXT_PUBLIC_WALRUS_PUBLISHER_URL ??
  "https://publisher.walrus-testnet.walrus.space";

const AGGREGATOR_URL =
  process.env.WALRUS_AGGREGATOR_URL ??
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ??
  "https://aggregator.walrus-testnet.walrus.space";

/** Default epochs to keep a blob. Walrus billing scales with epochs. */
const DEFAULT_EPOCHS =
  Number(process.env.WALRUS_EPOCHS ?? process.env.NEXT_PUBLIC_WALRUS_EPOCHS ?? "5") || 5;

export interface WalrusBlobRef {
  /** Walrus blob id (base64url-encoded). This is the durable handle. */
  blobId: string;
  /** Sui object id of the blob record (only present for newly stored blobs). */
  suiObjectId?: string;
  /** Size in bytes as reported by the publisher. */
  size?: number;
  /** Aggregator URL where the blob can be fetched. */
  url: string;
}

import { span } from "./trace";

/**
 * Store an arbitrary string (JSON or text) on Walrus. Returns the durable
 * blob id and a retrieval URL. Throws on network/publisher errors.
 */
export async function storeWalrusBlob(
  data: string | Uint8Array,
  opts: { epochs?: number; deletable?: boolean } = {},
): Promise<WalrusBlobRef> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return span(
    "walrus.store",
    { bytes: bytes.byteLength, epochs: opts.epochs ?? DEFAULT_EPOCHS },
    () => storeWalrusBlobImpl(bytes, opts),
  );
}

async function storeWalrusBlobImpl(
  bytes: Uint8Array,
  opts: { epochs?: number; deletable?: boolean } = {},
): Promise<WalrusBlobRef> {
  const epochs = opts.epochs ?? DEFAULT_EPOCHS;
  // Wrap in Blob so the fetch BodyInit overloads accept the binary payload
  // across Node + browser without TypeScript widening to `BodyInit`.
  const body = new Blob([bytes as BlobPart], { type: "application/octet-stream" });

  const params = new URLSearchParams();
  params.set("epochs", String(epochs));
  if (opts.deletable) params.set("deletable", "true");

  const res = await fetch(`${PUBLISHER_URL}/v1/blobs?${params}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Walrus store failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as
    | {
        newlyCreated?: {
          blobObject: { blobId: string; id: string; size?: number };
        };
        alreadyCertified?: { blobId: string; endEpoch?: number };
      }
    | Record<string, unknown>;

  // Two response shapes from the publisher:
  // 1) newlyCreated -> first-time upload
  // 2) alreadyCertified -> blob existed; we still get the id back
  const created = (json as { newlyCreated?: unknown }).newlyCreated as
    | { blobObject: { blobId: string; id: string; size?: number } }
    | undefined;
  const certified = (json as { alreadyCertified?: unknown }).alreadyCertified as
    | { blobId: string }
    | undefined;

  const blobId = created?.blobObject.blobId ?? certified?.blobId;
  if (!blobId) {
    throw new Error(
      `Walrus store: unexpected response shape: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }

  return {
    blobId,
    suiObjectId: created?.blobObject.id,
    size: created?.blobObject.size,
    url: `${AGGREGATOR_URL}/v1/blobs/${blobId}`,
  };
}

/**
 * Fetch a previously-stored blob as a string (assumes UTF-8 / JSON).
 */
export async function fetchWalrusBlob(blobId: string): Promise<string> {
  const res = await fetch(`${AGGREGATOR_URL}/v1/blobs/${blobId}`);
  if (!res.ok) {
    throw new Error(`Walrus fetch failed: ${res.status}`);
  }
  return await res.text();
}

/**
 * Fetch a blob as raw bytes (for binary content like avatars).
 */
export async function fetchWalrusBlobBytes(blobId: string): Promise<Uint8Array> {
  const res = await fetch(`${AGGREGATOR_URL}/v1/blobs/${blobId}`);
  if (!res.ok) {
    throw new Error(`Walrus fetch failed: ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export function walrusBlobUrl(blobId: string): string {
  return `${AGGREGATOR_URL}/v1/blobs/${blobId}`;
}

/**
 * Convenience: serialize a JSON-safe object and push it to Walrus.
 * Returns the blob ref. Use this for activity log batches, job results, etc.
 */
export async function storeJsonOnWalrus<T>(
  value: T,
  opts?: { epochs?: number; deletable?: boolean },
): Promise<WalrusBlobRef> {
  return storeWalrusBlob(JSON.stringify(value), opts);
}

export async function fetchJsonFromWalrus<T = unknown>(blobId: string): Promise<T> {
  const text = await fetchWalrusBlob(blobId);
  return JSON.parse(text) as T;
}

export const WALRUS_PUBLISHER_URL = PUBLISHER_URL;
export const WALRUS_AGGREGATOR_URL = AGGREGATOR_URL;
export const WALRUS_DEFAULT_EPOCHS = DEFAULT_EPOCHS;

/**
 * Probe whether a Walrus blob is still resolvable from the aggregator.
 * Walrus blobs disappear when their epochs run out (Walrus charges per
 * epoch). Used by the `/walrus` dashboard "Storage Lifecycle" panel and
 * by the `<WalrusBlob>` viewer to show an "expired" affordance.
 */
export async function probeWalrusBlob(
  blobId: string,
  signal?: AbortSignal,
): Promise<{ blobId: string; alive: boolean; status: number; size?: number }> {
  try {
    const res = await fetch(`${AGGREGATOR_URL}/v1/blobs/${blobId}`, {
      method: "HEAD",
      signal,
    });
    const sizeHeader = res.headers.get("content-length");
    return {
      blobId,
      alive: res.ok,
      status: res.status,
      size: sizeHeader ? Number(sizeHeader) : undefined,
    };
  } catch {
    return { blobId, alive: false, status: 0 };
  }
}

/**
 * Resilience helper: re-PUT a blob from a fresh source-of-truth (DB row,
 * agent state, etc.) so it lives for another N epochs. Walrus content is
 * content-addressed, so re-storing identical bytes produces the same
 * `blobId` and the publisher returns `alreadyCertified` — meaning you
 * can safely "renew" a blob without invalidating any pointers in the
 * `Talos` shared object or the database.
 *
 * The publisher charges WAL for the new epoch lease.
 */
export async function extendWalrusBlob<T>(
  freshValue: T,
  opts?: { epochs?: number },
): Promise<WalrusBlobRef> {
  return storeJsonOnWalrus(freshValue, { epochs: opts?.epochs ?? DEFAULT_EPOCHS });
}

/**
 * Estimate the WAL cost (in publisher-side cost units) for storing `size`
 * bytes for `epochs` epochs. Real Walrus costs depend on encoding
 * overhead (~1000×, plus storage-node fees) so this is a rough upper
 * bound suitable for "how much will this cost to extend?" hints in the
 * dashboard. Returns cost in MIST-equivalent units.
 */
export function estimateWalrusCost(
  sizeBytes: number,
  epochs: number = DEFAULT_EPOCHS,
): number {
  // 1 MIST per byte per epoch is conservative; Walrus testnet currently
  // bills well under that.
  return sizeBytes * epochs * 1;
}

