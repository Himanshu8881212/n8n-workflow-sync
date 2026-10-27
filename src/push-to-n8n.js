#!/usr/bin/env node

/**
 * Push Workflows to n8n
 *
 * Push all local workflows (or specific files) to n8n, optionally activating them.
 *
 * @module push-to-n8n
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { winstonLogger as logger } from './logger-enhanced.js';
import { config, validateConfig } from './config.js';
import { SyncEngine } from './sync-engine.js';

const program = new Command();

program
  .name('push-to-n8n')
  .description('Push local workflow files to n8n (creates or updates; writes the n8n id back into new files)')
  .argument('[files...]', 'Specific workflow files to push (default: every workflow in --directory)')
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('-a, --activate', 'Activate every pushed workflow (files with "active": true are always activated)')
  .option('--json', 'Print the result as JSON')
  .option('--dry-run', 'Show what would be pushed without making changes')
  .parse(process.argv);

const options = program.opts();
const files = program.args;

async function main() {
  try {
    validateConfig();

    logger.level = 'error'; // per-file results are printed below

    const syncEngine = new SyncEngine({
      workflowsDir: options.directory,
      dryRun: options.dryRun,
    });

    const result = await syncEngine.pushToN8n({ files, activate: !!options.activate });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.blue.bold(`\n📤 Push to ${config.n8n.apiUrl}\n`));
      for (const r of result.results) {
        const act =
          r.activated === true ? chalk.green(' + activated') : r.activated === false ? chalk.red(` (activation failed: ${r.activationError})`) : '';
        const tag = { created: chalk.green('created'), updated: chalk.blue('updated'), error: chalk.red('error'), skipped: chalk.yellow('skipped'), 'dry-run': chalk.yellow('dry-run') }[r.action];
        console.log(`  ${tag}  ${r.file}${r.id ? chalk.gray(` [${r.id}]`) : ''}${r.tags?.length ? chalk.gray(` #${r.tags.join(' #')}`) : ''}${act}${r.error || r.reason ? chalk.gray(` - ${r.error || r.reason}`) : ''}`);
      }
      console.log(
        chalk.gray(
          `\n  ${result.total} files: ${result.pushed} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors, ${result.activated} activated, ${result.activationErrors} activation failures\n`,
        ),
      );
      if (options.dryRun) console.log(chalk.yellow('⚠️  Dry run mode - no changes were made\n'));
    }

    process.exit(result.errors > 0 || result.activationErrors > 0 ? 1 : 0);
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
