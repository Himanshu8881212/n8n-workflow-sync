#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { copyFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const TEMPLATE = fileURLToPath(new URL('../../templates/project', import.meta.url));
// npm drops dotfiles like .gitignore from packages, so the template stores them without the dot
const RENAME = { gitignore: '.gitignore', 'env.example': '.env.example' };

const program = new Command();
program
  .name('init')
  .description('Set up a folder for n8n flows: example flow, CLAUDE.md, .env.example, .gitignore, GitHub Action')
  .argument('[dir]', 'Target folder', '.')
  .parse(process.argv);

async function main() {
  const target = resolve(program.args[0] || '.');
  const files = (await readdir(TEMPLATE, { recursive: true, withFileTypes: true })).filter((e) => e.isFile());
  const created = [];
  const kept = [];
  for (const f of files) {
    const src = join(f.parentPath ?? f.path, f.name);
    const rel = RENAME[relative(TEMPLATE, src)] || relative(TEMPLATE, src);
    const dest = join(target, rel);
    if (existsSync(dest)) {
      kept.push(rel);
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
    created.push(rel);
  }

  console.log(chalk.green(`\n✓ ${target}\n`));
  for (const f of created) console.log(chalk.green(`  + ${f}`));
  for (const f of kept) console.log(chalk.gray(`  = ${f} (exists, not changed)`));
  console.log(`
Next:
  1. cp .env.example .env   and set N8N_API_URL + N8N_API_KEY
  2. n8n-sync push --activate
  3. n8n-sync run "Hello Webhook" --data '{"name":"you"}'
`);
}

main();
