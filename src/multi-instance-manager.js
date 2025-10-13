import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Logger } from './logger-enhanced.js';
import { N8nClient } from './n8n-client.js';

const logger = new Logger('MultiInstanceManager');

/**
 * Multi-Instance Manager
 * 
 * @class MultiInstanceManager
 * @description Manages synchronization with multiple n8n instances
 * Features:
 * - Profile-based configuration
 * - Switch between instances
 * - Sync to multiple instances
 * - Instance health monitoring
 * 
 * @example
 * const manager = new MultiInstanceManager();
 * await manager.loadProfiles();
 * await manager.setActiveProfile('production');
 * await manager.syncToAll();
 */
export class MultiInstanceManager {
  /**
   * Create a multi-instance manager
   * @param {string} profilesFile - Path to profiles configuration file
   */
  constructor(profilesFile = '.n8n-profiles.json') {
    this.profilesFile = profilesFile;
    this.profiles = {};
    this.activeProfile = null;
    this.clients = new Map();
  }

  /**
   * Load profiles from configuration file
   * @returns {Promise<Object>} Loaded profiles
   */
  async loadProfiles() {
    if (!existsSync(this.profilesFile)) {
      logger.warn('Profiles file not found, creating default');
      await this._createDefaultProfiles();
    }

    try {
      const content = await readFile(this.profilesFile, 'utf-8');
      this.profiles = JSON.parse(content);

      // Create clients for each profile
      for (const [name, profile] of Object.entries(this.profiles)) {
        this.clients.set(name, new N8nClient(profile.apiUrl, profile.apiKey));
      }

      logger.info(`Loaded ${Object.keys(this.profiles).length} profiles`);
      return this.profiles;
    } catch (error) {
      logger.error('Failed to load profiles', error);
      throw error;
    }
  }

  /**
   * Save profiles to configuration file
   * @returns {Promise<void>}
   */
  async saveProfiles() {
    try {
      await writeFile(this.profilesFile, JSON.stringify(this.profiles, null, 2));
      logger.info('Profiles saved successfully');
    } catch (error) {
      logger.error('Failed to save profiles', error);
      throw error;
    }
  }

  /**
   * Add a new profile
   * @param {string} name - Profile name
   * @param {Object} config - Profile configuration
   * @param {string} config.apiUrl - n8n API URL
   * @param {string} config.apiKey - n8n API key
   * @param {string} config.description - Profile description
   * @returns {Promise<void>}
   */
  async addProfile(name, config) {
    if (this.profiles[name]) {
      throw new Error(`Profile already exists: ${name}`);
    }

    this.profiles[name] = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      description: config.description || '',
      enabled: config.enabled !== false,
      createdAt: new Date().toISOString(),
    };

    // Create client for new profile
    this.clients.set(name, new N8nClient(config.apiUrl, config.apiKey));

