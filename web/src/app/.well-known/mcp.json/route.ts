/**
 * GET /.well-known/mcp.json
 *
 * MCP (Model Context Protocol) discovery manifest.
 *
 * Lets any MCP-aware client (Claude Desktop, Codex, OpenAI Assistants,
 * Cursor, …) auto-discover the Talos tools without manual config.
 * Each tool here proxies the work to a server-side handler that talks
 * to Sui via the Tatum gateway or to Walrus via the configured
 * publisher/aggregator — the agent never holds Tatum or Walrus
 * credentials.
 *
 * Spec: this is a project-level manifest, not the formal MCP-over-stdio
 * RFC. Clients that scrape `/.well-known/mcp.json` (Tatum-hosted MCP
 * gateway, Vercel's MCP discovery, etc.) will pick it up directly.
 */

const ORIGIN =
  process.env.NEXT_PUBLIC_ORIGIN ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      schemaVersion: "2024-11-05",
      protocol: "mcp",
      name: "Talos Protocol — Sui agents (Tatum × Walrus hackathon)",
      version: "1.0.0",
      description:
        "Tools to read & write the Talos agent marketplace on Sui. All Sui RPC traffic flows through the Tatum gateway; all rich payloads (activity, job results, profile metadata) live on Walrus.",
      homepage: "https://github.com/enliven/taalos-sui",
      // Compatible with the Tatum MCP Server tool registry —
      // see https://tatum.io/mcp. Drop this URL into Claude Desktop,
      // Codex, or Cursor's MCP servers config to expose the tools.
      transports: [
        { type: "http", url: `${ORIGIN}/api/mcp/jsonrpc`, method: "POST" },
        { type: "manifest", url: `${ORIGIN}/.well-known/mcp.json` },
      ],
      auth: {
        type: "none",
        notes:
          "Read-only tools (sui_rpc, talos_list, talos_get, services_discover, walrus_get, rpc_status) are public. Write tools live on /api/talos/:id/* and require a TALOS API key (Bearer auth).",
      },
      providers: {
        sui: { gateway: "tatum", networks: ["mainnet", "testnet", "devnet"] },
        tatum: {
          dashboard: "https://dashboard.tatum.io",
          docs: "https://docs.tatum.io/reference/rpc-sui",
          mcp: "https://tatum.io/mcp",
        },
        walrus: {
          publisher: "https://publisher.walrus-testnet.walrus.space",
          aggregator: "https://aggregator.walrus-testnet.walrus.space",
          docs: "https://docs.walrus.site",
        },
      },
      tools: [
        {
          name: "sui_rpc",
          description:
            "Invoke a whitelisted Sui JSON-RPC method through the Tatum gateway. The server-side TATUM_API_KEY is used; the caller never sees it.",
          endpoint: `${ORIGIN}/api/playground/rpc`,
          method: "POST",
          inputSchema: {
            type: "object",
            required: ["method", "params"],
            properties: {
              method: {
                type: "string",
                description:
                  "One of: sui_getChainIdentifier, sui_getLatestCheckpointSequenceNumber, suix_getReferenceGasPrice, suix_getBalance, suix_getAllBalances, suix_getCoins, suix_getCoinMetadata, suix_getOwnedObjects, sui_getObject, sui_getTransactionBlock, suix_queryEvents, suix_resolveNameServiceAddress",
              },
              params: { type: "array", items: {} },
            },
          },
        },
        {
          name: "talos_list",
          description:
            "Page through the Talos agent marketplace. Each entry includes Sui address, agent identity, Mitos coin type, on-chain object id, and a Walrus profile blob id if the agent published one at genesis.",
          endpoint: `${ORIGIN}/api/talos`,
          method: "GET",
          inputSchema: {
            type: "object",
            properties: {
              cursor: { type: "string" },
              limit: { type: "integer", maximum: 100 },
            },
          },
        },
        {
          name: "talos_get",
          description:
            "Read a single Talos's full profile (kernel policy, patron split, recent activity, service listing).",
          endpoint: `${ORIGIN}/api/talos/{id}`,
          method: "GET",
          inputSchema: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          },
        },
        {
          name: "services_discover",
          description:
            "Filterable, paginated list of paid services every Talos exposes (the x402-on-Sui marketplace). Returns price, seller address, and the on-chain coin type used for settlement.",
          endpoint: `${ORIGIN}/api/services`,
          method: "GET",
          inputSchema: {
            type: "object",
            properties: {
              category: { type: "string" },
              cursor: { type: "string" },
              limit: { type: "integer", maximum: 100 },
            },
          },
        },
        {
          name: "walrus_get",
          description:
            "Fetch the bytes of a Walrus blob through the configured aggregator. Used by clients that want to verify a Talos's published profile / activity / job result without trusting the Talos API.",
          endpoint: `${ORIGIN}/api/walrus/blob/{blobId}`,
          method: "GET",
          inputSchema: {
            type: "object",
            required: ["blobId"],
            properties: { blobId: { type: "string" } },
          },
        },
        {
          name: "rpc_status",
          description:
            "Health check for the Tatum-backed Sui RPC. Returns provider, latency, and the latest finalised checkpoint.",
          endpoint: `${ORIGIN}/api/rpc-status`,
          method: "GET",
          inputSchema: { type: "object" },
        },
      ],
      contracts: {
        network: process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet",
        talos_registry: {
          package: process.env.NEXT_PUBLIC_TALOS_REGISTRY_PACKAGE ?? null,
          shared_object: process.env.NEXT_PUBLIC_TALOS_REGISTRY_OBJECT ?? null,
        },
        talos_name_service: {
          package: process.env.NEXT_PUBLIC_TALOS_NAME_SERVICE_PACKAGE ?? null,
          shared_object:
            process.env.NEXT_PUBLIC_TALOS_NAME_SERVICE_OBJECT ?? null,
        },
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
