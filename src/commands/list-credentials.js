#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { winstonLogger as logger } from '../logger-enhanced.js';
import { validateConfig } from '../config.js';
import { N8nClient } from '../n8n-client.js';

const program = new Command();
program
  .name('credentials')
  .description('List credentials in n8n (id, name, type - never secrets), for referencing them in flow files')
  .option('--type <type>', 'Only this credential type, e.g. slackApi')
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();

async function main() {
  try {
    validateConfig();
    logger.level = 'error';
    const creds = (await new N8nClient().listCredentials())
      .filter((c) => !options.type || c.type === options.type)
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));

    if (options.json) return console.log(JSON.stringify(creds, null, 2));
    if (!creds.length) return console.log(chalk.gray('\nNo credentials. Create them in the n8n UI (Credentials → Add).\n'));
    console.log();
    for (const c of creds) console.log(`  ${c.type.padEnd(28)} ${c.name} ${chalk.gray(`[${c.id}]`)}`);
    console.log(chalk.gray(`\nIn a node: "credentials": { "<type>": { "id": "<id>", "name": "<name>" } }\n`));
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

main();
