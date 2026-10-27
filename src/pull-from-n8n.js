#!/usr/bin/env node

/**
 * Pull Workflows from n8n
 *
 * Refresh the workflows tracked in a folder from n8n, or adopt new ones.
 *
 * @module pull-from-n8n
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { winstonLogger as logger } from './logger-enhanced.js';
import { config, validateConfig } from './config.js';
import { SyncEngine } from './sync-engine.js';

const program = new Command();

program
  .name('pull')
  .description('Pull workflows from n8n to local files. Default: only workflows already tracked in the folder.')
  .argument('[workflows...]', 'Workflow ids or exact names to pull into the folder (in addition to tracked ones)')
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('-t, --tag <name...>', 'Also pull workflows with any of these tags')
  .option('--all', 'Pull every workflow on the instance')
  .option('-f, --force', 'Overwrite local files even if they have changes that were not pushed (a backup is kept)')
  .option('--split-code', 'Write Code node code to separate .js/.py files next to the workflow')
  .option('--json', 'Print the result as JSON')
  .option('--dry-run', 'Show what would be pulled without making changes')
  .parse(process.argv);

const options = program.opts();
const select = program.args;

const LABELS = {
  pulled: chalk.green('pulled   '),
  unchanged: chalk.gray('unchanged'),
  'dry-run': chalk.yellow('dry-run  '),
  conflict: chalk.red('CONFLICT '),
  error: chalk.red('error    '),
};

async function main() {
  try {
    validateConfig();
    logger.level = 'error'; // summary is printed below

    const syncEngine = new SyncEngine({ workflowsDir: options.directory, dryRun: options.dryRun });
    const result = await syncEngine.pullFromN8n({
      select,
      tags: options.tag || [],
      all: !!options.all,
      force: !!options.force,
      splitCode: !!options.splitCode,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.blue.bold(`\n📥 Pull from ${config.n8n.apiUrl}${config.env ? ` (${config.env})` : ''}\n`));
      for (const r of result.results) {
        if (r.action === 'unchanged') continue;
        const why = r.error || r.reason ? chalk.gray(` - ${r.error || r.reason}`) : '';
        console.log(`  ${LABELS[r.action]}  ${r.file || r.name}${r.id ? chalk.gray(` [${r.id}]`) : ''}${why}`);
      }
      const parts = [
        `${result.pulled} pulled`,
        `${result.skipped} unchanged`,
        result.conflicts && chalk.red(`${result.conflicts} conflicts`),
        result.errors && chalk.red(`${result.errors} errors`),
        result.ignored && `${result.ignored} not tracked here (left alone)`,
      ].filter(Boolean);
      console.log(chalk.gray(`\n  ${result.total} selected: `) + parts.join(chalk.gray(', ')) + '\n');
      if (result.conflicts) console.log(chalk.yellow('  Conflicts: push your local changes first, or pull --force to take the n8n version.\n'));
      if (result.total === 0) {
        console.log(chalk.yellow('  Nothing tracked in this folder yet. Pull specific flows with'));
        console.log(chalk.yellow('  `pull "<name or id>"`, by tag with `--tag <name>`, or everything with `--all`.\n'));
      }
      if (options.dryRun) console.log(chalk.yellow('⚠️  Dry run mode - no changes were made\n'));
    }

    process.exit(result.errors + result.conflicts > 0 ? 1 : 0);
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
