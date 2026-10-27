#!/usr/bin/env bash
# End-to-end test against a real n8n started inside the CI runner.
# Installs n8n-sync the way users do (npx github:<repo>#<commit>) and runs the
# same commands as the project template's GitHub Action, plus the rest of the
# feature set. Needs: N8N_VERSION, TOOL_SPEC (e.g. github:owner/repo#sha), jq.
set -euo pipefail

PORT=5678
BASE="http://localhost:$PORT"
export N8N_API_URL="$BASE/api/v1"
WORK="$(mktemp -d)"
# TOOL_CMD (e.g. "node /path/src/cli.js") only for fast local runs; CI uses the npx install
S() { if [ -n "${TOOL_CMD:-}" ]; then $TOOL_CMD "$@"; else npx -y "$TOOL_SPEC" "$@"; fi; }
ok() { echo "✓ $*"; }
fail() { echo "✗ $*"; exit 1; }

echo "::group::start n8n@$N8N_VERSION"
N8N_USER_FOLDER="$WORK/n8n" N8N_PORT=$PORT N8N_DIAGNOSTICS_ENABLED=false N8N_SECURE_COOKIE=false \
  npx -y "n8n@$N8N_VERSION" start > "$WORK/n8n.log" 2>&1 &
echo "::endgroup::"

# Owner + API key through n8n's internal REST API (what the UI does).
# n8n answers 200 "starting up" on every route while booting, so retry until real JSON.
J="$WORK/cookies"
for _ in $(seq 1 300); do
  # (not `curl | grep -q`: with pipefail that fails on SIGPIPE even when it matches)
  out=$(curl -s -c "$J.try" -X POST "$BASE/rest/owner/setup" -H 'Content-Type: application/json' \
    -d '{"email":"ci@example.com","firstName":"C","lastName":"I","password":"Ci-password-12345"}' 2>/dev/null || true)
  if [[ $out == *'"data"'* ]]; then mv "$J.try" "$J"; break; fi
  sleep 1
done
grep -q n8n-auth "$J" || { tail -50 "$WORK/n8n.log"; fail "n8n did not start / owner setup failed"; }
SCOPES=$(curl -s -b "$J" "$BASE/rest/api-keys/scopes" | jq -c '.data // empty' || true)
BODY=$(jq -nc --argjson s "${SCOPES:-null}" '{label:"ci", expiresAt:null} + (if $s then {scopes:$s} else {} end)')
export N8N_API_KEY=$(curl -sf -b "$J" -X POST "$BASE/rest/api-keys" -H 'Content-Type: application/json' -d "$BODY" | jq -r '.data.rawApiKey // .data.apiKey')
[ -n "$N8N_API_KEY" ] && [ "$N8N_API_KEY" != null ] || fail "could not create API key"
VERSION=$(grep -m1 -oE 'Version: [0-9.]+' "$WORK/n8n.log" || true)
ok "n8n up ($VERSION), API key created"

api() { curl -sf -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'Content-Type: application/json' "$@"; }

mkdir -p "$WORK/proj" && cd "$WORK/proj"
S init > /dev/null
[ -f .gitignore ] && [ -f .claude/settings.json ] && [ -f .github/workflows/n8n.yml ] && [ -f flows/hello-webhook.json ] || fail "init files"
echo 'WORKFLOWS_DIR=./flows' > .env
ok "init (via ${TOOL_SPEC:-$TOOL_CMD})"

# --- the template Action's PR step
S validate -d flows --strict > /dev/null && ok "template action: validate"

# --- push + activate + run
R=$(S push --activate --json)
[ "$(jq '.pushed' <<<"$R")" = 1 ] && [ "$(jq '.activated' <<<"$R")" = 1 ] || { echo "$R"; fail "push --activate"; }
ok "push --activate"
R=$(S run "Hello Webhook" --data '{"name":"ci"}' --json)
[ "$(jq -r '.response.body.greeting' <<<"$R")" = "Hello, ci!" ] && [ "$(jq -r '.execution.status' <<<"$R")" = success ] || { echo "$R"; fail "run"; }
ok "run → HTTP 200 + execution success"
[ "$(S push --json | jq '.unchanged')" = 1 ] && ok "re-push is a no-op"

# --- conflict guard: edit "in the UI", then push
ID=$(jq -r .id flows/hello-webhook.json)
api "$N8N_API_URL/workflows/$ID" | jq '{name, nodes: (.nodes | map(if .name=="Respond" then .position=[999,0] else . end)), connections, settings}' > "$WORK/ui.json"
api -X PUT "$N8N_API_URL/workflows/$ID" -d @"$WORK/ui.json" > /dev/null
echo '// local edit' >> flows/hello-webhook.build_reply.js
[ "$(S push --json | jq '.conflicts')" = 1 ] || fail "push conflict guard"
[ "$(S pull --json | jq '.conflicts')" = 1 ] || fail "pull conflict guard"
S pull --force --json > /dev/null && ok "conflict guards (push + pull) + pull --force"

