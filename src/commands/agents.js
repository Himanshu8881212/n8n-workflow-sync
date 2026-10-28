#!/usr/bin/env node

/**
 * agents list                 agents n8n can see (name, id, project)
 * agents pull [names|ids...]  refresh tracked agents; add more by name/id, or --all
 * agents push                 create/update agents in n8n from the folder
 *
 * The folder (AGENTS_DIR, default ./agents) is an unpacked n8n package - see src/agents.js.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { winstonLogger as logger } from '../logger-enhanced.js';
import { config, validateConfig } from '../config.js';
import { N8nClient } from '../n8n-client.js';
import { discoverAgents, pullAgents, pushAgents } from '../agents.js';

const program = new Command();
program
  .name('agents')
  .description('Sync n8n agents with files (n8n packages, API key only)')
  .argument('[action]', 'list | pull | push', 'list')
  .argument('[names...]', 'pull: agent names or ids to add')
  .option('-d, --directory <path>', 'Agents folder', config.paths.agentsDir)
  .option('--all', 'pull: every agent n8n can see')
  .option('--project <id>', 'push: target project (default: your personal project)')
  .option('--publish', 'push: publish the pushed agents (publishing policy publish-all)')
  .option('--publishing-policy <policy>', 'push: preserve-published-state | match-source | publish-all | unpublish-all')
  .option('--conflict-policy <policy>', 'push: new-version | skip | fail', 'new-version')
  .option('--dry-run', 'push: show what would be pushed without calling n8n')
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();
const [action = 'list', ...names] = program.args;

const STATUS = { created: chalk.green('created'), updated: chalk.blue('updated'), skipped: chalk.gray('skipped') };

async function main() {
  try {
    validateConfig();
    logger.level = 'error';
    const client = new N8nClient();

    if (action === 'list') {
      const agents = await discoverAgents(client);
      if (options.json) return console.log(JSON.stringify(agents, null, 2));
      if (!agents.length) return console.log(chalk.gray('\nNo agents found (agents in projects without workflows only show up by id).\n'));
      console.log();
      for (const a of agents) console.log(`  ${a.name.padEnd(30)} ${chalk.gray(`[${a.id}]  project ${a.projectId}`)}`);
      console.log(chalk.gray('\nPull: n8n-sync agents pull "<name>"   or   n8n-sync agents pull --all\n'));
      return;
    }

    if (action === 'pull') {
      const result = await pullAgents(client, options.directory, { select: names, all: !!options.all });
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(chalk.blue.bold(`\n⬇  Agents → ${options.directory}\n`));
      if (!result.agents.length && !result.kept.length) console.log(chalk.gray('  Nothing tracked yet - add agents by name/id or use --all.'));
      for (const a of result.agents) console.log(`  ${chalk.green('✓')} ${a.name} ${chalk.gray(`[${a.id}]`)}`);
      for (const k of result.kept) console.log(chalk.yellow(`  ⚠ ${k}: not in n8n - kept the local files (push it, or delete its folder)`));
      console.log();
      return;
    }

    if (action === 'push') {
      const publishingPolicy = options.publish ? 'publish-all' : options.publishingPolicy;
      const result = await pushAgents(client, options.directory, {
        dryRun: !!options.dryRun,
        projectId: options.project,
        conflictPolicy: options.conflictPolicy,
        publishingPolicy,
      });
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(chalk.blue.bold(`\n⬆  ${options.directory} → ${config.n8n.apiUrl}${config.env ? ` (${config.env})` : ''}${result.dryRun ? ' (dry run)' : ''}\n`));
      if (result.dryRun) {
        for (const a of result.agents) console.log(`  ${chalk.yellow('would push')} ${a.name} ${chalk.gray(`[${a.id}]`)}`);
      } else {
        for (const a of result.agents) {
          const pub = a.publishing ? chalk.gray(` - publishing: ${a.publishing}`) : '';
          console.log(`  ${STATUS[a.status] || a.status} ${a.name} ${chalk.gray(`[${a.id}]`)}${pub}`);
          for (const c of a.channels) console.log(chalk.yellow(`      ⚠ channel needs setup: ${c}`));
        }
        const stubbed = result.credentials?.stubbed || [];
        if (stubbed.length) console.log(chalk.yellow(`\n  ⚠ empty credential placeholders created: ${stubbed.join(', ')} - fill them in n8n`));
        console.log(chalk.gray('\n  Run `n8n-sync agents pull` to record the new versions in git.'));
      }
      for (const w of result.warnings) console.log(chalk.yellow(`  ⚠ ${w}`));
      console.log();
      return;
    }

    throw new Error(`unknown action "${action}" (list, pull, push)`);
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(error.unsupported ? 2 : 1);
  }
}

main();
