# n8n Workflow Sync

Keep n8n workflows as files in git, build them with Claude Code, and deploy them with one command:
push, activate, run, read execution errors, pull UI changes back, promote dev → prod, deploy from GitHub.

```bash
npx -y github:Himanshu8881212/n8n-workflow-sync init        # new flows project
npx -y github:Himanshu8881212/n8n-workflow-sync push --activate
npx -y github:Himanshu8881212/n8n-workflow-sync run "Hello Webhook" --data '{"name":"you"}'
```

Below, `n8n-sync` means that `npx` command (or `node src/cli.js` in a clone).

**Install:** `npx github:…` needs **Node 24** (npm 10 on Node 20/22 has a bug installing from GitHub). On Node 20/22 use
`npm install -g github:Himanshu8881212/n8n-workflow-sync` once, then run `n8n-sync …`. CI tests both methods on Node 20/22/24.

**Tested on** Linux, macOS and Windows with Node 20/22/24, and end-to-end against real n8n 3.0.1 (Docker), 2.45.4 and 1.123.88.

## Setup

1. `n8n-sync init` in an empty folder. It creates:
   - `flows/hello-webhook.json` plus its code file
   - `CLAUDE.md`, `.env.example`, `.gitignore`
   - `.github/workflows/n8n.yml` (the GitHub Action)
   - `.claude/settings.json` plus a hook that stops Claude from reading secrets
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
| `credentials [list]` | Credential names, types and IDs (never secrets) |
| `credentials push [--dry-run]` | Create/update credentials from `flows/credentials.n8n.json`. Secrets come from env vars |
| `credentials test [names]` | n8n tests each credential: ok / failed / untestable |
| `list`, `search`, `activate`, `deactivate` | |
| `delete "<name>" --yes` | Delete in n8n and locally (unpublishes first, keeps a backup) |
| `prune --yes` | Delete n8n flows whose file you deleted (only flows this folder synced) |
| `data-tables pull\|push` | Data table schemas ↔ `flows/data-tables.n8n.json`. Rows are never synced |
| `variables pull\|push` | Variables ↔ `flows/variables.n8n.json`. Needs a licensed n8n |
| `agents [list]`, `agents pull ["name"\|id] [--all]`, `agents push [--publish] [--dry-run]` | Agents ↔ `agents/` (see below). Push needs a newer n8n |
| `init`, `gui`, `watch`, `mcp`, `completion zsh\|bash\|fish`, `version` | |

Every command takes `--json`. Logs go to stderr.

