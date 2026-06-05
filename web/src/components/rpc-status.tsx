"use client";

import { useEffect, useState } from "react";

interface Status {
  ok: boolean;
  provider: "tatum" | "public";
  latencyMs?: number;
  latestCheckpoint?: string;
  ts: number;
}

/**
 * Compact RPC health indicator that lives in the header.
 *
 * Polls `/api/rpc-status` (which the edge caches for 30s) every minute and
 * shows "Tatum • <latency>ms" with a green/red dot. Clicking opens a
 * tooltip with the latest Sui checkpoint, proving end-to-end connectivity
 * through the Tatum gateway.
 */
export function RpcStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/rpc-status", { cache: "no-store" });
        const body = (await res.json()) as Status;
        if (!cancelled) setStatus(body);
      } catch {
        if (!cancelled) setStatus({ ok: false, provider: "public", ts: Date.now() });
      }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!status) {
    return (
      <span
        className="hidden xl:inline-flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted font-mono"
        title="Checking RPC..."
      >
        <span className="w-1.5 h-1.5 rounded-full bg-muted/50 animate-pulse" />
        RPC
      </span>
    );
  }

  const dot = status.ok ? "bg-green-500" : "bg-red-500";
  const label = status.provider === "tatum" ? "Tatum" : "Sui RPC";

  return (
    <div className="relative hidden xl:block shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] uppercase tracking-widest text-muted hover:text-foreground font-mono transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span>{label}</span>
        {status.latencyMs != null && (
          <span className="text-muted">· {status.latencyMs}ms</span>
        )}
      </button>

      {expanded && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-surface border border-border p-3 text-xs font-mono shadow-lg z-50">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2">
            Sui RPC
          </div>
          <div className="space-y-1 text-foreground">
            <div className="flex justify-between">
              <span className="text-muted">Provider</span>
              <span>{status.provider === "tatum" ? "Tatum Gateway" : "Public fullnode"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Status</span>
              <span className={status.ok ? "text-green-500" : "text-red-500"}>
                {status.ok ? "online" : "offline"}
              </span>
            </div>
            {status.latencyMs != null && (
              <div className="flex justify-between">
                <span className="text-muted">Latency</span>
                <span>{status.latencyMs}ms</span>
              </div>
            )}
            {status.latestCheckpoint && (
              <div className="flex justify-between">
                <span className="text-muted">Checkpoint</span>
                <span>#{status.latestCheckpoint}</span>
              </div>
            )}
          </div>
          <div className="mt-3 pt-2 border-t border-border text-[10px] text-muted leading-snug">
            All Sui reads + writes flow through the configured Tatum gateway. Get a free key at{" "}
            <a
              href="https://dashboard.tatum.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              dashboard.tatum.io
            </a>
            .
          </div>
        </div>
      )}
    </div>
  );
}
