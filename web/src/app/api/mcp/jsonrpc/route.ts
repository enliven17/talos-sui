/**
 * POST /api/mcp/jsonrpc
 *
 * Minimal MCP-over-HTTP JSON-RPC bridge.
 *
 * Implements the three core methods MCP clients (Claude Desktop, Codex,
 * Cursor) expect when they talk to a remote MCP server:
 *
 *   initialize  → server capabilities + protocolVersion
 *   tools/list  → array of { name, description, inputSchema }
 *   tools/call  → invoke a tool by name with arguments
 *
 * Every read tool here ultimately routes through the Tatum-backed Sui
 * gateway (for chain data) or a Walrus aggregator (for blob data) —
 * meaning the MCP client can talk to Sui + Walrus without ever holding
 * the TATUM_API_KEY itself.
 *
 * Spec ref: https://spec.modelcontextprotocol.io/specification/
 */
import { NextRequest } from "next/server";
import { getSuiClient, getSuiRpcUrl } from "@/lib/sui";
import { tatumStatus } from "@/lib/tatum";

const ORIGIN_FALLBACK =
  process.env.NEXT_PUBLIC_ORIGIN ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

export const dynamic = "force-dynamic";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, baseUrl: string) => Promise<unknown>;
}

const ALLOWED_RPC_METHODS = new Set([
  "sui_getChainIdentifier",
  "sui_getLatestCheckpointSequenceNumber",
  "suix_getReferenceGasPrice",
  "suix_getBalance",
  "suix_getAllBalances",
  "suix_getCoins",
  "suix_getCoinMetadata",
  "suix_getOwnedObjects",
  "sui_getObject",
  "sui_getTransactionBlock",
  "suix_queryEvents",
]);

const TOOLS: Tool[] = [
  {
    name: "sui_rpc",
    description:
      "Invoke a whitelisted Sui JSON-RPC method through the Tatum gateway. The TATUM_API_KEY is held server-side; the agent never sees it.",
    inputSchema: {
      type: "object",
      required: ["method"],
      properties: {
        method: { type: "string", description: "Sui JSON-RPC method name" },
        params: {
          type: "array",
          description: "Positional params for the RPC call",
          items: {},
        },
      },
    },
    handler: async (args) => {
      const method = String(args.method ?? "");
      const params = Array.isArray(args.params) ? args.params : [];
      if (!ALLOWED_RPC_METHODS.has(method)) {
        throw new Error(
          `Method '${method}' is not in the allowlist (${Array.from(ALLOWED_RPC_METHODS).join(", ")})`,
        );
      }
      const apiKey = process.env.TATUM_API_KEY;
      const t0 = Date.now();
      const res = await fetch(getSuiRpcUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = await res.json();
      return {
        method,
        params,
        provider: apiKey ? "tatum" : "public",
        latencyMs: Date.now() - t0,
        result: json.result,
        error: json.error,
      };
    },
  },
  {
    name: "talos_list",
    description:
      "Page through the Talos agent marketplace. Returns Sui address, agent name, Mitos coin type, on-chain object id, Walrus profile blob id.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: { type: "string" },
        limit: { type: "integer", maximum: 100 },
      },
    },
    handler: async (args, baseUrl) => {
      const qs = new URLSearchParams();
      if (typeof args.cursor === "string") qs.set("cursor", args.cursor);
      if (typeof args.limit === "number") qs.set("limit", String(args.limit));
      const res = await fetch(`${baseUrl}/api/talos?${qs}`);
      return await res.json();
    },
  },
  {
    name: "talos_get",
    description:
      "Read a single Talos's full profile (kernel policy, patron split, recent activity, service listing).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
    handler: async (args, baseUrl) => {
      const id = String(args.id ?? "");
      const res = await fetch(`${baseUrl}/api/talos/${id}`);
      return await res.json();
    },
  },
  {
    name: "services_discover",
    description:
      "Filterable, paginated list of paid services every Talos exposes (the x402-on-Sui marketplace).",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "integer", maximum: 100 },
      },
    },
    handler: async (args, baseUrl) => {
      const qs = new URLSearchParams();
      if (typeof args.category === "string") qs.set("category", args.category);
      if (typeof args.cursor === "string") qs.set("cursor", args.cursor);
      if (typeof args.limit === "number") qs.set("limit", String(args.limit));
      const res = await fetch(`${baseUrl}/api/services?${qs}`);
      return await res.json();
    },
  },
  {
    name: "walrus_get",
    description:
      "Fetch the bytes of a Walrus blob through the configured aggregator. The MCP client can verify any agent's published profile / activity / job result.",
    inputSchema: {
      type: "object",
      required: ["blobId"],
      properties: { blobId: { type: "string" } },
    },
    handler: async (args, baseUrl) => {
      const blobId = String(args.blobId ?? "");
      const res = await fetch(`${baseUrl}/api/walrus/blob/${blobId}`);
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return await res.json();
      }
      return { blobId, contentType, status: res.status };
    },
  },
  {
    name: "rpc_status",
    description:
      "Health check for the Tatum-backed Sui RPC. Returns provider, latency, and the latest finalised checkpoint.",
    inputSchema: { type: "object" },
    handler: async () => {
      const client = getSuiClient();
      const t0 = Date.now();
      const checkpoint = await client.getLatestCheckpointSequenceNumber();
      const status = tatumStatus();
      return {
        ok: true,
        provider: status.provider,
        latencyMs: Date.now() - t0,
        latestCheckpoint: checkpoint,
        network: status.network,
      };
    },
  },
];

function jsonRpcResult(id: string | number | null | undefined, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function jsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }
  const { method, id, params } = body;
  const baseUrl =
    ORIGIN_FALLBACK ||
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;

  try {
    if (method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "talos-protocol",
          version: "1.0.0",
          vendor: "Talos",
        },
      });
    }

    if (method === "tools/list") {
      return jsonRpcResult(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }

    if (method === "tools/call") {
      const name = String(params?.name ?? "");
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        return jsonRpcError(id, -32601, `Tool not found: ${name}`);
      }
      const result = await tool.handler(args, baseUrl);
      return jsonRpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      });
    }

    if (method === "ping") {
      return jsonRpcResult(id, {});
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonRpcError(id, -32603, message);
  }
}

export async function GET() {
  return Response.json({
    transport: "http",
    methods: ["initialize", "tools/list", "tools/call", "ping"],
    tools: TOOLS.map((t) => t.name),
    note: "POST JSON-RPC 2.0 to this endpoint. See /.well-known/mcp.json for the full manifest.",
  });
}
