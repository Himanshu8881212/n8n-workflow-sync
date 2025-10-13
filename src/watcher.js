import chokidar from 'chokidar';
import { SyncEngine } from './sync-engine.js';
import { config } from './config.js';
import chalk from 'chalk';
import { join } from 'path';

/**
 * File Watcher - Monitors local files for changes
 */
export class FileWatcher {
  constructor(workflowsDir) {
    this.workflowsDir = workflowsDir;
    this.syncEngine = new SyncEngine(workflowsDir);
    this.watcher = null;
    this.debounceTimers = new Map();
  }

  /**
   * Start watching for file changes
   */
  async start() {
    console.log(chalk.blue('👁️  Starting file watcher...'));

    await this.syncEngine.initialize();

    // Configure watcher
    this.watcher = chokidar.watch(this.workflowsDir, {
      ignored: config.filters.ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    // Set up event handlers
    this.watcher
      .on('add', (path) => this._handleFileChange('added', path))
      .on('change', (path) => this._handleFileChange('changed', path))
      .on('unlink', (path) => this._handleFileChange('deleted', path))
      .on('error', (error) => console.error(chalk.red(`Watcher error: ${error}`)));

    console.log(chalk.green(`✓ Watching: ${this.workflowsDir}`));
    console.log(chalk.gray(`  Debounce: ${config.sync.debounceMs}ms`));
    console.log(chalk.gray(`  Auto-push: ${config.sync.autoPush ? 'enabled' : 'disabled'}\n`));
  }

  /**
   * Stop watching
   */
  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      console.log(chalk.yellow('⏸️  File watcher stopped'));
    }
  }

  /**
   * Handle file change events with debouncing
   */
  _handleFileChange(event, filePath) {
    // Only process JSON files
    if (!filePath.endsWith('.json')) return;

    console.log(chalk.cyan(`  📝 File ${event}: ${filePath}`));

    // Clear existing timer for this file
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath));
    }

    // Set new debounced timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);

      if (config.sync.autoPush) {
        try {
          await this._syncFile(filePath, event);
        } catch (error) {
          console.error(chalk.red(`  ✗ Sync failed: ${error.message}`));
        }
      }
    }, config.sync.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Sync individual file
   */
  async _syncFile(filePath, event) {
    if (event === 'deleted') {
      // Handle deletion
      console.log(chalk.yellow(`  ⚠️  File deleted, skipping sync: ${filePath}`));
      return;
    }

    // Push this specific file to n8n
    console.log(chalk.blue(`  ⬆️  Syncing to n8n...`));

    try {
      const workflow = await this.syncEngine.fileManager.readWorkflow(filePath);
      const relativePath = this.syncEngine.fileManager.getRelativePath(filePath);

      // Find workflow ID by checking:
      // 1. Sync state by file path
      // 2. Remote workflow by name
      const stateByPath = this.syncEngine.syncState.getWorkflowByPath(relativePath);

      let workflowId = null;
      if (stateByPath && stateByPath.id) {
        // Verify the ID still exists in n8n
        try {
          await this.syncEngine.n8nClient.getWorkflow(stateByPath.id);
          workflowId = stateByPath.id;
        } catch (error) {
          // ID doesn't exist, try name match
          const remoteWorkflows = await this.syncEngine.n8nClient.listWorkflows();
          const remoteByNameMatch = remoteWorkflows.find(w => w.name === workflow.name);
          if (remoteByNameMatch) {
            workflowId = remoteByNameMatch.id;
          }
        }
      } else {
        // No state, try name match
        const remoteWorkflows = await this.syncEngine.n8nClient.listWorkflows();
        const remoteByNameMatch = remoteWorkflows.find(w => w.name === workflow.name);
        if (remoteByNameMatch) {
          workflowId = remoteByNameMatch.id;
        }
      }

      let result;
      if (workflowId) {
        // Update existing workflow
        result = await this.syncEngine.n8nClient.updateWorkflow(workflowId, workflow);
        console.log(chalk.green(`  ✓ Updated in n8n: ${workflow.name}`));
      } else {
        // Create new workflow
        result = await this.syncEngine.n8nClient.createWorkflow(workflow);
        console.log(chalk.green(`  ✓ Created in n8n: ${result.name} (ID: ${result.id})`));
      }

      // Update sync state with file path as key
      await this.syncEngine.syncState.updateWorkflowByPath(relativePath, {
        id: result.id,
        name: result.name,
        hash: workflow._metadata.hash,
        remoteUpdatedAt: result.updatedAt,
      });
    } catch (error) {
      console.error(chalk.red(`  ✗ Failed to sync: ${error.message}`));
    }
  }
}

/**
 * Start watcher if run directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const workflowsDir = join(process.cwd(), config.paths.workflowsDir);
  const watcher = new FileWatcher(workflowsDir);

  watcher.start().catch((error) => {
    console.error(chalk.red('Failed to start watcher:', error));
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\nShutting down...'));
    await watcher.stop();
    process.exit(0);
  });
}

