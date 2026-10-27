# n8n flows

This repo holds n8n workflows as files. They are deployed with `n8n-sync`
(the `n8n-sync` skill / MCP server knows the commands).

## Layout
- `flows/*.json` — one workflow per file. The `id` field is written by `n8n-sync push`; don't invent one.
- `flows/<flow>.<node>.js` — code for a Code node, referenced as `"jsCode": "@file:./<flow>.<node>.js"`. Edit the `.js`, not the JSON string.
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
- Credentials are created in the n8n UI. Reference them in nodes as `"credentials": { "<type>": { "id": "<id>", "name": "<name>" } }`; they're matched by name on each instance. If push warns a credential is missing, tell the user which one to create.
- Sub-workflows (Execute Workflow node) are matched by workflow name per instance; keep `cachedResultName` set.
- Delete flows only when asked: `n8n-sync delete "<name>" --yes`.
