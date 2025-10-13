#!/usr/bin/env node

/**
 * Sync Engine
 * 
 * Handles bidirectional sync between n8n and local files.
 * 
 * @module sync-engine
 */

import { readdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import { winstonLogger as logger } from './logger-enhanced.js';
import { N8nClient } from './n8n-client.js';
import { FileManager } from './file-manager.js';
import { config } from './config.js';

/**
 * Sync Engine
 */
export class SyncEngine {
  constructor(options = {}) {
    this.client = new N8nClient(options.apiUrl, options.apiKey);
    this.fileManager = new FileManager();
    this.workflowsDir = options.workflowsDir || config.paths.workflowsDir;
    this.dryRun = options.dryRun || config.sync.dryRun;

    logger.info('SyncEngine initialized', {
      context: 'SyncEngine',
      workflowsDir: this.workflowsDir,
      dryRun: this.dryRun,
    });
  }

  /**
   * Pull workflows from n8n to local files
   */
  async pullFromN8n() {
    logger.info('Starting pull from n8n', { context: 'SyncEngine' });

    try {
      // Get all workflows from n8n
      const workflows = await this.client.listWorkflows();

      logger.info(`Found ${workflows.length} workflows in n8n`, {
        context: 'SyncEngine',
        count: workflows.length,
      });

      let pulled = 0;
      let skipped = 0;
      let errors = 0;

      for (const workflow of workflows) {
        try {
          // Get full workflow details
          const fullWorkflow = await this.client.getWorkflow(workflow.id);

          // Determine folder based on tags
          let folderPath = this.workflowsDir;
          if (fullWorkflow.tags && fullWorkflow.tags.length > 0) {
            // Use first tag as folder name
            const folderName = this._sanitizeFilename(fullWorkflow.tags[0].name || fullWorkflow.tags[0]);
            folderPath = join(this.workflowsDir, folderName);

            // Create folder if it doesn't exist
            if (!this.dryRun) {
              await mkdir(folderPath, { recursive: true });
            }
          }

          // Save to file
          const filename = `${this._sanitizeFilename(fullWorkflow.name)}.json`;
          const filepath = join(folderPath, filename);

          if (this.dryRun) {
            logger.info(`[DRY RUN] Would save: ${filename}`, {
              context: 'SyncEngine',
              filename,
            });
            pulled++;
          } else {
            await this.fileManager.writeWorkflow(filepath, fullWorkflow);
            logger.info(`Pulled workflow: ${fullWorkflow.name}`, {
              context: 'SyncEngine',
              id: fullWorkflow.id,
              name: fullWorkflow.name,
              file: filename,
            });
            pulled++;
          }
        } catch (error) {
          logger.error(`Failed to pull workflow: ${workflow.name}`, {
            context: 'SyncEngine',
            id: workflow.id,
            error: error.message,
          });
          errors++;
        }
      }

      logger.info('Pull completed', {
        context: 'SyncEngine',
        pulled,
        skipped,
        errors,
        total: workflows.length,
      });

      return { pulled, skipped, errors, total: workflows.length };
    } catch (error) {
      logger.error('Pull failed', {
        context: 'SyncEngine',
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Push local workflows to n8n
   */
  async pushToN8n() {
    logger.info('Starting push to n8n', { context: 'SyncEngine' });

    try {
      // Get all local workflow files recursively
      const workflowFiles = await this._getAllWorkflowFiles(this.workflowsDir);

      logger.info(`Found ${workflowFiles.length} local workflow files`, {
        context: 'SyncEngine',
        count: workflowFiles.length,
      });

      let pushed = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      for (const filepath of workflowFiles) {
        try {
          const workflow = await this.fileManager.readWorkflow(filepath);

          if (!workflow || !workflow.name) {
            logger.warn(`Invalid workflow file: ${filepath}`, {
              context: 'SyncEngine',
              file: filepath,
            });
            skipped++;
            continue;
          }

          if (this.dryRun) {
            logger.info(`[DRY RUN] Would push: ${workflow.name}`, {
              context: 'SyncEngine',
              name: workflow.name,
              file: filepath,
            });
            pushed++;
          } else {
            // Check if workflow exists in n8n
            if (workflow.id) {
              const exists = await this.client.workflowExists(workflow.id);
              if (exists) {
                // Update existing workflow
                await this.client.updateWorkflow(workflow.id, workflow);
                logger.info(`Updated workflow: ${workflow.name}`, {
                  context: 'SyncEngine',
                  id: workflow.id,
                  name: workflow.name,
                  file: filepath,
                });
                updated++;
              } else {
                // ID exists but workflow doesn't - create new
                delete workflow.id; // Remove invalid ID
                const created = await this.client.createWorkflow(workflow);
                logger.info(`Created workflow: ${created.name}`, {
                  context: 'SyncEngine',
                  id: created.id,
                  name: created.name,
                  file: filepath,
                });
                pushed++;
              }
            } else {
              // No ID - create new workflow
              const created = await this.client.createWorkflow(workflow);
              logger.info(`Created workflow: ${created.name}`, {
                context: 'SyncEngine',
                id: created.id,
                name: created.name,
                file: filepath,
              });
              pushed++;
            }
          }
        } catch (error) {
          logger.error(`Failed to push workflow: ${filepath}`, {
            context: 'SyncEngine',
            file: filepath,
            error: error.message,
          });
          errors++;
        }
      }

      logger.info('Push completed', {
        context: 'SyncEngine',
        pushed,
        updated,
        skipped,
        errors,
        total: workflowFiles.length,
      });

      return { pushed, updated, skipped, errors, total: workflowFiles.length };
    } catch (error) {
      logger.error('Push failed', {
        context: 'SyncEngine',
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Recursively get all workflow files
   */
  async _getAllWorkflowFiles(dir) {
    const files = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively get files from subdirectories
        const subFiles = await this._getAllWorkflowFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Full bidirectional sync
   */
  async fullSync() {
    logger.info('Starting full sync', { context: 'SyncEngine' });

    const pullResult = await this.pullFromN8n();
    const pushResult = await this.pushToN8n();

    logger.info('Full sync completed', {
      context: 'SyncEngine',
      pull: pullResult,
      push: pushResult,
    });

    return { pull: pullResult, push: pushResult };
  }

  /**
   * Sanitize filename
   */
  _sanitizeFilename(name) {
    return name
      .replace(/[^a-z0-9_-]/gi, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }
}

export default SyncEngine;

