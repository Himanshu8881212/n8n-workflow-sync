#!/usr/bin/env node

/**
 * Push Workflows to n8n
 * 
 * Standalone script to push all local workflows to n8n.
 * 
 * @module push-to-n8n
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { winstonLogger as logger } from './logger-enhanced.js';
import { config, validateConfig } from './config.js';
import { SyncEngine } from './sync-engine.js';

const program = new Command();

program
  .name('push-to-n8n')
  .description('Push local workflows to n8n')
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('--dry-run', 'Show what would be pushed without making changes')
  .parse(process.argv);

const options = program.opts();

/**
 * Main function
 */
async function main() {
  try {
    console.log(chalk.blue.bold('\n📤 Push Workflows to n8n\n'));

    // Validate configuration
    validateConfig();

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
    const spinner = ora('Pushing workflows to n8n...').start();

    try {
      // Push workflows
      const result = await syncEngine.pushToN8n();

      spinner.succeed('Push completed');

      // Show results
      console.log(chalk.green('\n✅ Push Summary:'));
      console.log(chalk.gray(`  Total files: ${result.total}`));
      console.log(chalk.green(`  ✓ Created: ${result.pushed}`));
      console.log(chalk.blue(`  ↻ Updated: ${result.updated}`));
      if (result.skipped > 0) {
        console.log(chalk.yellow(`  ⊘ Skipped: ${result.skipped}`));
      }
      if (result.errors > 0) {
        console.log(chalk.red(`  ✗ Errors: ${result.errors}`));
      }

      if (options.dryRun) {
        console.log(chalk.yellow('\n⚠️  Dry run mode - no changes were made'));
      }

      console.log();
      process.exit(result.errors > 0 ? 1 : 0);
    } catch (error) {
      spinner.fail('Push failed');
      throw error;
    }
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    logger.error('Push failed', {
      context: 'PushToN8n',
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

main();

