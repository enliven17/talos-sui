// ─────────────────────────────────────────────────────────────────────
// REMINDER:
//
// After the Bounty Board schema (`schema-bounties.ts`) is wired into the
// app, run Drizzle's push command from the `web/` package to create the
// `tls_bounties` table (and its indexes) in Neon:
//
//   pnpm --filter web exec drizzle-kit push
//
// This file intentionally contains NO code — Drizzle's config already
// picks up `schema.ts` (which re-exports `tlsBounties` from
// `schema-bounties.ts`), so there's nothing to register here. The file
// exists only so this reminder lives next to the schema and is impossible
// to miss when grepping the `db/` directory.
// ─────────────────────────────────────────────────────────────────────
export {};
