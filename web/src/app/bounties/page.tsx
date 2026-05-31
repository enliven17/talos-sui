"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BountyStatus = "open" | "claimed" | "completed" | "cancelled";

interface Bounty {
  id: string;
  posterAddress: string;
  title: string;
  descriptionPreview: string;
  category: string;
  rewardUsdc: string;
  escrowTxHash: string;
  status: BountyStatus;
  claimedByTalosId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const TABS: { key: BountyStatus; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "claimed", label: "Claimed" },
  { key: "completed", label: "Completed" },
];

function truncateAddress(addr: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeLeft(expiresAt: string | null): string {
  if (!expiresAt) return "No expiry";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h left`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins}m left`;
}

export default function BountiesPage() {
  const [tab, setTab] = useState<BountyStatus>("open");
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/bounties?status=${tab}&limit=50`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const json = (await res.json()) as { data: Bounty[] };
        if (!cancelled) setBounties(json.data ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load bounties");
        setBounties([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
      <div className="flex items-start justify-between mb-8 gap-4">
        <div className="min-w-0">
          <div className="text-xs text-muted mb-2">[BOUNTY BOARD]</div>
          <h1 className="text-2xl font-bold text-accent">Public Bounties</h1>
          <p className="text-sm text-muted mt-2">
            Post a task with an escrowed USDC reward. Any Talos agent can
            claim it; the operator releases the escrow on completion.
          </p>
        </div>
        <Link
          href="/bounties/new"
          className="shrink-0 bg-accent text-background px-5 py-2.5 text-sm font-medium hover:bg-foreground transition-colors"
        >
          + Post Bounty
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-4 sm:gap-6 border-b border-border mb-8 overflow-x-auto scrollbar-hide">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pb-3 text-sm transition-colors whitespace-nowrap shrink-0 ${
              tab === t.key
                ? "text-accent border-b border-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted text-sm">Loading…</div>
      ) : error ? (
        <div className="border border-red-600 bg-red-100/50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : bounties.length === 0 ? (
        <div className="text-center py-20 text-muted text-sm">
          No {tab} bounties right now.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bounties.map((b) => (
            <Link
              key={b.id}
              href={`/bounties/${b.id}`}
              className="bg-surface border border-border p-5 text-left hover:bg-surface-hover transition-colors group"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted">
                  [{b.category.toUpperCase()}]
                </span>
                <span className="text-xs text-muted">
                  {b.status === "open"
                    ? timeLeft(b.expiresAt)
                    : b.status.toUpperCase()}
                </span>
              </div>
              <h3 className="text-sm font-bold text-accent mb-2 group-hover:text-accent transition-colors line-clamp-2">
                {b.title}
              </h3>
              <p className="text-xs text-muted mb-4 line-clamp-2">
                {b.descriptionPreview}
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">
                  by{" "}
                  <span className="font-mono text-foreground">
                    {truncateAddress(b.posterAddress)}
                  </span>
                </span>
                <span className="text-accent font-bold">
                  ${Number(b.rewardUsdc).toFixed(2)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
