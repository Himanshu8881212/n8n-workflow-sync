#!/usr/bin/env node

/**
 * Workflow Diff Command
 * 
 * Shows differences between local and remote workflows.
 * 
 * @module commands/diff-workflows
 */

import chalk from 'chalk';
import { N8nClient } from '../n8n-client.js';
import { FileManager } from '../file-manager.js';
import { config } from '../config.js';

/**
 * Calculate diff between two workflow objects
 */
function calculateDiff(local, remote) {
  const diff = {
    changed: false,
    fields: {},
  };

  // Compare basic fields
  const fieldsToCompare = ['name', 'active', 'tags', 'settings'];

  for (const field of fieldsToCompare) {
    const localValue = JSON.stringify(local[field]);
    const remoteValue = JSON.stringify(remote[field]);

    if (localValue !== remoteValue) {
      diff.changed = true;
      diff.fields[field] = {
        local: local[field],
        remote: remote[field],
      };
    }
  }

  // Compare nodes
  const localNodes = JSON.stringify(local.nodes || []);
  const remoteNodes = JSON.stringify(remote.nodes || []);

  if (localNodes !== remoteNodes) {
    diff.changed = true;
    diff.fields.nodes = {
      local: (local.nodes || []).length,
      remote: (remote.nodes || []).length,
      localNodes: local.nodes || [],
      remoteNodes: remote.nodes || [],
    };
  }

  // Compare connections
  const localConnections = JSON.stringify(local.connections || {});
  const remoteConnections = JSON.stringify(remote.connections || {});

  if (localConnections !== remoteConnections) {
    diff.changed = true;
    diff.fields.connections = {
      local: Object.keys(local.connections || {}).length,
      remote: Object.keys(remote.connections || {}).length,
    };
  }

  // Compare timestamps
  if (local.updatedAt && remote.updatedAt) {
    const localTime = new Date(local.updatedAt).getTime();
    const remoteTime = new Date(remote.updatedAt).getTime();

    diff.newerVersion = localTime > remoteTime ? 'local' : 'remote';
    diff.timeDiff = Math.abs(localTime - remoteTime);
  }

  return diff;
}

/**
 * Format diff output
 */
function formatDiff(workflowName, diff, format = 'pretty') {
  if (format === 'json') {
    return JSON.stringify({ workflow: workflowName, diff }, null, 2);
  }

  if (!diff.changed) {
    return chalk.green(`✓ ${workflowName}: No differences`);
  }

  let output = chalk.yellow(`⚠ ${workflowName}: Differences found\n`);

  // Show which version is newer
  if (diff.newerVersion) {
    const timeAgo = Math.floor(diff.timeDiff / 1000 / 60); // minutes
    output += chalk.gray(`  Newer version: ${diff.newerVersion} (${timeAgo}m ago)\n`);
  }

  // Show field differences
  for (const [field, values] of Object.entries(diff.fields)) {
    output += chalk.cyan(`\n  ${field}:\n`);

    if (field === 'nodes') {
      output += chalk.red(`    - Local: ${values.local} nodes\n`);
      output += chalk.green(`    + Remote: ${values.remote} nodes\n`);

      // Show added/removed nodes
      const localNodeIds = new Set(values.localNodes.map((n) => n.id));
      const remoteNodeIds = new Set(values.remoteNodes.map((n) => n.id));

      const added = values.remoteNodes.filter((n) => !localNodeIds.has(n.id));
      const removed = values.localNodes.filter((n) => !remoteNodeIds.has(n.id));

      if (added.length > 0) {
        output += chalk.green(`    + Added nodes: ${added.map((n) => n.name).join(', ')}\n`);
      }
      if (removed.length > 0) {
        output += chalk.red(`    - Removed nodes: ${removed.map((n) => n.name).join(', ')}\n`);
      }
    } else if (field === 'connections') {
      output += chalk.red(`    - Local: ${values.local} connections\n`);
      output += chalk.green(`    + Remote: ${values.remote} connections\n`);
    } else {
      output += chalk.red(`    - Local: ${JSON.stringify(values.local)}\n`);
      output += chalk.green(`    + Remote: ${JSON.stringify(values.remote)}\n`);
    }
  }

  return output;
}

