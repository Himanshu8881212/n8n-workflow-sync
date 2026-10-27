#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { winstonLogger as logger } from '../logger-enhanced.js';
import { validateConfig } from '../config.js';
import { SyncEngine } from '../sync-engine.js';

const program = new Command();

program
  .name('executions')
  .description('Show recent runs of a workflow, with the error and failing node for failed runs')
  .argument('<workflow>', 'Workflow id or exact name')
  .option('-n, --limit <n>', 'How many runs', '5')
  .option('--failed', 'Only failed runs')
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();

function printExecution(e) {
  const color = e.status === 'success' ? chalk.green : e.status === 'error' || e.status === 'crashed' ? chalk.red : chalk.yellow;
  const took = e.durationMs != null ? `${e.durationMs}ms` : '';
  console.log(`  ${color(e.status.padEnd(8))} #${e.id}  ${new Date(e.startedAt).toLocaleString()}  ${chalk.gray(`${e.mode} ${took}`)}`);
  if (e.error) console.log(chalk.red(`           ✗ ${e.error.node ? `[${e.error.node}] ` : ''}${e.error.message}`));
  for (const ne of e.nodeErrors || []) {
    if (ne.message !== e.error?.message) console.log(chalk.red(`           ✗ [${ne.node}] ${ne.message}`));
  }
}

async function main() {
  try {
    validateConfig();
    logger.level = 'error';
    const engine = new SyncEngine({});
    const result = await engine.getExecutions(program.args[0], { limit: parseInt(options.limit) || 5, status: options.failed ? 'error' : undefined });

    if (options.json) return console.log(JSON.stringify(result, null, 2));
    console.log(chalk.blue.bold(`\n📜 ${result.workflow.name} ${chalk.gray(`[${result.workflow.id}]`)}${result.workflow.active ? '' : chalk.yellow(' (inactive)')}\n`));
    if (!result.executions.length) console.log(chalk.gray('  No executions yet'));
    result.executions.forEach(printExecution);
    console.log();
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
