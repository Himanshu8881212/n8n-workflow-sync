import { N8nClient } from './n8n-client.js';
import { FileManager } from './file-manager.js';
import { SyncState } from './sync-state.js';
import { config } from './config.js';
import chalk from 'chalk';

/**
 * Sync Engine - Handles bidirectional synchronization
 */
export class SyncEngine {
  constructor(workflowsDir) {
    this.n8nClient = new N8nClient();
    this.fileManager = new FileManager(workflowsDir);
    this.syncState = new SyncState();
    this.isRunning = false;
  }

  /**
   * Initialize sync engine
   */
  async initialize() {
    console.log(chalk.blue('🔧 Initializing sync engine...'));

    // Load sync state
    await this.syncState.load();

    // Check n8n health
    const health = await this.n8nClient.healthCheck();
    if (!health.healthy) {
      throw new Error(`n8n is not healthy: ${health.error}`);
    }

    console.log(chalk.green('✓ Sync engine initialized'));
  }

  /**
   * Pull workflows from n8n to local files
   */
  async pullFromN8n() {
    console.log(chalk.blue('⬇️  Pulling workflows from n8n...'));

    const remoteWorkflows = await this.n8nClient.listWorkflows();
    const stats = { updated: 0, created: 0, skipped: 0, errors: 0 };

    for (const remoteWorkflow of remoteWorkflows) {
      try {
        // Get full workflow details
        const fullWorkflow = await this.n8nClient.getWorkflow(remoteWorkflow.id);

        // Find the file path from sync state (by workflow ID)
        const existingState = this.syncState.getWorkflowById(fullWorkflow.id);

        let filePath;
        let relativePath;

        if (existingState && existingState.filePath) {
          // Use the path from sync state
          relativePath = existingState.filePath;
          filePath = this.fileManager.getAbsolutePath(relativePath);
        } else {
          // New workflow, derive path from name (fallback)
          filePath = this.fileManager.getWorkflowPath(fullWorkflow);
          relativePath = this.fileManager.getRelativePath(filePath);
        }

        // Check if local file exists and compare
        const localState = this.syncState.getWorkflowByPath(relativePath);
        const shouldUpdate = await this._shouldPullWorkflow(fullWorkflow, filePath, localState);

        if (shouldUpdate) {
          // Write to file
          const hash = await this.fileManager.writeWorkflow(filePath, fullWorkflow);

          // Update state with file path as key
          await this.syncState.updateWorkflowByPath(relativePath, {
            id: fullWorkflow.id,
            name: fullWorkflow.name,
            hash,
            remoteUpdatedAt: fullWorkflow.updatedAt,
          });

          const action = localState ? 'updated' : 'created';
          stats[action]++;
          console.log(chalk.green(`  ✓ ${action}: ${fullWorkflow.name}`));
        } else {
          stats.skipped++;
        }
      } catch (error) {
        stats.errors++;
        console.error(chalk.red(`  ✗ Error syncing ${remoteWorkflow.name}: ${error.message}`));
      }
    }

    await this.syncState.updateLastSync();
    this._printStats('Pull', stats);
    return stats;
  }

