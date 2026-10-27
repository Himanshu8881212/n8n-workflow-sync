#!/usr/bin/env node

/**
 * n8n-sync <command> [args]   - single entry point (npx / bin).
 * Global option: --env <name> loads .env.<name> from the current folder (e.g. --env prod).
 */

import { fileURLToPath, pathToFileURL } from 'url';

import { COMMANDS } from './commands-list.js';

const args = process.argv.slice(2);
const envAt = args.findIndex((a) => a === '--env' || a.startsWith('--env='));
if (envAt !== -1) {
  const [flag, inline] = args[envAt].split('=');
  process.env.N8N_ENV = inline ?? args[envAt + 1];
  args.splice(envAt, inline !== undefined ? 1 : 2);
  void flag;
}

const [name, ...rest] = args;
if (!name || name === '-h' || name === '--help' || !COMMANDS[name]) {
  if (name && !['-h', '--help'].includes(name)) console.error(`Unknown command: ${name}\n`);
  console.log('Usage: n8n-sync [--env <name>] <command> [options]\n');
  for (const [cmd, [, desc]] of Object.entries(COMMANDS)) console.log(`  ${cmd.padEnd(12)} ${desc}`);
  console.log('\nRun `n8n-sync <command> --help` for options.');
  process.exit(name && !['-h', '--help'].includes(name) ? 1 : 0);
}

const script = fileURLToPath(new URL(COMMANDS[name][0], import.meta.url));
if (name === 'data-tables' || name === 'variables') process.env.N8N_SYNC_RESOURCE = name;
// Each command parses process.argv itself and (some) check that they're the main module
process.argv = [process.argv[0], script, ...rest];
await import(pathToFileURL(script).href);
