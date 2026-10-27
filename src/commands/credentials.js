#!/usr/bin/env node

/**
 * credentials [list]        names / types / ids (never secrets)
 * credentials push          create/update from <flows>/credentials.n8n.json, secrets from env vars
 * credentials test [names]  have n8n test them with their stored data
 *
 * Run push through a secret manager so values never touch disk:
 *   bws run -- n8n-sync credentials push
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { join } from 'path';
import { existsSync } from 'fs';
import { winstonLogger as logger } from '../logger-enhanced.js';
import { config, validateConfig } from '../config.js';
import { N8nClient } from '../n8n-client.js';
import { pushCredentials, testCredentials } from '../credentials.js';

const program = new Command();
program
  .name('credentials')
  .description('List, push (secrets from env vars) or test n8n credentials. Secret values are never printed.')
  .argument('[action]', 'list | push | test', 'list')
  .argument('[names...]', 'test: credential names or ids (default: all)')
  .option('-d, --directory <path>', 'Folder with credentials.n8n.json', config.paths.workflowsDir)
  .option('--file <path>', 'Credentials file (default: <directory>/credentials.n8n.json)')
  .option('--type <type>', 'list: only this credential type, e.g. slackApi')
  .option('--dry-run', 'push: check the file, env vars and fields without changing n8n')
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();
const [action = 'list', ...names] = program.args;

const LABELS = {
  created: chalk.green('created     '),
  updated: chalk.blue('updated     '),
  'would-create': chalk.yellow('would create'),
  'would-update': chalk.yellow('would update'),
  invalid: chalk.red('INVALID     '),
  error: chalk.red('error       '),
};

async function main() {
  try {
    validateConfig();
    logger.level = 'error';
    const client = new N8nClient();

    if (action === 'list') {
      const creds = (await client.listCredentials())
        .filter((c) => !options.type || c.type === options.type)
        .map((c) => ({ id: c.id, name: c.name, type: c.type }));
      if (options.json) return console.log(JSON.stringify(creds, null, 2));
      if (!creds.length) return console.log(chalk.gray('\nNo credentials. Add them to credentials.n8n.json and run `credentials push`.\n'));
      console.log();
      for (const c of creds) console.log(`  ${c.type.padEnd(28)} ${c.name} ${chalk.gray(`[${c.id}]`)}`);
      console.log(chalk.gray(`\nIn a node: "credentials": { "<type>": { "id": "<id>", "name": "<name>" } }\n`));
      return;
    }

    if (action === 'push') {
      const file = options.file || join(options.directory, 'credentials.n8n.json');
      if (!existsSync(file)) throw new Error(`${file} not found`);
      const result = await pushCredentials(client, file, { dryRun: !!options.dryRun });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(chalk.blue.bold(`\n🔑 Credentials → ${config.n8n.apiUrl}${config.env ? ` (${config.env})` : ''}\n`));
        for (const r of result.results) {
          const vars = r.envVars?.length ? chalk.gray(` ← ${r.envVars.join(', ')}`) : '';
          console.log(`  ${LABELS[r.action]}  ${r.type} "${r.name}"${r.id ? chalk.gray(` [${r.id}]`) : ''}${vars}${r.error ? chalk.red(` - ${r.error}`) : ''}`);
          for (const e of r.errors || []) console.log(chalk.red(`                ✗ ${e}`));
        }
        console.log(chalk.gray('\n  Secret values were not printed or stored.\n'));
      }
      process.exit(result.errors + result.invalid > 0 ? 1 : 0);
    }

    if (action === 'test') {
      const result = await testCredentials(client, names);
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log();
        for (const r of result.results) {
          const mark = { ok: chalk.green('✓'), failed: chalk.red('✗'), 'not-found': chalk.red('?'), untestable: chalk.gray('-') }[r.status];
          console.log(`  ${mark} ${r.name}${r.type ? chalk.gray(` (${r.type})`) : ''}${r.message ? chalk.gray(` - ${r.message}`) : r.status === 'not-found' ? chalk.red(' - not found') : ''}`);
        }
        console.log();
      }
      process.exit(result.failed > 0 ? 1 : 0);
    }

    throw new Error(`unknown action "${action}" (list, push, test)`);
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
