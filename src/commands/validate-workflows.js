#!/usr/bin/env node

/**
 * Offline checks - no n8n connection needed (use in CI on pull requests).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';
import { config } from '../config.js';
import { FileManager } from '../file-manager.js';
import { validateWorkflow } from '../validator.js';
import { isWorkflow } from '../sync-engine.js';

const program = new Command();

program
  .name('validate')
  .description('Check workflow files for mistakes before pushing (no n8n connection needed)')
  .argument('[files...]', 'Specific files (default: every workflow in --directory)')
  .option('-d, --directory <path>', 'Workflows directory', config.paths.workflowsDir)
  .option('--strict', 'Treat warnings as errors')
  .option('--json', 'Print the result as JSON')
  .parse(process.argv);

const options = program.opts();

async function main() {
  const fm = new FileManager(resolve(options.directory));
  const files = program.args.length ? program.args.map((f) => resolve(f)) : await fm.getAllWorkflowFiles();
  const results = [];

  for (const file of files) {
    const rel = fm.getRelativePath(file);
    try {
      const wf = await fm.readWorkflow(file);
      if (!isWorkflow(wf) && !program.args.length) continue; // not a workflow (package.json, ...)
      results.push({ file: rel, name: wf.name, ...validateWorkflow(wf) });
    } catch (error) {
      results.push({ file: rel, errors: [error.message], warnings: [] });
    }
  }

  const errors = results.reduce((n, r) => n + r.errors.length, 0);
  const warnings = results.reduce((n, r) => n + r.warnings.length, 0);

  if (options.json) {
    console.log(JSON.stringify({ files: results.length, errors, warnings, results }, null, 2));
  } else {
    for (const r of results) {
      const mark = r.errors.length ? chalk.red('✗') : r.warnings.length ? chalk.yellow('⚠') : chalk.green('✓');
      console.log(`${mark} ${r.file}`);
      for (const e of r.errors) console.log(chalk.red(`    ✗ ${e}`));
      for (const w of r.warnings) console.log(chalk.yellow(`    ⚠ ${w}`));
    }
    console.log(chalk.gray(`\n${results.length} workflows, ${errors} errors, ${warnings} warnings`));
  }
  process.exit(errors > 0 || (options.strict && warnings > 0) ? 1 : 0);
}

main();
