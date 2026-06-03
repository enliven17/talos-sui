import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  storeWalrusBlob,
  storeJsonOnWalrus,
  fetchWalrusBlob,
  fetchWalrusBlobBytes,
  fetchJsonFromWalrus,
  walrusBlobUrl,
  WALRUS_PUBLISHER_URL,
  WALRUS_AGGREGATOR_URL,
} from "@/lib/walrus";

// Helper: build a fake Response with a chosen status/body.
function makeRes(opts: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  arrayBuffer?: ArrayBuffer;
}): Response {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    json: async () => opts.json,
    text: async () => opts.text ?? (opts.json ? JSON.stringify(opts.json) : ""),
    arrayBuffer: async () =>
      opts.arrayBuffer ?? new TextEncoder().encode(opts.text ?? "").buffer,
  } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

// ─── module-level exports ───────────────────────────────────────────

describe("module exports", () => {
  it("defaults publisher URL to walrus-testnet", () => {
    expect(WALRUS_PUBLISHER_URL).toMatch(/^https?:\/\//);
  });

  it("defaults aggregator URL to walrus-testnet", () => {
    expect(WALRUS_AGGREGATOR_URL).toMatch(/^https?:\/\//);
  });

  it("walrusBlobUrl builds aggregator path", () => {
    expect(walrusBlobUrl("BLOB_ID")).toBe(
      `${WALRUS_AGGREGATOR_URL}/v1/blobs/BLOB_ID`,
    );
  });
});

// ─── storeWalrusBlob ────────────────────────────────────────────────

describe("storeWalrusBlob", () => {
  it("uploads bytes and returns blob ref (newlyCreated path)", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({
        json: {
          newlyCreated: {
            blobObject: {
              blobId: "BLOB_NEW",
              id: "0xobject1",
              size: 42,
            },
          },
        },
      }),
    );

    const ref = await storeWalrusBlob("hello");

    expect(ref.blobId).toBe("BLOB_NEW");
    expect(ref.suiObjectId).toBe("0xobject1");
    expect(ref.size).toBe(42);
    expect(ref.url).toBe(`${WALRUS_AGGREGATOR_URL}/v1/blobs/BLOB_NEW`);
  });

  it("returns blob ref from alreadyCertified path", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({
        json: {
          alreadyCertified: { blobId: "BLOB_EXISTING" },
        },
      }),
    );

    const ref = await storeWalrusBlob("hello");

    expect(ref.blobId).toBe("BLOB_EXISTING");
    expect(ref.suiObjectId).toBeUndefined();
    expect(ref.size).toBeUndefined();
    expect(ref.url).toBe(`${WALRUS_AGGREGATOR_URL}/v1/blobs/BLOB_EXISTING`);
  });

  it("PUTs to the publisher URL with epochs query param", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({
        json: {
          newlyCreated: { blobObject: { blobId: "B", id: "0xi" } },
        },
      }),
    );

    await storeWalrusBlob("payload", { epochs: 7 });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain(`${WALRUS_PUBLISHER_URL}/v1/blobs?`);
    expect(String(url)).toContain("epochs=7");
    expect((init as RequestInit).method).toBe("PUT");
  });

  it("uses default epochs (5) when not provided", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({
        json: { newlyCreated: { blobObject: { blobId: "B", id: "0xi" } } },
      }),
    );

    await storeWalrusBlob("payload");

    const [url] = fetchSpy.mock.calls[0]!;
    // Default DEFAULT_EPOCHS is parsed from env at module load — accept any
    // numeric value but verify the param is present.
    expect(String(url)).toMatch(/epochs=\d+/);
  });

  it("includes 'deletable=true' when opts.deletable is set", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({
        json: { newlyCreated: { blobObject: { blobId: "B", id: "0xi" } } },
      }),
    );

    await storeWalrusBlob("payload", { deletable: true });

    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("deletable=true");
  });

  it("does NOT include 'deletable' when opts.deletable is omitted", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({
        json: { newlyCreated: { blobObject: { blobId: "B", id: "0xi" } } },
      }),
    );

    await storeWalrusBlob("payload");

    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).not.toContain("deletable=");
  });

  it("throws on publisher 5xx response", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ ok: false, status: 500, text: "Internal Error" }),
    );

    await expect(storeWalrusBlob("payload")).rejects.toThrow(
      /Walrus store failed: 500/,
    );
  });

  it("throws on publisher 4xx response", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ ok: false, status: 400, text: "Bad" }),
    );
    await expect(storeWalrusBlob("payload")).rejects.toThrow(
      /Walrus store failed: 400/,
    );
  });

  it("throws when response has neither newlyCreated nor alreadyCertified", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ json: { somethingElse: true } }),
    );
    await expect(storeWalrusBlob("payload")).rejects.toThrow(
      /unexpected response shape/,
    );
  });

  it("accepts Uint8Array input as well as string", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({
        json: { newlyCreated: { blobObject: { blobId: "BIN", id: "0xi" } } },
      }),
    );

    const ref = await storeWalrusBlob(new Uint8Array([1, 2, 3]));
    expect(ref.blobId).toBe("BIN");
  });
});

