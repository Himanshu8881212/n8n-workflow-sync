---
name: n8n-sync
description: Push local n8n workflow JSON/YAML files to an n8n instance and activate them, or pull workflows from n8n into files. Use when the user wants to deploy, push, upload, sync, activate or deactivate n8n workflows/flows, export n8n workflows to disk, or write a new n8n workflow file and get it running.
---

# n8n-sync

CLI from the `n8n-workflow-sync` repo. Every command talks to the n8n **public API**
using `N8N_API_URL` + `N8N_API_KEY` from the repo's `.env`.

## Locate the repo

```bash
REPO="$(cd "$(dirname "$(realpath ~/.claude/skills/n8n-sync/SKILL.md)")/../.." && pwd)"
```

First run only: `cd "$REPO" && npm install`. If `$REPO/.env` is missing, copy `.env.example`
and ask the user for the API URL (e.g. `http://localhost:5678/api/v1`) and an API key
(n8n → Settings → n8n API → Create API key). Never print the key.

## Push (create or update) and activate

```bash
node "$REPO/src/push-to-n8n.js" path/to/flow.json other.json --activate --json
node "$REPO/src/push-to-n8n.js" -d ./workflows --activate          # every workflow file in a folder
node "$REPO/src/push-to-n8n.js" -d ./workflows --dry-run           # preview
```

- Match order: file `id` → existing n8n workflow with the same `name` → create new.
- After create/name-match the n8n `id` is **written back into the file**, so re-pushing updates instead of duplicating. Tell the user the file changed.
- Activation happens with `--activate` or when the file has `"active": true`. Without either, an already-active workflow stays active, an inactive one stays inactive.
- Only `name`, `nodes`, `connections`, `settings`, `staticData` are sent; other fields are ignored. `tags` (`["name"]` or `[{"name": ...}]`) are set by name, and missing tags are created; omit `tags` to leave them untouched, `[]` clears them. Credentials must be created in the n8n UI.
- Files that aren't workflows (no `name`/`nodes`/`connections`) are skipped.
- Exit code 1 if any push or activation failed. With `--json`, check each `results[]` entry for `action` (`created|updated|skipped|error`), `activated`, `activationError`.

## Pull (n8n → files)

```bash
node "$REPO/src/pull-from-n8n.js" -d ./workflows                       # refresh tracked flows only (default)
node "$REPO/src/pull-from-n8n.js" -d ./workflows "Flow Name" <id>      # adopt specific flows
node "$REPO/src/pull-from-n8n.js" -d ./workflows --tag <tag>           # adopt flows with a tag
```

- Default pulls only workflows whose `id` is already in a file in the folder; everything else on the instance is left alone.
- When the user built/edited a flow in the n8n UI and wants it in the project, pull it **by name or id**. Only use `--all` if they explicitly ask for every workflow.
- Put positional names/ids **before** `--tag` (the flag takes multiple values).
- Adopted flows land in `<first-tag>/<name>.json` and are tracked from then on. Exit 1 if a requested name/id doesn't exist.

## Other commands

```bash
node "$REPO/src/commands/list-workflows.js"              # --active-only / --inactive-only / -o json
node "$REPO/src/commands/activate-workflow.js" "<id or name>"
node "$REPO/src/commands/deactivate-workflow.js" "<id or name>"
WORKFLOWS_DIR=./workflows node "$REPO/src/commands/diff-workflows.js"
```

## Writing a workflow file that can be activated

Minimal shape:

```json
{
  "name": "My Webhook Flow",
  "nodes": [
    { "id": "1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
      "position": [0, 0], "webhookId": "my-hook", "parameters": { "path": "my-hook", "httpMethod": "POST" } },
    { "id": "2", "name": "Set", "type": "n8n-nodes-base.set", "typeVersion": 3.4,
      "position": [220, 0], "parameters": {} }
  ],
  "connections": { "Webhook": { "main": [[{ "node": "Set", "type": "main", "index": 0 }]] } },
  "settings": { "executionOrder": "v1" }
}
```

Activation rules (n8n's, not this tool's):
- The workflow needs an automatic trigger (Webhook, Schedule Trigger, a `*Trigger` app node, a poller). A **Manual Trigger** alone can't be activated: report it as "manual-only", not as a failure to fix.
- Trigger nodes that need credentials fail to activate until credentials exist in n8n. Credentials are not part of the file and can't be pushed; tell the user to create them in the n8n UI.
- A webhook `path` must be unique across active workflows.
- `connections` keys are node **names**, not ids.

## Safety

- Pushing overwrites the remote workflow with the file's contents. If you're unsure whether n8n has newer edits, run `diff-workflows.js` or pull to a scratch dir first.
- Don't run `prune-workflows.js` or delete workflows unless the user explicitly asks.
