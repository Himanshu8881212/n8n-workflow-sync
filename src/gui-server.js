import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { N8nClient } from './n8n-client.js';
import { SyncEngine } from './sync-engine.js';
import { config } from './config.js';
import { defaultLogger as logger } from './logger-enhanced.js';

/**
 * GUI Server - Web-based dashboard for n8n workflow sync
 */
export class GUIServer {
  constructor(options = {}) {
    this.port = options.port || 3001;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.client = new N8nClient(
      config.n8n.apiUrl,
      config.n8n.apiKey
    );

    this.syncEngine = new SyncEngine({
      workflowsDir: config.paths.workflowsDir,
      dryRun: false,
    });

    this.stats = {
      totalWorkflows: 0,
      lastSync: null,
      syncStatus: 'idle',
      errors: [],
    };

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Get stats
    this.app.get('/api/stats', async (req, res) => {
      try {
        const workflows = await this.client.listWorkflows();
        this.stats.totalWorkflows = workflows.length;
        res.json(this.stats);
      } catch (error) {
        logger.error('Failed to get stats', { context: 'GUIServer', error: error.message });
        res.status(500).json({ error: error.message, workflows: [] });
      }
    });

    // List workflows
    this.app.get('/api/workflows', async (req, res) => {
      try {
        const workflows = await this.client.listWorkflows();
        res.json(Array.isArray(workflows) ? workflows : []);
      } catch (error) {
        logger.error('Failed to list workflows', { context: 'GUIServer', error: error.message });
        res.status(500).json({ error: error.message, workflows: [] });
      }
    });

    // Get workflow by ID
    this.app.get('/api/workflows/:id', async (req, res) => {
      try {
        const workflow = await this.client.getWorkflow(req.params.id);
        res.json(workflow);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Trigger pull
    this.app.post('/api/sync/pull', async (req, res) => {
      try {
        this.broadcast({ type: 'sync-start', operation: 'pull' });
        this.stats.syncStatus = 'pulling';

        const result = await this.syncEngine.pullFromN8n();

        this.stats.lastSync = new Date().toISOString();
        this.stats.syncStatus = 'idle';

        this.broadcast({ type: 'sync-complete', operation: 'pull', result });
        res.json(result);
      } catch (error) {
        this.stats.syncStatus = 'error';
        this.stats.errors.push({ timestamp: new Date(), error: error.message });
        this.broadcast({ type: 'sync-error', operation: 'pull', error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Trigger push
    this.app.post('/api/sync/push', async (req, res) => {
      try {
        this.broadcast({ type: 'sync-start', operation: 'push' });
        this.stats.syncStatus = 'pushing';

        const result = await this.syncEngine.pushToN8n();

        this.stats.lastSync = new Date().toISOString();
        this.stats.syncStatus = 'idle';

        this.broadcast({ type: 'sync-complete', operation: 'push', result });
        res.json(result);
      } catch (error) {
        this.stats.syncStatus = 'error';
        this.stats.errors.push({ timestamp: new Date(), error: error.message });
        this.broadcast({ type: 'sync-error', operation: 'push', error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Trigger full sync
    this.app.post('/api/sync/full', async (req, res) => {
      try {
        this.broadcast({ type: 'sync-start', operation: 'full' });
        this.stats.syncStatus = 'syncing';

        const result = await this.syncEngine.fullSync();

        this.stats.lastSync = new Date().toISOString();
        this.stats.syncStatus = 'idle';

        this.broadcast({ type: 'sync-complete', operation: 'full', result });
        res.json(result);
      } catch (error) {
        this.stats.syncStatus = 'error';
        this.stats.errors.push({ timestamp: new Date(), error: error.message });
        this.broadcast({ type: 'sync-error', operation: 'full', error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Activate workflow
    this.app.post('/api/workflows/:id/activate', async (req, res) => {
      try {
        const workflow = await this.client.activateWorkflow(req.params.id);
        this.broadcast({ type: 'workflow-updated', workflow });
        res.json(workflow);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Deactivate workflow
    this.app.post('/api/workflows/:id/deactivate', async (req, res) => {
      try {
        const workflow = await this.client.deactivateWorkflow(req.params.id);
        this.broadcast({ type: 'workflow-updated', workflow });
        res.json(workflow);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete workflow
    this.app.delete('/api/workflows/:id', async (req, res) => {
      try {
        await this.client.deleteWorkflow(req.params.id);
        this.broadcast({ type: 'workflow-deleted', id: req.params.id });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      logger.info('WebSocket client connected', { context: 'GUIServer' });

      // Send current stats
      ws.send(JSON.stringify({ type: 'stats', data: this.stats }));

      ws.on('close', () => {
        logger.info('WebSocket client disconnected', { context: 'GUIServer' });
      });
    });
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) { // OPEN
        client.send(data);
      }
    });
  }

  async start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        logger.info('GUI server started', {
          context: 'GUIServer',
          port: this.port,
          url: `http://localhost:${this.port}`,
        });
        resolve();
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      this.wss.close();
      this.server.close(() => {
        logger.info('GUI server stopped', { context: 'GUIServer' });
        resolve();
      });
    });
  }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new GUIServer({ port: 3001 });
  await server.start();

  console.log('\n🎨 GUI Dashboard running at: http://localhost:3001\n');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down GUI server...');
    await server.stop();
    process.exit(0);
  });
}

