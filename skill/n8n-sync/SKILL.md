---
name: n8n-sync
description: Build n8n workflows as files and deploy them - push to n8n, activate, run/test webhook flows and read execution errors, pull changes made in the n8n UI, diff, delete, and promote dev → prod. Use when the user wants to create, deploy, push, sync, activate/deactivate, test, debug, delete or version-control n8n workflows/flows, or set up an n8n flows project.
---

# n8n-sync

## Run it

```bash
N8N="$(cd "$(dirname "$(realpath ~/.claude/skills/n8n-sync/SKILL.md)")/../.." && pwd)/src/cli.js"
node "$N8N" <command> ...
```

(Without a local clone: `npx -y github:Himanshu8881212/n8n-workflow-sync <command>` on Node 24, or `npm install -g github:Himanshu8881212/n8n-workflow-sync` on Node 20/22, then `n8n-sync <command>`.)

Run commands **from the project folder**. Config comes from `./.env` there (`N8N_API_URL`, `N8N_API_KEY`, `WORKFLOWS_DIR`, usually `./flows`); `--env prod` reads `./.env.prod` instead (`node "$N8N" --env prod push`). If no `.env` exists, ask for the API URL (e.g. `http://localhost:5678/api/v1`) and an API key (n8n → Settings → n8n API). Never print the key. New project: `node "$N8N" init` (example flow, CLAUDE.md, .gitignore, GitHub Action).

Add `--json` to any command for machine-readable output (logs go to stderr).

## The build loop

1. Write/edit `flows/<name>.json`. Put Code node code in its own file: `"jsCode": "@file:./<name>.<node>.js"` and edit the `.js`.
2. `validate` — fix every error (broken connections, duplicate node names, missing fields).
3. `push <file> --activate` — creates/updates; new files get their `id` written in (tell the user the file changed). Activating also publishes any sub-workflows it calls.
4. Webhook flows: `run "<name>" --data '{"k":"v"}'` → HTTP response + execution status + per-node errors. Other triggers: `executions "<name>"` after it ran (`--failed` for errors only).
5. On an error: read the failing node + message, fix the file, push, run again.

## Commands

| | |
|---|---|
| `push [files] [--activate] [--force] [--dry-run]` | Push (default: all flows in `WORKFLOWS_DIR`) |
| `pull ["name"\|id ...] [--tag t] [--all] [--force] [--split-code]` | Refresh tracked flows; add flows by name/id/tag. `--all` only if asked |
| `diff` | Per file: what differs and whether **local** (→ push) or **n8n** (→ pull) changed |
| `validate [--strict]` | Offline checks |
| `run "<name>" [--data json] [-X method]` | Call an active webhook flow, show the result |
| `executions "<name>" [-n 5] [--failed]` | Recent runs with errors |
| `list [--active-only] [-o json]`, `activate`/`deactivate "<name>"` | |
| `credentials [--type t]` | Credential ids/names/types (no secrets) |
| `credentials push [--dry-run]` | Create/update credentials from `flows/credentials.n8n.json`; secrets from env vars |
| `credentials test [names]` | n8n tests each credential: ok / failed / untestable |
| `delete "<name>" ... --yes` | Delete in n8n + local file (backup kept). Without `--yes` = preview |
| `prune --yes` | Delete n8n flows whose local file was deleted (only flows this folder synced) |
| `data-tables pull\|push`, `variables pull\|push` | `flows/data-tables.n8n.json` (schemas only), `flows/variables.n8n.json` (licensed n8n) |
| `agents [list]`, `agents pull ["name"\|id] [--all]`, `agents push [--publish] [--dry-run]` | Agents ↔ `agents/` (unpacked n8n package). Edit `agents/agents/<name>/agent.json`; a new agent = new folder with `name` + `config`, no id. Push needs n8n newer than 3.0.0/2.46.0 (else exit 2: tell the user to update n8n) |

## Rules

- **CONFLICT on push** = someone edited it in n8n since the last sync. Pull, re-apply your change, push. **CONFLICT on pull** = local edits not pushed yet. Only use `--force` when the user agrees to overwrite; a backup is kept in `flows/.n8n-sync/backups/`.
- **Secrets never pass through you.** Never ask the user to paste a key/password/token into the chat, never write a real secret into any file, never read `.env*` files or run `printenv`, `env`, `bws secret …`, `op read …` (projects from `init` block these with deny rules + a hook).
- **Credentials as code:** add the credential to `flows/credentials.n8n.json` with secret fields as `{{env.NAME}}`:
  `{ "name": "OpenAI", "type": "openAiApi", "data": { "apiKey": "{{env.OPENAI_API_KEY}}" } }`
  1. `credentials push --dry-run` — fixes field names (it lists the type's real fields); missing env vars are reported by name only.
  2. Tell the user: "add `OPENAI_API_KEY` to Bitwarden Secrets Manager, then run `! bws run -- n8n-sync credentials push`" (1Password: `op run --env-file=.env -- …`). Let **the user** run it, so the secret-manager token is never in your shell.
  3. `credentials test` (ok / failed with n8n's message / untestable for types n8n can't test), then `run` the flow.
  OAuth types (Google, Microsoft, …) need one "Connect" click in the n8n UI after push — say so.
- **Referencing credentials in nodes:** `"credentials": { "<type>": { "id": "<id>", "name": "<name>" } }` with ids from `credentials`. Matched by type + name on each instance, so the same flow works on dev and prod.
- **Sub-workflows** (Execute Workflow node): `"workflowId": { "__rl": true, "value": "<id>", "mode": "list", "cachedResultName": "<sub-workflow name>" }`. Matched by name per instance; push sub-workflows before callers (push does this automatically for a folder).
- **Activation** needs an automatic trigger (Webhook, Schedule, app trigger, or Execute Workflow Trigger for sub-workflows). Manual Trigger only → can't activate; say so, don't "fix" it. Webhook paths must be unique across active flows.
- **Tags**: `"tags": ["a","b"]` set by name; omit to leave n8n's tags alone; `[]` clears.
- `connections` are keyed by node **name**.
- Delete/prune only when the user explicitly asks; show the preview first.

## Minimal activatable flow

```json
{
  "name": "My Webhook Flow",
  "nodes": [
    { "id": "1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
      "webhookId": "my-hook", "parameters": { "path": "my-hook", "httpMethod": "POST", "responseMode": "lastNode" } },
    { "id": "2", "name": "Transform", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0],
      "parameters": { "jsCode": "@file:./my-webhook-flow.transform.js" } }
  ],
  "connections": { "Webhook": { "main": [[{ "node": "Transform", "type": "main", "index": 0 }]] } },
  "settings": { "executionOrder": "v1" }
}
```
