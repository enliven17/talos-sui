"use client";

import { use } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { WalrusBlob } from "@/components/walrus-blob";
import { suiscanTxUrl } from "@/lib/explorer";

interface Job {
  id: string;
  talosId: string;
  talosName: string | null;
  talosAgentName: string | null;
  requesterTalosId: string;
  serviceName: string;
  payload: unknown;
  result: unknown;
  walrusResultBlobId: string | null;
  status: string;
  paymentSig: string | null;
  txHash: string | null;
  amount: string;
  createdAt: string;
  updatedAt: string;
}


/**
 * Job verification page.
 *
 * Cryptographic-proof view of a single commerce job:
 *   - on-chain Sui USDC payment receipt (link to SuiScan)
 *   - off-chain Walrus blob holding the full result (open in aggregator)
 *   - service + seller agent context (link back to detail page)
 *
 * This is the page judges land on after clicking a Walrus blob on the
 * `/walrus` dashboard — it ties the three layers (Sui · Walrus · DB) into
 * a single timeline.
 */
export default function JobVerificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const body = (await res.json()) as Job;
        if (!cancelled) setJob(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [id]);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="text-xs text-muted tracking-widest mb-2">[JOB NOT FOUND]</div>
        <h1 className="text-2xl font-bold text-accent">No job with id {id.slice(0, 12)}…</h1>
        <p className="text-sm text-muted mt-2">{error}</p>
        <Link href="/walrus" className="inline-block mt-6 text-accent hover:underline text-sm">
          ← Back to Walrus dashboard
        </Link>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center text-sm text-muted">
        Loading job…
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Link href="/walrus" className="text-xs text-muted hover:text-foreground transition-colors">
        ← Walrus Dashboard
      </Link>

      <div className="mt-6 mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="text-xs text-muted tracking-widest mb-2">[COMMERCE JOB · VERIFICATION]</div>
          <h1 className="text-2xl font-bold text-accent">{job.serviceName}</h1>
          <div className="mt-2 text-sm text-muted">
            Fulfilled by{" "}
            <Link href={`/agents/${job.talosId}`} className="text-accent hover:underline">
              {job.talosName ?? "(unnamed agent)"}
            </Link>
            {job.talosAgentName && (
              <span className="font-mono"> · {job.talosAgentName}.talos</span>
            )}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {/* Three-layer proof */}
      <div className="grid md:grid-cols-3 gap-px bg-border mb-8">
        <ProofTile
          label="Sui Payment"
          value={`${Number(job.amount).toFixed(6)} USDC`}
          sub={
            job.txHash
              ? `${job.txHash.slice(0, 10)}…${job.txHash.slice(-6)}`
              : "no tx digest"
          }
          link={job.txHash ? suiscanTxUrl(job.txHash) : undefined}
          linkLabel="View on SuiScan"
        />
        <ProofTile
          label="Walrus Result"
          value={job.walrusResultBlobId ? "Stored" : "Inline only"}
          sub={
            job.walrusResultBlobId
              ? `${job.walrusResultBlobId.slice(0, 12)}…`
              : "result stayed in DB row"
          }
        />
        <ProofTile
          label="Recorded At"
          value={new Date(job.createdAt).toLocaleDateString()}
          sub={new Date(job.createdAt).toLocaleTimeString()}
        />
      </div>

      {/* Walrus result blob */}
      {job.walrusResultBlobId && (
        <section className="mb-8">
          <div className="text-xs text-muted tracking-widest mb-3">[WALRUS RESULT]</div>
          <WalrusBlob blobId={job.walrusResultBlobId} defaultOpen />
        </section>
      )}

      {/* Inline result + payload */}
      <section className="mb-8">
        <div className="text-xs text-muted tracking-widest mb-3">[INLINE RESULT (DB)]</div>
        <pre className="bg-surface border border-border p-4 text-[11px] text-foreground overflow-x-auto max-h-72 leading-relaxed">
          {JSON.stringify(job.result ?? null, null, 2)}
        </pre>
      </section>

      <section className="mb-8">
        <div className="text-xs text-muted tracking-widest mb-3">[BUYER PAYLOAD]</div>
        <pre className="bg-surface border border-border p-4 text-[11px] text-foreground overflow-x-auto max-h-72 leading-relaxed">
          {JSON.stringify(job.payload ?? null, null, 2)}
        </pre>
      </section>

      <section className="mb-8">
        <div className="text-xs text-muted tracking-widest mb-3">[REQUESTER]</div>
        <div className="bg-surface border border-border p-4 text-xs font-mono break-all text-foreground">
          {job.requesterTalosId}
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "border-green-500/40 text-green-500"
      : status === "pending"
        ? "border-yellow-500/40 text-yellow-500"
        : "border-red-500/40 text-red-500";
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold tracking-widest uppercase border ${tone}`}>
      [{status}]
    </span>
  );
}

function ProofTile({
  label,
  value,
  sub,
  link,
  linkLabel,
}: {
  label: string;
  value: string;
  sub: string;
  link?: string;
  linkLabel?: string;
}) {
  return (
    <div className="bg-surface px-4 py-5">
      <div className="text-[10px] uppercase tracking-widest text-muted mb-1">{label}</div>
      <div className="text-base font-bold text-accent">{value}</div>
      <div className="text-[11px] text-muted font-mono truncate mt-1">{sub}</div>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-[11px] text-accent hover:underline"
        >
          {linkLabel ?? "Open"} ↗
        </a>
      )}
    </div>
  );
}
