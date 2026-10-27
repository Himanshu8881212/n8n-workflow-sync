import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config is per project: the first file that sets a variable wins.
//   1. <project>/.env.<N8N_ENV>   (e.g. N8N_ENV=prod -> .env.prod, or `n8n-sync --env prod`)
//   2. <project>/.env
//   3. <tool repo>/.env           (global fallback)
// Real environment variables beat all of them (CI secrets).
const envName = process.env.N8N_ENV;
const envFiles = [
  ...(envName ? [join(process.cwd(), `.env.${envName}`)] : []),
  join(process.cwd(), '.env'),
  join(__dirname, '../.env'),
];
for (const path of envFiles) {
  dotenv.config({ path, quiet: true });
}

export const config = {
  env: envName || null,

  // n8n Configuration
  n8n: {
    apiUrl: process.env.N8N_API_URL || 'http://localhost:5678/api/v1',
    apiKey: process.env.N8N_API_KEY || '',
    // Base URL for calling production webhooks (`run`). Defaults to the API host.
    webhookUrl: process.env.N8N_WEBHOOK_URL || null,
  },

  // Sync Configuration
  sync: {
    watchEnabled: process.env.WATCH_ENABLED === 'true',
    autoPull: process.env.AUTO_PULL === 'true',
    debounceMs: parseInt(process.env.DEBOUNCE_MS) || 1000,
    dryRun: process.env.DRY_RUN === 'true',
  },

  // Paths
  paths: {
    workflowsDir: process.env.WORKFLOWS_DIR || './workflows',
  },

  // Filtering
  filters: {
    ignorePatterns: (process.env.IGNORE_PATTERNS || 'node_modules/**,*.log,*.tmp,.git/**').split(','),
    includePatterns: (process.env.INCLUDE_PATTERNS || '**/*.json,**/*.yaml,**/*.yml').split(','),
  },

  // Webhook Server
  webhook: {
    enabled: process.env.WEBHOOK_ENABLED === 'true',
    port: parseInt(process.env.WEBHOOK_PORT) || 3000,
    secret: process.env.WEBHOOK_SECRET || null,
  },

  // GUI Server
  gui: {
    host: process.env.GUI_HOST || '127.0.0.1',
    port: parseInt(process.env.GUI_PORT) || 3001,
  },
};

/**
 * Validate configuration
 * @throws {Error} If configuration is invalid
 * @returns {boolean} True if configuration is valid
 */
export function validateConfig() {
  const errors = [];

  if (!config.n8n.apiUrl) {
    errors.push('N8N_API_URL is required');
  }

  if (!config.n8n.apiKey) {
    errors.push(
      `N8N_API_KEY is required (n8n → Settings → n8n API → Create API key). ` +
        `Put it in ${envName ? `.env.${envName} or ` : ''}.env in your project folder.`,
    );
  }

  if (config.webhook.enabled && !config.webhook.secret) {
    errors.push('WEBHOOK_SECRET is required when WEBHOOK_ENABLED=true');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }

  return true;
}
