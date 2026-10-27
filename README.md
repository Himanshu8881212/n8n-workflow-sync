# n8n Workflow Sync

Keep n8n workflows as JSON/YAML files and push them to n8n (and activate them) from the CLI, a small local dashboard, a file watcher, or Claude Code.

- **Push**: local files → n8n. Creates or updates, writes the n8n `id` back into new files so re-pushing never duplicates, and optionally activates.
- **Pull**: n8n → local files. By default only the workflows **already tracked in the folder** (a file has their `id`), so other flows on the same instance never land in your project. Files are updated in place, unchanged ones aren't rewritten.

Push and pull are one-way operations. There is no automatic conflict merge: push overwrites n8n with the file, pull overwrites the file with n8n. Use `diff` first if unsure.

## Setup

```bash
git clone https://github.com/Himanshu8881212/n8n-workflow-sync.git
cd n8n-workflow-sync
npm install
cp .env.example .env    # set N8N_API_URL and N8N_API_KEY
```

Create the API key in n8n → **Settings → n8n API → Create API key**. Requires Node 18+.

## Push and activate

```bash
npm run sync:push -- -d ./my-flows                 # push every workflow in a folder
npm run sync:push -- -d ./my-flows --activate      # ...and activate them
node src/push-to-n8n.js flows/a.json flows/b.json  # push specific files
node src/push-to-n8n.js -d ./my-flows --dry-run    # preview
node src/push-to-n8n.js flows/a.json --json        # machine-readable result
```

How a file is matched to a workflow in n8n: file `id` → existing workflow with the same `name` → create new.

A workflow is activated when you pass `--activate` or the file contains `"active": true`. Activation needs an automatic trigger (Webhook, Schedule, app trigger). Manual-trigger-only workflows can't be activated, and trigger nodes need their credentials to exist in n8n. Activation failures are reported per file and make the command exit with code 1.

Only `name`, `nodes`, `connections`, `settings` and `staticData` are sent to n8n plus tags. Tags are matched **by name** and created in n8n if missing. A file with no `tags` field leaves the workflow's tags alone, and `"tags": []` clears them. Credentials can't be pushed; create them in the n8n UI. Files that aren't workflows (e.g. `package.json`) are skipped.

## Pull

```bash
node src/pull-from-n8n.js -d ./my-flows                      # refresh flows tracked in this folder
node src/pull-from-n8n.js -d ./my-flows "Order Intake" abc123  # adopt specific flows by name or id
node src/pull-from-n8n.js -d ./my-flows --tag team-a           # adopt every flow with a tag
node src/pull-from-n8n.js -d ./my-flows --all                  # everything on the instance
```

Adopted flows go to `<first-tag>/<name>.json` and are tracked from then on, so a plain pull keeps them in sync. Names/ids that don't exist are reported and make the command exit 1. The dashboard's Pull button, `AUTO_PULL` and the webhook `/sync/pull` all use the tracked-only default.

## Other commands

```bash
npm run workflows:list                    # -- --active-only | --inactive-only | -o json
npm run workflows:activate -- "<id or name>"
npm run workflows:deactivate -- "<id or name>"
npm run workflows:diff                    # compares WORKFLOWS_DIR with n8n
npm run workflows:search -- <query>
npm run workflows:prune -- --dry-run      # delete n8n workflows that have no local file
npm test
```

## Dashboard

```bash
npm run gui     # http://127.0.0.1:3001
```

List, push, pull, activate, deactivate, and delete workflows. It has no login, so it only listens on `127.0.0.1` and rejects cross-origin requests. Change `GUI_HOST` only if you put real auth in front of it.

## Watch mode and webhooks

```bash
npm start
```

- `WATCH_ENABLED=true`: every saved file in `WORKFLOWS_DIR` is pushed. A deleted file is logged and **not** deleted in n8n.
- `AUTO_PULL=true`: pull tracked workflows once on start (runs before the watcher starts).
- `WEBHOOK_ENABLED=true`: HTTP server with `POST /sync/pull|push|full`. Requires `WEBHOOK_SECRET`. Requests must carry `X-Webhook-Signature: hex(HMAC-SHA256(secret, body))`.

## Claude Code skill

`skill/n8n-sync/SKILL.md` teaches Claude Code to push, activate and pull with this CLI. Install it by symlinking:

```bash
ln -s "$PWD/skill/n8n-sync" ~/.claude/skills/n8n-sync
```

Then ask things like "push flows/order-webhook.json to n8n and activate it".

## Configuration

See `.env.example`. Defaults: `N8N_API_URL=http://localhost:5678/api/v1`, `WORKFLOWS_DIR=./workflows`.
