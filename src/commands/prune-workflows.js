#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readdir } from 'fs/promises';
import { join, basename } from 'path';
import { N8nClient } from '../n8n-client.js';
import { config, validateConfig } from '../config.js';
import { FileManager } from '../file-manager.js';

const program = new Command();

program
  .name('prune-workflows')
  .description('Remove workflows from n8n that are not present in local directory')
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('--dry-run', 'Show what would be deleted without making changes')
  .option('-y, --yes', 'Skip confirmation prompt')
  .parse(process.argv);

const options = program.opts();

/**
 * Get local workflow IDs
 */
async function getLocalWorkflowIds(directory) {
  const fileManager = new FileManager(directory);
  const files = await readdir(directory, { recursive: true });

  const workflowIds = new Set();

  for (const file of files) {
    if (file.endsWith('.json') || file.endsWith('.yaml') || file.endsWith('.yml')) {
      try {
        const filePath = join(directory, file);
        const workflow = await fileManager.readWorkflow(filePath);
        if (workflow.id) {
          workflowIds.add(workflow.id);
        }
      } catch (error) {
        // Skip invalid files
      }
    }
  }

  return workflowIds;
}

/**
 * Confirm deletion
 */
async function confirmDeletion(workflows) {
  if (options.yes) {
    return true;
  }

  console.log(chalk.yellow('\n⚠️  The following workflows will be DELETED from n8n:\n'));

  workflows.forEach((workflow) => {
    console.log(chalk.red(`  - ${workflow.name} (${workflow.id})`));
  });

  console.log(chalk.yellow('\nThis action cannot be undone!'));

  // In a real implementation, we'd use a prompt library like inquirer
  // For now, we'll just proceed if --yes flag is set
  return false;
}

/**
 * Main function
 */
async function main() {
  try {
    // Validate configuration
    validateConfig();

    const workflowsDir = join(process.cwd(), options.directory);

    console.log(chalk.blue('🔍 Analyzing workflows...\n'));
    console.log(chalk.gray(`Local directory: ${workflowsDir}`));

    // Create client
    const client = new N8nClient();

    // Get local workflow IDs
    console.log(chalk.blue('\n📁 Scanning local workflows...'));
    const localIds = await getLocalWorkflowIds(workflowsDir);
    console.log(chalk.gray(`Found ${localIds.size} local workflows`));

    // Get remote workflows
    console.log(chalk.blue('\n☁️  Fetching remote workflows...'));
    const remoteWorkflows = await client.listWorkflows();
    console.log(chalk.gray(`Found ${remoteWorkflows.length} remote workflows`));

    // Find workflows to prune
    const toPrune = remoteWorkflows.filter((w) => !localIds.has(w.id));

    if (toPrune.length === 0) {
      console.log(chalk.green('\n✓ No workflows to prune'));
      return;
    }

    console.log(chalk.yellow(`\n⚠️  Found ${toPrune.length} workflow(s) to prune`));

    // Dry run mode
    if (options.dryRun) {
      console.log(chalk.blue('\n[DRY RUN] Would delete the following workflows:\n'));
      toPrune.forEach((workflow) => {
        console.log(chalk.gray(`  - ${workflow.name} (${workflow.id})`));
      });
      return;
    }

    // Confirm deletion
    const confirmed = await confirmDeletion(toPrune);
    if (!confirmed && !options.yes) {
      console.log(chalk.yellow('\n⚠️  Deletion cancelled. Use --yes flag to skip confirmation.'));
      return;
    }

    // Delete workflows
    console.log(chalk.blue('\n🗑️  Deleting workflows...\n'));

    let deleted = 0;
    let failed = 0;

    for (const workflow of toPrune) {
      try {
        await client.deleteWorkflow(workflow.id);
        console.log(chalk.green(`✓ Deleted: ${workflow.name}`));
        deleted++;
      } catch (error) {
        console.log(chalk.red(`✗ Failed: ${workflow.name} - ${error.message}`));
        failed++;
      }
    }

    console.log(chalk.bold(`\n📊 Summary:`));
    console.log(chalk.green(`  ✓ Deleted: ${deleted}`));
    if (failed > 0) {
      console.log(chalk.red(`  ✗ Failed: ${failed}`));
    }
  } catch (error) {
    console.error(chalk.red(`✗ Error: ${error.message}`));
    process.exit(1);
  }
}

main();

