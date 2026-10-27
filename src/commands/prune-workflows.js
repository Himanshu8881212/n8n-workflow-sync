#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { winstonLogger as logger } from '../logger-enhanced.js';
import { config, validateConfig } from '../config.js';
import { SyncEngine } from '../sync-engine.js';

const program = new Command();

program
  .name('prune')
  .description(
    'Delete workflows from n8n whose local file you deleted. Only workflows this folder has synced before are ' +
      'considered - flows never synced from here are never touched.',
  )
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('-y, --yes', 'Actually delete (without it, only lists candidates)')
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();

async function main() {
  try {
    validateConfig();
    logger.level = 'error';

    const engine = new SyncEngine({ workflowsDir: options.directory });
    const candidates = await engine.pruneCandidates();

    if (!candidates.length) {
      if (options.json) console.log(JSON.stringify({ candidates: [], results: [] }));
      else console.log(chalk.green('\n✓ Nothing to prune\n'));
      return;
    }

    if (!options.yes) {
      if (options.json) console.log(JSON.stringify({ candidates, results: [] }, null, 2));
      else {
        console.log(chalk.yellow('\nLocal file deleted, still in n8n:\n'));
        for (const c of candidates) console.log(`  ${c.name} ${chalk.gray(`[${c.id}]`)}${c.active ? chalk.yellow(' (active)') : ''}`);
        console.log(chalk.yellow('\nNothing deleted. Re-run with --yes to delete these from n8n (backups are kept).\n'));
      }
      return;
    }

    const result = await engine.deleteWorkflows(candidates.map((c) => c.id));
    if (options.json) console.log(JSON.stringify({ candidates, ...result }, null, 2));
    else {
      for (const r of result.results) {
        console.log(r.action === 'deleted' ? chalk.green(`  ✓ deleted ${r.name} [${r.id}]`) : chalk.red(`  ✗ ${r.identifier}: ${r.error}`));
      }
      console.log();
    }
    process.exit(result.errors > 0 ? 1 : 0);
  } catch (error) {
    console.error(chalk.red(`✗ Error: ${error.message}`));
    process.exit(1);
  }
}

main();
