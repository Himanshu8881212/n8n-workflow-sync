#!/usr/bin/env node

/**
 * n8n API Client
 * 
 * Handles all communication with the n8n API.
 * 
 * @module n8n-client
 */

import { winstonLogger as logger } from './logger-enhanced.js';
import { config } from './config.js';

/**
 * n8n API Client
 */
export class N8nClient {
  constructor(apiUrl = null, apiKey = null) {
    this.apiUrl = apiUrl || config.n8n.apiUrl;
    this.apiKey = apiKey || config.n8n.apiKey;

    if (!this.apiUrl) {
      throw new Error('N8N_API_URL is required');
    }
    if (!this.apiKey) {
      throw new Error('N8N_API_KEY is required');
    }

    logger.info('N8nClient initialized', {
      context: 'N8nClient',
      apiUrl: this.apiUrl,
    });
  }

  /**
   * Make HTTP request to n8n API
   */
  async _request(method, path, body = null) {
    const url = `${this.apiUrl}${path}`;
    const headers = {
      'X-N8N-API-KEY': this.apiKey,
      'Content-Type': 'application/json',
    };

    const options = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    logger.debug(`API Request: ${method} ${path}`, {
      context: 'N8nClient',
      method,
      path,
    });

    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(`n8n API error: ${response.status} - ${JSON.stringify(data)}`);
      }

      return data;
    } catch (error) {
      logger.error('API request failed', {
        context: 'N8nClient',
        method,
        path,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * List all workflows
   */
  async listWorkflows() {
    logger.info('Fetching workflows from n8n', { context: 'N8nClient' });

    const data = await this._request('GET', '/workflows');
    const workflows = data.data || [];

    logger.info(`Fetched ${workflows.length} workflows`, {
      context: 'N8nClient',
      count: workflows.length,
    });

    return workflows;
  }

  /**
   * Get a single workflow by ID
   */
  async getWorkflow(id) {
    logger.debug(`Fetching workflow ${id}`, { context: 'N8nClient', id });

    const workflow = await this._request('GET', `/workflows/${id}`);

    return workflow;
  }

  /**
   * Create a new workflow
   */
  async createWorkflow(workflow) {
    logger.info(`Creating workflow: ${workflow.name}`, {
      context: 'N8nClient',
      name: workflow.name,
    });

    const created = await this._request('POST', '/workflows', workflow);

    logger.info(`Created workflow: ${created.name} (${created.id})`, {
      context: 'N8nClient',
      id: created.id,
      name: created.name,
    });

    return created;
  }

  /**
   * Update an existing workflow
   */
  async updateWorkflow(id, workflow) {
    logger.info(`Updating workflow: ${workflow.name} (${id})`, {
      context: 'N8nClient',
      id,
      name: workflow.name,
    });

    const updated = await this._request('PUT', `/workflows/${id}`, workflow);

    logger.info(`Updated workflow: ${updated.name}`, {
      context: 'N8nClient',
      id: updated.id,
      name: updated.name,
    });

    return updated;
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(id) {
    logger.info(`Deleting workflow: ${id}`, { context: 'N8nClient', id });

    await this._request('DELETE', `/workflows/${id}`);

    logger.info(`Deleted workflow: ${id}`, { context: 'N8nClient', id });
  }

  /**
   * Activate a workflow
   */
  async activateWorkflow(id) {
    logger.info(`Activating workflow: ${id}`, { context: 'N8nClient', id });

    // Use the dedicated activate endpoint
    const updated = await this._request('POST', `/workflows/${id}/activate`);

    logger.info(`Activated workflow: ${updated.name}`, {
      context: 'N8nClient',
      id: updated.id,
      name: updated.name,
    });

    return updated;
  }

  /**
   * Deactivate a workflow
   */
  async deactivateWorkflow(id) {
    logger.info(`Deactivating workflow: ${id}`, { context: 'N8nClient', id });

    // Use the dedicated deactivate endpoint
    const updated = await this._request('POST', `/workflows/${id}/deactivate`);

    logger.info(`Deactivated workflow: ${updated.name}`, {
      context: 'N8nClient',
      id: updated.id,
      name: updated.name,
    });

    return updated;
  }

  /**
   * Find workflow by name
   */
  async findWorkflowByName(name) {
    const workflows = await this.listWorkflows();
    return workflows.find((w) => w.name === name);
  }

  /**
   * Check if workflow exists
   */
  async workflowExists(id) {
    try {
      await this.getWorkflow(id);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export default N8nClient;

