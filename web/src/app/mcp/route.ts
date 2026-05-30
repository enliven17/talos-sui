/**
 * GET /mcp
 *
 * Convenience alias for `/.well-known/mcp.json` so MCP clients that
 * scan for a top-level `/mcp` endpoint (Tatum's MCP server gateway
 * style) can discover the same manifest without the well-known dance.
 *
 * Identical body to `/.well-known/mcp.json`.
 */
import { GET as wellKnown } from "../.well-known/mcp.json/route";

export const dynamic = "force-dynamic";

export const GET = wellKnown;