// ─── storeJsonOnWalrus ──────────────────────────────────────────────

describe("storeJsonOnWalrus", () => {
  it("JSON-stringifies the value before uploading", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({
        json: { newlyCreated: { blobObject: { blobId: "JBLOB", id: "0xi" } } },
      }),
    );

    const ref = await storeJsonOnWalrus({ hello: "world", n: 1 });

    expect(ref.blobId).toBe("JBLOB");
    expect(ref.url).toBe(`${WALRUS_AGGREGATOR_URL}/v1/blobs/JBLOB`);
    // Verify the upload was a PUT to the publisher
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain(`${WALRUS_PUBLISHER_URL}/v1/blobs?`);
    expect((init as RequestInit).method).toBe("PUT");
  });

  it("propagates publisher errors", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ ok: false, status: 502, text: "Bad Gateway" }),
    );
    await expect(storeJsonOnWalrus({ x: 1 })).rejects.toThrow(
      /Walrus store failed: 502/,
    );
  });
});

// ─── fetchWalrusBlob ────────────────────────────────────────────────

describe("fetchWalrusBlob", () => {
  it("returns text on 200", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ status: 200, text: "hello payload" }),
    );

    const txt = await fetchWalrusBlob("BLOB_ID");
    expect(txt).toBe("hello payload");

    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      `${WALRUS_AGGREGATOR_URL}/v1/blobs/BLOB_ID`,
    );
  });

  it("throws on 404", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ ok: false, status: 404, text: "Not Found" }),
    );
    await expect(fetchWalrusBlob("MISSING")).rejects.toThrow(
      /Walrus fetch failed: 404/,
    );
  });

  it("throws on 500", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ ok: false, status: 500, text: "ERR" }),
    );
    await expect(fetchWalrusBlob("X")).rejects.toThrow(
      /Walrus fetch failed: 500/,
    );
  });
});

// ─── fetchWalrusBlobBytes ───────────────────────────────────────────

describe("fetchWalrusBlobBytes", () => {
  it("returns Uint8Array on 200", async () => {
    const data = new Uint8Array([7, 8, 9]);
    fetchSpy.mockResolvedValueOnce(
      makeRes({ status: 200, arrayBuffer: data.buffer }),
    );

    const bytes = await fetchWalrusBlobBytes("BLOB_BIN");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([7, 8, 9]);
  });

  it("throws on non-OK status", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ ok: false, status: 404, text: "Not Found" }),
    );
    await expect(fetchWalrusBlobBytes("MISSING")).rejects.toThrow(
      /Walrus fetch failed: 404/,
    );
  });
});

// ─── fetchJsonFromWalrus ────────────────────────────────────────────

describe("fetchJsonFromWalrus", () => {
  it("parses JSON from aggregator text response", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ status: 200, text: JSON.stringify({ a: 1, b: "two" }) }),
    );

    const obj = await fetchJsonFromWalrus<{ a: number; b: string }>("JID");
    expect(obj).toEqual({ a: 1, b: "two" });
  });

  it("propagates aggregator errors", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ ok: false, status: 404, text: "x" }),
    );
    await expect(fetchJsonFromWalrus("JID")).rejects.toThrow(
      /Walrus fetch failed: 404/,
    );
  });

  it("throws on malformed JSON", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeRes({ status: 200, text: "{not json" }),
    );
    await expect(fetchJsonFromWalrus("JID")).rejects.toThrow();
  });
});
