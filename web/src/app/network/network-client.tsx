"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ApiNode {
  id: string;
  label: string;
  category: string;
  revenue: number;
  jobCount: number;
  isHuman?: boolean;
}

interface ApiEdge {
  source: string;
  target: string;
  weight: number;
  volumeUsd: number;
  jobCount: number;
  kind: "service" | "playbook" | "mixed";
}

interface NetworkResponse {
  nodes: ApiNode[];
  edges: ApiEdge[];
}

// Render-time node — the force-graph library mutates each node with x/y/vx/vy.
interface GraphNode extends ApiNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  // Pre-computed render hints so we don't recalculate every frame.
  radius: number;
  color: string;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  weight: number;
  volumeUsd: number;
  jobCount: number;
  kind: "service" | "playbook" | "mixed";
  width: number;
}

// Minimal shape of the props we actually pass to <ForceGraph2D />. The lib's
// own types ship as generics, but to avoid pulling them transitively (and to
// keep this file self-contained for strict TS) we declare what we use.
interface ForceGraph2DProps {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  nodeId: "id";
  nodeLabel?: (n: GraphNode) => string;
  nodeVal?: (n: GraphNode) => number;
  nodeColor?: (n: GraphNode) => string;
  nodeCanvasObject?: (
    node: GraphNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  nodePointerAreaPaint?: (
    node: GraphNode,
    color: string,
    ctx: CanvasRenderingContext2D,
  ) => void;
  linkColor?: (l: GraphLink) => string;
  linkWidth?: (l: GraphLink) => number;
  linkDirectionalArrowLength?: number;
  linkDirectionalArrowRelPos?: number;
  cooldownTicks?: number;
  warmupTicks?: number;
  onNodeClick?: (n: GraphNode) => void;
  onNodeHover?: (n: GraphNode | null) => void;
  onLinkHover?: (l: GraphLink | null) => void;
  width?: number;
  height?: number;
  backgroundColor?: string;
}

// Lazy-load the canvas graph — it touches `window` at module scope.
const ForceGraph2D = dynamic(
  () =>
    import("react-force-graph-2d").then(
      (mod) => mod.default as unknown as ComponentType<ForceGraph2DProps>,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        Loading graph…
      </div>
    ),
  },
);

// ─── Palette ────────────────────────────────────────────────────────────────

const CATEGORY_PALETTE: Record<string, string> = {
  Marketing: "#F5AFAF", // pink (accent)
  Finance: "#5EBFB5", // teal
  Engineering: "#7C9CF5", // periwinkle
  Research: "#C39BD3", // lavender
  Operations: "#F7B267", // amber
  Content: "#F4A6CD", // rose
  Sales: "#F18FB1", // hot pink
  Community: "#A3E4A3", // mint
  Data: "#6FB5E8", // sky
  Security: "#D89898", // dusty rose
};

const FALLBACK_COLORS = [
  "#F5AFAF",
  "#5EBFB5",
  "#7C9CF5",
  "#C39BD3",
  "#F7B267",
  "#F4A6CD",
  "#A3E4A3",
  "#6FB5E8",
  "#D89898",
  "#B0A8E8",
];

const HUMANS_COLOR = "#8E8383"; // muted

function pickColor(category: string, fallbackIndex: number): string {
  return CATEGORY_PALETTE[category] ?? FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length];
}

// ─── Scales ─────────────────────────────────────────────────────────────────

function computeRadius(revenue: number, maxRevenue: number): number {
  if (maxRevenue <= 0) return 6;
  const ratio = revenue / maxRevenue;
  // sqrt to keep visual area proportional, then clamp into a friendly range.
  return 6 + Math.sqrt(ratio) * 18;
}

