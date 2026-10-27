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
  .name('push')
  .description('Push local workflow files to n8n (creates or updates; writes the n8n id back into new files)')
  .argument('[files...]', 'Specific workflow files to push (default: every workflow in --directory)')
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('-a, --activate', 'Activate every pushed workflow (files with "active": true are always activated)')
  .option('-f, --force', 'Overwrite even if the workflow was changed in n8n since the last sync (a backup is kept)')
  .option('--json', 'Print the result as JSON')
  .option('--dry-run', 'Validate and show what would be pushed without making changes')
  .parse(process.argv);

const options = program.opts();
const files = program.args;

const LABELS = {
  created: chalk.green('created  '),
  updated: chalk.blue('updated  '),
  unchanged: chalk.gray('unchanged'),
  skipped: chalk.yellow('skipped  '),
  'dry-run': chalk.yellow('dry-run  '),
  conflict: chalk.red('CONFLICT '),
  invalid: chalk.red('INVALID  '),
  error: chalk.red('error    '),
};

async function main() {
  try {
    validateConfig();
    logger.level = 'error'; // per-file results are printed below

    const syncEngine = new SyncEngine({ workflowsDir: options.directory, dryRun: options.dryRun });
    const result = await syncEngine.pushToN8n({ files, activate: !!options.activate, force: !!options.force });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.blue.bold(`\n📤 Push to ${config.n8n.apiUrl}${config.env ? ` (${config.env})` : ''}\n`));
      for (const r of result.results) {
        const act =
          r.activated === true
            ? chalk.green(` + activated${r.activatedSubWorkflows ? ` (and sub-workflows: ${r.activatedSubWorkflows.join(', ')})` : ''}`)
            : r.activated === false ? chalk.red(` (activation failed: ${r.activationError})`) : '';
        const tags = r.tags?.length ? chalk.gray(` #${r.tags.join(' #')}`) : '';
        const why = r.error || r.reason ? chalk.gray(` - ${r.error || r.reason}`) : '';
        console.log(`  ${LABELS[r.action]}  ${r.file}${r.id ? chalk.gray(` [${r.id}]`) : ''}${tags}${act}${why}`);
        for (const e of r.errors || []) console.log(chalk.red(`             ✗ ${e}`));
        for (const w of r.warnings || []) console.log(chalk.yellow(`             ⚠ ${w}`));
      }
      const parts = [
        `${result.pushed} created`,
        `${result.updated} updated`,
        `${result.unchanged} unchanged`,
        `${result.skipped} skipped`,
        `${result.activated} activated`,
        result.conflicts && chalk.red(`${result.conflicts} conflicts`),
        result.invalid && chalk.red(`${result.invalid} invalid`),
        result.errors && chalk.red(`${result.errors} errors`),
        result.activationErrors && chalk.red(`${result.activationErrors} activation failures`),
      ].filter(Boolean);
      console.log(chalk.gray(`\n  ${result.total} files: `) + parts.join(chalk.gray(', ')) + '\n');
      if (result.conflicts) console.log(chalk.yellow('  Conflicts: pull first to get the n8n changes, or push --force to overwrite them.\n'));
      if (options.dryRun) console.log(chalk.yellow('⚠️  Dry run mode - no changes were made\n'));
    }

    const failed = result.errors + result.invalid + result.conflicts + result.activationErrors;
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
