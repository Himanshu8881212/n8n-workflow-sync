import { SyncEngine } from './sync-engine.js';
import { config } from './config.js';
import chalk from 'chalk';
import { join } from 'path';

/**
 * Pull workflows from n8n to local files (one-time operation)
 */
async function pullFromN8n() {
  console.log(chalk.bold.blue('\n⬇️  Pull from n8n\n'));
  
  try {
    const workflowsDir = join(process.cwd(), config.paths.workflowsDir);
    const engine = new SyncEngine(workflowsDir);
    
    await engine.initialize();
    await engine.pullFromN8n();
    
    console.log(chalk.green('\n✓ Pull completed\n'));
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('\n✗ Pull failed:', error.message));
    process.exit(1);
  }
}

pullFromN8n();

