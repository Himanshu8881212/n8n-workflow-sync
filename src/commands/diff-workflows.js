#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { winstonLogger as logger } from '../logger-enhanced.js';
import { config, validateConfig } from '../config.js';
import { SyncEngine } from '../sync-engine.js';

const program = new Command();
program
  .name('diff')
  .description("Compare this folder's flow files with n8n and say which side changed (exit 1 if anything differs)")
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();

const hint = (r) => {
  if (r.localChanged && r.n8nChanged) return chalk.red('both sides changed - pull --force or push --force after merging by hand');
  if (r.localChanged) return chalk.blue('changed locally → push');
  if (r.n8nChanged) return chalk.magenta('changed in n8n → pull');
  return chalk.gray('no sync record here → pull --force (take n8n) or push --force (take file)');
};

async function main() {
  try {
    validateConfig();
    logger.level = 'error';
    const results = await new SyncEngine({ workflowsDir: options.directory }).diff();

    if (options.json) console.log(JSON.stringify(results, null, 2));
    else {
      console.log(chalk.blue.bold(`\n🔍 ${options.directory} vs ${config.n8n.apiUrl}${config.env ? ` (${config.env})` : ''}\n`));
      for (const r of results) {
        if (r.status === 'unchanged') console.log(chalk.green(`  ✓ ${r.file}`));
        else if (r.status === 'changed') console.log(`  ${chalk.yellow('≠')} ${r.file} ${chalk.gray(`(${r.fields.join(', ')})`)} - ${hint(r)}`);
        else if (r.status === 'not-in-n8n') console.log(`  ${chalk.blue('+')} ${r.file} ${chalk.gray('- not in n8n yet → push')}`);
        else if (r.status === 'deleted-locally') console.log(`  ${chalk.red('-')} ${r.name} [${r.id}] ${chalk.gray('- file deleted, still in n8n → prune')}`);
        else console.log(chalk.red(`  ✗ ${r.file}: ${r.error}`));
      }
      if (!results.length) console.log(chalk.gray('  No flow files here.'));
      console.log();
    }
    process.exit(results.some((r) => r.status !== 'unchanged') ? 1 : 0);
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
