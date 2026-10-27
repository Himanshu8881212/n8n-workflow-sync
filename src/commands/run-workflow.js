#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { winstonLogger as logger } from '../logger-enhanced.js';
import { validateConfig } from '../config.js';
import { SyncEngine } from '../sync-engine.js';

const program = new Command();

program
  .name('run')
  .description("Call an active workflow's webhook and show the response and the resulting execution (errors included)")
  .argument('<workflow>', 'Workflow id or exact name')
  .option('--data <json>', 'JSON body to send', '{}')
  .option('-X, --method <method>', 'HTTP method (default: the webhook node\'s method)')
  .option('--timeout <ms>', 'How long to wait for the execution to finish', '15000')
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();

async function main() {
  try {
    validateConfig();
    logger.level = 'error';
    let data;
    try {
      data = JSON.parse(options.data);
    } catch {
      throw new Error(`--data is not valid JSON: ${options.data}`);
    }

    const engine = new SyncEngine({});
    const result = await engine.runWorkflow(program.args[0], { data, method: options.method, timeoutMs: parseInt(options.timeout) || 15000 });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const { response: res, execution: e } = result;
      console.log(chalk.blue.bold(`\n▶ ${result.workflow.name}`) + chalk.gray(`  ${result.request.method} ${result.request.url}\n`));
      console.log(`  HTTP ${res.status < 400 ? chalk.green(res.status) : chalk.red(res.status)}  ${chalk.gray(typeof res.body === 'string' ? res.body : JSON.stringify(res.body))}`);
      if (!e) console.log(chalk.yellow('  No finished execution found yet (still running, or execution saving is off)'));
      else {
        const color = e.status === 'success' ? chalk.green : chalk.red;
        console.log(`  Run  ${color(e.status)} #${e.id} ${chalk.gray(`${e.durationMs}ms, last node: ${e.lastNode}`)}`);
        if (e.error) console.log(chalk.red(`       ✗ ${e.error.node ? `[${e.error.node}] ` : ''}${e.error.message}`));
        for (const ne of e.nodeErrors || []) if (ne.message !== e.error?.message) console.log(chalk.red(`       ✗ [${ne.node}] ${ne.message}`));
      }
      console.log();
    }
    process.exit(result.execution && result.execution.status !== 'success' ? 1 : 0);
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
