#!/usr/bin/env node

/**
 * Webhook Server for n8n Workflow Sync
 * 
 * Provides HTTP endpoints to trigger sync operations remotely.
 * Alternative to polling-based sync for event-driven architectures.
 * 
 * @module webhook-server
 */

import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import { winstonLogger as logger } from './logger-enhanced.js';

/**
 * Webhook server for remote sync triggering
 */
export class WebhookServer {
  constructor(syncEngine, options = {}) {
    this.syncEngine = syncEngine;
    this.port = options.port || process.env.WEBHOOK_PORT || 3000;
    this.secret = options.secret || process.env.WEBHOOK_SECRET || null;
    this.enabled = options.enabled !== false;
    this.server = null;

    // Metrics
    this.metrics = {
      requests: 0,
      successful: 0,
      failed: 0,
      unauthorized: 0,
    };
  }

  /**
   * Start the webhook server
   */
  async start() {
    if (!this.enabled) {
      logger.info('Webhook server disabled', { context: 'WebhookServer' });
      return;
    }
    if (!this.secret) {
      throw new Error('WEBHOOK_SECRET is required to run the webhook server');
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));

      this.server.listen(this.port, () => {
        logger.info(`Webhook server started on port ${this.port}`, {
          context: 'WebhookServer',
          port: this.port,
          secretConfigured: !!this.secret,
        });
        resolve();
      });

      this.server.on('error', (error) => {
        logger.error('Webhook server error', {
          context: 'WebhookServer',
          error: error.message,
        });
        reject(error);
      });
    });
  }

  /**
   * Stop the webhook server
   */
  async stop() {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('Webhook server stopped', {
          context: 'WebhookServer',
          metrics: this.metrics,
        });
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  async _handleRequest(req, res) {
    this.metrics.requests++;

    // Parse URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Route requests
    try {
      if (path === '/health' && req.method === 'GET') {
        await this._handleHealth(req, res);
      } else if (path === '/sync/pull' && req.method === 'POST') {
        await this._handleSyncPull(req, res);
      } else if (path === '/sync/push' && req.method === 'POST') {
        await this._handleSyncPush(req, res);
      } else if (path === '/sync/full' && req.method === 'POST') {
        await this._handleSyncFull(req, res);
      } else if (path === '/metrics' && req.method === 'GET') {
        await this._handleMetrics(req, res);
      } else {
        this._sendError(res, 404, 'Not Found');
      }
    } catch (error) {
      logger.error('Request handling error', {
        context: 'WebhookServer',
        path,
        error: error.message,
      });
      this._sendError(res, 500, 'Internal Server Error');
    }
  }

  /**
   * Verify webhook signature
   */
  _verifySignature(req, body) {
    const signature = req.headers['x-webhook-signature'];
    if (!signature) {
      logger.warn('Missing webhook signature', { context: 'WebhookServer' });
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(body)
      .digest('hex');

    const a = Buffer.from(String(signature));
    const b = Buffer.from(expectedSignature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Read request body
   */
  async _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
        if (body.length > 1_000_000) {
          reject(new Error('Request body too large'));
          req.destroy();
        }
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Handle health check
   */
  async _handleHealth(req, res) {
    const health = {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      metrics: this.metrics,
    };

    this._sendJSON(res, 200, health);
  }

  /**
   * Handle sync pull request
   */
  async _handleSyncPull(req, res) {
    const body = await this._readBody(req);

    if (!this._verifySignature(req, body)) {
      this.metrics.unauthorized++;
      this._sendError(res, 401, 'Unauthorized');
      return;
    }

    try {
      logger.info('Webhook triggered: sync pull', { context: 'WebhookServer' });

      // Trigger pull sync
      if (this.syncEngine && typeof this.syncEngine.pullFromN8n === 'function') {
        await this.syncEngine.pullFromN8n();
      }

      this.metrics.successful++;
      this._sendJSON(res, 200, {
        success: true,
        action: 'pull',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.metrics.failed++;
      logger.error('Sync pull failed', {
        context: 'WebhookServer',
        error: error.message,
      });
      this._sendError(res, 500, 'Sync failed: ' + error.message);
    }
  }

  /**
   * Handle sync push request
   */
  async _handleSyncPush(req, res) {
    const body = await this._readBody(req);

    if (!this._verifySignature(req, body)) {
      this.metrics.unauthorized++;
      this._sendError(res, 401, 'Unauthorized');
      return;
    }

    try {
      logger.info('Webhook triggered: sync push', { context: 'WebhookServer' });

      // Trigger push sync
      if (this.syncEngine && typeof this.syncEngine.pushToN8n === 'function') {
        await this.syncEngine.pushToN8n();
      }

      this.metrics.successful++;
      this._sendJSON(res, 200, {
        success: true,
        action: 'push',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.metrics.failed++;
      logger.error('Sync push failed', {
        context: 'WebhookServer',
        error: error.message,
      });
      this._sendError(res, 500, 'Sync failed: ' + error.message);
    }
  }

  /**
   * Handle full sync request
   */
  async _handleSyncFull(req, res) {
    const body = await this._readBody(req);

    if (!this._verifySignature(req, body)) {
      this.metrics.unauthorized++;
      this._sendError(res, 401, 'Unauthorized');
      return;
    }

    try {
      logger.info('Webhook triggered: full sync', { context: 'WebhookServer' });

      // Trigger full sync (pull then push)
      if (this.syncEngine) {
        if (typeof this.syncEngine.pullFromN8n === 'function') {
          await this.syncEngine.pullFromN8n();
        }
        if (typeof this.syncEngine.pushToN8n === 'function') {
          await this.syncEngine.pushToN8n();
        }
      }

      this.metrics.successful++;
      this._sendJSON(res, 200, {
        success: true,
        action: 'full',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.metrics.failed++;
      logger.error('Full sync failed', {
        context: 'WebhookServer',
        error: error.message,
      });
      this._sendError(res, 500, 'Sync failed: ' + error.message);
    }
  }

  /**
   * Handle metrics request
   */
  async _handleMetrics(req, res) {
    this._sendJSON(res, 200, {
      metrics: this.metrics,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send JSON response
   */
  _sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Send error response
   */
  _sendError(res, statusCode, message) {
    this._sendJSON(res, statusCode, {
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }
}

export default WebhookServer;

