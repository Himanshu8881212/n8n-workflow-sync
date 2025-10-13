#!/usr/bin/env node

/**
 * n8n Workflow Sync Service
 * 
 * Main entry point for the bidirectional sync service.
 * Starts the file watcher and webhook server.
 * 
 * @module index
 */

import { winstonLogger as logger } from './logger-enhanced.js';
import { config, validateConfig } from './config.js';
import { SyncEngine } from './sync-engine.js';
import { Watcher } from './watcher-enhanced.js';
import { WebhookServer } from './webhook-server.js';

/**
 * Main application
 */
class SyncService {
  constructor() {
    this.syncEngine = null;
    this.watcher = null;
    this.webhookServer = null;
    this.isRunning = false;
  }

  /**
   * Start the service
   */
  async start() {
    try {
      logger.info('🚀 Starting n8n Workflow Sync Service v2.0', {
        context: 'SyncService',
      });

      // Validate configuration
      validateConfig();

      // Initialize sync engine
      this.syncEngine = new SyncEngine({
        workflowsDir: config.paths.workflowsDir,
        dryRun: config.sync.dryRun,
      });

      // Start file watcher if enabled
      if (config.sync.watchEnabled) {
        logger.info('Starting file watcher', { context: 'SyncService' });
        this.watcher = new Watcher(this.syncEngine, {
          workflowsDir: config.paths.workflowsDir,
          debounceMs: config.sync.debounceMs,
          autoPush: config.sync.autoPush,
          autoPull: config.sync.autoPull,
        });
        await this.watcher.start();
      } else {
        logger.info('File watcher disabled', { context: 'SyncService' });
      }

      // Start webhook server if enabled
      if (config.webhook.enabled) {
        logger.info('Starting webhook server', { context: 'SyncService' });
        this.webhookServer = new WebhookServer(this.syncEngine, {
          port: config.webhook.port,
          secret: config.webhook.secret,
          enabled: config.webhook.enabled,
        });
        await this.webhookServer.start();
      } else {
        logger.info('Webhook server disabled', { context: 'SyncService' });
      }

      this.isRunning = true;

      logger.info('✅ n8n Workflow Sync Service started successfully', {
        context: 'SyncService',
        watchEnabled: config.sync.watchEnabled,
        webhookEnabled: config.webhook.enabled,
        workflowsDir: config.paths.workflowsDir,
      });

      // Initial sync if configured
      if (config.sync.autoPull) {
        logger.info('Running initial pull sync', { context: 'SyncService' });
        await this.syncEngine.pullFromN8n();
      }

      // Keep process alive
      process.on('SIGINT', () => this.stop());
      process.on('SIGTERM', () => this.stop());

    } catch (error) {
      logger.error('Failed to start service', {
        context: 'SyncService',
        error: error.message,
        stack: error.stack,
      });
      process.exit(1);
    }
  }

  /**
   * Stop the service
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping n8n Workflow Sync Service', {
      context: 'SyncService',
    });

    try {
      // Stop watcher
      if (this.watcher) {
        await this.watcher.stop();
      }

      // Stop webhook server
      if (this.webhookServer) {
        await this.webhookServer.stop();
      }

      this.isRunning = false;

      logger.info('✅ Service stopped gracefully', {
        context: 'SyncService',
      });

      process.exit(0);
    } catch (error) {
      logger.error('Error stopping service', {
        context: 'SyncService',
        error: error.message,
      });
      process.exit(1);
    }
  }
}

// Start the service
const service = new SyncService();
service.start();

