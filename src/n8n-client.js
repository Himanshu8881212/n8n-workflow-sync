#!/usr/bin/env node

/**
 * n8n API Client
 *
 * Handles all communication with the n8n public API.
 *
 * @module n8n-client
 */

import { winstonLogger as logger } from './logger-enhanced.js';
import { config } from './config.js';

// Fields the public API accepts on create/update. Anything else (id, active,
// tags, createdAt, ...) makes n8n reject the request.
const WRITABLE_FIELDS = ['name', 'nodes', 'connections', 'settings', 'staticData'];

/**
 * Keep only the fields n8n accepts when creating/updating a workflow.
 */
export function toApiBody(workflow) {
  const body = {};
  for (const key of WRITABLE_FIELDS) {
    if (workflow[key] !== undefined && workflow[key] !== null) body[key] = workflow[key];
  }
  body.settings = body.settings || {};
  return body;
}

/**
 * n8n API Client
 */
export class N8nClient {
  constructor(apiUrl = null, apiKey = null) {
    this.apiUrl = (apiUrl || config.n8n.apiUrl).replace(/\/+$/, '');
    this.apiKey = apiKey || config.n8n.apiKey;

    if (!this.apiUrl) {
      throw new Error('N8N_API_URL is required');
    }
    if (!this.apiKey) {
      throw new Error('N8N_API_KEY is required');
    }

    logger.debug('N8nClient initialized', {
      context: 'N8nClient',
      apiUrl: this.apiUrl,
    });
  }

  /**
   * Make HTTP request to n8n API
   */
  async _request(method, path, body = null) {
    const options = {
      method,
      headers: {
        'X-N8N-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    logger.debug(`API Request: ${method} ${path}`, { context: 'N8nClient', method, path });

    const response = await fetch(`${this.apiUrl}${path}`, options);
    return this._parse(response);
  }

  /**
   * Turn a fetch Response into data, or throw with n8n's message (+ status, issues).
   */
  async _parse(response) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const detail = data?.message || (typeof data === 'string' ? data : JSON.stringify(data));
      const error = new Error(`n8n API error: ${response.status} - ${detail}`);
      error.status = response.status;
      error.apiMessage = data?.message;
      if (Array.isArray(data?.issues)) error.issues = data.issues; // blocked package imports
      throw error;
    }

    return data;
  }

