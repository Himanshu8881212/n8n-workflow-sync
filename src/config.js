import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

export const config = {
  // n8n Configuration
  n8n: {
    apiUrl: process.env.N8N_API_URL || 'http://localhost:5678/api/v1',
    apiKey: process.env.N8N_API_KEY || '',
  },

  // Sync Configuration
  sync: {
    intervalMs: parseInt(process.env.SYNC_INTERVAL_MS) || 5000,
    watchEnabled: process.env.WATCH_ENABLED === 'true',
    autoPush: process.env.AUTO_PUSH === 'true',
    autoPull: process.env.AUTO_PULL === 'true',
    debounceMs: parseInt(process.env.DEBOUNCE_MS) || 1000,
    batchSize: parseInt(process.env.BATCH_SIZE) || 10,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
    dryRun: process.env.DRY_RUN === 'true',
  },

  // Paths
  paths: {
    workflowsDir: process.env.WORKFLOWS_DIR || '../Generation Methods',
    syncStateFile: process.env.SYNC_STATE_FILE || '.sync-state.json',
    rootDir: join(__dirname, '../../..'),
  },

  // Conflict Resolution
  conflict: {
    strategy: process.env.CONFLICT_STRATEGY || 'newest_wins',
    // Options: local_wins, remote_wins, newest_wins, manual
  },

  // Git Integration
  git: {
    autoCommit: process.env.AUTO_COMMIT === 'true',
    commitMessagePrefix: process.env.COMMIT_MESSAGE_PREFIX || '[Auto-Sync]',
  },

  // Filtering
  filters: {
    ignorePatterns: (process.env.IGNORE_PATTERNS || 'node_modules/**,*.log,*.tmp,.git/**').split(','),
    includePatterns: (process.env.INCLUDE_PATTERNS || '**/*.json').split(','),
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

// Validate configuration
export function validateConfig() {
  const errors = [];

  if (!config.n8n.apiUrl) {
    errors.push('N8N_API_URL is required');
  }

  if (!config.n8n.apiKey) {
    errors.push('N8N_API_KEY is required');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }

  return true;
}

