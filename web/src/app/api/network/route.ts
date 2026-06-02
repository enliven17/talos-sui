/**
 * GET /api/network
 *
 * Aggregates the on-chain commerce graph for the Talos ecosystem:
 *   - `tls_commerce_jobs`        → talos↔talos (or human→talos) USDC service jobs
 *   - `tls_playbook_purchases`   → buyer→talos playbook sales
 *
 * Every edge represents a real on-chain USDC settlement via x402-on-Sui.
 * Human buyers (encoded as `"human:0x..."` in `requesterTalosId`, or as raw
 * `0x...` addresses in `buyerAddress`) are *aggregated* into a single
 * synthetic `"humans"` node so we never dox individual wallets.
 *
 * Response is capped to the top 100 talos nodes by total revenue to keep the
 * payload small for the force-directed canvas on the client.
 */
import { db } from "@/db";
import { tlsTalos, tlsCommerceJobs, tlsPlaybooks, tlsPlaybookPurchases } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const HUMANS_NODE_ID = "humans";
const MAX_NODES = 100;

type EdgeKind = "service" | "playbook" | "mixed";

interface NodeOut {
  id: string;
  label: string;
  category: string;
  revenue: number;
  jobCount: number;
  isHuman?: boolean;
}

interface EdgeOut {
  source: string;
  target: string;
  weight: number;
  volumeUsd: number;
  jobCount: number;
  kind: EdgeKind;
}

interface MutableEdge {
  source: string;
  target: string;
  volumeUsd: number;
  jobCount: number;
  hasService: boolean;
  hasPlaybook: boolean;
}

interface MutableTalosNode {
  id: string;
  label: string;
  category: string;
  revenue: number;
  jobCount: number;
}

function edgeKey(source: string, target: string): string {
  return `${source}${target}`;
}

function bumpEdge(
  edges: Map<string, MutableEdge>,
  source: string,
  target: string,
  amount: number,
  kind: "service" | "playbook",
): void {
  const key = edgeKey(source, target);
  const existing = edges.get(key);
  if (existing) {
    existing.volumeUsd += amount;
    existing.jobCount += 1;
    if (kind === "service") existing.hasService = true;
    else existing.hasPlaybook = true;
    return;
  }
  edges.set(key, {
    source,
    target,
    volumeUsd: amount,
    jobCount: 1,
    hasService: kind === "service",
    hasPlaybook: kind === "playbook",
  });
}

