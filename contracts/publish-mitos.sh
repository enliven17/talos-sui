#!/usr/bin/env bash
# Publish a per-Talos Mitos Coin<T> package.
#
# Usage:
#   ./publish-mitos.sh NEXUS "Nexus Mitos" 1000000
#
#   $1 = symbol (uppercased, used as the struct name TICKER → e.g. NEXUS)
#   $2 = display name shown in wallets (e.g. "Nexus Mitos")
#   $3 = initial supply (whole tokens, before the 6-decimal scaling)
#
# Reads contracts/mitos_template/ from disk, substitutes the placeholders,
# writes the patched package to a temp dir, runs `sui client publish`, and
# prints the resulting package id + Coin type tag for the web app to
# persist into `tls_talos.mitosCoinType`.
set -euo pipefail

SYMBOL="${1:-}"
NAME="${2:-}"
SUPPLY="${3:-1000000}"
NETWORK="${NETWORK:-testnet}"
GAS_BUDGET="${GAS_BUDGET:-200000000}"

if [[ -z "${SYMBOL}" || -z "${NAME}" ]]; then
  echo "Usage: $0 <SYMBOL> \"<Display Name>\" [supply]" >&2
  exit 1
fi

# Validate symbol — Move struct identifier rules
if ! [[ "${SYMBOL}" =~ ^[A-Z][A-Z0-9_]{1,15}$ ]]; then
  echo "Error: SYMBOL must be uppercase alphanumeric (1–16 chars), starting with a letter." >&2
  exit 1
fi

TEMPLATE_DIR="$(cd "$(dirname "$0")"/mitos_template && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

# Copy template files into the work dir, then substitute placeholders
cp -r "${TEMPLATE_DIR}/." "${WORK_DIR}/"

# Cross-platform sed -i (BSD sed needs `-i ''`)
SED_INPLACE=(-i)
if [[ "$OSTYPE" == "darwin"* ]]; then
  SED_INPLACE=(-i '')
fi

# Replace TICKER (struct + addresses + module path) and the display name
find "${WORK_DIR}" -type f \( -name "*.move" -o -name "*.toml" \) -exec sed "${SED_INPLACE[@]}" \
  -e "s/TICKER/${SYMBOL}/g" \
  -e "s/Ticker Mitos/${NAME//\//\\/}/g" \
  -e "s/INITIAL_SUPPLY: u64 = 1_000_000/INITIAL_SUPPLY: u64 = ${SUPPLY}/g" \
  {} +

# Switch sui client env if requested
sui client switch --env "${NETWORK}" >/dev/null

OUT="$(sui client publish --gas-budget "${GAS_BUDGET}" --json "${WORK_DIR}")"
PKG="$(echo "${OUT}" | jq -r '.objectChanges[] | select(.type=="published") | .packageId')"
CAP="$(echo "${OUT}" | jq -r --arg sym "${SYMBOL}" '.objectChanges[] | select(.type=="created" and (.objectType | endswith("::coin::TreasuryCap<" + . + "::mitos::" + $sym + ">"))) | .objectId' | head -n1)"

cat <<EOF

# ── Mitos Coin<${SYMBOL}> published ────────────────────────────
package:        ${PKG}
treasuryCap:    ${CAP}
coinType:       ${PKG}::mitos::${SYMBOL}

# Persist on the Talos:
UPDATE tls_talos SET "mitosCoinType" = '${PKG}::mitos::${SYMBOL}' WHERE "tokenSymbol" = '${SYMBOL}';
EOF
