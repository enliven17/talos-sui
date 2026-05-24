# Talos — Tatum × Build on Sui with Walrus

Single-page judge view. Everything below is verifiable on testnet.

---

## Submission checklist (per [tatum.io/tatum-x-walrus-hackathon](https://tatum.io/tatum-x-walrus-hackathon))

| Requirement | Status | Where |
|---|---|---|
| Use a Tatum API key | ✅ | `TATUM_API_KEY` is injected as `x-api-key` on every Sui RPC call in [`web/src/lib/sui.ts`](web/src/lib/sui.ts#L40-L61) and the Python agent ([`packages/prime-agent/.../sui_kit.py`](packages/prime-agent/src/talos_agent/payments/sui_kit.py)) |
| Use Tatum's Sui RPC | ✅ | Default URL = `https://sui-<network>.gateway.tatum.io`, surfaced in the header status pill + the `/playground` page + `/.well-known/mcp.json` manifest |
| Integrate Walrus meaningfully | ✅ | Profile metadata, agent activity batches, commerce job results, and unlocked playbook content are all stored on Walrus. The DB only persists `blobId` + a short preview. Dedicated [`/walrus`](web/src/app/walrus/page.tsx) dashboard breaks down storage usage per category. |
| Build on Sui Mainnet / Testnet / Devnet | ✅ Testnet | Live testnet deploy below |
| GitHub repo + demo video | ✅ repo · 🔲 video (recording) | Repo: https://github.com/enliven/taalos-sui |
| 1–3 team members | ✅ 1 | Solo build |
| MCP integration (optional bonus) | ✅ | Public MCP manifest at [`/.well-known/mcp.json`](web/src/app/.well-known/mcp.json/route.ts) + [`/mcp`](web/src/app/mcp/route.ts) — 6 tools (`sui_rpc`, `talos_list`, `talos_get`, `services_discover`, `walrus_get`, `rpc_status`). Human-driven playground at [`/playground`](web/src/app/playground/page.tsx). |
| Social tags `@Tatum_io` `@WalrusFoundation` `@SuiNetwork` | 🔲 (on submit day) | Draft post in [`docs/submission-tweet.md`](docs/submission-tweet.md) |

---

## Live testnet deployment (June 2026)

**Sui operator address:** `0xdeac1680f935c0d5265b4e0656a2436361d8adebee0adf3060ef6c06e95c89eb`

| Artifact | ID | Explorer |
|---|---|---|
| `talos_registry` package | `0x2340e56416db9d90ab604703f121842e7f6ad53dcfc151fec605cb7f41335eb0` | [SuiVision](https://suivision.xyz/package/0x2340e56416db9d90ab604703f121842e7f6ad53dcfc151fec605cb7f41335eb0?network=testnet) |
| `Registry` shared object | `0x6e1844c2f624cd4a831aaf98ceb8b25716af84c3a5ebafb184bfba49fb3e870c` | [SuiVision](https://suivision.xyz/object/0x6e1844c2f624cd4a831aaf98ceb8b25716af84c3a5ebafb184bfba49fb3e870c?network=testnet) |
| `talos_name_service` package | `0x4bef2d0f48d1d3fd010b42303c859f5c0b08f0d4b4e4b193a07eb09091369a1e` | [SuiVision](https://suivision.xyz/package/0x4bef2d0f48d1d3fd010b42303c859f5c0b08f0d4b4e4b193a07eb09091369a1e?network=testnet) |
| `Directory` shared object | `0xd19677f77805f7c4bb64da9dc3cb57b787f915ee40eac5ce6bfe7aef32b9886d` | [SuiVision](https://suivision.xyz/object/0xd19677f77805f7c4bb64da9dc3cb57b787f915ee40eac5ce6bfe7aef32b9886d?network=testnet) |
| `talos_badges` package | `0xe2b967d0475cddb5d2f9098eae15656451588bee1612068a716e20b2bd789f28` | [SuiVision](https://suivision.xyz/package/0xe2b967d0475cddb5d2f9098eae15656451588bee1612068a716e20b2bd789f28?network=testnet) |
| Badges `MinterCap` | `0xee9181b16a79c50774a7685b3a39629a042cc651908edd9d9ecf19aec62118ab` | [SuiVision](https://suivision.xyz/object/0xee9181b16a79c50774a7685b3a39629a042cc651908edd9d9ecf19aec62118ab?network=testnet) |
| Genesis publish tx | `HPyVuHDMVbmEYM9q6qauhYmUEJWxXbFYddgNmDgaM1hH` | [SuiVision](https://suivision.xyz/txblock/HPyVuHDMVbmEYM9q6qauhYmUEJWxXbFYddgNmDgaM1hH?network=testnet) |

---

## Walrus proof-of-storage

The first Walrus blob the project published (during the live integration smoke test):

| Field | Value |
|---|---|
| Blob ID | `zc8xToByNU5Bi039oCjOFzNMqy53536tWUJ6yhICfQ4` |
| Aggregator URL | https://aggregator.walrus-testnet.walrus.space/v1/blobs/zc8xToByNU5Bi039oCjOFzNMqy53536tWUJ6yhICfQ4 |
| Publisher | `https://publisher.walrus-testnet.walrus.space` |
| Epochs | 5 |
| Size | 66 bytes |
| Stored at | 2026-06-01 (registered epoch 415) |

Any human or agent can `curl` that aggregator URL and get back the exact bytes
the platform wrote, with no Talos involvement.

---

## Why Walrus is *core* (not an add-on)

Walrus is the only storage surface for everything that isn't tabular SQL state:

1. **Talos profile metadata** (genesis) — pushed at launch, blob id written into
   the on-chain `Talos` shared object's `walrus_profile_blob` field AND the
   Postgres row. SuiVision's `display::Display<Talos>` renders the profile
   image directly from the Walrus aggregator.
2. **Agent activity batches** — the `POST /api/talos/:id/activity/flush`
   endpoint batches up to 200 recent activities, pushes the bundle to Walrus,
   stamps the blob id on every row, then optionally calls
   `talos_registry::record_activity_batch` on-chain so the audit trail is
   tamper-evident.
3. **Commerce job results** (x402-on-Sui) — the full result of every paid
   service request is published to Walrus before the buyer gets their reply.
   The DB only stores `walrusResultBlobId` + a short summary; the buyer
   verifies fulfilment by fetching the blob from any aggregator.
4. **Playbook content unlock** — unlocked playbooks ship rich JSON/MD to
   Walrus so the marketplace itself doesn't gatekeep paid content.

A `/walrus` dashboard renders totals per category + the most recent 15 blobs
per type with a [`<WalrusBlob />`](web/src/components/walrus-blob.tsx) viewer
that lazy-fetches and pretty-prints the bytes.

---

## Why Tatum is *core* (not an add-on)

1. **Every Sui RPC call** the web app or Python agent makes goes through
   `https://sui-<network>.gateway.tatum.io` with `x-api-key: $TATUM_API_KEY`.
   That includes balance reads, object reads, signed transaction submission,
   event polling, the `signAndExecute` enrichment round-trip, the
   `/api/rpc-status` health probe, and the `/playground` MCP tool surface.
2. **The MCP manifest** advertises `provider.sui.gateway = "tatum"` so any
   downstream agent that picks it up knows where to route.
3. **`web/src/lib/tatum.ts`** wraps Tatum's REST Data API (`/v4/data/wallet`,
   `/v4/data/transaction/history`) so the dashboard can compose cross-chain
   account views without writing a custom indexer.
4. **Header status pill** ([`<RpcStatus />`](web/src/components/rpc-status.tsx))
   polls the live Tatum gateway every 60 s, surfacing provider, latency, and
   the latest finalised checkpoint to every visitor.

---

## Judging criteria — self-score

| Criterion | Weight | What we deliver |
|---|---|---|
| **Walrus + Tatum integration (30%)** | — | Walrus is the canonical storage layer for 4 distinct content types; Tatum is the canonical RPC + Data API surface. Both are referenced in the on-chain `Display<Talos>` standard, the MCP manifest, and the agent runtime. |
| **Technical quality (30%)** | — | Move 2024 packages (`registry` + `name_service`) with `display::Display`, shared objects, batched audit trail; Next.js 16 + TS strict + Drizzle on Neon; lazy Tatum-backed `SuiClient`; lazy Walrus blob viewer with graceful expired-blob UX; CI for web/contracts/python; tsc clean, build clean, 0 lint errors. |
| **Creativity (20%)** | — | A *self-policing marketplace* where agents pay each other in USDC on Sui, publish their work to Walrus, and the buyer cryptographically verifies the result — without ever trusting the seller's API. |
| **Presentation (20%)** | — | `/walrus` dashboard, `/jobs/[id]` 3-layer proof page (Sui tx · Walrus blob · DB row), `/playground` MCP demo, docs folder with architecture + deployment + API reference + Walrus/Tatum integration explainer. |

---

## Where to look

| What | Path |
|---|---|
| One-paragraph project pitch | [README.md](README.md) |
| Architecture diagram | [docs/architecture.md](docs/architecture.md) |
| Local dev | [docs/local-development.md](docs/local-development.md) |
| Deployment | [docs/deployment.md](docs/deployment.md) |
| API reference | [docs/api-reference.md](docs/api-reference.md) |
| Walrus + Tatum wiring (with file:line refs) | [docs/walrus-tatum-integration.md](docs/walrus-tatum-integration.md) |
| MCP manifest | [`/.well-known/mcp.json`](web/src/app/.well-known/mcp.json/route.ts) / [`/mcp`](web/src/app/mcp/route.ts) |
| Move sources | [`contracts/talos_registry/sources/registry.move`](contracts/talos_registry/sources/registry.move) · [`contracts/talos_name_service/sources/name_service.move`](contracts/talos_name_service/sources/name_service.move) |
| Mitos Coin<T> template + publish script | [`contracts/mitos_template/`](contracts/mitos_template/) · [`contracts/publish-mitos.sh`](contracts/publish-mitos.sh) |
