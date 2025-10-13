#!/usr/bin/env node

import { SyncEngine } from './sync-engine.js';
import { FileWatcher } from './watcher.js';
import { validateConfig, config } from './config.js';
import chalk from 'chalk';
import { join } from 'path';

/**
 * Main entry point for sync service
 */
class SyncService {
  constructor() {
    this.workflowsDir = join(process.cwd(), config.paths.workflowsDir);
    this.syncEngine = new SyncEngine(this.workflowsDir);
    this.watcher = null;
    this.intervalId = null;
  }

  /**
   * Start the sync service
   */
  async start() {
    console.log(chalk.bold.blue('\n🚀 n8n Workflow Sync Service\n'));
    
    try {
      // Validate configuration
      validateConfig();
      
      // Initialize sync engine
      await this.syncEngine.initialize();
      
      // Perform initial sync
      console.log(chalk.blue('📊 Performing initial sync...\n'));
      await this.syncEngine.sync();
      
      // Start file watcher if enabled
      if (config.sync.watchEnabled) {
        this.watcher = new FileWatcher(this.workflowsDir);
        await this.watcher.start();
      }
      
      // Start periodic sync if enabled
      if (config.sync.autoPull && config.sync.intervalMs > 0) {
        this._startPeriodicSync();
      }
      
      console.log(chalk.bold.green('\n✓ Sync service is running\n'));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));
      
    } catch (error) {
      console.error(chalk.red('\n✗ Failed to start sync service:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Start periodic sync from n8n
   */
  _startPeriodicSync() {
    console.log(chalk.blue(`🔄 Periodic sync enabled (every ${config.sync.intervalMs / 1000}s)\n`));
    
    this.intervalId = setInterval(async () => {
      try {
        console.log(chalk.gray(`\n⏰ Periodic sync triggered at ${new Date().toLocaleTimeString()}`));
        await this.syncEngine.pullFromN8n();
      } catch (error) {
        console.error(chalk.red('Periodic sync failed:'), error.message);
      }
    }, config.sync.intervalMs);
  }

  /**
   * Stop the sync service
   */
  async stop() {
    console.log(chalk.yellow('\n⏸️  Stopping sync service...'));
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    
    if (this.watcher) {
      await this.watcher.stop();
    }
    
    console.log(chalk.green('✓ Sync service stopped\n'));
  }
}

/**
 * CLI Commands
 */
const commands = {
  async start() {
    const service = new SyncService();
    await service.start();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      await service.stop();
      process.exit(0);
    });
  },

  async pull() {
    console.log(chalk.bold.blue('\n⬇️  Pull from n8n\n'));
    const workflowsDir = join(process.cwd(), config.paths.workflowsDir);
    const engine = new SyncEngine(workflowsDir);
    await engine.initialize();
    await engine.pullFromN8n();
    console.log(chalk.green('\n✓ Pull completed\n'));
  },

  async push() {
    console.log(chalk.bold.blue('\n⬆️  Push to n8n\n'));
    const workflowsDir = join(process.cwd(), config.paths.workflowsDir);
    const engine = new SyncEngine(workflowsDir);
    await engine.initialize();
    await engine.pushToN8n();
    console.log(chalk.green('\n✓ Push completed\n'));
  },

  async sync() {
    console.log(chalk.bold.blue('\n🔄 Full sync\n'));
    const workflowsDir = join(process.cwd(), config.paths.workflowsDir);
    const engine = new SyncEngine(workflowsDir);
    await engine.initialize();
    await engine.sync();
    console.log(chalk.green('\n✓ Sync completed\n'));
  },

  async watch() {
    console.log(chalk.bold.blue('\n👁️  Watch mode\n'));
    const workflowsDir = join(process.cwd(), config.paths.workflowsDir);
    const watcher = new FileWatcher(workflowsDir);
    await watcher.start();
    
    // Keep process alive
    process.on('SIGINT', async () => {
      await watcher.stop();
      process.exit(0);
    });
  },

  help() {
    console.log(chalk.bold('\nn8n Workflow Sync Service\n'));
    console.log('Usage: npm run <command>\n');
    console.log('Commands:');
    console.log('  start      - Start full sync service (watch + periodic pull)');
    console.log('  pull       - Pull workflows from n8n to local files');
    console.log('  push       - Push local workflows to n8n');
    console.log('  sync       - Full bidirectional sync (pull + push)');
    console.log('  watch      - Watch local files and auto-push changes');
    console.log('  help       - Show this help message\n');
  },
};

// Parse command line arguments
const command = process.argv[2] || 'start';

if (commands[command]) {
  commands[command]().catch((error) => {
    console.error(chalk.red('\n✗ Error:'), error.message);
    process.exit(1);
  });
} else {
  console.error(chalk.red(`\n✗ Unknown command: ${command}\n`));
  commands.help();
  process.exit(1);
}