**Dashboard** (`n8n-sync gui` → http://127.0.0.1:3001): a *Workflows* and an *Agents* tab with pull/push, activate/deactivate/delete for workflows, and per-agent status (synced / only in n8n / only local). It talks to the n8n in `N8N_API_URL`, so a dashboard on your laptop can drive an n8n on a server; `N8N_EDITOR_URL` sets the "open n8n" link (default: the API URL without `/api/v1`). Open `/#agents` to land on the agents tab.

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

## Credentials without secrets in files (Bitwarden recommended)

`flows/credentials.n8n.json` is committed. It lists what your flows need, and every secret is a **reference to an environment variable**:

```json
[
  { "name": "OpenAI",          "type": "openAiApi",      "data": { "apiKey": "{{env.OPENAI_API_KEY}}" } },
  { "name": "Partner API Key", "type": "httpHeaderAuth", "data": { "name": "X-Api-Key", "value": "{{env.PARTNER_API_KEY}}" } }
]
```

Keep the values in **Bitwarden Secrets Manager**, using the same names as the variables, and push through it:

```bash
bws run -- n8n-sync credentials push        # creates missing, updates existing (merges, so OAuth tokens survive)
n8n-sync credentials test                   # n8n checks each one against the real service
```

How the secrets are protected:
- They exist only inside the `bws run` process. Nothing is printed, logged or written to disk, and any secret n8n echoes back in an error is masked.
- n8n's API never returns secret data, so `list`, `test`, `pull` and backups can't leak them either.
- `--dry-run` checks the file against n8n's schema for each credential type (missing or unknown fields) and lists which environment variables are missing, by name only.
- On push, credentials are matched by type and name on each instance, so `bws run -- n8n-sync --env prod credentials push` sets up prod from the same file. In GitHub Actions, pass the values as repository secrets instead.
- Works with any secret manager that injects environment variables: `op run --env-file=.env -- …` (1Password), `infisical run -- …`, `dotenvx run -- …`.
- OAuth credentials (Google, Microsoft, …) are created too, but still need one "Connect" click in the n8n UI.

**Keeping Claude away from secrets.** In a project made by `init`, Claude asks *you* to run `credentials push`, so the secret manager's token never sits in Claude's shell. That is the actual guarantee. On top of that, `.claude/settings.json` adds:
- deny rules for reading `.env*` and for `printenv`, `env`, `bws secret`, `op read`. These hold even in bypass-permissions mode.
- a PreToolUse hook that also catches wrapped forms like `bws run -- printenv` or `sh -c 'cat .env'`.

Both layers match patterns, so they reduce the risk but don't eliminate it on their own.

## Code in its own files

`"jsCode": "@file:./flow.node.js"` (also `pythonCode`) is inlined on push. Pull writes n8n's version back into the `.js` file. `pull --split-code` converts inline code into files. Diffs and reviews then show real code.

## GitHub deploys

`init` adds `.github/workflows/n8n.yml`:
- **On pull requests:** runs `validate`.
- **On merge to `main`:** runs `push --force`. Git wins, and files with `"active": true` get activated.

It needs the repo secrets `N8N_API_URL` (reachable from GitHub) and `N8N_API_KEY`. Make UI changes through `pull` and a PR, or the next deploy overwrites them.

## Claude Code skill and MCP server

- **Skill:** `ln -s "$PWD/skill/n8n-sync" ~/.claude/skills/n8n-sync`, then ask *"make a flow that … and push it"*.
- **MCP server** (Claude Desktop or any MCP client). It provides 15 tools: list, push, pull, validate, diff, activate, deactivate, delete, run, executions, list/push/test credentials, data tables, variables. To push credentials over MCP, start the server under your secret manager (`bws run -- npx … mcp`).

```json
{ "mcpServers": { "n8n-sync": {
  "command": "npx", "args": ["-y", "github:Himanshu8881212/n8n-workflow-sync", "mcp"],
  "env": { "N8N_API_URL": "http://localhost:5678/api/v1", "N8N_API_KEY": "…", "N8N_SYNC_DIR": "/abs/path/to/flows" } } } }
```

## Agents

n8n agents sync through n8n packages (`/n8n-packages/export` and `/import`), with the same API key. The `agents/` folder (`AGENTS_DIR`) is the package unpacked, the way n8n exports it:

```
agents/
  manifest.json                            what the package contains (kept up to date on push)
  agents/<name>-<id>/agent.json            the definition: model, instructions, tools, memory… edit this
  agents/<name>-<id>/agent-metadata.json   version ids (written by n8n)
  credentials/<name>-<id>/credential.json  credential reference: id, name, type (never secrets)
```

- `agents pull --all` (or `pull "name"`) adds agents; a plain `agents pull` refreshes the ones in the folder. Agents that n8n doesn't have (yet) keep their local files.
- **New agent:** create `agents/agents/<name>/agent.json` with `name` and `config` (copy an existing one, drop `id`). `config.credential` can be the credential's name. `push` assigns the id, adds it to `manifest.json` and lists its credential.
- `agents push` keeps the ids (`idPolicy=source`), so pushing again updates the agent (`--conflict-policy new-version`) instead of creating a copy. `--publish` publishes. It never deletes agents in n8n.
- **Push needs n8n 3.0.1 or newer** (agent package import, n8n PR #40892). Older n8n says so (exit code 2). Pull works on 2.45+.
- The API key needs the `agent:import` scopes. Keys created before 3.0 don't have them (push fails with 403): create a new key after upgrading.
- Agents in a project without any workflow aren't listed by `agents list` / `--all` (the public API has no agent list). Pull them by id from the editor URL.
- Workflows an agent uses as tools aren't copied into the package (`reference-only`); keep them in your flows folder.

## Limits

- n8n's public API can't start Manual or Schedule triggers, so `run` only works for webhook flows. For the others, use `executions` after they've run.
- `credentials push/test/list` need n8n 2.x (n8n 1.x has no API to list credentials; everything else works on 1.x). Credential secrets are never read back from n8n (by design). Projects and folders need an n8n license or have no public API, so they aren't synced.
- Validation checks the structure only. A wrong parameter value only shows up at run time, so use `run` or `executions`.
- Backups are never rotated. Delete `flows/.n8n-sync/backups/` when it gets big.

## Development

```bash
npm install && npm test     # 55 tests; CI runs them on Node 20/22/24
```