  /**
   * List all workflows (follows pagination)
   */
  async listWorkflows() {
    const workflows = [];
    let cursor = null;

    do {
      const query = `?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const data = await this._request('GET', `/workflows${query}`);
      workflows.push(...(data?.data || []));
      cursor = data?.nextCursor;
    } while (cursor);

    logger.debug(`Fetched ${workflows.length} workflows`, {
      context: 'N8nClient',
      count: workflows.length,
    });

    return workflows;
  }

  /**
   * Get a single workflow by ID
   */
  async getWorkflow(id) {
    return this._request('GET', `/workflows/${encodeURIComponent(id)}`);
  }

  /**
   * Create a new workflow
   */
  async createWorkflow(workflow) {
    const created = await this._request('POST', '/workflows', toApiBody(workflow));
    logger.info(`Created workflow: ${created.name} (${created.id})`, { context: 'N8nClient' });
    return created;
  }

  /**
   * Update an existing workflow
   */
  async updateWorkflow(id, workflow) {
    const updated = await this._request('PUT', `/workflows/${encodeURIComponent(id)}`, toApiBody(workflow));
    logger.info(`Updated workflow: ${updated.name} (${id})`, { context: 'N8nClient' });
    return updated;
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(id) {
    await this._request('DELETE', `/workflows/${encodeURIComponent(id)}`);
    logger.info(`Deleted workflow: ${id}`, { context: 'N8nClient' });
  }

  /**
   * Activate a workflow (needs a trigger/webhook/poller node)
   */
  async activateWorkflow(id) {
    const updated = await this._request('POST', `/workflows/${encodeURIComponent(id)}/activate`);
    logger.info(`Activated workflow: ${updated.name} (${id})`, { context: 'N8nClient' });
    return updated;
  }

  /**
   * Deactivate a workflow
   */
  async deactivateWorkflow(id) {
    const updated = await this._request('POST', `/workflows/${encodeURIComponent(id)}/deactivate`);
    logger.info(`Deactivated workflow: ${updated.name} (${id})`, { context: 'N8nClient' });
    return updated;
  }

  /**
   * GET a paginated list endpoint and return every item.
   */
  async _listAll(path, params = {}) {
    const items = [];
    let cursor = null;
    do {
      const query = new URLSearchParams({ limit: '250', ...params, ...(cursor ? { cursor } : {}) });
      const data = await this._request('GET', `${path}?${query}`);
      items.push(...(data?.data || []));
      cursor = data?.nextCursor;
    } while (cursor);
    return items;
  }

  /**
   * Get a workflow, or null if it doesn't exist
   */
  async getWorkflowOrNull(id) {
    try {
      return await this.getWorkflow(id);
    } catch (error) {
      if (error.status === 404 || error.status === 400) return null;
      throw error;
    }
  }

  /**
   * List all tags (follows pagination)
   */
  async listTags() {
    return this._listAll('/tags');
  }

  /**
   * List credentials (id, name, type - never the secret data)
   */
  async listCredentials() {
    try {
      return await this._listAll('/credentials');
    } catch (error) {
      // n8n 1.x has no "list credentials" endpoint
      if (error.status === 405 || error.status === 404) {
        throw Object.assign(new Error('This n8n version cannot list credentials through its API (needs n8n 2.x) - manage credentials in the n8n UI'), {
          status: error.status,
          unsupported: true,
        });
      }
      throw error;
    }
  }

  /**
   * JSON schema of a credential type's fields (field names, which are required)
   */
  async getCredentialSchema(type) {
    return this._request('GET', `/credentials/schema/${encodeURIComponent(type)}`);
  }

  async createCredential(name, type, data) {
    return this._request('POST', '/credentials', { name, type, data });
  }

  /**
   * Update a credential's data. isPartialData merges with what's stored, so
   * fields not in `data` (e.g. OAuth tokens) are kept.
   */
  async updateCredential(id, data) {
    return this._request('PATCH', `/credentials/${encodeURIComponent(id)}`, { data, isPartialData: true });
  }

  /**
   * Ask n8n to test a credential with its stored data -> { status: 'OK'|'Error', message }
   */
  async testCredential(id) {
    return this._request('POST', `/credentials/${encodeURIComponent(id)}/test`);
  }

  /**
   * List executions, newest first.
   * @param {Object} opts - { workflowId, status, limit, includeData }
   */
  async listExecutions({ workflowId, status, limit = 10, includeData = false } = {}) {
    const query = new URLSearchParams({ limit: String(limit), includeData: String(includeData) });
    if (workflowId) query.set('workflowId', workflowId);
    if (status) query.set('status', status);
    const data = await this._request('GET', `/executions?${query}`);
    return data?.data || [];
  }

  /**
   * Get one execution (with run data when includeData)
   */
  async getExecution(id, includeData = true) {
    return this._request('GET', `/executions/${encodeURIComponent(id)}?includeData=${includeData}`);
  }

  // Variables (n8n license feature: 403 on unlicensed instances)
  async listVariables() {
    return this._listAll('/variables');
  }
  async createVariable(key, value) {
    return this._request('POST', '/variables', { key, value });
  }
  async updateVariable(id, key, value) {
    return this._request('PUT', `/variables/${encodeURIComponent(id)}`, { key, value });
  }

  // Data tables (schema only - rows are data, not config)
  async listDataTables() {
    return this._listAll('/data-tables');
  }
  async listDataTableColumns(id) {
    const data = await this._request('GET', `/data-tables/${encodeURIComponent(id)}/columns`);
    return Array.isArray(data) ? data : data?.data || [];
  }
  async createDataTable(name, columns) {
    return this._request('POST', '/data-tables', { name, columns });
  }
  async addDataTableColumn(id, column) {
    return this._request('POST', `/data-tables/${encodeURIComponent(id)}/columns`, column);
  }

  /**
   * n8n packages (.n8np = gzipped tar). Export: agents/workflows/folders/projects.
   * @returns {Promise<Buffer>}
   */
  async exportPackage(body) {
    const response = await fetch(`${this.apiUrl}/n8n-packages/export`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) await this._parse(response); // throws
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Import a package (multipart). Fields are sent as text; empty ones are left out.
   */
  async importPackage(buffer, fields = {}) {
    const form = new FormData();
    form.append('package', new Blob([new Uint8Array(buffer)]), 'agents.n8np');
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value !== '') form.append(key, value);
    }
    const response = await fetch(`${this.apiUrl}/n8n-packages/import`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': this.apiKey },
      body: form,
    });
    return this._parse(response);
  }

  /**
   * Create a tag
   */
  async createTag(name) {
    return this._request('POST', '/tags', { name });
  }

  /**
   * Replace a workflow's tags (tag ids)
   */
  async setWorkflowTags(id, tagIds) {
    return this._request('PUT', `/workflows/${encodeURIComponent(id)}/tags`, tagIds.map((tagId) => ({ id: tagId })));
  }

  /**
   * Find workflow by name
   */
  async findWorkflowByName(name) {
    const workflows = await this.listWorkflows();
    return workflows.find((w) => w.name === name);
  }

  /**
   * Check if workflow exists. Only a 404 means "no"; other errors propagate
   * so a network blip doesn't turn an update into a duplicate create.
   */
  async workflowExists(id) {
    try {
      await this.getWorkflow(id);
      return true;
    } catch (error) {
      if (error.status === 404 || error.status === 400) return false;
      throw error;
    }
  }
}

export default N8nClient;
