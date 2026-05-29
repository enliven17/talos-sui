"use client";

import { useEffect, useState } from "react";

const AGGREGATOR =
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ??
  "https://aggregator.walrus-testnet.walrus.space";

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; text: string; isJson: boolean; size: number }
  | { kind: "expired" }
  | { kind: "error"; message: string };

interface WalrusBlobProps {
  blobId: string | null | undefined;
  /** Inline preview shown collapsed (a one-line summary the DB row already has). */
  fallback?: string;
  /** Open expanded on first render. */
  defaultOpen?: boolean;
  /** Maximum chars rendered inline; beyond this we offer a "Download" link. */
  maxInlineChars?: number;
}

/**
 * Reusable viewer for a Walrus blob id.
 *
 * Lazy-fetches the blob from the configured aggregator only when the user
 * expands the panel; pretty-prints JSON and surfaces a stable
 * `https://aggregator/v1/blobs/<id>` link so the content is independently
 * verifiable from any Walrus aggregator (proof for hackathon judges).
 *
 * Handles two failure modes Walrus exposes:
 *   - 404 from the aggregator → blob expired / never stored → "expired"
 *   - anything else → "error" with the status text
 */
export function WalrusBlob({
  blobId,
  fallback,
  defaultOpen = false,
  maxInlineChars = 4000,
}: WalrusBlobProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState<FetchState>({ kind: "idle" });

  const url = blobId ? `${AGGREGATOR}/v1/blobs/${blobId}` : null;

  useEffect(() => {
    if (!open || !blobId || state.kind !== "idle") return;
    let cancelled = false;
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const res = await fetch(`${AGGREGATOR}/v1/blobs/${blobId}`);
        if (cancelled) return;
        if (res.status === 404) {
          setState({ kind: "expired" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "error", message: `${res.status} ${res.statusText}` });
          return;
        }
        const text = await res.text();
        let pretty = text;
        let isJson = false;
        try {
          pretty = JSON.stringify(JSON.parse(text), null, 2);
          isJson = true;
        } catch {
          /* not JSON, render as-is */
        }
        setState({
          kind: "ok",
          text: pretty,
          isJson,
          size: new Blob([text]).size,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [open, blobId, state.kind]);

  if (!blobId) {
    if (!fallback) return null;
    return (
      <div className="text-xs text-muted italic">{fallback}</div>
    );
  }

  return (
    <div className="border border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 border border-accent/30 text-[10px] tracking-widest uppercase text-accent">
            Walrus
          </span>
          <span className="text-xs font-mono text-foreground truncate">
            {blobId.slice(0, 18)}…{blobId.slice(-8)}
          </span>
        </div>
        <span className="text-xs text-muted shrink-0">{open ? "Hide" : "View"}</span>
      </button>

      {fallback && !open && (
        <div className="px-3 pb-2 text-xs text-muted line-clamp-2">{fallback}</div>
      )}

      {open && (
        <div className="border-t border-border">
          {state.kind === "loading" && (
            <div className="px-3 py-4 text-xs text-muted">Fetching from Walrus aggregator…</div>
          )}
          {state.kind === "expired" && (
            <div className="px-3 py-4 text-xs text-yellow-600">
              Blob no longer available on the aggregator (epochs expired or
              never propagated). The DB-side summary is shown above.
            </div>
          )}
          {state.kind === "error" && (
            <div className="px-3 py-4 text-xs text-red-600">
              Walrus fetch failed: {state.message}
            </div>
          )}
          {state.kind === "ok" && (
            <div className="bg-surface">
              <div className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted border-b border-border">
                <span>{state.isJson ? "JSON" : "Raw text"} · {state.size} bytes</span>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    Open in aggregator ↗
                  </a>
                )}
              </div>
              <pre className="px-3 py-3 text-[11px] text-foreground overflow-x-auto leading-relaxed max-h-96 whitespace-pre-wrap break-words">
                {state.text.length > maxInlineChars
                  ? state.text.slice(0, maxInlineChars) + `\n…\n[truncated, ${state.size - maxInlineChars} more bytes — open in aggregator]`
                  : state.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Helper to build the canonical aggregator URL for a blob id. */
export function walrusBlobUrl(blobId: string): string {
  return `${AGGREGATOR}/v1/blobs/${blobId}`;
}
