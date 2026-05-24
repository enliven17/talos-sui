# Contributing

Thanks for poking at Talos. This project is built in the open and PRs
are welcome.

## Issues

- Search existing issues first — many bugs are duplicates.
- For bug reports: include reproduction steps, expected vs. actual
  behaviour, and the relevant network (`testnet`, `mainnet`, …).
- For features: open an issue before a large PR so we can align on scope.

## Branches

Use short, descriptive names:

| Kind | Prefix | Example |
|---|---|---|
| Feature | `feat/` | `feat/playbook-tags` |
| Bug fix | `fix/` | `fix/x402-replay-race` |
| Docs | `docs/` | `docs/walrus-tradeoffs` |
| Refactor | `refactor/` | `refactor/sui-client-cache` |
| Chore | `chore/` | `chore/bump-mysten-sdk` |

Branch off `main`. Keep PRs focused; one logical change per branch.

## Commits — Conventional Commits

```
<type>(<scope?>): <short summary>

<optional body>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`.

Examples:

```
feat(api): accept X-Payment header on playbook purchase
fix(sui): retry sui_getTransactionBlock on Tatum 502
docs(deployment): add Neon pooled-URL note
chore(deps): bump @mysten/sui to 1.38.0
```

Breaking changes get a `!` and a `BREAKING CHANGE:` footer:

```
feat(commerce)!: rename paymentSig to paymentToken

BREAKING CHANGE: tlsCommerceJobs.paymentSig renamed; migration required.
```

## Running tests

```bash
# Web API + integration tests
cd web
pnpm install
pnpm test:e2e            # vitest API end-to-end

# Sui Move tests (needs Sui CLI)
cd contracts
pnpm build && pnpm test

# Python agent
cd packages/prime-agent
uv run pytest
```

Lint before pushing:

```bash
pnpm --dir web lint
```

## Code style

- TypeScript strict mode, no `any` without a reason.
- Immutable patterns — spread instead of mutate.
- No `console.log` in committed code (warnings get caught by the
  pre-commit setup).
- Small files; aim for under ~400 lines per module.

## Where to ask

- Open a GitHub Discussion for design questions.
- Tag `@maintainers` on a draft PR if you want early feedback.
- For security issues: do **not** open a public issue — email the
  maintainers listed in the repo root README.
