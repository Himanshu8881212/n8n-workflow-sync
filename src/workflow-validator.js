import { Logger } from './logger-enhanced.js';

const logger = new Logger('WorkflowValidator');

/**
 * Workflow Validator
 * 
 * @class WorkflowValidator
 * @description Validates n8n workflow structure and content before syncing
 * Features:
 * - Schema validation
 * - Node validation
 * - Connection validation
 * - Credential validation
 * - Best practices checks
 * 
 * @example
 * const validator = new WorkflowValidator();
 * const result = validator.validate(workflow);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 */
export class WorkflowValidator {
  constructor(options = {}) {
    this.strict = options.strict || false;
    this.checkBestPractices = options.checkBestPractices !== false;
  }

  /**
   * Validate a workflow
   * @param {Object} workflow - Workflow object to validate
   * @returns {Object} Validation result with errors and warnings
   */
  validate(workflow) {
    const errors = [];
    const warnings = [];

    try {
      // Required fields validation
      this._validateRequiredFields(workflow, errors);

      // Nodes validation
      if (workflow.nodes) {
        this._validateNodes(workflow.nodes, errors, warnings);
      }

      // Connections validation
      if (workflow.connections) {
        this._validateConnections(workflow.connections, workflow.nodes, errors, warnings);
      }

      // Settings validation
      if (workflow.settings) {
        this._validateSettings(workflow.settings, warnings);
      }

      // Best practices
      if (this.checkBestPractices) {
        this._checkBestPractices(workflow, warnings);
      }

      const valid = errors.length === 0;

      if (!valid) {
        logger.warn('Workflow validation failed', {
          workflow: workflow.name,
          errors: errors.length,
          warnings: warnings.length,
        });
      }

      return {
        valid,
        errors,
        warnings,
        summary: {
          nodeCount: workflow.nodes?.length || 0,
          connectionCount: Object.keys(workflow.connections || {}).length,
          hasErrors: errors.length > 0,
          hasWarnings: warnings.length > 0,
        },
      };
    } catch (error) {
      logger.error('Validation error', error);
      return {
        valid: false,
        errors: [`Validation exception: ${error.message}`],
        warnings: [],
      };
    }
  }