/**
 * Diff workflows command
 */
export async function diffWorkflowsCommand(options = {}) {
  const {
    workflowName = null,
    format = 'pretty',
    showUnchanged = false,
  } = options;

  console.log(chalk.bold.cyan('\n🔍 Comparing Local and Remote Workflows\n'));

  try {
    // Initialize clients
    const client = new N8nClient(config.n8n.apiUrl, config.n8n.apiKey);
    const fileManager = new FileManager(config.paths.workflowsDir);

    // Get local workflows
    const localFiles = await fileManager.getAllWorkflowFiles();
    console.log(chalk.gray(`Found ${localFiles.length} local workflows\n`));

    // Get remote workflows
    const remoteWorkflows = await client.listWorkflows();
    console.log(chalk.gray(`Found ${remoteWorkflows.length} remote workflows\n`));

    // Create maps for easy lookup
    const localMap = new Map();
    for (const file of localFiles) {
      const workflow = await fileManager.readWorkflow(file);
      localMap.set(workflow.name, { file, workflow });
    }

    const remoteMap = new Map();
    for (const workflow of remoteWorkflows) {
      remoteMap.set(workflow.name, workflow);
    }

    // Compare workflows
    const results = [];
    let changedCount = 0;
    let unchangedCount = 0;
    let localOnlyCount = 0;
    let remoteOnlyCount = 0;

    // Check local workflows
    for (const [name, { workflow: local }] of localMap) {
      if (workflowName && name !== workflowName) continue;

      const remote = remoteMap.get(name);

      if (!remote) {
        localOnlyCount++;
        results.push({
          name,
          status: 'local-only',
          message: chalk.blue(`ℹ ${name}: Only exists locally`),
        });
        continue;
      }

      const diff = calculateDiff(local, remote);

      if (diff.changed) {
        changedCount++;
        results.push({
          name,
          status: 'changed',
          message: formatDiff(name, diff, format),
        });
      } else {
        unchangedCount++;
        if (showUnchanged) {
          results.push({
            name,
            status: 'unchanged',
            message: chalk.green(`✓ ${name}: No differences`),
          });
        }
      }
    }

    // Check for remote-only workflows
    for (const [name, remote] of remoteMap) {
      if (workflowName && name !== workflowName) continue;

      if (!localMap.has(name)) {
        remoteOnlyCount++;
        results.push({
          name,
          status: 'remote-only',
          message: chalk.magenta(`ℹ ${name}: Only exists remotely`),
        });
      }
    }

    // Print results
    if (format === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const result of results) {
        console.log(result.message);
      }

      // Print summary
      console.log(chalk.bold.cyan('\n📊 Summary:\n'));
      console.log(chalk.yellow(`  Changed: ${changedCount}`));
      console.log(chalk.green(`  Unchanged: ${unchangedCount}`));
      console.log(chalk.blue(`  Local only: ${localOnlyCount}`));
      console.log(chalk.magenta(`  Remote only: ${remoteOnlyCount}`));
      console.log(chalk.gray(`  Total: ${results.length}\n`));
    }

    // Exit code based on changes
    if (changedCount > 0 || localOnlyCount > 0 || remoteOnlyCount > 0) {
      process.exit(1); // Differences found
    } else {
      process.exit(0); // No differences
    }
  } catch (error) {
    console.error(chalk.red('\n❌ Error comparing workflows:'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = {
    workflowName: args[0] || null,
    format: args.includes('--json') ? 'json' : 'pretty',
    showUnchanged: args.includes('--all'),
  };

  diffWorkflowsCommand(options);
}

