# Talos Protocol — Sui Move Packages

Sui Move packages for the Talos Protocol. Two on-chain modules manage
agent identity, governance metadata, and Walrus blob references.

## Packages

### 1. `talos_registry`

Module: `talos_registry::registry`

- Creates `Talos` shared objects with patron/kernel/mitos metadata
- Tracks a global `Registry` singleton (counter + `talos_id → ID` index)
- Stores Walrus blob ids for the long-form profile and a ring of recent
  activity-log batches (off-chain content lives on Walrus, only the blob
  id is on-chain)
- Events: `TalosCreated`, `PatronUpdated`, `ActivityBatchRecorded`,
  `ProfileUpdated`
- 3% protocol fee (configurable bps) for the launchpad

### 2. `talos_name_service`

Module: `talos_name_service::name_service`

- Forward + reverse map between names and `talos_id` (e.g. `nexus → 7`)
- On-chain length bounds (3..32 bytes); character validation is enforced
  off-chain by the Next.js layer
- Events: `NameRegistered`

## Prerequisites

```bash
# Install the Sui CLI (see https://docs.sui.io for OS-specific instructions)
brew install sui                    # macOS
# or: curl -fsSL https://sui-install.io | sh

# Configure a testnet env + key
sui client new-env --alias testnet --rpc https://sui-testnet.gateway.tatum.io
sui client switch --env testnet
sui client new-address ed25519
# Top up via faucet:
sui client faucet
```

## Build & Test

```bash
pnpm build       # compiles both packages
pnpm test        # runs all Move unit tests
```

Or per-package:

```bash
pnpm build:registry
pnpm test:registry
pnpm build:name-service
pnpm test:name-service
```

## Deploy

```bash
# Publish both packages and print env vars for the web app
./deploy.sh testnet
```

The script publishes each package, extracts the shared `Registry` and
`Directory` object ids, and prints the `NEXT_PUBLIC_*` env vars to paste
into `web/.env.local`.

## Manual invoke examples

```bash
# Create a Talos via PTB
sui client ptb \
  --move-call ${REG_PKG}::registry::create_talos \
    @${REG_OBJ} \
    "Nexus" \
    "Finance" \
    "AI payments agent" \
    6000 2500 1500 \
    @${INVESTOR_ADDR} @${TREASURY_ADDR} \
    10000000 200000000 100 \
    1000000 500000 "NEXUS" \
    "walrus_blob_id" \
    1700000000000

# Register a human-readable name
sui client ptb \
  --move-call ${NS_PKG}::name_service::register_name \
    @${NS_OBJ} 1 "nexus"
```

## Layout

```
contracts/
├── README.md
├── package.json
├── deploy.sh
├── talos_registry/
│   ├── Move.toml
│   ├── sources/registry.move
│   └── tests/registry_tests.move
└── talos_name_service/
    ├── Move.toml
    ├── sources/name_service.move
    └── tests/name_service_tests.move
```

## RPC

All published packages and views are accessed through Tatum's Sui RPC
gateways (set in `web/.env.local`):

| Network | URL |
|---|---|
| Mainnet | `https://sui-mainnet.gateway.tatum.io` |
| Testnet | `https://sui-testnet.gateway.tatum.io` |
| Devnet  | `https://sui-devnet.gateway.tatum.io` |

## License

MIT
