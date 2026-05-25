#!/usr/bin/env bash
# Deploy Talos Move packages to a Sui network (testnet|mainnet|devnet).
# Usage: ./deploy.sh testnet
#
# Uses `node` (always present alongside the web app) instead of `jq`
# so the script runs on Windows / Git Bash without extra setup.
set -euo pipefail

NETWORK="${1:-testnet}"
GAS_BUDGET="${GAS_BUDGET:-200000000}"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required to parse the publish JSON output. Install Node 20+ first." >&2
  exit 1
fi

# Run a Node one-liner that reads JSON from stdin and prints either the
# new package id or the created shared object whose type ends in
# `::<module>::<struct>`.
extract_pkg() {
  node -e '
    let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{
      const j=JSON.parse(s);
      const v=(j.objectChanges||[]).find(c=>c.type==="published");
      if(!v) process.exit(1);
      process.stdout.write(v.packageId);
    });'
}
extract_shared() {
  local suffix="$1"
  node -e '
    let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{
      const j=JSON.parse(s);
      const v=(j.objectChanges||[]).find(c=>
        c.type==="created" &&
        c.owner && c.owner.Shared !== undefined &&
        (c.objectType||"").endsWith(process.argv[1])
      );
      if(!v) process.exit(1);
      process.stdout.write(v.objectId);
    });' -- "${suffix}"
}

echo "→ Switching active env to ${NETWORK}"
sui client switch --env "${NETWORK}" >/dev/null

echo "→ Publishing talos_registry"
REG_OUT=$(sui client publish --gas-budget "${GAS_BUDGET}" --json talos_registry)
REG_PKG=$(echo "${REG_OUT}" | extract_pkg)
REG_OBJ=$(echo "${REG_OUT}" | extract_shared "::registry::Registry")

echo "  package:  ${REG_PKG}"
echo "  Registry: ${REG_OBJ}"

echo "→ Publishing talos_name_service"
NS_OUT=$(sui client publish --gas-budget "${GAS_BUDGET}" --json talos_name_service)
NS_PKG=$(echo "${NS_OUT}" | extract_pkg)
NS_OBJ=$(echo "${NS_OUT}" | extract_shared "::name_service::Directory")

echo "  package:  ${NS_PKG}"
echo "  Directory: ${NS_OBJ}"

cat <<EOF

# ── Add to web/.env.local ────────────────────────────────────────
NEXT_PUBLIC_SUI_NETWORK=${NETWORK}
NEXT_PUBLIC_TALOS_REGISTRY_PACKAGE=${REG_PKG}
NEXT_PUBLIC_TALOS_REGISTRY_OBJECT=${REG_OBJ}
NEXT_PUBLIC_TALOS_NAME_SERVICE_PACKAGE=${NS_PKG}
NEXT_PUBLIC_TALOS_NAME_SERVICE_OBJECT=${NS_OBJ}
EOF
