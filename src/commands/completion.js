#!/usr/bin/env node

/**
 * Print a shell completion script for n8n-sync:
 *   n8n-sync completion zsh  >> ~/.zshrc
 *   n8n-sync completion bash >> ~/.bashrc
 *   n8n-sync completion fish > ~/.config/fish/completions/n8n-sync.fish
 */

import { COMMANDS } from '../commands-list.js';

const names = Object.keys(COMMANDS);
const shell = process.argv[2] || 'bash';

const scripts = {
  bash: `_n8n_sync() { local cur=\${COMP_WORDS[COMP_CWORD]}; [ "$COMP_CWORD" -eq 1 ] && COMPREPLY=( $(compgen -W "${names.join(' ')}" -- "$cur") ); }
complete -o default -F _n8n_sync n8n-sync`,
  zsh: `_n8n_sync() { local -a cmds; cmds=(${names.map((n) => `'${n}:${COMMANDS[n][1].replace(/'/g, '')}'`).join(' ')}); _arguments '1:command:->c' '*::arg:_files'; [[ $state == c ]] && _describe command cmds; }
compdef _n8n_sync n8n-sync`,
  fish: names.map((n) => `complete -c n8n-sync -n __fish_use_subcommand -a ${n} -d '${COMMANDS[n][1].replace(/'/g, '')}'`).join('\n'),
};

if (!scripts[shell]) {
  console.error(`Unknown shell "${shell}" (bash, zsh, fish)`);
  process.exit(1);
}
console.log(scripts[shell]);
