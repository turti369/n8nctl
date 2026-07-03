#!/usr/bin/env bash
#
# Minimal LIVE end-to-end smoke test against a real n8n instance.
#
# Why this exists: every other test is a mock. The `execution retry` bug (a
# fabricated Public-API endpoint that passed against a mock but 404s on a real
# instance) proves mocks alone can't guarantee the /rest layer. This script
# exercises the built CLI against a real n8n container — especially the /rest
# paths Phase 1 touches (session run, execution retry).
#
# It is fully self-contained and NON-MUTATING to your real n8nctl setup:
# auth is supplied via env (N8N_HOST/N8N_API_KEY for the Public API,
# N8N_EMAIL/N8N_PASSWORD for /rest session), and config is redirected to a
# throwaway dir via N8NCTL_CONFIG_DIR — nothing touches your keyring or config.
#
# Usage:
#   scripts/e2e/smoke.sh                 # spins up docker n8n, runs, tears down
#   N8N_IMAGE=n8nio/n8n:1.122.5 scripts/e2e/smoke.sh
#   KEEP_CONTAINER=1 scripts/e2e/smoke.sh   # leave n8n running for debugging
#
# Requires: docker, node (repo built: `npm run build`), curl, jq.
# Exit 0 = all steps passed; non-zero = a step failed (prints which).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="node ${REPO_ROOT}/packages/n8nctl/dist/index.js"

N8N_IMAGE="${N8N_IMAGE:-n8nio/n8n:1.122.5}"
N8N_PORT="${N8N_PORT:-5678}"
HOST="http://localhost:${N8N_PORT}"
CONTAINER="n8nctl-smoke-$$"
OWNER_EMAIL="smoke@n8nctl.test"
OWNER_PASS="Sm0ke-Test-Pw1"          # ephemeral throwaway container only
COOKIE_JAR="$(mktemp)"
WF_FILE="$(mktemp)"
CFG_DIR="$(mktemp -d)"

# Isolate: use a throwaway config dir so nothing touches the real n8nctl setup.
export N8NCTL_CONFIG_DIR="$CFG_DIR"

cleanup() {
  local code=$?
  if [ "${KEEP_CONTAINER:-0}" != "1" ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -f "$COOKIE_JAR" "$WF_FILE" || true
  rm -rf "$CFG_DIR" || true
  if [ "$code" -eq 0 ]; then echo; echo "SMOKE: PASS"; else echo; echo "SMOKE: FAIL (exit $code)"; fi
}
trap cleanup EXIT

step() { echo; echo "== $* =="; }

step "Start n8n ($N8N_IMAGE)"
docker run -d --name "$CONTAINER" \
  -p "${N8N_PORT}:5678" \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  -e N8N_USER_MANAGEMENT_DISABLED=false \
  -e N8N_PUBLIC_API_DISABLED=false \
  "$N8N_IMAGE" >/dev/null

step "Wait for n8n REST API to be fully ready"
# /healthz is a shallow check that flips green while the app still serves a
# "starting up" placeholder for real routes — poll /rest/settings until it
# returns actual JSON.
for i in $(seq 1 120); do
  BODY="$(curl -s "${HOST}/rest/settings" 2>/dev/null || true)"
  case "$BODY" in
    \{*) break;;
    *) if [ "$i" -eq 120 ]; then echo "n8n REST API did not become ready"; exit 1; fi; sleep 2;;
  esac
done

step "Bootstrap owner (POST /rest/owner/setup)"
# Fresh container: setup succeeds and sets the auth cookie. If the owner somehow
# already exists, fall back to login.
if ! curl -fsS -c "$COOKIE_JAR" -X POST "${HOST}/rest/owner/setup" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"${OWNER_EMAIL}\",\"firstName\":\"Smoke\",\"lastName\":\"Test\",\"password\":\"${OWNER_PASS}\"}" \
      >/dev/null 2>&1; then
  echo "owner/setup failed — trying login"
  curl -fsS -c "$COOKIE_JAR" -X POST "${HOST}/rest/login" \
    -H 'Content-Type: application/json' \
    -d "{\"emailOrLdapLoginId\":\"${OWNER_EMAIL}\",\"password\":\"${OWNER_PASS}\"}" >/dev/null
