#!/usr/bin/env node

/**
 * MCP server (stdio) exposing the sync engine as tools, for Claude Desktop or
 * any MCP client:
 *
 *   { "mcpServers": { "n8n-sync": {
 *       "command": "npx", "args": ["-y", "github:Himanshu8881212/n8n-workflow-sync", "mcp"],
 *       "env": { "N8N_API_URL": "...", "N8N_API_KEY": "...", "N8N_SYNC_DIR": "/abs/path/to/flows" } } } }
 *
 * Logs go to stderr (stdout is the protocol).
 *
 * @module mcp-server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve, join } from 'path';
import { readFileSync } from 'fs';
import { winstonLogger as logger } from './logger-enhanced.js';
import { config, validateConfig } from './config.js';
import { SyncEngine, isWorkflow } from './sync-engine.js';
import { N8nClient } from './n8n-client.js';
import { FileManager } from './file-manager.js';
import { validateWorkflow } from './validator.js';

logger.level = process.env.LOG_LEVEL || 'warn';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const server = new McpServer({ name: 'n8n-sync', version: pkg.version });

const dirOf = (directory) => resolve(directory || process.env.N8N_SYNC_DIR || config.paths.workflowsDir);
const engineFor = (directory, dryRun = false) => {
  validateConfig();
  return new SyncEngine({ workflowsDir: dirOf(directory), dryRun });
};

const directory = z.string().optional().describe('Folder with flow files (absolute path recommended). Default: N8N_SYNC_DIR or WORKFLOWS_DIR');
const workflow = z.string().describe('Workflow id or exact name');

/**
 * Register a tool whose handler returns a JSON-able result.
 */
