#!/usr/bin/env node

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Interactive setup wizard
 */
class SetupWizard {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Ask a question
   */
  async ask(question, defaultValue = '') {
    return new Promise((resolve) => {
      const prompt = defaultValue 
        ? `${question} (${chalk.gray(defaultValue)}): `
        : `${question}: `;
      
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  /**
   * Run setup wizard
   */
  async run() {
    console.log(chalk.bold.blue('\n🔧 n8n Workflow Sync - Setup Wizard\n'));
    
    const config = {};

    // n8n Configuration
    console.log(chalk.bold('n8n Configuration:'));
    config.N8N_API_URL = await this.ask('n8n API URL', 'http://localhost:5678/api/v1');
    config.N8N_API_KEY = await this.ask('n8n API Key');

    // Sync Configuration
    console.log(chalk.bold('\nSync Configuration:'));
    config.SYNC_INTERVAL_MS = await this.ask('Sync interval (ms)', '5000');
    config.WATCH_ENABLED = await this.ask('Enable file watching? (true/false)', 'true');
    config.AUTO_PUSH = await this.ask('Auto-push local changes? (true/false)', 'true');
    config.AUTO_PULL = await this.ask('Auto-pull remote changes? (true/false)', 'true');

    // Paths
    console.log(chalk.bold('\nPaths:'));
    config.WORKFLOWS_DIR = await this.ask('Workflows directory', '../Generation Methods');

    // Conflict Resolution
    console.log(chalk.bold('\nConflict Resolution:'));
    console.log(chalk.gray('  Options: local_wins, remote_wins, newest_wins, manual'));
    config.CONFLICT_STRATEGY = await this.ask('Conflict strategy', 'newest_wins');

    // Git Integration
    console.log(chalk.bold('\nGit Integration:'));
    config.AUTO_COMMIT = await this.ask('Auto-commit changes? (true/false)', 'false');
    config.COMMIT_MESSAGE_PREFIX = await this.ask('Commit message prefix', '[Auto-Sync]');

    // Performance
    console.log(chalk.bold('\nPerformance:'));
    config.DEBOUNCE_MS = await this.ask('Debounce delay (ms)', '1000');
    config.BATCH_SIZE = await this.ask('Batch size', '10');

    this.rl.close();

    // Write .env file
    await this.writeEnvFile(config);

    console.log(chalk.bold.green('\n✓ Setup completed!\n'));
    console.log(chalk.blue('Next steps:'));
    console.log(chalk.gray('  1. Review the .env file'));
    console.log(chalk.gray('  2. Run: npm install'));
    console.log(chalk.gray('  3. Run: npm start\n'));
  }

  /**
   * Write .env file
   */
  async writeEnvFile(config) {
    const envPath = join(__dirname, '../.env');
    
    if (existsSync(envPath)) {
      const overwrite = await this.ask(
        chalk.yellow('\n.env file already exists. Overwrite? (yes/no)'),
        'no'
      );
      if (overwrite.toLowerCase() !== 'yes') {
        console.log(chalk.yellow('Skipping .env file creation'));
        return;
      }
    }

    const envContent = Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    await writeFile(envPath, envContent + '\n', 'utf-8');
    console.log(chalk.green(`\n✓ Created .env file at ${envPath}`));
  }
}

// Run setup wizard
const wizard = new SetupWizard();
wizard.run().catch((error) => {
  console.error(chalk.red('\n✗ Setup failed:'), error.message);
  process.exit(1);
});

