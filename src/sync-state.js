import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { config } from './config.js';

/**
 * Sync State Manager - Tracks workflow sync status
 */
export class SyncState {
  constructor(stateFilePath) {
    this.stateFilePath = stateFilePath || config.paths.syncStateFile;
    this.state = {
      workflows: {},  // Now keyed by file path instead of workflow ID
      lastSync: null,
      version: '2.0.0',  // Bumped version for new structure
    };
  }

  /**
   * Load state from file
   */
  async load() {
    if (!existsSync(this.stateFilePath)) {
      await this.save();
      return;
    }

    try {
      const content = await readFile(this.stateFilePath, 'utf-8');
      this.state = JSON.parse(content);
    } catch (error) {
      console.warn('Failed to load sync state, using empty state:', error.message);
      await this.save();
    }
  }

  /**
   * Save state to file
   */
  async save() {
    const content = JSON.stringify(this.state, null, 2);
    await writeFile(this.stateFilePath, content, 'utf-8');
  }

  /**
   * Get workflow state by file path
   */
  getWorkflowByPath(filePath) {
    return this.state.workflows[filePath] || null;
  }

  /**
   * Get workflow state by ID (searches all workflows)
   */
  getWorkflowById(id) {
    for (const [path, workflow] of Object.entries(this.state.workflows)) {
      if (workflow.id === id) {
        return { ...workflow, filePath: path };
      }
    }
    return null;
  }

  /**
   * Update workflow state by file path
   */
  async updateWorkflowByPath(filePath, data) {
    this.state.workflows[filePath] = {
      ...this.state.workflows[filePath],
      ...data,
      lastUpdated: new Date().toISOString(),
    };
    await this.save();
  }

  /**
   * Remove workflow from state by file path
   */
  async removeWorkflowByPath(filePath) {
    delete this.state.workflows[filePath];
    await this.save();
  }

  /**
   * Legacy: Get workflow state by ID (deprecated, use getWorkflowById)
   */
  getWorkflow(id) {
    return this.getWorkflowById(id);
  }

  /**
   * Legacy: Update workflow state (deprecated, use updateWorkflowByPath)
   */
  async updateWorkflow(id, data) {
    // Find the file path for this ID
    const existing = this.getWorkflowById(id);
    if (existing && existing.filePath) {
      await this.updateWorkflowByPath(existing.filePath, { ...data, id });
    }
  }

  /**
   * Legacy: Remove workflow from state (deprecated, use removeWorkflowByPath)
   */
  async removeWorkflow(id) {
    const existing = this.getWorkflowById(id);
    if (existing && existing.filePath) {
      await this.removeWorkflowByPath(existing.filePath);
    }
  }

  /**
   * Update last sync time
   */
  async updateLastSync() {
    this.state.lastSync = new Date().toISOString();
    await this.save();
  }

  /**
   * Get all workflow file paths
   */
  getAllWorkflowPaths() {
    return Object.keys(this.state.workflows);
  }

  /**
   * Get all workflow IDs (legacy)
   */
  getAllWorkflowIds() {
    return Object.values(this.state.workflows)
      .map(w => w.id)
      .filter(Boolean);
  }

  /**
   * Check if workflow has changed by file path
   */
  hasChangedByPath(filePath, hash) {
    const workflow = this.getWorkflowByPath(filePath);
    return !workflow || workflow.hash !== hash;
  }

  /**
   * Check if workflow has changed (legacy, uses ID)
   */
  hasChanged(id, hash) {
    const workflow = this.getWorkflowById(id);
    return !workflow || workflow.hash !== hash;
  }

  /**
   * Clear all state
   */
  async clear() {
    this.state = {
      workflows: {},
      lastSync: null,
      version: '1.0.0',
    };
    await this.save();
  }
}

