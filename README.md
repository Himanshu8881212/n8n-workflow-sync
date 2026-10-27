# n8n Workflow Sync

Keep n8n workflows as files in git, build them with Claude Code, and deploy them with one command:
push, activate, run, read execution errors, pull UI changes back, promote dev → prod, deploy from GitHub.

```bash
npx -y github:Himanshu8881212/n8n-workflow-sync init        # new flows project
npx -y github:Himanshu8881212/n8n-workflow-sync push --activate
npx -y github:Himanshu8881212/n8n-workflow-sync run "Hello Webhook" --data '{"name":"you"}'
```

Below, `n8n-sync` means that `npx` command (or `node src/cli.js` in a clone). Tested against n8n 2.45.

## Setup

1. `n8n-sync init` in an empty folder. It creates `flows/hello-webhook.json` plus its code file, `CLAUDE.md`, `.env.example`, `.gitignore` and `.github/workflows/n8n.yml`.
2. `cp .env.example .env`, then set `N8N_API_URL` and `N8N_API_KEY` (n8n → Settings → n8n API → Create API key).
3. For prod, add `.env.prod` and use `n8n-sync --env prod <command>`.

Config is per project: `./.env.<env>` → `./.env` → the tool's own `.env`. Real environment variables (CI secrets) override all of them.

## Commands

| Command | |
|---|---|
| `push [files] [-a/--activate] [-f/--force] [--dry-run]` | Validate, then create/update in n8n. New files get the n8n `id` written in |
| `pull ["name"\|id] [--tag t] [--all] [-f] [--split-code]` | Refresh flows tracked in this folder; adopt others by name/id/tag |
| `diff` | What differs, and whether the file or n8n changed (→ push or pull) |
| `validate [--strict]` | Offline checks: connections, duplicate names, missing fields, triggers |
| `run "<name>" [--data json]` | Call an active webhook flow; prints the response and execution result |
| `executions "<name>" [--failed]` | Recent runs with the failing node and error |
| `list`, `search`, `activate`, `deactivate`, `credentials` | |
| `delete "<name>" --yes` | Delete in n8n and locally (unpublishes first, keeps a backup) |
| `prune --yes` | Delete n8n flows whose file you deleted (only flows this folder synced) |
| `data-tables pull\|push` | Data table schemas ↔ `flows/data-tables.n8n.json`. Rows are never synced |
| `variables pull\|push` | Variables ↔ `flows/variables.n8n.json`. Needs a licensed n8n |
| `init`, `gui`, `watch`, `mcp`, `completion zsh\|bash\|fish`, `version` | |

Every command takes `--json`. Logs go to stderr.

## How sync stays safe

- **Conflict guards.** `flows/.n8n-sync/state.json` (gitignored) records each flow as it was at the last sync, separately for each n8n instance.
  - Push refuses (`CONFLICT`) if the flow was edited in n8n since then.
  - Pull refuses if the file has edits that weren't pushed.
  - `--force` overrides either guard. Whatever gets replaced is saved in `flows/.n8n-sync/backups/`.
- **Only your flows.** Pull, diff and prune only touch flows this folder tracks. Other flows on the instance are never touched unless you name them.
- **Delete.** Previews by default and keeps backups. `prune` never deletes flows this folder didn't sync.

## Dev → prod

The same files work on every instance:
- **Workflow IDs:** the file keeps the ID from whichever instance created it. Other instances are tracked in the sync state, or matched by name when there's no state (CI).
- **Credentials:** matched by **type and name**. Create one with the same name on each instance (secrets never go in files). Push warns if one is missing.
- **Sub-workflows:** Execute Workflow targets are matched by **workflow name**. Push sends sub-workflows before their callers, and `--activate` publishes them first (n8n 2.x requires this).

## Code in its own files

`"jsCode": "@file:./flow.node.js"` (also `pythonCode`) is inlined on push. Pull writes n8n's version back into the `.js` file. `pull --split-code` converts inline code into files. Diffs and reviews then show real code.

## GitHub deploys

`init` adds `.github/workflows/n8n.yml`:
- **On pull requests:** runs `validate`.
- **On merge to `main`:** runs `push --force`. Git wins, and files with `"active": true` get activated.

It needs the repo secrets `N8N_API_URL` (reachable from GitHub) and `N8N_API_KEY`. Make UI changes through `pull` and a PR, or the next deploy overwrites them.

## Claude Code skill and MCP server

- **Skill:** `ln -s "$PWD/skill/n8n-sync" ~/.claude/skills/n8n-sync`, then ask *"make a flow that … and push it"*.
- **MCP server** (Claude Desktop or any MCP client). It provides 13 tools: list, push, pull, validate, diff, activate, deactivate, delete, run, executions, credentials, data tables, variables.

```json
{ "mcpServers": { "n8n-sync": {
  "command": "npx", "args": ["-y", "github:Himanshu8881212/n8n-workflow-sync", "mcp"],
  "env": { "N8N_API_URL": "http://localhost:5678/api/v1", "N8N_API_KEY": "…", "N8N_SYNC_DIR": "/abs/path/to/flows" } } } }
```

## Limits

- n8n's public API can't start Manual or Schedule triggers, so `run` only works for webhook flows. For the others, use `executions` after they've run.
- Credential secrets can't be read or pushed (by design). Projects and folders need an n8n license or have no public API, so they aren't synced.
- Validation checks the structure only. A wrong parameter value only shows up at run time, so use `run` or `executions`.
- Backups are never rotated. Delete `flows/.n8n-sync/backups/` when it gets big.

## Development

```bash
npm install && npm test     # 43 tests; CI runs them on Node 20/22/24
```