export async function GET() {
  try {
    // ─── 1. Load all talos rows (we need name + category for every node) ──
    const talosRows = await db
      .select({
        id: tlsTalos.id,
        name: tlsTalos.name,
        category: tlsTalos.category,
        agentWalletAddress: tlsTalos.agentWalletAddress,
      })
      .from(tlsTalos);

    // Build lookup tables: talos id → meta, and wallet → talos id (so we can
    // recognise on-chain agent wallets that paid out as playbook buyers).
    const talosById = new Map<string, { name: string; category: string }>();
    const talosIdByWallet = new Map<string, string>();
    for (const row of talosRows) {
      talosById.set(row.id, { name: row.name, category: row.category });
      if (row.agentWalletAddress) {
        talosIdByWallet.set(row.agentWalletAddress.toLowerCase(), row.id);
      }
    }

    // ─── 2. Commerce jobs (talos seller, talos OR human buyer) ───────────
    const jobs = await db
      .select({
        sellerTalosId: tlsCommerceJobs.talosId,
        buyerTalosId: tlsCommerceJobs.requesterTalosId,
        amount: tlsCommerceJobs.amount,
        status: tlsCommerceJobs.status,
      })
      .from(tlsCommerceJobs);

    // ─── 3. Playbook purchases (seller via playbook → talos, buyer = addr)─
    const purchases = await db
      .select({
        sellerTalosId: tlsPlaybooks.talosId,
        buyerAddress: tlsPlaybookPurchases.buyerAddress,
        price: tlsPlaybooks.price,
      })
      .from(tlsPlaybookPurchases)
      .innerJoin(tlsPlaybooks, eq(tlsPlaybookPurchases.playbookId, tlsPlaybooks.id));

    // ─── 4. Aggregate ────────────────────────────────────────────────────
    const nodes = new Map<string, MutableTalosNode>();
    const edges = new Map<string, MutableEdge>();
    let humansTouched = false;

    function ensureNode(id: string): MutableTalosNode | null {
      const existing = nodes.get(id);
      if (existing) return existing;
      const meta = talosById.get(id);
      if (!meta) return null; // unknown talos id — skip silently
      const fresh: MutableTalosNode = {
        id,
        label: meta.name,
        category: meta.category,
        revenue: 0,
        jobCount: 0,
      };
      nodes.set(id, fresh);
      return fresh;
    }

    // Jobs: settled-ish jobs count as revenue. We're permissive here — anything
    // that's not "failed"/"cancelled" with an amount > 0 contributes to volume.
    for (const job of jobs) {
      const amount = Number(job.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (job.status === "failed" || job.status === "cancelled") continue;

      const seller = ensureNode(job.sellerTalosId);
      if (!seller) continue;
      seller.revenue += amount;
      seller.jobCount += 1;

      // Resolve buyer: literal talos id, "human:0x..." prefix, or raw fallback.
      let buyerId: string;
      const raw = job.buyerTalosId;
      if (raw.startsWith("human:")) {
        buyerId = HUMANS_NODE_ID;
        humansTouched = true;
      } else if (talosById.has(raw)) {
        buyerId = raw;
        ensureNode(buyerId);
      } else {
        // Unknown id — treat as human to avoid dropping the edge.
        buyerId = HUMANS_NODE_ID;
        humansTouched = true;
      }
      bumpEdge(edges, buyerId, seller.id, amount, "service");
    }

    // Playbook purchases: seller is always a talos. Buyer is a 0x... address;
    // if that address matches a known talos wallet we link talos→talos,
    // otherwise it folds into "humans".
    for (const p of purchases) {
      const amount = Number(p.price);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const seller = ensureNode(p.sellerTalosId);
      if (!seller) continue;
      seller.revenue += amount;
      seller.jobCount += 1;

      const wallet = p.buyerAddress.toLowerCase();
      const buyerTalosId = talosIdByWallet.get(wallet);
      let buyerId: string;
      if (buyerTalosId && buyerTalosId !== seller.id) {
        buyerId = buyerTalosId;
        ensureNode(buyerId);
      } else {
        buyerId = HUMANS_NODE_ID;
        humansTouched = true;
      }
      bumpEdge(edges, buyerId, seller.id, amount, "playbook");
    }

    // ─── 5. Cap at top 100 talos nodes by revenue ────────────────────────
    const talosNodes = Array.from(nodes.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, MAX_NODES);
    const kept = new Set(talosNodes.map((n) => n.id));
    if (humansTouched) kept.add(HUMANS_NODE_ID);

    // Filter edges to those whose endpoints both survived the cap.
    const survivingEdges: EdgeOut[] = [];
    const connectedIds = new Set<string>();
    for (const e of edges.values()) {
      if (!kept.has(e.source) || !kept.has(e.target)) continue;
      const kind: EdgeKind =
        e.hasService && e.hasPlaybook ? "mixed" : e.hasPlaybook ? "playbook" : "service";
      survivingEdges.push({
        source: e.source,
        target: e.target,
        weight: e.jobCount,
        volumeUsd: Number(e.volumeUsd.toFixed(6)),
        jobCount: e.jobCount,
        kind,
      });
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }

    // Drop any node that ended up isolated after the edge filter.
    const outNodes: NodeOut[] = [];
    for (const n of talosNodes) {
      if (!connectedIds.has(n.id)) continue;
      outNodes.push({
        id: n.id,
        label: n.label,
        category: n.category,
        revenue: Number(n.revenue.toFixed(6)),
        jobCount: n.jobCount,
      });
    }
    if (humansTouched && connectedIds.has(HUMANS_NODE_ID)) {
      outNodes.push({
        id: HUMANS_NODE_ID,
        label: "Humans",
        category: "Human",
        revenue: 0,
        jobCount: 0,
        isHuman: true,
      });
    }

    return Response.json({ nodes: outNodes, edges: survivingEdges });
  } catch (err) {
    console.error("/api/network failed", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
