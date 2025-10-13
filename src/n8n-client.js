import fetch from 'node-fetch';
import { config } from './config.js';

/**
 * n8n API Client for workflow management
 */
export class N8nClient {
  constructor() {
    this.baseUrl = config.n8n.apiUrl;
    this.apiKey = config.n8n.apiKey;
    this.headers = {
      'X-N8N-API-KEY': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Make API request to n8n
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`n8n API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * List all workflows from n8n
   */
  async listWorkflows() {
    const workflows = [];
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) params.append('cursor', cursor);

      const response = await this.request(`/workflows?${params}`);
      workflows.push(...response.data);

      hasMore = response.nextCursor != null;
      cursor = response.nextCursor;
    }

    return workflows;
  }

  /**
   * Get workflow by ID
   */
  async getWorkflow(id) {
    return this.request(`/workflows/${id}`);
  }

  /**
   * Clean workflow object for n8n API
   * Only include fields that n8n API accepts for create/update operations
   */
  _cleanWorkflowForApi(workflow, isUpdate = false) {
    // Clean nodes - remove 'id' field from each node as n8n API doesn't accept it
    const cleanNodes = workflow.nodes ? workflow.nodes.map(node => {
      const { id, ...nodeWithoutId } = node;
      return nodeWithoutId;
    }) : [];

    // Start with required fields
    const allowedFields = {
      name: workflow.name,
      nodes: cleanNodes,
      connections: workflow.connections || {},
      settings: workflow.settings || {}  // Always include settings (required by n8n API)
    };

    // 'active' field is read-only for updates, only include for create
    if (!isUpdate && workflow.active !== undefined && workflow.active !== null) {
      allowedFields.active = workflow.active;
    }

    // Optional fields - only include if they have values
    if (workflow.staticData !== undefined && workflow.staticData !== null) {
      allowedFields.staticData = workflow.staticData;
    }

    // Tags are read-only, don't include them
    // if (workflow.tags && Array.isArray(workflow.tags) && workflow.tags.length > 0) {
    //   allowedFields.tags = workflow.tags;
    // }

    if (workflow.pinData && typeof workflow.pinData === 'object' && Object.keys(workflow.pinData).length > 0) {
      allowedFields.pinData = workflow.pinData;
    }

    return allowedFields;
  }

  /**
   * Create new workflow
   */
  async createWorkflow(workflow) {
    const cleanWorkflow = this._cleanWorkflowForApi(workflow);
    return this.request('/workflows', {
      method: 'POST',
      body: JSON.stringify(cleanWorkflow),
    });
  }

  /**
   * Update existing workflow
   */
  async updateWorkflow(id, workflow) {
    const cleanWorkflow = this._cleanWorkflowForApi(workflow, true); // true = isUpdate
    return this.request(`/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(cleanWorkflow),
    });
  }

  /**
   * Delete workflow
   */
  async deleteWorkflow(id) {
    return this.request(`/workflows/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Check n8n health
   */
  async healthCheck() {
    try {
      await this.request('/workflows?limit=1');
      return { healthy: true };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Get workflow by name
   */
  async getWorkflowByName(name) {
    const workflows = await this.listWorkflows();
    return workflows.find(w => w.name === name);
  }

  /**
   * Batch update workflows
   */
  async batchUpdate(updates) {
    const results = [];
    for (const update of updates) {
      try {
        const result = await this.updateWorkflow(update.id, update.workflow);
        results.push({ success: true, id: update.id, result });
      } catch (error) {
        results.push({ success: false, id: update.id, error: error.message });
      }
    }
    return results;
  }
}