    await this.saveProfiles();
    logger.info(`Profile added: ${name}`);
  }

  /**
   * Remove a profile
   * @param {string} name - Profile name
   * @returns {Promise<void>}
   */
  async removeProfile(name) {
    if (!this.profiles[name]) {
      throw new Error(`Profile not found: ${name}`);
    }

    delete this.profiles[name];
    this.clients.delete(name);

    if (this.activeProfile === name) {
      this.activeProfile = null;
    }

    await this.saveProfiles();
    logger.info(`Profile removed: ${name}`);
  }

  /**
   * Set active profile
   * @param {string} name - Profile name
   * @returns {Object} Active profile configuration
   */
  setActiveProfile(name) {
    if (!this.profiles[name]) {
      throw new Error(`Profile not found: ${name}`);
    }

    this.activeProfile = name;
    logger.info(`Active profile set to: ${name}`);
    return this.profiles[name];
  }

  /**
   * Get active profile
   * @returns {Object|null} Active profile configuration
   */
  getActiveProfile() {
    if (!this.activeProfile) {
      return null;
    }
    return {
      name: this.activeProfile,
      ...this.profiles[this.activeProfile],
    };
  }

  /**
   * Get client for a profile
   * @param {string} name - Profile name (defaults to active profile)
   * @returns {N8nClient} n8n client instance
   */
  getClient(name = null) {
    const profileName = name || this.activeProfile;

    if (!profileName) {
      throw new Error('No profile specified and no active profile set');
    }

    const client = this.clients.get(profileName);
    if (!client) {
      throw new Error(`Client not found for profile: ${profileName}`);
    }

    return client;
  }

  /**
   * List all profiles
   * @returns {Array} List of profiles with metadata
   */
  listProfiles() {
    return Object.entries(this.profiles).map(([name, profile]) => ({
      name,
      ...profile,
      isActive: name === this.activeProfile,
    }));
  }

  /**
   * Check health of all instances
   * @returns {Promise<Object>} Health status for each instance
   */
  async checkHealth() {
    const results = {};

    for (const [name, client] of this.clients.entries()) {
      const profile = this.profiles[name];

      if (!profile.enabled) {
        results[name] = {
          status: 'disabled',
          message: 'Profile is disabled',
        };
        continue;
      }

      try {
        const startTime = Date.now();
        await client.listWorkflows({ limit: 1 });
        const responseTime = Date.now() - startTime;

        results[name] = {
          status: 'healthy',
          responseTime,
          apiUrl: profile.apiUrl,
        };
      } catch (error) {
        results[name] = {
          status: 'unhealthy',
          error: error.message,
          apiUrl: profile.apiUrl,
        };
      }
    }

    return results;
  }

  /**
   * Sync workflows to a specific instance
   * @param {string} profileName - Profile name
   * @param {Array} workflows - Workflows to sync
   * @returns {Promise<Object>} Sync results
   */
  async syncToInstance(profileName, workflows) {
    const client = this.getClient(profileName);
    const results = {
      success: [],
      failed: [],
      skipped: [],
    };

    logger.info(`Syncing ${workflows.length} workflows to ${profileName}`);

    for (const workflow of workflows) {
      try {
        // Check if workflow exists
        const existing = await client.listWorkflows();
        const existingWorkflow = existing.find((w) => w.name === workflow.name);

        if (existingWorkflow) {
          // Update existing workflow
          await client.updateWorkflow(existingWorkflow.id, workflow);
          results.success.push({
            name: workflow.name,
            action: 'updated',
            id: existingWorkflow.id,
          });
        } else {
          // Create new workflow
          const created = await client.createWorkflow(workflow);
          results.success.push({
            name: workflow.name,
            action: 'created',
            id: created.id,
          });
        }
      } catch (error) {
        logger.error(`Failed to sync workflow: ${workflow.name}`, error);
        results.failed.push({
          name: workflow.name,
          error: error.message,
        });
      }
    }

    logger.info(`Sync to ${profileName} complete`, {
      success: results.success.length,
      failed: results.failed.length,
    });

    return results;
  }

  /**
   * Sync workflows to all enabled instances
   * @param {Array} workflows - Workflows to sync
   * @returns {Promise<Object>} Sync results for all instances
   */
  async syncToAll(workflows) {
    const results = {};

    for (const [name, profile] of Object.entries(this.profiles)) {
      if (!profile.enabled) {
        results[name] = {
          status: 'skipped',
          reason: 'Profile disabled',
        };
        continue;
      }

      try {
        results[name] = await this.syncToInstance(name, workflows);
        results[name].status = 'completed';
      } catch (error) {
        logger.error(`Failed to sync to ${name}`, error);
        results[name] = {
          status: 'error',
          error: error.message,
        };
      }
    }

    return results;
  }

  /**
   * Create default profiles configuration
   * @private
   */
  async _createDefaultProfiles() {
    this.profiles = {
      local: {
        apiUrl: 'http://localhost:5678/api/v1',
        apiKey: '',
        description: 'Local development instance',
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    };

    await this.saveProfiles();
  }
}

