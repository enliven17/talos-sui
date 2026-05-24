# Summary

<!-- One or two sentences describing what this PR does and why. -->

## Type

<!-- Check one. -->

- [ ] feat: new user-facing capability
- [ ] fix: bug fix
- [ ] refactor: internal change with no behavior difference
- [ ] docs: documentation only

## Walrus / Tatum / Sui touchpoints

<!-- Skip with "None" if this PR does not touch any of these. Otherwise list:
     - Sui Move modules / package IDs affected
     - Walrus blobs read/written, expected epoch lifetime
     - Tatum endpoints / API keys used
     - Network: devnet / testnet / mainnet
-->

None

## Testing checklist

- [ ] `pnpm exec tsc --noEmit` passes (if `web/` changed)
- [ ] `pnpm lint` passes (if `web/` changed)
- [ ] `pnpm build` succeeds (if `web/` changed)
- [ ] `sui move test` passes for affected packages (if `contracts/` changed)
- [ ] `pytest` passes for `packages/prime-agent` (if Python changed)
- [ ] Manually verified the change against the running app where applicable
- [ ] No secrets, private keys, or `.env` values committed
