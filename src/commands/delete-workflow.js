#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { winstonLogger as logger } from '../logger-enhanced.js';
import { config, validateConfig } from '../config.js';
import { SyncEngine } from '../sync-engine.js';

const program = new Command();

program
  .name('delete')
  .description('Delete workflows from n8n (by id or exact name) and their local files. Both are backed up first.')
  .argument('<workflows...>', 'Workflow ids or exact names')
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('--keep-file', 'Only delete in n8n, keep the local file')
  .option('-y, --yes', 'Actually delete (without it, only shows what would be deleted)')
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();

async function main() {
  try {
    validateConfig();
    logger.level = 'error';

    const engine = new SyncEngine({ workflowsDir: options.directory, dryRun: !options.yes });
    const result = await engine.deleteWorkflows(program.args, { keepFile: !!options.keepFile });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.blue.bold(`\n🗑  Delete from ${config.n8n.apiUrl}${config.env ? ` (${config.env})` : ''}\n`));
      for (const r of result.results) {
        if (r.action === 'error') {
          console.log(chalk.red(`  ✗ ${r.identifier}: ${r.error}`));
          continue;
        }
        const where = [r.remote && 'n8n', (r.deletedFile || r.wouldDeleteFile) && r.file].filter(Boolean).join(' + ');
        const verb = r.action === 'dry-run' ? chalk.yellow('would delete') : chalk.green('deleted');
        console.log(`  ${verb}  ${r.name} ${chalk.gray(`[${r.id}]`)} ${chalk.gray(`(${where})`)}`);
      }
      if (!options.yes) console.log(chalk.yellow('\n  Nothing deleted. Re-run with --yes to delete.'));
      else console.log(chalk.gray(`\n  Backups: ${options.directory}/.n8n-sync/backups/`));
      console.log();
    }
    process.exit(result.errors > 0 ? 1 : 0);
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
