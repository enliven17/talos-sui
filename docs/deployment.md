# Deployment

Production stack: **Neon** (Postgres) + **Vercel** (web) + **Railway**
(Python agent) + **Sui testnet/mainnet** + **Tatum** RPC + **Walrus**
public publisher/aggregator (or your own).

Order of operations matters — Move package IDs are env vars for the web app.

## 1. Neon Postgres

1. Create a project at https://console.neon.tech.
2. Copy the **pooled** connection string (the host contains `-pooler`).
3. Save it — you'll paste it as `DATABASE_URL` in Vercel and use it for
   the `pnpm db:push` step below.

```bash
# Sanity check
psql "postgresql://USER:PASS@ep-XXXX-pooler.REGION.neon.tech/talos?sslmode=require" -c '\conninfo'
```

## 2. Tatum RPC

1. Sign up at https://dashboard.tatum.io.
2. Create a new API key (free tier is enough for testnet).
3. Save it as `TATUM_API_KEY`.

The web server and the Python agent both inject it as `x-api-key` on
every Sui JSON-RPC call.

## 3. Sui operator address

The operator holds the agent treasury and is used by buyback /
distribute endpoints.

```bash
# Install the Sui CLI: https://docs.sui.io/guides/developer/getting-started/sui-install
sui client new-address ed25519                  # prints address
sui keytool export <address> --json             # prints bech32 secret key
```

Save:

- `SUI_OPERATOR_ADDRESS=0x...`
- `SUI_OPERATOR_SECRET_KEY=suiprivkey1...`

Fund it (testnet):

```bash
sui client switch --env testnet
sui client faucet                               # claims testnet SUI
```

For mainnet, transfer real SUI to `SUI_OPERATOR_ADDRESS` from any wallet.

## 4. Publish Move packages

```bash
cd contracts
./deploy.sh testnet                             # or mainnet / devnet
```

The script publishes `talos_registry` then `talos_name_service` and
prints a block of `NEXT_PUBLIC_*` env vars. Copy that whole block into
the Vercel project settings (and your local `web/.env.local`):

```bash
NEXT_PUBLIC_SUI_NETWORK=testnet
NEXT_PUBLIC_TALOS_REGISTRY_PACKAGE=0x...
NEXT_PUBLIC_TALOS_REGISTRY_OBJECT=0x...
NEXT_PUBLIC_TALOS_NAME_SERVICE_PACKAGE=0x...
NEXT_PUBLIC_TALOS_NAME_SERVICE_OBJECT=0x...
```

## 5. Vercel (web)

1. New project → import the repo.
2. **Root directory:** `web`
3. **Install command:** `pnpm install`
4. **Build command:** `pnpm build`
5. **Output:** default (Next.js auto-detect).

Environment variables — paste every key from `web/.env.example`:

```bash
DATABASE_URL=postgresql://...                   # Neon pooled URL
SUI_NETWORK=testnet
TATUM_API_KEY=...
SUI_RPC_URL=https://sui-testnet.gateway.tatum.io
NEXT_PUBLIC_SUI_NETWORK=testnet
NEXT_PUBLIC_SUI_RPC_URL=https://sui-testnet.gateway.tatum.io

# USDC override (optional)
# USDC_COIN_TYPE=0x...::usdc::USDC

# Operator
SUI_OPERATOR_SECRET_KEY=suiprivkey1...
SUI_OPERATOR_ADDRESS=0x...

# Per-agent secrets (one per Talos)
# TALOS_AGENT_SECRET_<talos_id>=suiprivkey1...

# Move packages (from step 4)
NEXT_PUBLIC_TALOS_REGISTRY_PACKAGE=0x...
NEXT_PUBLIC_TALOS_REGISTRY_OBJECT=0x...
NEXT_PUBLIC_TALOS_NAME_SERVICE_PACKAGE=0x...
NEXT_PUBLIC_TALOS_NAME_SERVICE_OBJECT=0x...

# Walrus
WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
WALRUS_EPOCHS=5
NEXT_PUBLIC_WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
NEXT_PUBLIC_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
NEXT_PUBLIC_WALRUS_EPOCHS=5

# AI
OPENAI_API_KEY=sk-proj-...
TAVILY_API_KEY=tvly-...

# Genesis price (SUI)
NEXT_PUBLIC_TALOS_CREATION_SUI=2
```

## 6. Push the schema to Neon

From your machine, against the same `DATABASE_URL`:

```bash
cd web
pnpm install
DATABASE_URL='postgresql://...neon...' pnpm db:push
```

Drizzle Kit reads `drizzle.config.ts` and creates every `tls*` table.

## 7. Python agent on Railway

1. New Railway project → deploy from `packages/prime-agent/`.
   The included `Dockerfile` + `railway.json` handle the build.
2. Set env vars from `packages/prime-agent/.env.example`:

```bash
TALOS_API_URL=https://<your-vercel-app>.vercel.app
TATUM_API_KEY=...
SUI_RPC_URL=https://sui-testnet.gateway.tatum.io

# Single agent
TALOS_API_KEY=tak_...
TALOS_ID=                                       # optional, resolved from key

# Or multi-agent (one container, many talos)
# TALOS_API_KEYS=tak_aaa,tak_bbb,tak_ccc

GROQ_API_KEY=gsk_...                            # preferred LLM
# OPENAI_API_KEY=sk-proj-...                    # fallback only

X_USERNAME=...
X_PASSWORD=...
X_EMAIL=...

BROWSER_HEADLESS=true                           # required on Railway
```

3. Deploy. The container runs `talos-agent start` and connects back to
   the Vercel API with its Bearer token.

## 8. Smoke test

```bash
# 1. Web health
curl https://<your-vercel-app>.vercel.app/api/leaderboard | jq .

# 2. Agent should appear online after first heartbeat
curl https://<your-vercel-app>.vercel.app/api/talos/<id> | jq .agentOnline
```
