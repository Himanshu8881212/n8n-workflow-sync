#!/usr/bin/env node

/**
 * Shell Completion Generator
 * 
 * Generates shell completion scripts for bash and zsh.
 * 
 * @module commands/completion
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get package.json data
 */
function getPackageData() {
  const packagePath = join(__dirname, '../../package.json');
  return JSON.parse(readFileSync(packagePath, 'utf8'));
}

/**
 * Generate bash completion script
 */
export function generateBashCompletion() {
  const pkg = getPackageData();
  const commands = Object.keys(pkg.scripts)
    .filter((cmd) => cmd.startsWith('workflows:') || cmd.startsWith('sync:'))
    .map((cmd) => cmd.replace(/^(workflows|sync):/, ''));

  return `#!/usr/bin/env bash

# Bash completion for n8n-workflow-sync
# 
# Installation:
#   Copy this file to /etc/bash_completion.d/n8n-workflow-sync
#   Or source it in your ~/.bashrc:
#     source /path/to/completion.bash

_n8n_workflow_sync_completions() {
    local cur prev opts
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    # Main commands
    local commands="start dev watch sync:pull sync:push sync:full workflows:list workflows:activate workflows:deactivate workflows:prune version test lint format"

    # Workflow-specific options
    local workflow_opts="--output --format --dry-run --yes --help"
    local output_formats="table json yaml"

    case "\${prev}" in
        --output|--format)
            COMPREPLY=( $(compgen -W "\${output_formats}" -- \${cur}) )
            return 0
            ;;
        workflows:list)
            COMPREPLY=( $(compgen -W "\${workflow_opts}" -- \${cur}) )
            return 0
            ;;
        workflows:activate|workflows:deactivate)
            # TODO: Could fetch actual workflow names from n8n
            COMPREPLY=( $(compgen -W "--dry-run --help" -- \${cur}) )
            return 0
            ;;
        workflows:prune)
            COMPREPLY=( $(compgen -W "--dry-run --yes --help" -- \${cur}) )
            return 0
            ;;
    esac

    # Complete commands
    if [[ \${cur} == -* ]] ; then
        COMPREPLY=( $(compgen -W "\${workflow_opts}" -- \${cur}) )
    else
        COMPREPLY=( $(compgen -W "\${commands}" -- \${cur}) )
    fi
}

complete -F _n8n_workflow_sync_completions npm
complete -F _n8n_workflow_sync_completions yarn
complete -F _n8n_workflow_sync_completions pnpm

# Also complete for direct script execution
complete -F _n8n_workflow_sync_completions n8n-workflow-sync
`;
}

/**
 * Generate zsh completion script
 */
export function generateZshCompletion() {
  const pkg = getPackageData();
  
  return `#compdef n8n-workflow-sync npm yarn pnpm

# Zsh completion for n8n-workflow-sync
#
# Installation:
#   Copy this file to a directory in your $fpath
#   For example: ~/.zsh/completions/_n8n-workflow-sync
#   Then add to ~/.zshrc:
#     fpath=(~/.zsh/completions $fpath)
#     autoload -U compinit && compinit

_n8n_workflow_sync() {
    local -a commands
    commands=(
        'start:Start the auto-sync service'
        'dev:Start in development mode with auto-reload'
        'watch:Watch for file changes'
        'sync\\:pull:Pull workflows from n8n'
        'sync\\:push:Push workflows to n8n'
        'sync\\:full:Full bidirectional sync'
        'workflows\\:list:List all workflows'
        'workflows\\:activate:Activate a workflow'
        'workflows\\:deactivate:Deactivate a workflow'
        'workflows\\:prune:Remove remote workflows not in local directory'
        'version:Show version information'
        'test:Run tests'
        'lint:Run linter'
        'format:Format code'
    )

    local -a workflow_opts
    workflow_opts=(
        '--output[Output format]:format:(table json yaml)'
        '--format[Output format]:format:(table json yaml)'
        '--dry-run[Preview changes without applying]'
        '--yes[Skip confirmation prompts]'
        '--help[Show help information]'
    )

    _arguments -C \\
        '1: :->command' \\
        '*:: :->args'

    case $state in
        command)
            _describe 'command' commands
            ;;
        args)
            case $words[1] in
                workflows:list)
                    _arguments $workflow_opts
                    ;;
                workflows:activate|workflows:deactivate)
                    _arguments \\
                        '1:workflow name or ID:' \\
                        '--dry-run[Preview changes]' \\
                        '--help[Show help]'
                    ;;
                workflows:prune)
                    _arguments \\
                        '--dry-run[Preview changes]' \\
                        '--yes[Skip confirmation]' \\
                        '--help[Show help]'
                    ;;
            esac
            ;;
    esac
}

_n8n_workflow_sync "$@"
`;
}

/**
 * Generate fish completion script
 */
export function generateFishCompletion() {
  return `# Fish completion for n8n-workflow-sync
#
# Installation:
#   Copy this file to ~/.config/fish/completions/n8n-workflow-sync.fish

# Main commands
complete -c npm -n '__fish_seen_subcommand_from run' -a 'start' -d 'Start the auto-sync service'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'dev' -d 'Start in development mode'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'watch' -d 'Watch for file changes'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'sync:pull' -d 'Pull workflows from n8n'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'sync:push' -d 'Push workflows to n8n'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'sync:full' -d 'Full bidirectional sync'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'workflows:list' -d 'List all workflows'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'workflows:activate' -d 'Activate a workflow'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'workflows:deactivate' -d 'Deactivate a workflow'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'workflows:prune' -d 'Prune workflows'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'version' -d 'Show version'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'test' -d 'Run tests'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'lint' -d 'Run linter'
complete -c npm -n '__fish_seen_subcommand_from run' -a 'format' -d 'Format code'

# Options for workflows:list
complete -c npm -n '__fish_seen_subcommand_from workflows:list' -l output -d 'Output format' -a 'table json yaml'
complete -c npm -n '__fish_seen_subcommand_from workflows:list' -l format -d 'Output format' -a 'table json yaml'
complete -c npm -n '__fish_seen_subcommand_from workflows:list' -l dry-run -d 'Preview changes'
complete -c npm -n '__fish_seen_subcommand_from workflows:list' -l help -d 'Show help'

# Options for workflows:activate and workflows:deactivate
complete -c npm -n '__fish_seen_subcommand_from workflows:activate workflows:deactivate' -l dry-run -d 'Preview changes'
complete -c npm -n '__fish_seen_subcommand_from workflows:activate workflows:deactivate' -l help -d 'Show help'

# Options for workflows:prune
complete -c npm -n '__fish_seen_subcommand_from workflows:prune' -l dry-run -d 'Preview changes'
complete -c npm -n '__fish_seen_subcommand_from workflows:prune' -l yes -d 'Skip confirmation'
complete -c npm -n '__fish_seen_subcommand_from workflows:prune' -l help -d 'Show help'
`;
}

/**
 * Main completion command
 */
export async function completionCommand(shell = 'bash') {
  const generators = {
    bash: generateBashCompletion,
    zsh: generateZshCompletion,
    fish: generateFishCompletion,
  };

  const generator = generators[shell];
  if (!generator) {
    console.error(`Unknown shell: ${shell}`);
    console.error('Supported shells: bash, zsh, fish');
    process.exit(1);
  }

  const script = generator();
  console.log(script);
}

// CLI execution
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const shell = process.argv[2] || 'bash';
  completionCommand(shell);
}