function tool(name, description, inputSchema, handler, annotations = {}) {
  server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
    try {
      const result = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
}

tool(
  'list_workflows',
  'List workflows in n8n (id, name, active, tags).',
  { active: z.boolean().optional().describe('Only active (true) or inactive (false)') },
  async ({ active }) => {
    validateConfig();
    const all = await new N8nClient().listWorkflows();
    return all
      .filter((w) => active === undefined || w.active === active)
      .map((w) => ({ id: w.id, name: w.name, active: w.active, tags: (w.tags || []).map((t) => t.name), updatedAt: w.updatedAt }));
  },
  { readOnlyHint: true },
);

tool(
  'push_workflows',
  'Create/update n8n workflows from local flow files (validates first). New files get their n8n id written back. ' +
    'Results with action "conflict" mean the workflow was edited in n8n since the last sync: pull first, or set force only if the user agrees to overwrite.',
  {
    directory,
    files: z.array(z.string()).optional().describe('Specific files; default: all flows in directory'),
    activate: z.boolean().optional().describe('Activate every pushed workflow (files with "active": true always are)'),
    force: z.boolean().optional().describe('Overwrite workflows changed in n8n since the last sync (backup kept)'),
    dry_run: z.boolean().optional(),
  },
  ({ directory: d, files, activate, force, dry_run }) => engineFor(d, dry_run).pushToN8n({ files, activate, force }),
);

tool(
  'pull_workflows',
  'Update local flow files from n8n. Default: only flows already tracked in the folder. Use select (names/ids) or tags to add flows. ' +
    '"conflict" = the local file has unpushed changes.',
  {
    directory,
    select: z.array(z.string()).optional().describe('Workflow names or ids to add to the folder'),
    tags: z.array(z.string()).optional().describe('Also pull workflows with these tags'),
    all: z.boolean().optional().describe('Every workflow on the instance - only if the user asks'),
    force: z.boolean().optional().describe('Overwrite unpushed local changes (backup kept)'),
    split_code: z.boolean().optional().describe('Write Code node code to separate .js/.py files'),
    dry_run: z.boolean().optional(),
  },
  ({ directory: d, select, tags, all, force, split_code, dry_run }) =>
    engineFor(d, dry_run).pullFromN8n({ select, tags, all, force, splitCode: split_code }),
);

tool(
  'validate_workflows',
  'Check flow files for mistakes without contacting n8n (broken connections, duplicate node names, missing fields, no trigger).',
  { directory, files: z.array(z.string()).optional() },
  async ({ directory: d, files }) => {
    const fm = new FileManager(dirOf(d));
    const paths = files?.length ? files.map((f) => resolve(f)) : await fm.getAllWorkflowFiles();
    const results = [];
    for (const p of paths) {
      try {
        const wf = await fm.readWorkflow(p);
        if (isWorkflow(wf) || files?.length) results.push({ file: fm.getRelativePath(p), ...validateWorkflow(wf) });
      } catch (error) {
        results.push({ file: fm.getRelativePath(p), errors: [error.message], warnings: [] });
      }
    }
    return results;
  },
  { readOnlyHint: true },
);

tool(
  'diff_workflows',
  "Compare the folder's flow files with n8n: which differ, in which fields, and whether the local file or n8n changed since the last sync (push vs pull).",
  { directory },
  ({ directory: d }) => engineFor(d).diff(),
  { readOnlyHint: true },
);

tool('activate_workflow', 'Activate a workflow (needs an automatic trigger and its credentials).', { workflow }, async ({ workflow: w }) => {
  const engine = engineFor();
  const { id } = await engine.findWorkflow(w);
  const r = await engine.client.activateWorkflow(id);
  return { id, name: r.name, active: r.active };
});

tool('deactivate_workflow', 'Deactivate a workflow.', { workflow }, async ({ workflow: w }) => {
  const engine = engineFor();
  const { id } = await engine.findWorkflow(w);
  const r = await engine.client.deactivateWorkflow(id);
  return { id, name: r.name, active: r.active };
});

tool(
  'delete_workflows',
  'Delete workflows from n8n and their local files (backups kept in .n8n-sync/backups). Only when the user explicitly asked. ' +
    'Call with confirm=false first to show what would be deleted.',
  {
    directory,
    workflows: z.array(z.string()).describe('Workflow ids or exact names'),
    confirm: z.boolean().describe('true = actually delete, false = preview'),
    keep_file: z.boolean().optional().describe('Only delete in n8n'),
  },
  ({ directory: d, workflows, confirm, keep_file }) => engineFor(d, !confirm).deleteWorkflows(workflows, { keepFile: keep_file }),
  { destructiveHint: true },
);

tool(
  'run_workflow',
  "Call an active workflow's production webhook and return the HTTP response plus the execution result (status, errors per node).",
  {
    workflow,
    data: z.record(z.string(), z.any()).optional().describe('JSON body'),
    method: z.string().optional().describe("HTTP method; default the webhook node's"),
  },
  ({ workflow: w, data, method }) => engineFor().runWorkflow(w, { data, method }),
);

tool(
  'get_executions',
  'Recent runs of a workflow with status and error details (which node failed and why).',
  { workflow, limit: z.number().int().min(1).max(50).optional(), failed_only: z.boolean().optional() },
  ({ workflow: w, limit, failed_only }) => engineFor().getExecutions(w, { limit: limit || 5, status: failed_only ? 'error' : undefined }),
  { readOnlyHint: true },
);

tool(
  'list_credentials',
  'Credentials that exist in n8n (id, name, type - never secrets). Use to reference credentials in node JSON.',
  {},
  async () => {
    validateConfig();
    return (await new N8nClient().listCredentials()).map((c) => ({ id: c.id, name: c.name, type: c.type }));
  },
  { readOnlyHint: true },
);

for (const [name, file, pull, push, what] of [
  ['sync_data_tables', 'data-tables.n8n.json', 'pullDataTables', 'pushDataTables', 'data table schemas (rows are never synced)'],
  ['sync_variables', 'variables.n8n.json', 'pullVariables', 'pushVariables', 'variables (licensed n8n only)'],
]) {
  tool(
    name,
    `Pull or push ${what} via <directory>/${file}. Never deletes anything in n8n.`,
    { directory, action: z.enum(['pull', 'push']), all: z.boolean().optional().describe('pull: include everything in n8n'), dry_run: z.boolean().optional() },
    ({ directory: d, action, all, dry_run }) => {
      const engine = engineFor(d, dry_run);
      return engine[action === 'pull' ? pull : push](join(engine.workflowsDir, file), { all });
    },
  );
}

await server.connect(new StdioServerTransport());
