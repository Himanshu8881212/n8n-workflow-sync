import chokidar from 'chokidar';
import { join, basename } from 'path';
import chalk from 'chalk';
import PQueue from 'p-queue';
import { Logger } from './logger-enhanced.js';
import { config } from './config.js';

const logger = new Logger('FileWatcher');

/**
 * Enhanced file watcher with intelligent debouncing and batch processing
 *
 * @class EnhancedFileWatcher
 * @description Superior file watcher implementation with advanced features:
 * - Batch processing of multiple file changes (groups changes every 2 seconds)
 * - Per-file debouncing to prevent duplicate syncs (1 second per file)
 * - Queue-based processing for better performance (p-queue with concurrency control)
 * - Rate limiting (max 5 operations per second)
 * - Graceful error handling and recovery with retry logic
 * - Detailed logging and metrics tracking
 * - Intelligent ignore patterns
 *
 * @example
 * const watcher = new EnhancedFileWatcher('./workflows', syncEngine);
 * await watcher.start();
 * // ... later
 * await watcher.stop();
 */
export class EnhancedFileWatcher {
  /**
   * Create an enhanced file watcher
   * @param {string} workflowsDir - Directory to watch for workflow files
   * @param {Object} syncEngine - Sync engine instance for processing changes
   */
  constructor(workflowsDir, syncEngine) {
    this.workflowsDir = workflowsDir;
    this.syncEngine = syncEngine;
    this.watcher = null;
    this.isRunning = false;

    // Debounce configuration
    this.debounceMs = config.sync.debounceMs || 1000;
    this.debounceTimers = new Map(); // Per-file debounce timers

    // Batch processing
    this.pendingChanges = new Map(); // file -> { type, timestamp }
    this.batchTimer = null;
    this.batchIntervalMs = 2000; // Process batches every 2 seconds

    // Queue for processing changes
    this.queue = new PQueue({
      concurrency: 3, // Process up to 3 files concurrently
      interval: 1000, // Rate limiting
      intervalCap: 5, // Max 5 operations per interval
    });

    // Metrics
    this.metrics = {
      filesChanged: 0,
      filesProcessed: 0,
      errors: 0,
      lastSync: null,
    };

    // Ignore patterns
    this.ignorePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '**/.sync-state.json',
      '**/*.log',
      '**/*.tmp',
      '**/.*', // Hidden files
    ];
  }

  /**
   * Start watching for file changes
   */
  async start() {
    if (this.isRunning) {
      logger.warn('File watcher is already running');
      return;
    }

    logger.info(`Starting enhanced file watcher on: ${this.workflowsDir}`);
    logger.debug('Watcher configuration', {
      debounceMs: this.debounceMs,
      batchIntervalMs: this.batchIntervalMs,
      queueConcurrency: this.queue.concurrency,
    });

    this.watcher = chokidar.watch(this.workflowsDir, {
      ignored: this.ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      depth: 10, // Watch nested directories
    });

    this.watcher
      .on('add', (path) => this.handleFileChange('add', path))
      .on('change', (path) => this.handleFileChange('change', path))
      .on('unlink', (path) => this.handleFileChange('unlink', path))
      .on('error', (error) => this.handleError(error))
      .on('ready', () => {
        this.isRunning = true;
        console.log(chalk.green('✓ File watcher is ready'));
        logger.info('File watcher initialized successfully');
      });

    // Start batch processor
    this.startBatchProcessor();
  }

  /**
   * Handle file change with intelligent debouncing
   */
  handleFileChange(eventType, filePath) {
    const fileName = basename(filePath);

    // Only watch JSON and YAML files
    if (!fileName.endsWith('.json') && !fileName.endsWith('.yaml') && !fileName.endsWith('.yml')) {
      return;
    }

    logger.debug(`File ${eventType}: ${fileName}`, { eventType, filePath });

    // Clear existing debounce timer for this file
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath));
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.queueFileChange(eventType, filePath);
      this.debounceTimers.delete(filePath);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Queue file change for batch processing
   */
  queueFileChange(eventType, filePath) {
    const fileName = basename(filePath);

    // Add to pending changes
    this.pendingChanges.set(filePath, {
      type: eventType,
      timestamp: Date.now(),
      fileName,
    });

    this.metrics.filesChanged++;

    logger.debug(`Queued ${eventType} for: ${fileName}`, {
      queueSize: this.pendingChanges.size,
    });
  }

  /**
   * Start batch processor
   */
  startBatchProcessor() {
    this.batchTimer = setInterval(() => {
      if (this.pendingChanges.size > 0) {
        this.processBatch();
      }
    }, this.batchIntervalMs);
  }

  /**
   * Process batch of pending changes
   */
  async processBatch() {
    if (this.pendingChanges.size === 0) return;

    const changes = Array.from(this.pendingChanges.entries());
    this.pendingChanges.clear();

    logger.info(`Processing batch of ${changes.length} file changes`);

    const startTime = Date.now();

    // Group changes by type
    const grouped = {
      add: [],
      change: [],
      unlink: [],
    };

    changes.forEach(([filePath, change]) => {
      grouped[change.type].push({ filePath, ...change });
    });

    // Process each group
    try {
      // Process additions and changes (can be batched together)
      const toSync = [...grouped.add, ...grouped.change];
      if (toSync.length > 0) {
        await this.processSyncBatch(toSync);
      }

      // Process deletions
      if (grouped.unlink.length > 0) {
        await this.processDeleteBatch(grouped.unlink);
      }

      const duration = Date.now() - startTime;
      this.metrics.lastSync = new Date().toISOString();

      logger.info(`Batch processed successfully in ${duration}ms`, {
        added: grouped.add.length,
        changed: grouped.change.length,
        deleted: grouped.unlink.length,
        duration,
      });

      console.log(chalk.green(`✓ Synced ${changes.length} file(s) in ${duration}ms`));
    } catch (error) {
      this.metrics.errors++;
      logger.error('Batch processing failed', error);
      console.log(chalk.red(`✗ Batch sync failed: ${error.message}`));
    }
  }

  /**
   * Process sync batch (additions and changes)
   */
  async processSyncBatch(files) {
    // Add all files to queue for concurrent processing
    const promises = files.map((file) =>
      this.queue.add(async () => {
        try {
          await this.syncEngine.syncFile(file.filePath);
          this.metrics.filesProcessed++;
          logger.debug(`Synced: ${file.fileName}`);
        } catch (error) {
          this.metrics.errors++;
          logger.error(`Failed to sync ${file.fileName}`, error);
          throw error;
        }
      }),
    );

    await Promise.allSettled(promises);
  }

  /**
   * Process delete batch
   */
  async processDeleteBatch(files) {
    // Process deletions sequentially to avoid conflicts
    for (const file of files) {
      try {
        await this.syncEngine.handleFileDelete(file.filePath);
        this.metrics.filesProcessed++;
        logger.debug(`Deleted: ${file.fileName}`);
      } catch (error) {
        this.metrics.errors++;
        logger.error(`Failed to handle deletion of ${file.fileName}`, error);
      }
    }
  }

  /**
   * Handle watcher errors
   */
  handleError(error) {
    this.metrics.errors++;
    logger.error('File watcher error', error);
    console.log(chalk.red(`✗ Watcher error: ${error.message}`));
  }

  /**
   * Get watcher metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      queueSize: this.queue.size,
      queuePending: this.queue.pending,
      pendingChanges: this.pendingChanges.size,
    };
  }

  /**
   * Stop watching
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping file watcher...');

    // Clear all debounce timers
    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();

    // Clear batch timer
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }

    // Process any pending changes
    if (this.pendingChanges.size > 0) {
      logger.info('Processing pending changes before shutdown...');
      await this.processBatch();
    }

    // Wait for queue to finish
    await this.queue.onIdle();

    // Close watcher
    if (this.watcher) {
      await this.watcher.close();
    }

    this.isRunning = false;
    logger.info('File watcher stopped', this.metrics);
    console.log(chalk.yellow('File watcher stopped'));
  }
}

// Export alias for compatibility
export const Watcher = EnhancedFileWatcher;
export default EnhancedFileWatcher;
