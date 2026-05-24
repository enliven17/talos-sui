# Talos × Sui × Walrus × Tatum — Reference Links

Curated resources for the **Tatum × Build on Sui with Walrus** hackathon.

## Sui

- Sui Docs: https://docs.sui.io — concepts, RPC, Move, dApp Kit
- Sui CLI install: https://docs.sui.io/guides/developer/getting-started/sui-install
- Move book: https://move-book.com — official Move language reference
- Sui Examples: https://github.com/MystenLabs/sui/tree/main/examples
- Sui TypeScript SDK: https://sdk.mystenlabs.com/typescript
- `@mysten/dapp-kit`: https://sdk.mystenlabs.com/dapp-kit — wallet + React hooks
- Programmable Transactions (PTB): https://docs.sui.io/concepts/transactions/prog-txn-blocks
- Sui Object Model: https://docs.sui.io/concepts/object-model
- Sui USDC (Circle CCTP): https://developers.circle.com/stablecoins/sui

## Walrus

- Walrus Docs: https://docs.walrus.site
- Walrus public testnet endpoints:
  - Publisher: https://publisher.walrus-testnet.walrus.space
  - Aggregator: https://aggregator.walrus-testnet.walrus.space
- `@mysten/walrus` TS SDK: https://sdk.mystenlabs.com/walrus
- Walrus REST API reference: https://docs.walrus.site/walrus-sites/restapi.html
- Walrus GitHub: https://github.com/MystenLabs/walrus
- Walrus Discord: https://discord.gg/walrusprotocol

## Tatum

- Tatum dashboard / API key: https://dashboard.tatum.io
- Sui RPC gateways:
  - Mainnet: https://sui-mainnet.gateway.tatum.io
  - Testnet: https://sui-testnet.gateway.tatum.io
  - Devnet:  https://sui-devnet.gateway.tatum.io
- Tatum Sui RPC docs: https://docs.tatum.io/reference/rpc-sui
- Tatum MCP server guide: https://docs.tatum.io/docs/mcp-server
- Tatum Discord: https://discord.gg/tatum

## Database

- Neon serverless Postgres: https://neon.tech
- Neon connection string format:
  `postgresql://USER:PASSWORD@ep-XXXX-pooler.REGION.neon.tech/DB?sslmode=require`
- `@neondatabase/serverless`: https://github.com/neondatabase/serverless

## Block explorers

- SuiVision: https://suivision.xyz
- SuiScan: https://suiscan.xyz

## Hackathon — Tatum × Build on Sui with Walrus

- Sponsor: Tatum + Walrus Foundation + Sui Network
- Dates: May 23 — June 6, 2026
- Submission deadline: June 6 · 17:00 UTC
- Prize pool: $2,000 USD (5 placements + 2 bonus categories: *Best Walrus
  Integration* and *Best Use of Tatum Tools*)
- Requirements
  - Use a Tatum API key + Tatum's Sui RPC gateway
  - Integrate Walrus storage meaningfully
  - Build on Sui Mainnet (preferred) or Testnet/Devnet
  - MCP optional but encouraged for AI features
  - Submit GitHub repo + 2-3 minute demo video

## x402-style payments on Sui

x402 has no canonical Sui facilitator yet — Talos implements a minimal
HTTP-402 pattern over Sui USDC PTB transfers:

1. Buyer hits the protected URL.
2. Server returns `402 Payment Required` with `{ payee, amount, coinType }`.
3. Buyer signs a Sui PTB transferring USDC to `payee`.
4. Buyer replays the request with header `X-Payment: sui-tx <digest>`.
5. Server reads the on-chain tx via Tatum-backed SuiClient, verifies the
   USDC balance change to `payee`, then fulfils + writes the result to
   Walrus.

The Talos implementation lives at:

- `web/src/lib/sui-x402.ts` — sign / verify / settle
- `web/src/app/api/talos/[id]/service/route.ts` — server-side facilitator
