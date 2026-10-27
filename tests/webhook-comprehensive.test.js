#!/usr/bin/env node

/**
 * Comprehensive Webhook Server Tests
 * 
 * Tests all webhook functionality including:
 * - Server lifecycle
 * - All endpoints
 * - Security features
 * - Error handling
 * - Metrics tracking
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { WebhookServer } from '../src/webhook-server.js';

// Mock sync engine
class MockSyncEngine {
  constructor() {
    this.pullCalled = false;
    this.pushCalled = false;
  }

  async pullFromN8n() {
    this.pullCalled = true;
    return { success: true };
  }

  async pushToN8n() {
    this.pushCalled = true;
    return { success: true };
  }

  reset() {
    this.pullCalled = false;
    this.pushCalled = false;
  }
}

describe('WebhookServer - Comprehensive Tests', () => {
  let server;
  let syncEngine;
  const port = 3100;
  const baseUrl = `http://localhost:${port}`;
  const secret = 'basic-secret';
  // Empty-body POST signed with the shared secret
  const signedPost = {
    method: 'POST',
    headers: { 'X-Webhook-Signature': crypto.createHmac('sha256', secret).update('').digest('hex') },
  };

  before(async () => {
    syncEngine = new MockSyncEngine();
    server = new WebhookServer(syncEngine, {
      port,
      enabled: true,
      secret,
    });
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Server Lifecycle', () => {
    it('should start server successfully', async () => {
      assert.ok(server.server, 'Server should be running');
    });

    it('should have correct port', () => {
      assert.strictEqual(server.port, port);
    });

    it('should initialize metrics', () => {
      const metrics = server.getMetrics();
      assert.strictEqual(typeof metrics.requests, 'number');
      assert.strictEqual(typeof metrics.successful, 'number');
      assert.strictEqual(typeof metrics.failed, 'number');
      assert.strictEqual(typeof metrics.unauthorized, 'number');
    });
  });

  describe('Health Endpoint', () => {
    it('should return health status', async () => {
      const response = await fetch(`${baseUrl}/health`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.status, 'healthy');
      assert.ok(data.uptime >= 0);
      assert.ok(data.timestamp);
      assert.ok(data.metrics);
    });

    it('should include metrics in health response', async () => {
      const response = await fetch(`${baseUrl}/health`);
      const data = await response.json();

      assert.ok(data.metrics.requests >= 0);
      assert.ok(data.metrics.successful >= 0);
      assert.ok(data.metrics.failed >= 0);
      assert.ok(data.metrics.unauthorized >= 0);
    });
  });

  describe('Sync Pull Endpoint', () => {
    it('should trigger pull sync', async () => {
      syncEngine.reset();

      const response = await fetch(`${baseUrl}/sync/pull`, signedPost);

      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.action, 'pull');
      assert.ok(data.timestamp);

      // Verify sync engine was called
      assert.strictEqual(syncEngine.pullCalled, true);
    });

    it('should increment metrics on pull', async () => {
      const beforeMetrics = server.getMetrics();

      await fetch(`${baseUrl}/sync/pull`, signedPost);

      const afterMetrics = server.getMetrics();
      assert.ok(afterMetrics.requests > beforeMetrics.requests);
      assert.ok(afterMetrics.successful > beforeMetrics.successful);
    });
  });

  describe('Sync Push Endpoint', () => {
    it('should trigger push sync', async () => {
      syncEngine.reset();

      const response = await fetch(`${baseUrl}/sync/push`, signedPost);

      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.action, 'push');
      assert.ok(data.timestamp);

      // Verify sync engine was called
      assert.strictEqual(syncEngine.pushCalled, true);
    });
  });

  describe('Full Sync Endpoint', () => {
    it('should trigger full sync', async () => {
      syncEngine.reset();

      const response = await fetch(`${baseUrl}/sync/full`, signedPost);

      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.action, 'full');
      assert.ok(data.timestamp);

      // Verify both pull and push were called
      assert.strictEqual(syncEngine.pullCalled, true);
      assert.strictEqual(syncEngine.pushCalled, true);
    });
  });

  describe('Metrics Endpoint', () => {
    it('should return metrics', async () => {
      const response = await fetch(`${baseUrl}/metrics`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.ok(data.metrics);
      assert.ok(data.uptime >= 0);
      assert.ok(data.timestamp);
    });

    it('should have accurate request count', async () => {
      const before = await fetch(`${baseUrl}/metrics`);
      const beforeData = await before.json();

      // Make a request
      await fetch(`${baseUrl}/health`);

      const after = await fetch(`${baseUrl}/metrics`);
      const afterData = await after.json();

      assert.ok(afterData.metrics.requests > beforeData.metrics.requests);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoint', async () => {
      const response = await fetch(`${baseUrl}/unknown`);
      assert.strictEqual(response.status, 404);

      const data = await response.json();
      assert.ok(data.error);
    });

    it('should reject wrong HTTP method', async () => {
      const response = await fetch(`${baseUrl}/sync/pull`, {
        method: 'GET',
      });
      assert.strictEqual(response.status, 404);
    });
  });

  describe('CORS Headers', () => {
    it('should not allow cross-origin browser access', async () => {
      const response = await fetch(`${baseUrl}/health`);
      assert.strictEqual(response.headers.get('access-control-allow-origin'), null);
    });
  });
});

describe('WebhookServer - Security Tests', () => {
  let server;
  let syncEngine;
  const port = 3101;
  const baseUrl = `http://localhost:${port}`;
  const secret = 'test-secret-key';

  before(async () => {
    syncEngine = new MockSyncEngine();
    server = new WebhookServer(syncEngine, {
      port,
      enabled: true,
      secret,
    });
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
  });

  function generateSignature(body) {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  describe('Signature Verification', () => {
    it('should reject request without signature', async () => {
      const response = await fetch(`${baseUrl}/sync/pull`, {
        method: 'POST',
      });

      assert.strictEqual(response.status, 401);

      const data = await response.json();
      assert.ok(data.error);
    });

    it('should accept request with valid signature', async () => {
      const body = '';
      const signature = generateSignature(body);

      const response = await fetch(`${baseUrl}/sync/pull`, {
        method: 'POST',
        headers: {
          'X-Webhook-Signature': signature,
        },
      });

      assert.strictEqual(response.status, 200);
    });

    it('should reject request with invalid signature', async () => {
      const response = await fetch(`${baseUrl}/sync/pull`, {
        method: 'POST',
        headers: {
          'X-Webhook-Signature': 'invalid-signature',
        },
      });

      assert.strictEqual(response.status, 401);
    });

    it('should track unauthorized attempts', async () => {
      const beforeMetrics = server.getMetrics();

      await fetch(`${baseUrl}/sync/pull`, {
        method: 'POST',
        headers: {
          'X-Webhook-Signature': 'wrong-signature',
        },
      });

      const afterMetrics = server.getMetrics();
      assert.ok(afterMetrics.unauthorized > beforeMetrics.unauthorized);
    });
  });

  describe('GET Endpoints (No Signature Required)', () => {
    it('should allow health check without signature', async () => {
      const response = await fetch(`${baseUrl}/health`);
      assert.strictEqual(response.status, 200);
    });

    it('should allow metrics without signature', async () => {
      const response = await fetch(`${baseUrl}/metrics`);
      assert.strictEqual(response.status, 200);
    });
  });
});

describe('WebhookServer - Disabled State', () => {
  it('should not start when disabled', async () => {
    const syncEngine = new MockSyncEngine();
    const server = new WebhookServer(syncEngine, {
      port: 3102,
      enabled: false,
    });

    await server.start();
    assert.strictEqual(server.server, null);
  });

  it('should refuse to start without a secret', async () => {
    const server = new WebhookServer(new MockSyncEngine(), { port: 3103, enabled: true, secret: null });
    await assert.rejects(server.start(), /WEBHOOK_SECRET/);
  });
});

