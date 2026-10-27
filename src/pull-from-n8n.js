#!/usr/bin/env node

/**
 * Pull Workflows from n8n
 * 
 * Standalone script to pull all workflows from n8n to local files.
 * 
 * @module pull-from-n8n
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { winstonLogger as logger } from './logger-enhanced.js';
import { config, validateConfig } from './config.js';
import { SyncEngine } from './sync-engine.js';

const program = new Command();

program
  .name('pull-from-n8n')
  .description('Pull workflows from n8n to local files. Default: only workflows already tracked in the folder.')
  .argument('[workflows...]', 'Workflow ids or exact names to pull into the folder (in addition to tracked ones)')
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('-t, --tag <name...>', 'Also pull workflows with any of these tags')
  .option('--all', 'Pull every workflow on the instance')
  .option('--dry-run', 'Show what would be pulled without making changes')
  .parse(process.argv);

const options = program.opts();
const select = program.args;

/**
 * Main function
 */
async function main() {
  try {
    console.log(chalk.blue.bold('\n📥 Pull Workflows from n8n\n'));

    // Validate configuration
    validateConfig();
    logger.level = 'error'; // summary is printed below

    // Create sync engine
    const syncEngine = new SyncEngine({
      workflowsDir: options.directory,
      dryRun: options.dryRun,
    });

    // Show configuration
    console.log(chalk.gray('Configuration:'));
    console.log(chalk.gray(`  API URL: ${config.n8n.apiUrl}`));
    console.log(chalk.gray(`  Workflows Directory: ${options.directory}`));
    console.log(chalk.gray(`  Dry Run: ${options.dryRun ? 'Yes' : 'No'}\n`));

    // Start spinner
    const spinner = ora('Pulling workflows from n8n...').start();

    try {
      // Pull workflows
      const result = await syncEngine.pullFromN8n({ select, tags: options.tag || [], all: !!options.all });

      spinner.succeed('Pull completed');

      // Show results
      console.log(chalk.green('\n✅ Pull Summary:'));
      console.log(chalk.gray(`  Selected: ${result.total}`));
      console.log(chalk.green(`  ✓ Pulled: ${result.pulled}`));
      if (result.skipped > 0) {
        console.log(chalk.yellow(`  ⊘ Skipped: ${result.skipped}`));
      }
      if (result.errors > 0) {
        console.log(chalk.red(`  ✗ Errors: ${result.errors}`));
      }
      if (result.notFound.length > 0) {
        console.log(chalk.red(`  ✗ Not found in n8n: ${result.notFound.join(', ')}`));
      }
      if (result.ignored > 0) {
        console.log(chalk.gray(`  · Not tracked here (left alone): ${result.ignored}`));
      }
      if (result.total === 0) {
        console.log(chalk.yellow('\n  Nothing tracked in this folder yet. Pull specific flows with'));
        console.log(chalk.yellow('  `pull-from-n8n "<name or id>"`, by tag with `--tag <name>`, or everything with `--all`.'));
      }

      if (options.dryRun) {
        console.log(chalk.yellow('\n⚠️  Dry run mode - no changes were made'));
      }

      console.log();
      process.exit(result.errors > 0 ? 1 : 0);
    } catch (error) {
      spinner.fail('Pull failed');
      throw error;
    }
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    logger.error('Pull failed', {
      context: 'PullFromN8n',
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

main();

