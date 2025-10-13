#!/usr/bin/env node

/**
 * Workflow Search Command
 * 
 * Advanced search and filtering for workflows.
 * 
 * @module commands/search-workflows
 */

import chalk from 'chalk';
import { N8nClient } from '../n8n-client.js';
import { FileManager } from '../file-manager.js';
import config from '../config.js';

/**
 * Search workflows by various criteria
 */
class WorkflowSearcher {
  constructor(client, fileManager) {
    this.client = client;
    this.fileManager = fileManager;
  }

  /**
   * Search workflows
   */
  async search(criteria = {}) {
    const {
      query = null,
      tags = [],
      nodes = [],
      active = null,
      source = 'both', // 'local', 'remote', or 'both'
      caseSensitive = false,
    } = criteria;

    let workflows = [];

    // Get workflows from specified source
    if (source === 'local' || source === 'both') {
      const localWorkflows = await this._getLocalWorkflows();
      workflows.push(...localWorkflows.map((w) => ({ ...w, source: 'local' })));
    }

    if (source === 'remote' || source === 'both') {
      const remoteWorkflows = await this.client.listWorkflows();
      workflows.push(...remoteWorkflows.map((w) => ({ ...w, source: 'remote' })));
    }

    // Apply filters
    let results = workflows;

    // Filter by text query (name or description)
    if (query) {
      const searchQuery = caseSensitive ? query : query.toLowerCase();
      results = results.filter((w) => {
        const name = caseSensitive ? w.name : w.name.toLowerCase();
        const desc = w.description || '';
        const description = caseSensitive ? desc : desc.toLowerCase();
        
        return name.includes(searchQuery) || description.includes(searchQuery);
      });
    }

    // Filter by tags
    if (tags.length > 0) {
      results = results.filter((w) => {
        const workflowTags = w.tags || [];
        return tags.some((tag) => workflowTags.includes(tag));
      });
    }

    // Filter by nodes
    if (nodes.length > 0) {
      results = results.filter((w) => {
        const workflowNodes = (w.nodes || []).map((n) => n.type);
        return nodes.some((nodeType) => workflowNodes.includes(nodeType));
      });
    }

    // Filter by active status
    if (active !== null) {
      results = results.filter((w) => w.active === active);
    }

    return results;
  }

  /**
   * Get local workflows
   */
  async _getLocalWorkflows() {
    const files = await this.fileManager.getAllWorkflowFiles();
    const workflows = [];

    for (const file of files) {
      try {
        const workflow = await this.fileManager.readWorkflow(file);
        workflows.push(workflow);
      } catch (error) {
        console.error(chalk.yellow(`Warning: Could not read ${file}: ${error.message}`));
      }
    }

    return workflows;
  }

  /**
   * Get unique tags from workflows
   */
  async getAllTags() {
    const workflows = await this.search({ source: 'both' });
    const tags = new Set();

    for (const workflow of workflows) {
      if (workflow.tags) {
        workflow.tags.forEach((tag) => tags.add(tag));
      }
    }

    return Array.from(tags).sort();
  }

  /**
   * Get unique node types from workflows
   */
  async getAllNodeTypes() {
    const workflows = await this.search({ source: 'both' });
    const nodeTypes = new Set();

    for (const workflow of workflows) {
      if (workflow.nodes) {
        workflow.nodes.forEach((node) => nodeTypes.add(node.type));
      }
    }

    return Array.from(nodeTypes).sort();
  }

  /**
   * Get workflow statistics
   */
  async getStatistics() {
    const workflows = await this.search({ source: 'both' });

    const stats = {
      total: workflows.length,
      active: workflows.filter((w) => w.active).length,
      inactive: workflows.filter((w) => !w.active).length,
      local: workflows.filter((w) => w.source === 'local').length,
      remote: workflows.filter((w) => w.source === 'remote').length,
      tags: await this.getAllTags(),
      nodeTypes: await this.getAllNodeTypes(),
      avgNodesPerWorkflow: 0,
      avgConnectionsPerWorkflow: 0,
    };

    // Calculate averages
    let totalNodes = 0;
    let totalConnections = 0;

    for (const workflow of workflows) {
      totalNodes += (workflow.nodes || []).length;
      totalConnections += Object.keys(workflow.connections || {}).length;
    }

    stats.avgNodesPerWorkflow = workflows.length > 0 ? (totalNodes / workflows.length).toFixed(1) : 0;
    stats.avgConnectionsPerWorkflow = workflows.length > 0 ? (totalConnections / workflows.length).toFixed(1) : 0;

    return stats;
  }
}

