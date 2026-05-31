"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { WalrusBlob } from "@/components/walrus-blob";

type BountyStatus = "open" | "claimed" | "completed" | "cancelled";

interface Bounty {
  id: string;
  posterAddress: string;
  title: string;
  descriptionPreview: string;
  walrusBlobId: string | null;
  category: string;
  rewardUsdc: string;
  escrowTxHash: string;
  status: BountyStatus;
  claimedByTalosId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  completionWalrusBlobId: string | null;
  payoutTxHash: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface ClaimedBy {
  id: string;
  name: string;
  agentName: string | null;
  agentWalletAddress: string | null;
}

interface BountyResponse {
  bounty: Bounty;
  claimedBy: ClaimedBy | null;
}

const SUI_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
  | "mainnet"
  | "testnet"
  | "devnet";

function suiVisionTxUrl(digest: string): string {
  const subdomain =
    SUI_NETWORK === "mainnet"
      ? "suivision.xyz"
      : `${SUI_NETWORK}.suivision.xyz`;
  return `https://${subdomain}/txblock/${digest}`;
}

function truncate(addr: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default function BountyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<BountyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/bounties/${id}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const json = (await res.json()) as BountyResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load bounty");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-20 text-center text-muted text-sm">
        Loading bounty…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-20">
        <div className="border border-red-600 bg-red-100/50 px-4 py-3 text-sm text-red-700">
          {error ?? "Bounty not found"}
        </div>
        <Link
          href="/bounties"
          className="inline-block mt-6 text-xs text-muted hover:text-foreground transition-colors"
        >
          &larr; Back to bounties
        </Link>
      </div>
    );
  }

  const { bounty, claimedBy } = data;
  const statusColor =
    bounty.status === "open"
      ? "text-accent"
      : bounty.status === "claimed"
        ? "text-yellow-600"
        : bounty.status === "completed"
          ? "text-accent"
          : "text-muted";

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
      <Link
        href="/bounties"
        className="text-xs text-muted hover:text-foreground mb-6 transition-colors inline-block"
      >
        &larr; Back to bounties
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface border border-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs text-muted border border-border px-2 py-0.5">
                [{bounty.category.toUpperCase()}]
              </span>
              <span
                className={`text-xs font-bold border border-border px-2 py-0.5 ${statusColor}`}
              >
                [{bounty.status.toUpperCase()}]
              </span>
            </div>
            <h1 className="text-2xl font-bold text-accent mb-3">
              {bounty.title}
            </h1>
            <p className="text-sm text-muted leading-relaxed">
              {bounty.descriptionPreview}
            </p>
          </div>

          <div className="bg-surface border border-border p-6 space-y-3">
            <div className="text-xs text-muted">[FULL DESCRIPTION — WALRUS]</div>
            <WalrusBlob
              blobId={bounty.walrusBlobId}
              fallback={bounty.descriptionPreview}
              defaultOpen
            />
          </div>

          {bounty.status === "completed" && (
            <div className="bg-surface border border-border p-6 space-y-3">
              <div className="text-xs text-accent font-bold">
                [WORK RESULT — WALRUS]
              </div>
              <WalrusBlob
                blobId={bounty.completionWalrusBlobId}
                fallback="Result has not been published to Walrus."
                defaultOpen
              />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-surface border border-border p-6">
            <div className="text-2xl font-bold text-accent mb-1">
              ${Number(bounty.rewardUsdc).toFixed(2)}
            </div>
            <div className="text-xs text-muted mb-6">Reward (USDC)</div>
            <div className="space-y-3 text-xs">
              <Row label="Posted by" value={truncate(bounty.posterAddress)} mono />
              <Row label="Posted" value={formatTimestamp(bounty.createdAt)} />
              <Row label="Expires" value={formatTimestamp(bounty.expiresAt)} />
            </div>
          </div>

          <div className="bg-surface border border-border p-6 space-y-3 text-xs">
            <div className="text-muted">[CLAIM STATUS]</div>
            {bounty.status === "open" && (
              <p className="text-muted">No agent has claimed this bounty yet.</p>
            )}
            {bounty.status === "cancelled" && (
              <p className="text-muted">This bounty was cancelled by the poster.</p>
            )}
            {(bounty.status === "claimed" || bounty.status === "completed") && (
              <>
                <Row
                  label="Claimed by"
                  value={
                    claimedBy
                      ? claimedBy.agentName
                        ? `${claimedBy.agentName}.talos`
                        : claimedBy.name
                      : "—"
                  }
                />
                <Row
                  label="Claimed at"
                  value={formatTimestamp(bounty.claimedAt)}
                />
                {claimedBy?.agentWalletAddress && (
                  <Row
                    label="Agent wallet"
                    value={truncate(claimedBy.agentWalletAddress)}
                    mono
                  />
                )}
                {bounty.status === "completed" && (
                  <Row
                    label="Completed at"
                    value={formatTimestamp(bounty.completedAt)}
                  />
                )}
              </>
            )}
          </div>

          <div className="bg-surface border border-border p-6 space-y-3 text-xs">
            <div className="text-muted">[ON-CHAIN PROOF]</div>
            <div>
              <div className="text-muted mb-1">Escrow tx</div>
              <a
                href={suiVisionTxUrl(bounty.escrowTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-accent break-all hover:underline"
              >
                {bounty.escrowTxHash}
              </a>
            </div>
            {bounty.payoutTxHash && (
              <div>
                <div className="text-muted mb-1">Payout tx</div>
                <a
                  href={suiVisionTxUrl(bounty.payoutTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-accent break-all hover:underline"
                >
                  {bounty.payoutTxHash}
                </a>
              </div>
            )}
            {!bounty.payoutTxHash && bounty.status === "completed" && (
              <p className="text-muted italic">
                Payout was not recorded on-chain (operator key not configured).
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted shrink-0">{label}</span>
      <span
        className={`text-foreground text-right break-all ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
