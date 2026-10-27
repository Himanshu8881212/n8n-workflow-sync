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

(Or `npx -y github:Himanshu8881212/n8n-workflow-sync <command>` without a local clone.)

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
| `delete "<name>" ... --yes` | Delete in n8n + local file (backup kept). Without `--yes` = preview |
| `prune --yes` | Delete n8n flows whose local file was deleted (only flows this folder synced) |
| `data-tables pull\|push`, `variables pull\|push` | `flows/data-tables.n8n.json` (schemas only), `flows/variables.n8n.json` (licensed n8n) |

## Rules

- **CONFLICT on push** = someone edited it in n8n since the last sync. Pull, re-apply your change, push. **CONFLICT on pull** = local edits not pushed yet. Only use `--force` when the user agrees to overwrite; a backup is kept in `flows/.n8n-sync/backups/`.
- **Credentials** are created in the n8n UI, never in files. Get them with `credentials`, then reference in a node: `"credentials": { "<type>": { "id": "<id>", "name": "<name>" } }`. They're matched by type+name on each instance, so the same file works on dev and prod. If push warns a credential is missing, tell the user exactly which one to create.
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