/**
 * Format search results
 */
function formatResults(results, format = 'table') {
  if (format === 'json') {
    return JSON.stringify(results, null, 2);
  }

  if (results.length === 0) {
    return chalk.yellow('No workflows found matching criteria');
  }

  let output = chalk.bold.cyan(`\n📋 Found ${results.length} workflow(s):\n\n`);

  for (const workflow of results) {
    const status = workflow.active ? chalk.green('●') : chalk.gray('○');
    const source = workflow.source === 'local' ? chalk.blue('[L]') : chalk.magenta('[R]');
    const tags = workflow.tags && workflow.tags.length > 0 ? chalk.gray(` (${workflow.tags.join(', ')})`) : '';
    const nodeCount = workflow.nodes ? chalk.gray(` [${workflow.nodes.length} nodes]`) : '';

    output += `${status} ${source} ${chalk.white(workflow.name)}${tags}${nodeCount}\n`;
  }

  return output;
}

/**
 * Search workflows command
 */
export async function searchWorkflowsCommand(options = {}) {
  const {
    query = null,
    tags = [],
    nodes = [],
    active = null,
    source = 'both',
    format = 'table',
    stats = false,
    listTags = false,
    listNodes = false,
  } = options;

  try {
    const client = new N8nClient(config.n8n.apiUrl, config.n8n.apiKey);
    const fileManager = new FileManager(config.paths.workflowsDir);
    const searcher = new WorkflowSearcher(client, fileManager);

    // List tags
    if (listTags) {
      const allTags = await searcher.getAllTags();
      console.log(chalk.bold.cyan('\n🏷️  Available Tags:\n'));
      allTags.forEach((tag) => console.log(`  - ${tag}`));
      console.log();
      return;
    }

    // List node types
    if (listNodes) {
      const allNodeTypes = await searcher.getAllNodeTypes();
      console.log(chalk.bold.cyan('\n🔧 Available Node Types:\n'));
      allNodeTypes.forEach((nodeType) => console.log(`  - ${nodeType}`));
      console.log();
      return;
    }

    // Show statistics
    if (stats) {
      const statistics = await searcher.getStatistics();
      console.log(chalk.bold.cyan('\n📊 Workflow Statistics:\n'));
      console.log(chalk.white(`  Total workflows: ${statistics.total}`));
      console.log(chalk.green(`  Active: ${statistics.active}`));
      console.log(chalk.gray(`  Inactive: ${statistics.inactive}`));
      console.log(chalk.blue(`  Local: ${statistics.local}`));
      console.log(chalk.magenta(`  Remote: ${statistics.remote}`));
      console.log(chalk.white(`  Unique tags: ${statistics.tags.length}`));
      console.log(chalk.white(`  Unique node types: ${statistics.nodeTypes.length}`));
      console.log(chalk.white(`  Avg nodes/workflow: ${statistics.avgNodesPerWorkflow}`));
      console.log(chalk.white(`  Avg connections/workflow: ${statistics.avgConnectionsPerWorkflow}\n`));
      return;
    }

    // Perform search
    const results = await searcher.search({
      query,
      tags,
      nodes,
      active,
      source,
    });

    // Format and display results
    const output = formatResults(results, format);
    console.log(output);
  } catch (error) {
    console.error(chalk.red('\n❌ Error searching workflows:'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  const options = {
    query: args.find((a) => !a.startsWith('--')) || null,
    tags: args.filter((a) => a.startsWith('--tag=')).map((a) => a.replace('--tag=', '')),
    nodes: args.filter((a) => a.startsWith('--node=')).map((a) => a.replace('--node=', '')),
    active: args.includes('--active') ? true : args.includes('--inactive') ? false : null,
    source: args.includes('--local') ? 'local' : args.includes('--remote') ? 'remote' : 'both',
    format: args.includes('--json') ? 'json' : 'table',
    stats: args.includes('--stats'),
    listTags: args.includes('--list-tags'),
    listNodes: args.includes('--list-nodes'),
  };

  searchWorkflowsCommand(options);
}

