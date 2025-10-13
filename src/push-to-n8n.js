import { SyncEngine } from './sync-engine.js';
import { config } from './config.js';
import chalk from 'chalk';
import { join } from 'path';

/**
 * Push workflows from local files to n8n (one-time operation)
 */
async function pushToN8n() {
  console.log(chalk.bold.blue('\n⬆️  Push to n8n\n'));
  
  try {
    const workflowsDir = join(process.cwd(), config.paths.workflowsDir);
    const engine = new SyncEngine(workflowsDir);
    
    await engine.initialize();
    await engine.pushToN8n();
    
    console.log(chalk.green('\n✓ Push completed\n'));
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('\n✗ Push failed:', error.message));
    process.exit(1);
  }
}

pushToN8n();

