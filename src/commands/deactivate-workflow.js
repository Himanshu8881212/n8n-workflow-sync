#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { N8nClient } from '../n8n-client.js';
import { validateConfig } from '../config.js';

const program = new Command();

program
  .name('deactivate-workflow')
  .description('Deactivate a workflow by ID or name')
  .argument('<identifier>', 'Workflow ID or name')
  .option('--dry-run', 'Show what would be deactivated without making changes')
  .parse(process.argv);

const identifier = program.args[0];
const options = program.opts();

/**
 * Find workflow by ID or name
 */
async function findWorkflow(client, identifier) {
  // Try to get by ID first
  try {
    const workflow = await client.getWorkflow(identifier);
    if (workflow) {
      return workflow;
    }
  } catch (error) {
    // Not found by ID, try by name
  }

  // Search by name
  const workflows = await client.listWorkflows();
  const found = workflows.find(
    (w) => w.name.toLowerCase() === identifier.toLowerCase(),
  );

  if (!found) {
    throw new Error(`Workflow not found: ${identifier}`);
  }

  return found;
}

/**
 * Main function
 */
async function main() {
  try {
    // Validate configuration
    validateConfig();

    console.log(chalk.blue(`🔍 Finding workflow: ${identifier}\n`));

    // Create client
    const client = new N8nClient();

    // Find workflow
    const workflow = await findWorkflow(client, identifier);

    console.log(chalk.gray(`Found: ${workflow.name} (${workflow.id})`));

    // Check if already inactive
    if (!workflow.active) {
      console.log(chalk.yellow(`⚠️  Workflow is already inactive`));
      return;
    }

    // Dry run mode
    if (options.dryRun) {
      console.log(chalk.blue(`\n[DRY RUN] Would deactivate workflow: ${workflow.name}`));
      return;
    }

    // Deactivate workflow
    console.log(chalk.blue(`\n⏸️  Deactivating workflow...`));
    await client.deactivateWorkflow(workflow.id);

    console.log(chalk.green(`✓ Workflow deactivated successfully`));
    console.log(chalk.gray(`  Name: ${workflow.name}`));
    console.log(chalk.gray(`  ID: ${workflow.id}`));
  } catch (error) {
    console.error(chalk.red(`✗ Error: ${error.message}`));
    process.exit(1);
  }
}

main();

