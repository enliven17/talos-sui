"use client";

import { useEffect, useState } from "react";

interface MethodSpec {
  method: string;
  label: string;
  defaultParams: string; // JSON string
  description: string;
}

const METHODS: MethodSpec[] = [
  {
    method: "sui_getChainIdentifier",
    label: "Chain identifier",
    defaultParams: "[]",
    description: "Returns the current chain identifier (a hex digest of the genesis checkpoint).",
  },
  {
    method: "sui_getLatestCheckpointSequenceNumber",
    label: "Latest checkpoint",
    defaultParams: "[]",
    description: "Returns the latest finalised Sui checkpoint sequence number — proves the gateway is live.",
  },
  {
    method: "suix_getReferenceGasPrice",
    label: "Reference gas price",
    defaultParams: "[]",
    description: "Returns the current reference gas price in MIST per gas unit.",
  },
  {
    method: "suix_getBalance",
    label: "Address balance (SUI by default)",
    defaultParams: JSON.stringify(["0x0000000000000000000000000000000000000000000000000000000000000005"], null, 2),
    description: "Total SUI (in MIST) for an address. Second arg can be a coin type, e.g. `\"0x...::usdc::USDC\"`.",
  },
  {
    method: "suix_getCoinMetadata",
    label: "Coin metadata",
    defaultParams: JSON.stringify(["0x2::sui::SUI"], null, 2),
    description: "Decimals, symbol, name, icon URL for a Coin<T>. Try the Mitos coin type once you publish one.",
  },
  {
    method: "suix_getOwnedObjects",
    label: "Owned objects",
    defaultParams: JSON.stringify(
      ["0x0000000000000000000000000000000000000000000000000000000000000005", { options: { showType: true } }],
      null,
      2,
    ),
    description: "Lists objects owned by an address — used to discover Talos shared objects, Mitos coins, NFTs.",
  },
];

interface RpcResponse {
  method: string;
  params: unknown[];
  provider: "tatum" | "public";
  latencyMs: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * MCP-style playground.
 *
 * The page lets a human (or an agent driving a headless browser) issue
 * structured Sui JSON-RPC calls through the Tatum-backed proxy at
 * `/api/playground/rpc`. The same proxy is what AI agents target when they
 * want a "tool" surface they can call without holding the Tatum key
 * themselves — the equivalent of an MCP tool with input + output schema.
 */
export default function PlaygroundPage() {
  const [spec, setSpec] = useState<MethodSpec>(METHODS[0]);
  const [paramsText, setParamsText] = useState(METHODS[0].defaultParams);
  const [response, setResponse] = useState<RpcResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setParamsText(spec.defaultParams);
    setResponse(null);
    setError(null);
  }, [spec]);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    let params: unknown[];
    try {
      params = JSON.parse(paramsText);
      if (!Array.isArray(params)) throw new Error("params must be a JSON array");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/playground/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: spec.method, params }),
      });
      const body = (await res.json()) as RpcResponse | { error: string };
      if (!res.ok || "error" in body) {
        const rpc = body as RpcResponse;
        const msg =
          "error" in body && typeof body.error === "string"
            ? body.error
            : rpc.error
              ? `RPC error ${rpc.error.code}: ${rpc.error.message}`
              : "Unknown RPC error";
        setError(msg);
        if (!("error" in body)) setResponse(rpc);
      } else {
        setResponse(body);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <div className="text-xs text-muted tracking-widest mb-2">[MCP PLAYGROUND]</div>
        <h1 className="text-2xl font-bold text-accent">Tatum-backed Sui RPC tool surface</h1>
        <p className="text-sm text-muted mt-2 max-w-3xl">
          This page is the human-friendly face of our Sui RPC proxy at{" "}
          <code className="text-accent">/api/playground/rpc</code>. AI agents
          (Claude Code, Codex, OpenAI assistants, your own scripts) can POST
          the same payload as a tool/function call — no Tatum key needed on
          their side, the server-side <code>TATUM_API_KEY</code> handles auth.
        </p>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        {/* Method picker */}
        <div className="space-y-2">
          <div className="text-xs text-muted tracking-widest mb-3">[METHOD]</div>
          {METHODS.map((m) => (
            <button
              key={m.method}
              type="button"
              onClick={() => setSpec(m)}
              className={`w-full text-left p-3 border transition-colors ${
                m.method === spec.method
                  ? "border-accent bg-surface text-accent"
                  : "border-border bg-background text-foreground hover:bg-surface-hover"
              }`}
            >
              <div className="text-xs font-mono">{m.method}</div>
              <div className="text-[10px] text-muted mt-0.5">{m.label}</div>
            </button>
          ))}
        </div>

        {/* Request / Response */}
        <div className="space-y-6">
          <div className="bg-surface border border-border p-5">
            <div className="text-xs text-muted tracking-widest mb-3">[REQUEST]</div>
            <p className="text-xs text-muted mb-3">{spec.description}</p>
            <label className="block text-xs text-muted mb-2">params (JSON array)</label>
            <textarea
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
              rows={6}
              className="w-full bg-background border border-border px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-accent"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="mt-3 bg-accent text-background px-5 py-2 text-sm font-medium hover:bg-foreground transition-colors disabled:opacity-50"
            >
              {loading ? "Calling…" : `Call ${spec.method} →`}
            </button>
          </div>

          {error && (
            <div className="border border-red-600 bg-red-100/50 text-red-700 p-3 text-xs">
              {error}
            </div>
          )}

          {response && (
            <div className="bg-surface border border-border">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <div className="text-xs text-muted tracking-widest">[RESPONSE]</div>
                <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted">
                  <span>{response.provider}</span>
                  <span className="text-border">·</span>
                  <span>{response.latencyMs}ms</span>
                </div>
              </div>
              <pre className="px-5 py-4 text-[11px] text-foreground overflow-x-auto leading-relaxed max-h-96 whitespace-pre-wrap break-words">
                {JSON.stringify(response.result ?? response.error ?? null, null, 2)}
              </pre>
            </div>
          )}

          <div className="bg-surface border border-border p-5">
            <div className="text-xs text-muted tracking-widest mb-3">[FOR AI AGENTS]</div>
            <p className="text-xs text-muted mb-3">
              Wire this proxy as a function in your agent toolkit. Whitelist
              is enforced server-side — extra methods need an env-flagged
              opt-in.
            </p>
            <pre className="text-[11px] text-foreground bg-background border border-border p-3 overflow-x-auto">
{`// Example tool definition for an OpenAI / Anthropic agent
{
  "name": "sui_rpc",
  "description": "Issue a JSON-RPC call against Sui via the Tatum gateway.",
  "input_schema": {
    "type": "object",
    "properties": {
      "method": { "type": "string", "description": "Sui JSON-RPC method, e.g. suix_getBalance" },
      "params": { "type": "array", "items": {} }
    },
    "required": ["method", "params"]
  }
}

// Execution:
const r = await fetch("${typeof window !== "undefined" ? window.location.origin : ""}/api/playground/rpc", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ method, params }),
});`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