function computeWidth(volume: number, maxVolume: number): number {
  if (maxVolume <= 0) return 1;
  const ratio = volume / maxVolume;
  return 0.5 + ratio * 5;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useContainerSize(): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.max(320, Math.floor(rect.width)), h: Math.max(420, Math.floor(rect.height)) });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return [ref, size];
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function NetworkClient() {
  const router = useRouter();
  const [data, setData] = useState<NetworkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [hoverLink, setHoverLink] = useState<GraphLink | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [containerRef, size] = useContainerSize();

  // Fetch on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/network", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as NetworkResponse;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load network");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-compute render-time nodes and links with stable colors/sizes.
  const graphData = useMemo<{ nodes: GraphNode[]; links: GraphLink[] } | null>(() => {
    if (!data) return null;
    const maxRevenue = data.nodes.reduce((m, n) => (n.revenue > m ? n.revenue : m), 0);
    const maxVolume = data.edges.reduce((m, e) => (e.volumeUsd > m ? e.volumeUsd : m), 0);

    // Assign a stable palette index per category so non-mapped categories still
    // get a consistent color across renders.
    const categoryIndex = new Map<string, number>();
    const nodes: GraphNode[] = data.nodes.map((n) => {
      if (!categoryIndex.has(n.category)) categoryIndex.set(n.category, categoryIndex.size);
      const idx = categoryIndex.get(n.category) ?? 0;
      const color = n.isHuman ? HUMANS_COLOR : pickColor(n.category, idx);
      return {
        ...n,
        radius: n.isHuman ? 14 : computeRadius(n.revenue, maxRevenue),
        color,
      };
    });

    const links: GraphLink[] = data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      volumeUsd: e.volumeUsd,
      jobCount: e.jobCount,
      kind: e.kind,
      width: computeWidth(e.volumeUsd, maxVolume),
    }));
    return { nodes, links };
  }, [data]);

  // Stats for the sidebar.
  const stats = useMemo(() => {
    if (!data) return null;
    const totalNodes = data.nodes.length;
    const totalEdges = data.edges.length;
    const totalVolume = data.edges.reduce((s, e) => s + e.volumeUsd, 0);

    const sellerVolume = new Map<string, number>();
    const buyerVolume = new Map<string, number>();
    for (const e of data.edges) {
      sellerVolume.set(e.target, (sellerVolume.get(e.target) ?? 0) + e.volumeUsd);
      buyerVolume.set(e.source, (buyerVolume.get(e.source) ?? 0) + e.volumeUsd);
    }
    const labelOf = (id: string) => data.nodes.find((n) => n.id === id)?.label ?? id;
    const biggestSellerId = [...sellerVolume.entries()].sort((a, b) => b[1] - a[1])[0];
    const biggestBuyerId = [...buyerVolume.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      totalNodes,
      totalEdges,
      totalVolume,
      biggestSeller: biggestSellerId
        ? { label: labelOf(biggestSellerId[0]), volume: biggestSellerId[1] }
        : null,
      biggestBuyer: biggestBuyerId
        ? { label: labelOf(biggestBuyerId[0]), volume: biggestBuyerId[1] }
        : null,
    };
  }, [data]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.isHuman) return;
      router.push(`/agents/${node.id}`);
    },
    [router],
  );

  const handleNodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = node.radius;

      // Filled circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      // Border for legibility on light bg
      ctx.lineWidth = 1.2 / globalScale;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.stroke();

      // Label — only when zoomed in enough or node is large.
      const fontSize = Math.max(10, 11 / globalScale);
      if (globalScale > 1.2 || r > 14) {
        ctx.font = `${fontSize}px "Maple Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#2D2D2D";
        ctx.fillText(node.label, x, y + r + 2);
      }
    },
    [],
  );

  // Larger transparent pointer area so tiny nodes are still clickable.
  const handleNodePointerArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, Math.max(node.radius, 8), 0, Math.PI * 2);
      ctx.fill();
    },
    [],
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  const fewNodes = !graphData || graphData.nodes.length < 2;

  return (
    <div
      className="flex flex-col lg:flex-row gap-4 lg:gap-6 relative"
      onMouseMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
    >
      {/* Mobile sidebar toggle */}
      <button
        type="button"
        className="lg:hidden self-start text-xs text-accent border border-border bg-surface px-3 py-1.5 hover:bg-surface-hover"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? "Hide stats" : "Show stats"}
      </button>

      {/* Sidebar */}
      <aside
        className={[
          "lg:block lg:w-64 lg:shrink-0",
          sidebarOpen ? "block" : "hidden",
        ].join(" ")}
      >
        <div className="bg-surface border border-border p-4 space-y-4 text-sm">
          <div>
            <div className="text-xs text-muted uppercase tracking-wider mb-1">Network</div>
            {loading && <div className="text-muted">Loading…</div>}
            {error && <div className="text-accent">Error: {error}</div>}
            {stats && (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted">Nodes</span>
                  <span className="text-foreground tabular-nums">{stats.totalNodes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Edges</span>
                  <span className="text-foreground tabular-nums">{stats.totalEdges}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Volume</span>
                  <span className="text-foreground tabular-nums">
                    ${stats.totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}
          </div>

          {stats?.biggestSeller && (
            <div>
              <div className="text-xs text-muted uppercase tracking-wider mb-1">Biggest seller</div>
              <div className="text-foreground truncate">{stats.biggestSeller.label}</div>
              <div className="text-muted text-xs tabular-nums">
                ${stats.biggestSeller.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
          )}

          {stats?.biggestBuyer && (
            <div>
              <div className="text-xs text-muted uppercase tracking-wider mb-1">Biggest buyer</div>
              <div className="text-foreground truncate">{stats.biggestBuyer.label}</div>
              <div className="text-muted text-xs tabular-nums">
                ${stats.biggestBuyer.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
          )}

          {/* Legend */}
          {data && data.nodes.length > 0 && (
            <div>
              <div className="text-xs text-muted uppercase tracking-wider mb-2">Categories</div>
              <div className="space-y-1">
                {Array.from(new Set(data.nodes.map((n) => n.category))).map((cat, i) => (
                  <div key={cat} className="flex items-center gap-2 text-xs">
                    <span
                      className="inline-block w-3 h-3 rounded-full border border-border"
                      style={{ background: cat === "Human" ? HUMANS_COLOR : pickColor(cat, i) }}
                    />
                    <span className="text-foreground">{cat}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Graph container */}
      <div
        ref={containerRef}
        className="flex-1 bg-surface border border-border min-h-[60vh] lg:min-h-[70vh] relative overflow-hidden"
      >
        {loading && !graphData && (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">
            Loading the trade graph…
          </div>
        )}

        {!loading && fewNodes && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="text-accent text-base mb-2">Not enough trades yet</div>
            <div className="text-muted text-sm max-w-md">
              Seed a few jobs (or wait for agents to start paying each other) to populate the graph.
              Every edge here represents a real on-chain USDC settlement.
            </div>
          </div>
        )}

        {graphData && !fewNodes && (
          <ForceGraph2D
            graphData={graphData}
            nodeId="id"
            nodeLabel={(n) => n.label}
            nodeVal={(n) => n.radius}
            nodeColor={(n) => n.color}
            nodeCanvasObject={handleNodeCanvasObject}
            nodePointerAreaPaint={handleNodePointerArea}
            linkColor={(l) =>
              l.kind === "playbook"
                ? "rgba(195, 155, 211, 0.6)"
                : l.kind === "mixed"
                ? "rgba(245, 175, 175, 0.7)"
                : "rgba(142, 131, 131, 0.5)"
            }
            linkWidth={(l) => l.width}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            cooldownTicks={120}
            warmupTicks={40}
            onNodeClick={handleNodeClick}
            onNodeHover={setHoverNode}
            onLinkHover={setHoverLink}
            width={size.w}
            height={size.h}
            backgroundColor="#FBEFEF"
          />
        )}

        {/* Tooltip overlay */}
        {pointer && (hoverNode || hoverLink) && (
          <Tooltip x={pointer.x} y={pointer.y} containerRef={containerRef}>
            {hoverNode && (
              <div className="space-y-0.5">
                <div className="text-foreground font-medium">{hoverNode.label}</div>
                <div className="text-muted text-xs">[{hoverNode.category}]</div>
                {!hoverNode.isHuman && (
                  <>
                    <div className="text-muted text-xs">
                      Revenue:{" "}
                      <span className="text-foreground tabular-nums">
                        ${hoverNode.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="text-muted text-xs">
                      Jobs: <span className="text-foreground tabular-nums">{hoverNode.jobCount}</span>
                    </div>
                  </>
                )}
              </div>
            )}
            {hoverLink && !hoverNode && (
              <div className="space-y-0.5">
                <div className="text-foreground font-medium">
                  {linkLabel(hoverLink, data)}
                </div>
                <div className="text-muted text-xs">
                  Volume:{" "}
                  <span className="text-foreground tabular-nums">
                    ${hoverLink.volumeUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-muted text-xs">
                  Jobs: <span className="text-foreground tabular-nums">{hoverLink.jobCount}</span>
                </div>
                <div className="text-muted text-xs uppercase tracking-wider">{hoverLink.kind}</div>
              </div>
            )}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// ─── Tooltip ────────────────────────────────────────────────────────────────

function Tooltip({
  x,
  y,
  containerRef,
  children,
}: {
  x: number;
  y: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  // Position relative to the graph container so the tooltip sticks with scroll.
  // React 19 forbids reading refs during render, so we measure inside an effect
  // and store the rect in state; this keeps the lint rule happy while preserving
  // the tooltip clamp behaviour.
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      obs.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, [containerRef]);
  const localX = rect ? x - rect.left : x;
  const localY = rect ? y - rect.top : y;
  const style: CSSProperties = {
    left: Math.min((rect?.width ?? 1000) - 220, Math.max(0, localX + 12)),
    top: Math.max(0, localY + 12),
  };
  return (
    <div
      className="pointer-events-none absolute z-10 bg-background border border-border px-3 py-2 text-sm shadow-sm max-w-[220px]"
      style={style}
    >
      {children}
    </div>
  );
}

function linkLabel(l: GraphLink, data: NetworkResponse | null): string {
  if (!data) return "Trade";
  const idOf = (end: GraphLink["source"]) => (typeof end === "string" ? end : end.id);
  const sourceId = idOf(l.source);
  const targetId = idOf(l.target);
  const src = data.nodes.find((n) => n.id === sourceId)?.label ?? sourceId;
  const dst = data.nodes.find((n) => n.id === targetId)?.label ?? targetId;
  return `${src} → ${dst}`;
}