  /**
   * Push workflows from local files to n8n
   */
  async pushToN8n() {
    console.log(chalk.blue('⬆️  Pushing workflows to n8n...'));

    const localFiles = await this.fileManager.getAllWorkflowFiles();
    const stats = { updated: 0, created: 0, skipped: 0, errors: 0 };

    // Get all remote workflows once for name-based matching
    const remoteWorkflows = await this.n8nClient.listWorkflows();
    const remoteByName = new Map(remoteWorkflows.map(w => [w.name, w]));

    for (const filePath of localFiles) {
      try {
        const workflow = await this.fileManager.readWorkflow(filePath);
        const relativePath = this.fileManager.getRelativePath(filePath);

        // Find workflow ID by checking:
        // 1. Sync state by file path
        // 2. Remote workflow by name
        const stateByPath = this.syncState.getWorkflowByPath(relativePath);
        const remoteByNameMatch = remoteByName.get(workflow.name);

        // Determine the workflow ID to use
        let workflowId = null;
        if (stateByPath && stateByPath.id) {
          // Verify the ID still exists in n8n
          try {
            await this.n8nClient.getWorkflow(stateByPath.id);
            workflowId = stateByPath.id;
          } catch (error) {
            // ID doesn't exist, try name match
            if (remoteByNameMatch) {
              workflowId = remoteByNameMatch.id;
            }
          }
        } else if (remoteByNameMatch) {
          // No state, but found by name
          workflowId = remoteByNameMatch.id;
        }

        // Check if workflow needs to be pushed
        const shouldPush = await this._shouldPushWorkflow(workflow, stateByPath);

        if (shouldPush) {
          let result;
          if (workflowId) {
            // Update existing workflow
            result = await this.n8nClient.updateWorkflow(workflowId, workflow);
            stats.updated++;
            console.log(chalk.green(`  ✓ Updated: ${workflow.name}`));
          } else {
            // Create new workflow
            result = await this.n8nClient.createWorkflow(workflow);
            stats.created++;
            console.log(chalk.green(`  ✓ Created: ${workflow.name}`));
          }

          // Update state with file path as key
          await this.syncState.updateWorkflowByPath(relativePath, {
            id: result.id,
            name: result.name,
            hash: workflow._metadata.hash,
            remoteUpdatedAt: result.updatedAt,
          });
        } else {
          stats.skipped++;
        }
      } catch (error) {
        stats.errors++;
        console.error(chalk.red(`  ✗ Error pushing ${filePath}: ${error.message}`));
      }
    }

    await this.syncState.updateLastSync();
    this._printStats('Push', stats);
    return stats;
  }

  /**
   * Full bidirectional sync
   */
  async sync() {
    console.log(chalk.bold.blue('\n🔄 Starting full sync...\n'));

    // Pull first to get latest from n8n
    const pullStats = await this.pullFromN8n();

    // Then push local changes
    const pushStats = await this.pushToN8n();

    console.log(chalk.bold.green('\n✓ Sync completed\n'));

    return { pull: pullStats, push: pushStats };
  }

  /**
   * Determine if workflow should be pulled from n8n
   */
  async _shouldPullWorkflow(remoteWorkflow, filePath, localState) {
    // If no local state, always pull
    if (!localState) return true;

    // Check conflict resolution strategy
    switch (config.conflict.strategy) {
      case 'remote_wins':
        return true;

      case 'local_wins':
        return false;

      case 'newest_wins':
        const remoteDate = new Date(remoteWorkflow.updatedAt);
        const localDate = new Date(localState.remoteUpdatedAt || 0);
        return remoteDate > localDate;

      default:
        return true;
    }
  }

  /**
   * Determine if workflow should be pushed to n8n
   */
  async _shouldPushWorkflow(workflow, localState) {
    // If no local state, always push
    if (!localState) return true;

    // Check if file has changed
    const hasChanged = localState.hash !== workflow._metadata.hash;
    if (!hasChanged) return false;

    // Check conflict resolution strategy
    switch (config.conflict.strategy) {
      case 'local_wins':
        return true;

      case 'remote_wins':
        return false;

      case 'newest_wins':
        const localDate = workflow._metadata.lastModified;
        const remoteDate = new Date(localState.remoteUpdatedAt || 0);
        return localDate > remoteDate;

      default:
        return true;
    }
  }

  /**
   * Print sync statistics
   */
  _printStats(operation, stats) {
    console.log(chalk.bold(`\n${operation} Summary:`));
    console.log(chalk.green(`  ✓ Created: ${stats.created}`));
    console.log(chalk.blue(`  ↻ Updated: ${stats.updated}`));
    console.log(chalk.gray(`  ⊘ Skipped: ${stats.skipped}`));
    if (stats.errors > 0) {
      console.log(chalk.red(`  ✗ Errors: ${stats.errors}`));
    }
  }
}

