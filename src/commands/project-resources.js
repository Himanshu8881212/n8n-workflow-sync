#!/usr/bin/env node

/**
 * data-tables / variables: pull <-> push of instance resources that aren't
 * workflows. Invoked as `n8n-sync data-tables pull` / `n8n-sync variables push`.
 *
 *   data-tables.n8n.json  [{ "name": "...", "columns": [{ "name": "...", "type": "string" }] }]
 *   variables.n8n.json    { "KEY": "value" }
 *
 * Never deletes anything in n8n.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'path';
import { existsSync } from 'fs';
import { winstonLogger as logger } from '../logger-enhanced.js';
import { config, validateConfig } from '../config.js';
import { SyncEngine } from '../sync-engine.js';

const KINDS = {
  'data-tables': { file: 'data-tables.n8n.json', pull: 'pullDataTables', push: 'pushDataTables', label: 'data table schemas (rows are never synced)' },
  variables: { file: 'variables.n8n.json', pull: 'pullVariables', push: 'pushVariables', label: 'variables (needs a licensed n8n)' },
};

const kind = process.env.N8N_SYNC_RESOURCE;
const spec = KINDS[kind];
if (!spec) {
  console.error(`Unknown resource "${kind}" (use: ${Object.keys(KINDS).join(', ')})`);
  process.exit(1);
}

const program = new Command();
program
  .name(kind)
  .description(`Sync ${spec.label} with ${spec.file}`)
  .argument('<action>', 'pull | push')
  .option('-d, --directory <path>', 'Workflows directory (the file lives here)', config.paths.workflowsDir)
  .option('--file <path>', `File (default: <directory>/${spec.file})`)
  .option('--all', 'pull: include everything in n8n, not just entries already in the file')
  .option('--dry-run', 'Show what would change')
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();
const action = program.args[0];

async function main() {
  try {
    if (!['pull', 'push'].includes(action)) throw new Error(`action must be pull or push, got "${action}"`);
    validateConfig();
    logger.level = 'error';
    const file = options.file || join(options.directory, spec.file);
    if (action === 'push' && !existsSync(file)) throw new Error(`${file} not found`);

    const engine = new SyncEngine({ workflowsDir: options.directory, dryRun: !!options.dryRun });
    const result = await engine[spec[action]](file, { all: !!options.all });

    if (options.json) return console.log(JSON.stringify(result, null, 2));
    console.log(chalk.blue.bold(`\n${kind} ${action} (${file})\n`));
    if (action === 'pull') {
      const names = result.tables || result.keys;
      console.log(`  ${names.length ? names.join(', ') : chalk.gray('nothing tracked - use --all to pull everything')}`);
      if (result.missingInN8n.length) console.log(chalk.yellow(`  ⚠ in file but not in n8n: ${result.missingInN8n.join(', ')}`));
    } else {
      for (const r of result.results) {
        console.log(`  ${r.action.padEnd(9)} ${r.table || r.key}${r.added ? chalk.gray(` +${r.added.join(', +')}`) : ''}`);
        for (const w of r.warnings || []) console.log(chalk.yellow(`            ⚠ ${w}`));
      }
    }
    console.log();
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