# --- credentials from env vars (API key type + OAuth type)
if [[ $N8N_VERSION == 1.* ]]; then
  # n8n 1.x can't list credentials via the API: expect a clear message, not a crash
  echo '[{"name":"X","type":"httpHeaderAuth","data":{"name":"X","value":"{{env.X}}"}}]' > flows/credentials.n8n.json
  out=$(X=1 S credentials push 2>&1 || true)
  [[ $out == *"needs n8n 2.x"* ]] || { echo "$out"; fail "n8n 1.x: credentials push should explain it's unsupported"; }
  rm flows/credentials.n8n.json
  ok "n8n 1.x: credentials push explains it needs n8n 2.x"
else
cat > flows/credentials.n8n.json <<'EOF'
[
  { "name": "CI Header", "type": "httpHeaderAuth", "data": { "name": "X-Key", "value": "{{env.CI_HEADER_SECRET}}" } },
  { "name": "CI Google Sheets", "type": "googleSheetsOAuth2Api", "data": { "clientId": "{{env.CI_OAUTH_ID}}", "clientSecret": "{{env.CI_OAUTH_SECRET}}" } }
]
EOF
R=$(S credentials push --json 2>"$WORK/err.log" || true)
[ "$(jq '.errors' <<<"$R")" = 2 ] || { echo "$R"; cat "$WORK/err.log"; fail "missing env vars should be reported"; }
SECRET="ci-secret-$RANDOM$RANDOM"
OUT=$(CI_HEADER_SECRET="$SECRET" CI_OAUTH_ID="oauth-id-$RANDOM" CI_OAUTH_SECRET="oauth-sec-$RANDOM$RANDOM" S credentials push --json 2>/dev/null) || { echo "$OUT"; fail "credentials push"; }
[ "$(jq '.created' <<<"$OUT")" = 2 ] || { echo "$OUT"; fail "credentials created"; }
grep -q "$SECRET" <<<"$OUT" && fail "secret leaked into output"
grep -rq "$SECRET" . && fail "secret leaked into a file"
ok "credentials push (header + OAuth), no secret in output/files"
S credentials test --json > "$WORK/ct.json" || true
jq -e '.results | length == 2' "$WORK/ct.json" > /dev/null && ok "credentials test: $(jq -c '[.results[] | {name, status}]' "$WORK/ct.json")"
fi

# --- pagination: 300 extra workflows
# (xargs, not `&` + `wait`: a bare wait would also wait for n8n itself)
BULK='{"name":"bulk @N","nodes":[{"id":"t","name":"Start","type":"n8n-nodes-base.manualTrigger","typeVersion":1,"position":[0,0],"parameters":{}}],"connections":{},"settings":{}}'
codes=$(seq 1 300 | xargs -P 20 -I@N curl -s -o /dev/null -w '%{http_code}\n' -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H 'Content-Type: application/json' -X POST "$N8N_API_URL/workflows" -d "$BULK" | sort | uniq -c)
[[ $(grep -c . <<<"$codes") == 1 && $codes == *" 200" ]] || {
  echo "bulk create status codes: $codes"
  api -X POST "$N8N_API_URL/workflows" -d "${BULK//@N/probe}" || curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'Content-Type: application/json' -X POST "$N8N_API_URL/workflows" -d "${BULK//@N/probe}"
  fail "bulk create"
}
COUNT=$(S list -o json | jq length)
[ "$COUNT" -ge 301 ] || fail "list paginated: got $COUNT"
R=$(S pull --all -d "$WORK/all" --json)
[ "$(jq '.total' <<<"$R")" -ge 301 ] || fail "pull --all paginated"
[ "$(S pull --json | jq '.ignored')" -ge 300 ] || fail "tracked-only pull"
ok "pagination: list + pull --all see $COUNT workflows; plain pull ignores the 300 untracked"

# --- the template Action's deploy step (fresh checkout = no sync state)
rm -rf flows/.n8n-sync
R=$(S push -d flows --force --json)
[ "$(jq '.errors + .invalid' <<<"$R")" = 0 ] && [ "$(jq '.pushed' <<<"$R")" = 0 ] || { echo "$R"; fail "template action: deploy"; }
ok "template action: deploy (push --force, no state, no duplicates)"

# --- diff + delete
S diff > /dev/null && ok "diff clean"
R=$(S delete "Hello Webhook" --yes --json)
[ "$(jq '.deleted' <<<"$R")" = 1 ] && [ ! -f flows/hello-webhook.json ] && [ ! -f flows/hello-webhook.build_reply.js ] || { echo "$R"; fail "delete"; }
ok "delete (active workflow, files + code file removed)"

echo "All e2e checks passed on n8n $VERSION"