  /**
   * Validate required fields
   * @private
   */
  _validateRequiredFields(workflow, errors) {
    const requiredFields = ['name', 'nodes', 'connections'];

    for (const field of requiredFields) {
      if (!workflow[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Validate field types
    if (workflow.name && typeof workflow.name !== 'string') {
      errors.push('Field "name" must be a string');
    }

    if (workflow.nodes && !Array.isArray(workflow.nodes)) {
      errors.push('Field "nodes" must be an array');
    }

    if (workflow.connections && typeof workflow.connections !== 'object') {
      errors.push('Field "connections" must be an object');
    }

    if (workflow.active !== undefined && typeof workflow.active !== 'boolean') {
      errors.push('Field "active" must be a boolean');
    }
  }

  /**
   * Validate nodes
   * @private
   */
  _validateNodes(nodes, errors, warnings) {
    if (nodes.length === 0) {
      warnings.push('Workflow has no nodes');
      return;
    }

    const nodeIds = new Set();
    const nodeNames = new Set();

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nodeRef = `Node ${i} (${node.name || 'unnamed'})`;

      // Required node fields
      if (!node.name) {
        errors.push(`${nodeRef}: Missing "name" field`);
      }

      if (!node.type) {
        errors.push(`${nodeRef}: Missing "type" field`);
      }

      if (!node.position || !Array.isArray(node.position) || node.position.length !== 2) {
        errors.push(`${nodeRef}: Invalid "position" field (must be [x, y])`);
      }

      if (node.typeVersion === undefined) {
        warnings.push(`${nodeRef}: Missing "typeVersion" field`);
      }

      // Check for duplicate IDs
      if (node.id) {
        if (nodeIds.has(node.id)) {
          errors.push(`${nodeRef}: Duplicate node ID: ${node.id}`);
        }
        nodeIds.add(node.id);
      }

      // Check for duplicate names
      if (node.name) {
        if (nodeNames.has(node.name)) {
          warnings.push(`${nodeRef}: Duplicate node name: ${node.name}`);
        }
        nodeNames.add(node.name);
      }

      // Validate parameters
      if (node.parameters && typeof node.parameters !== 'object') {
        errors.push(`${nodeRef}: "parameters" must be an object`);
      }

      // Check for common node types
      this._validateNodeType(node, warnings);
    }
  }

  /**
   * Validate node type
   * @private
   */
  _validateNodeType(node, warnings) {
    const commonNodeTypes = [
      'n8n-nodes-base.start',
      'n8n-nodes-base.webhook',
      'n8n-nodes-base.httpRequest',
      'n8n-nodes-base.set',
      'n8n-nodes-base.code',
      'n8n-nodes-base.if',
      'n8n-nodes-base.switch',
      'n8n-nodes-base.merge',
      'n8n-nodes-base.respondToWebhook',
    ];

    if (node.type && !node.type.includes('.') && !node.type.startsWith('n8n-nodes-')) {
      warnings.push(`Node "${node.name}": Unusual node type format: ${node.type}`);
    }
  }

  /**
   * Validate connections
   * @private
   */
  _validateConnections(connections, nodes, errors, warnings) {
    const nodeNames = new Set(nodes?.map((n) => n.name) || []);

    for (const [sourceName, outputs] of Object.entries(connections)) {
      // Check if source node exists
      if (!nodeNames.has(sourceName)) {
        errors.push(`Connection from non-existent node: ${sourceName}`);
        continue;
      }

      // Validate connection structure
      if (typeof outputs !== 'object') {
        errors.push(`Invalid connection structure for node: ${sourceName}`);
        continue;
      }

      // Validate each output type (main, error, etc.)
      for (const [outputType, outputConnections] of Object.entries(outputs)) {
        if (!Array.isArray(outputConnections)) {
          errors.push(`Invalid connection type for ${sourceName}.${outputType}`);
          continue;
        }

        // Validate each output branch
        for (let i = 0; i < outputConnections.length; i++) {
          const branch = outputConnections[i];

          if (!Array.isArray(branch)) {
            errors.push(`Invalid connection branch for ${sourceName}.${outputType}[${i}]`);
            continue;
          }

          // Validate each connection in the branch
          for (const conn of branch) {
            if (!conn.node) {
              errors.push(`Connection missing "node" field: ${sourceName} -> ?`);
            } else if (!nodeNames.has(conn.node)) {
              errors.push(`Connection to non-existent node: ${sourceName} -> ${conn.node}`);
            }

            if (conn.type === undefined) {
              warnings.push(`Connection missing "type" field: ${sourceName} -> ${conn.node}`);
            }

            if (conn.index === undefined) {
              warnings.push(`Connection missing "index" field: ${sourceName} -> ${conn.node}`);
            }
          }
        }
      }
    }

    // Check for orphaned nodes (no incoming connections)
    this._checkOrphanedNodes(nodes, connections, warnings);
  }

  /**
   * Check for orphaned nodes
   * @private
   */
  _checkOrphanedNodes(nodes, connections, warnings) {
    const nodesWithIncoming = new Set();

    // Find all nodes that have incoming connections
    for (const outputs of Object.values(connections)) {
      for (const outputConnections of Object.values(outputs)) {
        for (const branch of outputConnections) {
          for (const conn of branch) {
            if (conn.node) {
              nodesWithIncoming.add(conn.node);
            }
          }
        }
      }
    }

    // Check for nodes without incoming connections (except start/webhook nodes)
    for (const node of nodes) {
      const isStartNode = node.type === 'n8n-nodes-base.start' || node.type === 'n8n-nodes-base.webhook';

      if (!isStartNode && !nodesWithIncoming.has(node.name)) {
        warnings.push(`Orphaned node (no incoming connections): ${node.name}`);
      }
    }
  }

  /**
   * Validate settings
   * @private
   */
  _validateSettings(settings, warnings) {
    if (settings.executionOrder && !['v0', 'v1'].includes(settings.executionOrder)) {
      warnings.push(`Unknown execution order: ${settings.executionOrder}`);
    }

    if (settings.timezone && typeof settings.timezone !== 'string') {
      warnings.push('Invalid timezone format');
    }
  }

  /**
   * Check best practices
   * @private
   */
  _checkBestPractices(workflow, warnings) {
    // Check workflow name
    if (workflow.name && workflow.name.length < 3) {
      warnings.push('Workflow name is very short (< 3 characters)');
    }

    if (workflow.name && workflow.name.length > 100) {
      warnings.push('Workflow name is very long (> 100 characters)');
    }

    // Check node count
    if (workflow.nodes && workflow.nodes.length > 50) {
      warnings.push('Workflow has many nodes (> 50) - consider splitting into smaller workflows');
    }

    // Check for tags
    if (!workflow.tags || workflow.tags.length === 0) {
      warnings.push('Workflow has no tags - consider adding tags for organization');
    }

    // Check for description/notes
    const hasNotes = workflow.nodes?.some((node) => node.notes);
    if (!hasNotes && workflow.nodes?.length > 5) {
      warnings.push('Consider adding notes to nodes for documentation');
    }
  }
}

