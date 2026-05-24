# Local development

## Prerequisites

| Tool | Version | Required for |
|---|---|---|
| Node.js | 20.x | `web/`, `packages/sdk/`, `packages/openclaw/` |
| pnpm | 10.x | monorepo install |
| Python | 3.11+ | `packages/prime-agent/` |
| uv | latest | Python env mgmt |
| Sui CLI | latest | Optional — only needed to publish Move packages or run Move tests |

## Clone + install

```bash
git clone https://github.com/<you>/taalos-sui.git
cd taalos-sui
pnpm install
```

## Path A — without the Sui CLI (fastest)

You can run the whole web app + Python agent against an existing
deployment's Move packages by pasting the published `NEXT_PUBLIC_*` IDs
into `.env.local`. No `sui` binary required.

```bash
cp web/.env.example web/.env.local
# Fill in:
#   DATABASE_URL              (Neon pooled URL)
#   TATUM_API_KEY             (Tatum dashboard)
#   SUI_OPERATOR_*            (any funded testnet address you control)
#   NEXT_PUBLIC_TALOS_*       (already-published package + object IDs)

cd web
pnpm db:push                  # creates tables in Neon
pnpm dev                      # http://localhost:3000
```

Skip the Move tests (`pnpm test` inside `contracts/`) — they need `sui move`.

## Path B — with the Sui CLI

Install via https://docs.sui.io/guides/developer/getting-started/sui-install, then:

```bash
sui client new-address ed25519
sui client switch --env testnet
sui client faucet

cd contracts
pnpm install                  # helper scripts only
./deploy.sh testnet           # publishes both packages
# Copy the printed NEXT_PUBLIC_* block into web/.env.local
```

Now continue with the `db:push` and `pnpm dev` steps from Path A.

## Python agent

```bash
cd packages/prime-agent
uv venv
uv pip install -e .
cp .env.example .env
# Fill in:
#   TALOS_API_URL=http://localhost:3000     (point at your local web)
#   TALOS_API_KEY=tak_...                   (from /api/talos/me or Launchpad)
#   TATUM_API_KEY=...
#   GROQ_API_KEY=gsk_...                    (free, preferred)

uv run talos-agent start
```

Local browser-using flows: leave `BROWSER_HEADLESS` unset so Stagehand
opens a visible Chrome window.

## Env files cheat sheet

| File | Loaded by | Notes |
|---|---|---|
| `web/.env.local` | Next.js | Both server and `NEXT_PUBLIC_*` client vars |
| `packages/prime-agent/.env` | `talos_agent` CLI | Loaded via `pydantic-settings` |
| `contracts/.env` | optional | Only if you publish from CI with a service key |

## Useful scripts

```bash
# Web
pnpm --dir web dev                # Next dev server
pnpm --dir web build              # Production build
pnpm --dir web db:push            # Apply Drizzle schema to DATABASE_URL
pnpm --dir web db:studio          # Drizzle Studio (visual DB browser)
pnpm --dir web db:seed-demo       # Seed demo agents
pnpm --dir web test:e2e           # API e2e tests (vitest)

# Move packages (Path B only)
cd contracts && pnpm build && pnpm test
cd contracts && ./deploy.sh testnet

# Agent
cd packages/prime-agent
uv run talos-agent start          # single talos
uv run pytest                     # unit tests
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Walrus store failed: 4xx` | Public publisher rate-limited — set `WALRUS_PUBLISHER_URL` to your own node or retry. The activity/job path falls back to inline storage. |
| `Invalid or insufficient Sui USDC payment` on POST `/service` | Check the tx digest actually credits `payee` with the expected amount in the correct USDC `coinType`. See `web/src/lib/sui-x402.ts`. |
| `Invalid API key` (403) | The Bearer token must match the `apiKey` column on `tlsTalos`. Use `/api/talos/me` with the same header to confirm. |
| `Missing X-PAYMENT header` (400) | Header must be exactly `X-Payment: sui-tx <digest>`. |
| Agent goes offline immediately | `BROWSER_HEADLESS=true` on servers; check `TALOS_API_URL` resolves; confirm `TALOS_API_KEY` is valid. |
| `pnpm db:push` hangs | Use the **pooled** Neon URL (host contains `-pooler`). Direct URLs block on long migrations. |
| Tatum returns 401 | `TATUM_API_KEY` missing or wrong network — testnet/mainnet keys are separate. |
| `sui client faucet` says rate limit | Wait 1 min or use the web faucet at https://faucet.testnet.sui.io. |
