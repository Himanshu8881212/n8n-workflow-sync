# n8n flows

This repo holds n8n workflows as files. They are deployed with `n8n-sync`
(the `n8n-sync` skill / MCP server knows the commands).

## Layout
- `flows/*.json` — one workflow per file. The `id` field is written by `n8n-sync push`; don't invent one.
- `flows/<flow>.<node>.js` — code for a Code node, referenced as `"jsCode": "@file:./<flow>.<node>.js"`. Edit the `.js`, not the JSON string.
- `flows/credentials.n8n.json` — the credentials the flows need. Secret values are **only** `{{env.NAME}}` references, never real values.
- `flows/data-tables.n8n.json`, `flows/variables.n8n.json` — optional, synced with `n8n-sync data-tables|variables pull|push`.
- `.env` (dev) / `.env.prod` (prod) — n8n URL + API key, never committed. Use `n8n-sync --env prod ...` for prod.

## Loop
1. Write/edit the flow file.
2. `n8n-sync validate` — fix every error.
3. `n8n-sync push <file> --activate`.
4. For webhook flows: `n8n-sync run "<name>" --data '{...}'` and read the execution result; for others, check `n8n-sync executions "<name>"` after it runs. Fix and repeat.
5. Commit. Merging to `main` deploys to prod (see `.github/workflows/n8n.yml`).

## Rules
- Pull before editing a flow that may have been changed in the n8n UI: `n8n-sync pull`. If push reports CONFLICT, pull, merge, push again. Only use `--force` when the user says to overwrite.
- **Secrets never pass through Claude.** Don't ask the user to paste keys, don't read `.env*` files, don't run `printenv`, `bws secret get`, `op read` or similar.
- Credentials: add an entry to `flows/credentials.n8n.json` — `{ "name": "OpenAI", "type": "openAiApi", "data": { "apiKey": "{{env.OPENAI_API_KEY}}" } }` — and run `n8n-sync credentials push --dry-run` to check fields. Then tell the user which secret to add to Bitwarden Secrets Manager under that env var name and ask them to run `! bws run -- n8n-sync credentials push` themselves (1Password: `op run --env-file=.env -- …`), so the secret-manager token never enters your shell. Then `n8n-sync credentials test`.
  - Field names per type: `credentials push --dry-run` reports missing/unknown fields.
  - OAuth types (Google, Microsoft, …) still need one "Connect" click in the n8n UI.
- Reference credentials in nodes as `"credentials": { "<type>": { "id": "<id>", "name": "<name>" } }` (ids from `n8n-sync credentials`). They're matched by type + name on each instance.
- Sub-workflows (Execute Workflow node) are matched by workflow name per instance; keep `cachedResultName` set.
- Delete flows only when asked: `n8n-sync delete "<name>" --yes`.
