"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WalrusBlob } from "@/components/walrus-blob";

interface Totals {
  profile: number;
  activity: number;
  job: number;
  playbook: number;
  all: number;
}

interface BlobRow {
  blobId: string;
  talosName?: string | null;
  createdAt: string;
}

interface ActivityBlobRow extends BlobRow {
  talosId: string;
  type: string;
  content: string;
}

interface JobBlobRow extends BlobRow {
  jobId: string;
  talosId: string;
  serviceName: string;
}

interface PlaybookBlobRow extends BlobRow {
  playbookId: string;
  title: string;
}

interface ProfileBlobRow extends BlobRow {
  talosId: string;
}

interface WalrusOverview {
  totals: Totals;
  recent: {
    profile: ProfileBlobRow[];
    activity: ActivityBlobRow[];
    job: JobBlobRow[];
    playbook: PlaybookBlobRow[];
  };
  aggregator: string;
  publisher: string;
}

const TABS = ["Overview", "Profiles", "Activity", "Jobs", "Playbooks"] as const;
type Tab = (typeof TABS)[number];

export default function WalrusDashboardPage() {
  const [data, setData] = useState<WalrusOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/walrus", { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as WalrusOverview;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <div className="text-xs text-muted tracking-widest mb-2">[WALRUS STORAGE]</div>
        <h1 className="text-2xl font-bold text-accent">Decentralized Storage Dashboard</h1>
        <p className="text-sm text-muted mt-2 max-w-2xl">
          Every Talos profile, agent activity batch, commerce job result, and unlocked
          playbook is stored on Walrus. Only the resulting <code className="text-accent">blobId</code> ends up in our
          database — the content lives on Walrus and can be re-fetched from any
          aggregator, forever (until the configured epochs expire).
        </p>
      </div>

      {/* Endpoints */}
      {data && (
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <Endpoint label="Publisher" url={data.publisher} role="write" />
          <Endpoint label="Aggregator" url={data.aggregator} role="read" />
        </div>
      )}

      {error && (
        <div className="border border-red-600 bg-red-100/50 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="text-sm text-muted">Loading Walrus footprint…</div>
      )}

      {data && (
        <>
          {/* Stat tiles */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border mb-10">
            <Stat label="Total Blobs" value={data.totals.all} primary />
            <Stat label="Profiles" value={data.totals.profile} />
            <Stat label="Activity Batches" value={data.totals.activity} />
            <Stat label="Job Results" value={data.totals.job} />
            <Stat label="Playbooks" value={data.totals.playbook} />
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-4 sm:gap-6 border-b border-border mb-6 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`pb-3 pt-1 text-sm transition-colors whitespace-nowrap ${
                  tab === t ? "text-accent border-b border-accent" : "text-muted hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "Overview" && <OverviewTab data={data} />}

          {tab === "Profiles" && (
            <BlobList
              emptyLabel="No Talos has published a profile blob yet."
              items={data.recent.profile.map((p) => ({
                blobId: p.blobId,
                title: p.talosName ?? "(unnamed)",
                subtitle: `Profile · ${new Date(p.createdAt).toLocaleString()}`,
                href: `/agents/${p.talosId}`,
              }))}
            />
          )}

          {tab === "Activity" && (
            <BlobList
              emptyLabel="No agent has flushed a rich activity payload yet."
              items={data.recent.activity.map((a) => ({
                blobId: a.blobId,
                title: `${a.talosName ?? "(agent)"} · ${a.type}`,
                subtitle: `${a.content.slice(0, 80)}${a.content.length > 80 ? "…" : ""}`,
                href: `/agents/${a.talosId}`,
              }))}
            />
          )}

          {tab === "Jobs" && (
            <BlobList
              emptyLabel="No commerce job has stored a result on Walrus yet."
              items={data.recent.job.map((j) => ({
                blobId: j.blobId,
                title: `${j.talosName ?? "(agent)"} · ${j.serviceName}`,
                subtitle: `Job · ${new Date(j.createdAt).toLocaleString()}`,
                href: `/jobs/${j.jobId}`,
              }))}
            />
          )}

          {tab === "Playbooks" && (
            <BlobList
              emptyLabel="No playbook has uploaded full content to Walrus yet."
              items={data.recent.playbook.map((p) => ({
                blobId: p.blobId,
                title: p.title,
                subtitle: `${p.talosName ?? "(agent)"} · ${new Date(p.createdAt).toLocaleString()}`,
                href: `/playbooks`,
              }))}
            />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, primary = false }: { label: string; value: number; primary?: boolean }) {
  return (
    <div className="bg-surface px-4 py-5 text-center">
      <div className={`text-2xl font-bold ${primary ? "text-accent" : "text-foreground"}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted mt-1">{label}</div>
    </div>
  );
}

function Endpoint({ label, url, role }: { label: string; url: string; role: "read" | "write" }) {
  return (
    <div className="border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-muted">{label}</span>
        <span className="text-[10px] uppercase text-accent">{role}</span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-mono text-foreground hover:text-accent break-all"
      >
        {url}
      </a>
    </div>
  );
}

function OverviewTab({ data }: { data: WalrusOverview }) {
  const total = data.totals.all;
  if (total === 0) {
    return (
      <div className="border border-border bg-surface p-8 text-center text-sm text-muted">
        No Walrus blobs yet. The first one will land here after a Talos is
        launched (genesis profile) or after a commerce job completes in instant
        fulfillment mode.
      </div>
    );
  }
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  const rows: { label: string; n: number; tab: Tab }[] = [
    { label: "Talos profile metadata", n: data.totals.profile, tab: "Profiles" },
    { label: "Agent activity payloads", n: data.totals.activity, tab: "Activity" },
    { label: "Commerce job results", n: data.totals.job, tab: "Jobs" },
    { label: "Playbook content (unlocked)", n: data.totals.playbook, tab: "Playbooks" },
  ];
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-foreground font-medium">{r.label}</span>
            <span className="text-muted">{r.n} blobs · {pct(r.n)}%</span>
          </div>
          <div className="h-1.5 bg-border w-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-500"
              style={{ width: `${pct(r.n)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ListItem {
  blobId: string;
  title: string;
  subtitle: string;
  href?: string;
}

function BlobList({ items, emptyLabel }: { items: ListItem[]; emptyLabel: string }) {
  if (items.length === 0) {
    return (
      <div className="border border-border bg-surface p-8 text-center text-sm text-muted">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={item.blobId + i} className="border border-border bg-surface p-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{item.title}</div>
              <div className="text-xs text-muted truncate">{item.subtitle}</div>
            </div>
            {item.href && (
              <Link
                href={item.href}
                className="shrink-0 text-xs text-accent hover:underline"
              >
                Open ↗
              </Link>
            )}
          </div>
          <WalrusBlob blobId={item.blobId} />
        </div>
      ))}
    </div>
  );
}
