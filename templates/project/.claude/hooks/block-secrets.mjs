// PreToolUse hook: refuse Bash commands that could show secret values to Claude.
// Deny rules in settings.json only match a command's start; this checks the whole
// text, so `bws run -- printenv` or `sh -c 'cat .env'` are caught too.
// ponytail: pattern-based, so it narrows the risk rather than closing it - a script
// written to print secrets can still slip through. For a hard guarantee, keep the
// secret manager token out of Claude's shell and run `credentials push` yourself.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const command = JSON.parse(input || '{}').tool_input?.command || '';

const text = command
  .replace(/--env-file[= ]\S*/g, '') // `op run --env-file=.env -- …` only passes refs through
  .replace(/\.env\.example\b/g, '');

const rules = [
  [/\bprintenv\b/, 'printenv'],
  [/(^|[\s;&|(`])env\s*($|[|;&>)`])/, 'env (prints all variables)'],
  [/\bexport\s+-p\b|\bdeclare\s+-x\b|(^|[\s;&|])set\s*($|[|;&>])/, 'shell variable dump'],
  [/\bbws\s+secret\b/, 'bws secret'],
  [/\bop\s+(read|inject|item\s+get)\b/, '1Password read'],
  [/\bsecurity\s+find-(generic|internet)-password\b/, 'keychain read'],
  [/process\.env\b(?!\.(N8N_ENV|NODE_ENV)\b)|os\.environ|ENV\[/, 'reading environment variables in code'],
  [/(^|[^\w-])\.env(\.[\w-]+)?\b/, '.env file'],
  [/\.n8n-sync\/backups/, 'backups'],
];

for (const [pattern, what] of rules) {
  if (pattern.test(text)) {
    console.error(
      `Blocked by this project's secret policy (${what}): this command could reveal secret values. ` +
        `Don't read secrets - reference them as {{env.NAME}} in flows/credentials.n8n.json and ask the user to run ` +
        `\`bws run -- n8n-sync credentials push\` (or the 1Password equivalent) themselves.`,
    );
    process.exit(2);
  }
}
