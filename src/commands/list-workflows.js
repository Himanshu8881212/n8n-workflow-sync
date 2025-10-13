#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { N8nClient } from '../n8n-client.js';
import { config, validateConfig } from '../config.js';
import yaml from 'js-yaml';

const program = new Command();

program
  .name('list-workflows')
  .description('List all workflows from n8n instance')
  .option('-o, --output <format>', 'Output format: table, json, yaml', 'table')
  .option('-a, --active-only', 'Show only active workflows')
  .option('-i, --inactive-only', 'Show only inactive workflows')
  .option('--sort <field>', 'Sort by field: name, id, active, updated', 'name')
  .parse(process.argv);

const options = program.opts();

/**
 * Format workflows as table
 */
function formatTable(workflows) {
  console.log(chalk.bold('\nWorkflows:\n'));

  // Header
  const header = `${chalk.bold('ID').padEnd(25)} ${chalk.bold('NAME').padEnd(40)} ${chalk.bold('ACTIVE').padEnd(10)} ${chalk.bold('UPDATED')}`;
  console.log(header);
  console.log('─'.repeat(100));

  // Rows
  workflows.forEach((workflow) => {
    const id = workflow.id.padEnd(25);
    const name = workflow.name.substring(0, 38).padEnd(40);
    const active = workflow.active
      ? chalk.green('Yes').padEnd(10)
      : chalk.gray('No').padEnd(10);
    const updated = workflow.updatedAt
      ? new Date(workflow.updatedAt).toLocaleDateString()
      : 'N/A';

    console.log(`${id} ${name} ${active} ${updated}`);
  });

  console.log(`\n${chalk.bold('Total:')} ${workflows.length} workflows\n`);
}

/**
 * Format workflows as JSON
 */
function formatJson(workflows) {
  console.log(JSON.stringify(workflows, null, 2));
}

/**
 * Format workflows as YAML
 */
function formatYaml(workflows) {
  console.log(yaml.dump(workflows));
}

/**
 * Sort workflows
 */
function sortWorkflows(workflows, sortField) {
  return workflows.sort((a, b) => {
    switch (sortField) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'id':
      return a.id.localeCompare(b.id);
    case 'active':
      return (b.active ? 1 : 0) - (a.active ? 1 : 0);
    case 'updated':
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    default:
      return 0;
    }
  });
}

/**
 * Main function
 */
async function main() {
  try {
    // Validate configuration
    validateConfig();

    console.log(chalk.blue('📋 Fetching workflows from n8n...\n'));

    // Create client
    const client = new N8nClient();

    // Fetch workflows
    const workflows = await client.listWorkflows();

    if (!workflows || workflows.length === 0) {
      console.log(chalk.yellow('No workflows found'));
      return;
    }

    // Filter workflows
    let filtered = workflows;
    if (options.activeOnly) {
      filtered = workflows.filter((w) => w.active);
    } else if (options.inactiveOnly) {
      filtered = workflows.filter((w) => !w.active);
    }

    // Sort workflows
    const sorted = sortWorkflows(filtered, options.sort);

    // Format output
    switch (options.output.toLowerCase()) {
    case 'json':
      formatJson(sorted);
      break;
    case 'yaml':
      formatYaml(sorted);
      break;
    case 'table':
    default:
      formatTable(sorted);
      break;
    }
  } catch (error) {
    console.error(chalk.red(`✗ Error: ${error.message}`));
    process.exit(1);
  }
}

main();

