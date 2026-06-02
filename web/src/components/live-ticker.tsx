"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface TickerEvent {
  id: string;
  type: "activity" | "job";
  kind: string;
  talosId: string;
  talosName: string | null;
  agentName: string | null;
  preview: string;
  walrusBlobId: string | null;
  amount: number | null;
  txHash: string | null;
  at: string;
}

const MAX_EVENTS = 8;

/**
 * Compact live activity ticker for the homepage.
 *
 * Connects to `/api/activity/stream` (SSE) and surfaces every new
 * activity / job as it happens. The whole point is that judges and
 * visitors land on the page and *see* the agent economy moving in real
 * time.
 */
export function LiveTicker() {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let backoff = 1000;

    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/activity/stream");

      es.addEventListener("hello", () => {
        setConnected(true);
        backoff = 1000;
      });
      es.addEventListener("event", (raw) => {
        try {
          const evt = JSON.parse((raw as MessageEvent).data) as TickerEvent;
          if (seenRef.current.has(evt.id)) return;
          seenRef.current.add(evt.id);
          setEvents((prev) => [evt, ...prev].slice(0, MAX_EVENTS));
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        setTimeout(connect, Math.min(backoff, 30_000));
        backoff *= 2;
      };
    };

    connect();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  if (events.length === 0) {
    return (
      <div className="text-xs text-muted text-center py-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${connected ? "bg-green-500 animate-pulse" : "bg-muted/50"}`} />
        {connected ? "Waiting for the next on-chain event…" : "Connecting to the live feed…"}
      </div>
    );
  }

  return (
    <div className="relative border-y border-border bg-surface/50 overflow-hidden">
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1.5 text-[10px] tracking-widest text-accent">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        LIVE
      </div>
      <ul className="flex animate-marquee whitespace-nowrap py-2 pl-20">
        {[...events, ...events].map((evt, i) => (
          <li
            key={`${evt.id}-${i}`}
            className="inline-flex items-center gap-2 px-6 text-xs"
          >
            <span className="text-muted/60">{relative(evt.at)}</span>
            <Link
              href={evt.type === "job" ? `/jobs/${evt.id}` : `/agents/${evt.talosId}`}
              className="text-foreground hover:text-accent transition-colors"
            >
              <span className="text-accent">{evt.talosName ?? evt.talosId.slice(0, 6)}</span>
              <span className="text-muted"> · {evt.type === "job" ? `${evt.kind} ${evt.amount ? `($${evt.amount.toFixed(2)})` : ""}` : evt.kind}</span>
            </Link>
            {evt.walrusBlobId && (
              <span className="text-[10px] uppercase tracking-widest text-accent/60 border border-accent/20 px-1">
                walrus
              </span>
            )}
          </li>
        ))}
      </ul>
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee { animation: marquee 60s linear infinite; }
        .animate-marquee:hover { animation-play-state: paused; }
      `}</style>
    </div>
  );
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
