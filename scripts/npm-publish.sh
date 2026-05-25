#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

tmp_npmrc=""
cleanup() {
  if [[ -n "$tmp_npmrc" ]]; then
    rm -f "$tmp_npmrc"
  fi
}
trap cleanup EXIT

if [[ -n "${NPM_TOKEN:-}" ]]; then
  tmp_npmrc="$(mktemp)"
  printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$tmp_npmrc"
  export NPM_CONFIG_USERCONFIG="$tmp_npmrc"
  npm publish --access public
elif [[ -n "${1:-}" ]]; then
  npm publish --access public --otp="$1"
else
  cat >&2 <<'EOF'
Publish failed: npm requires one of:

1. Granular access token with "Bypass 2FA" enabled:
   NPM_TOKEN='npm_...' bash scripts/npm-publish.sh

2. Account 2FA enabled, then publish with OTP:
   bash scripts/npm-publish.sh 123456

Create a bypass token at:
https://www.npmjs.com/settings/pzep1/tokens/granular
EOF
  exit 1
fi
