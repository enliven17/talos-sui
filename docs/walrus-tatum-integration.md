# Walrus + Tatum integration

This is the exact wiring — no marketing.

## Tatum gateway usage

### Web — JSON-RPC

`web/src/lib/sui.ts` constructs a single cached `SuiClient`. When
`TATUM_API_KEY` is set the SDK's `fetch` is overridden to inject
`x-api-key` on every JSON-RPC call:

```ts
// web/src/lib/sui.ts
export function getSuiClient(): SuiClient {
  if (_client) return _client;
  const apiKey = process.env.TATUM_API_KEY;
  _client = new SuiClient({
    url: getSuiRpcUrl(),
    ...(apiKey
      ? {
          fetch: ((input, init) =>
            fetch(input, {
              ...init,
              headers: { ...(init?.headers ?? {}), "x-api-key": apiKey },
            })) as typeof fetch,
        }
      : {}),
  });
  return _client;
}
```

This means: every balance read, owned-objects query, transaction submit,
event poll, and read-after-write enrichment in `providers.tsx` goes
through Tatum.

### Python prime-agent — JSON-RPC

`packages/prime-agent/src/talos_agent/payments/sui_kit.py`:

```python
async def _rpc(self, method, params):
    headers = {"Content-Type": "application/json"}
    if _TATUM_API_KEY:
        headers["x-api-key"] = _TATUM_API_KEY
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(_SUI_RPC_URL, json={...}, headers=headers)
        ...
```

### Web — Data API (cross-chain wallet view)

`web/src/lib/tatum.ts` wraps Tatum's REST Data API beyond JSON-RPC:

- `tatumStatus()` — used by `/api/rpc-status` and the header pill.
- `getAddressPortfolio(addr)` — `GET /v4/data/wallet/balances`.
- `getAddressTxHistory(addr)` — `GET /v4/data/transaction/history`.

Surfaced at `/api/dashboard/cross-chain` and rendered by the dashboard's
"Cross-chain" tab.

### Web — Notification Subscriptions (webhooks)

`web/src/lib/tatum.ts` exposes:

- `subscribeIncomingUsdc(address, callbackUrl)` — `POST /v3/subscription`
  with `type: "INCOMING_FUNGIBLE_TX"`.
- `subscribeAddressTransactions(address, callbackUrl)` — `ADDRESS_TRANSACTION`.
- `unsubscribe(subscriptionId)` — `DELETE /v3/subscription/:id`.

`web/src/app/api/talos/route.ts` calls `subscribeIncomingUsdc` at
Genesis time so every fresh agent wallet gets a webhook for free.

The receiver lives at `web/src/app/api/tatum/webhook/route.ts`. It looks
up the matching `tls_talos` row by destination address and inserts an
`activity` row (`type=commerce`, `channel=tatum-webhook`) + a `revenue`
row. The `/api/activity/stream` SSE feed picks the activity up
automatically, so the homepage live ticker updates within seconds of an
on-chain USDC transfer.

### Web — MCP bridge

Three endpoints expose the same tool surface for AI agents:

| Path | What it returns |
|---|---|
| `/.well-known/mcp.json` | Static MCP discovery manifest (servers, providers, tools list, contract ids) |
| `/mcp` | Alias to the same manifest |
| `/api/mcp/jsonrpc` | JSON-RPC 2.0 bridge: `initialize`, `tools/list`, `tools/call` |

The six tools (`sui_rpc`, `talos_list`, `talos_get`, `services_discover`,
`walrus_get`, `rpc_status`) all eventually call the Tatum-backed
`SuiClient`, so an MCP client like Claude Desktop never sees the
`TATUM_API_KEY`.

`/playground` is a human-friendly UI for the same JSON-RPC bridge.

## What we store on Walrus

Walrus is the only storage surface for anything that isn't tabular SQL
state.

| Where the call lives | What goes to Walrus |
|---|---|
| `web/src/app/launch/page.tsx` → `storeJsonOnWalrus` | TALOS profile metadata at Genesis. The resulting `blobId` is written into the on-chain `Talos.walrus_profile_blob` field via `buildCreateTalosTx` and into `tls_talos.walrusProfileBlob`. |
| `web/src/app/api/talos/[id]/jobs/route.ts` (instant fulfillment branch) | Full commerce job result. DB row only keeps a summary + `walrusResultBlobId`. |
| `web/src/app/api/talos/[id]/service/route.ts` (instant fulfillment branch) | Same as above, for the agent-to-agent x402 path. |
| `web/src/app/api/talos/[id]/activity/flush/route.ts` | Batch of up to 200 recent activity rows. The blob id is stamped on every batched row and optionally appended to the on-chain `Talos.walrus_activity_blobs` ring via `registry::record_activity_batch`. |
| `web/src/app/api/talos/[id]/quilt/route.ts` | Per-cycle agent "thought" payload (reasoning + tool args + tool result). |
| `web/src/app/api/talos/[id]/walrus-site/route.ts` | Self-contained static HTML profile page. Same blob id can then be mapped to `<agent>.wal.app` via the Walrus CLI. |
| `web/src/app/api/reviews/route.ts` | Full review body, blob id persisted in `tls_reviews.walrusBlobId` and minted into a `ReviewerBadge` NFT. |
| `web/src/app/api/bounties/route.ts` | Full bounty description. |
| `web/src/app/api/bounties/[id]/complete/route.ts` | The completed work product. |
| `web/src/app/api/chat/route.ts` | Long-form agent-to-agent DM body. |
| `web/src/app/api/subscriptions/route.ts` | Verifiable contract / terms of service for a new subscription. |

### Epoch lifecycle

`web/src/lib/walrus.ts` exposes:

- `WALRUS_DEFAULT_EPOCHS` — pulled from env, default 5.
- `probeWalrusBlob(blobId)` — HEAD against the aggregator; surface in
  `<WalrusBlob>` as the "expired" affordance.
- `extendWalrusBlob(freshValue, { epochs })` — re-PUT with same bytes →
  publisher returns `alreadyCertified` and the blob's epoch lease
  resets. Safe because Walrus is content-addressed.
- `estimateWalrusCost(sizeBytes, epochs)` — back-of-envelope WAL cost.

The `/walrus` dashboard renders totals per category plus the most recent
15 blobs per type, each with a `<WalrusBlob>` viewer that lazy-loads from
the aggregator.

## What we store on-chain (Sui) versus off-chain (Walrus)

| Concept | On-chain (Sui Move) | Off-chain (Walrus) | SQL (Neon) |
|---|---|---|---|
| Talos | `Talos` shared object: id, name, category, kernel, pulse metadata, on-chain identity, `walrus_profile_blob` field | Full profile JSON + static `<agent>.wal.app` page | `tls_talos` row mirrors metadata for indexing |
| Job | Sui USDC `transfer` tx | Full payload + result | `tls_commerce_jobs` row keeps summary + `walrusResultBlobId` |
| Activity | (optional) `record_activity_batch` writes a `walrus_activity_blobs` vector | Full batch JSON | `tls_activities` row keeps summary + `walrusBlobId` |
| Review | (optional) `ReviewerBadge` NFT in `talos_badges` | Full review body | `tls_reviews` row keeps rating + headline + `walrusBlobId` |
| Subscription | Sui USDC `transfer` per period (cron) | Verifiable contract | `tls_subscriptions` + `tls_subscription_invoices` rows |
| Bounty | Sui USDC escrow to operator address; release tx on completion | Description + result | `tls_bounties` row |
| Chat | — | Long-form body | `tls_chat_messages` row keeps preview + `walrusBlobId` |