fi

step "Create a Public-API key (POST /rest/api-keys, all scopes, no expiry)"
# n8n >= 1.x requires an explicit `scopes` array AND an `expiresAt` field
# (null = never expires). `rawApiKey` is the full one-time token; `apiKey` is
# the masked display value.
SCOPES="$(curl -fsS -b "$COOKIE_JAR" "${HOST}/rest/api-keys/scopes" | jq -c '.data')"
API_BODY="$(jq -nc --argjson scopes "$SCOPES" '{label:"smoke",scopes:$scopes,expiresAt:null}')"
API_RESP="$(curl -fsS -b "$COOKIE_JAR" -X POST "${HOST}/rest/api-keys" \
  -H 'Content-Type: application/json' -d "$API_BODY")"
API_KEY="$(echo "$API_RESP" | jq -r '.data.rawApiKey // .data.apiKey // empty')"
if [ -z "$API_KEY" ]; then
  echo "Failed to mint API key. Response: $API_RESP"; exit 1
fi

# Env auth — Public API (key) + /rest session (email/password). No config/keyring writes.
export N8N_HOST="$HOST"
export N8N_API_KEY="$API_KEY"
export N8N_EMAIL="$OWNER_EMAIL"
export N8N_PASSWORD="$OWNER_PASS"

step "Create a deterministically-FAILING workflow (so retry is valid)"
cat > "$WF_FILE" <<'JSON'
{
  "name": "n8nctl-smoke-fail",
  "nodes": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Manual Trigger",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "Boom",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [260, 0],
      "parameters": { "jsCode": "throw new Error('intentional smoke failure');" }
    }
  ],
  "connections": {
    "Manual Trigger": { "main": [[{ "node": "Boom", "type": "main", "index": 0 }]] }
  },
  "settings": { "executionOrder": "v1", "saveManualExecutions": true }
}
JSON

WF_ID="$($CLI workflow create "$WF_FILE" --json | jq -r '.id')"
[ -n "$WF_ID" ] && [ "$WF_ID" != "null" ] || { echo "create failed"; exit 1; }
echo "workflow id: $WF_ID"

step "Run via /rest --wait (expected to FAIL — status=error)"
# run --wait exits 1 on non-success; that's expected here. Capture output anyway.
RUN_OUT="$($CLI workflow run "$WF_ID" --wait --json 2>/dev/null || true)"
EXEC_ID="$(echo "$RUN_OUT" | jq -r '.executionId // empty')"
RUN_STATUS="$(echo "$RUN_OUT" | jq -r '.status // empty')"
[ -n "$EXEC_ID" ] || { echo "run did not return an executionId. Output: $RUN_OUT"; exit 1; }
echo "execution id: $EXEC_ID (status: ${RUN_STATUS:-unknown})"
if [ "$RUN_STATUS" != "error" ]; then
  echo "WARN: expected status=error but got '$RUN_STATUS' — retry may be rejected"; fi

step "Retry the failed execution via /rest (THE bug#2 path — Public API has no such endpoint)"
RETRY_OUT="$($CLI execution retry "$EXEC_ID" --json)"
NEW_EXEC="$(echo "$RETRY_OUT" | jq -r '.newExecutionId // empty')"
[ -n "$NEW_EXEC" ] && [ "$NEW_EXEC" != "unknown" ] \
  || { echo "retry did not return a new execution id. Output: $RETRY_OUT"; exit 1; }
echo "retried → new execution id: $NEW_EXEC"

step "Fetch execution + cleanup"
$CLI execution get "$EXEC_ID" --json >/dev/null
$CLI workflow delete "$WF_ID" --yes >/dev/null
echo "deleted workflow $WF_ID"
