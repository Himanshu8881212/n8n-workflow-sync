#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get package.json
 */
async function getPackageInfo() {
  const packagePath = join(__dirname, '../../package.json');
  const content = await readFile(packagePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Main function
 */
async function main() {
  try {
    const pkg = await getPackageInfo();

    console.log(chalk.bold.blue('\nn8n Workflow Sync Service\n'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('Version:     ') + chalk.green(pkg.version));
    console.log(chalk.bold('Description: ') + pkg.description);
    console.log(chalk.bold('License:     ') + pkg.license);
    console.log(chalk.bold('Author:      ') + pkg.author);
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('Node:        ') + process.version);
    console.log(chalk.bold('Platform:    ') + `${process.platform} ${process.arch}`);
    console.log(chalk.bold('CWD:         ') + process.cwd());
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

main();

