/**
 * Credentials as code, without secrets in files.
 *
 * <flows>/credentials.n8n.json lists the credentials flows need. Secret values
 * are references to environment variables, filled in at run time by a secret
 * manager, e.g.
 *
 *   [{ "name": "OpenAI", "type": "openAiApi", "data": { "apiKey": "{{env.OPENAI_API_KEY}}" } }]
 *
 *   bws run -- n8n-sync credentials push        (Bitwarden Secrets Manager)
 *   op run --env-file=.env -- n8n-sync credentials push   (1Password)
 *
 * Secret values are never printed, logged, written to disk or returned:
 * results only contain names, types, ids, field names and env var names, and
 * any error text from n8n is scrubbed of the values that were sent.
 *
 * @module credentials
 */

import { readFile } from 'fs/promises';

const ENV_REF = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Replace {{env.NAME}} references (recursively) with values from `env`.
 * @returns {{ value: any, vars: string[], missing: string[], secrets: string[] }}
 */
export function resolveSecrets(value, env = process.env) {
  const vars = new Set();
  const missing = new Set();
  const secrets = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      return v.replace(ENV_REF, (_, name) => {
        vars.add(name);
        const resolved = env[name];
        if (resolved === undefined || resolved === '') {
          missing.add(name);
          return '';
        }
        secrets.add(resolved);
        return resolved;
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), vars: [...vars], missing: [...missing], secrets: [...secrets] };
}

/**
 * Remove every secret value from a message (n8n validation errors can echo input).
 */
export function scrub(message, secrets) {
  let out = String(message ?? '');
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('***');
  return out;
}

/**
 * Field names the credential type requires / allows, from n8n's schema.
 */
function checkAgainstSchema(schema, data) {
  const problems = [];
  const fields = Object.keys(schema?.properties || {});
  for (const req of schema?.required || []) {
    if (data[req] === undefined || data[req] === '') problems.push(`missing field "${req}"`);
  }
  if (schema?.additionalProperties === false && fields.length) {
    for (const key of Object.keys(data)) {
      if (!fields.includes(key)) problems.push(`unknown field "${key}" (fields: ${fields.join(', ')})`);
    }
  }
  return problems;
}

/**
 * Create missing / update existing credentials from the file.
 * Matched by type + name (same rule flows use), so it works per instance.
 */
export async function pushCredentials(client, filePath, { dryRun = false, env = process.env } = {}) {
  const wanted = JSON.parse(await readFile(filePath, 'utf-8'));
  if (!Array.isArray(wanted)) throw new Error(`${filePath} must be a JSON array of { name, type, data }`);

  const existing = await client.listCredentials();
  const schemas = new Map();
  const results = [];

  for (const entry of wanted) {
    const base = { name: entry?.name, type: entry?.type };
    if (!entry?.name || !entry?.type || typeof entry.data !== 'object') {
      results.push({ ...base, action: 'error', error: 'needs "name", "type" and a "data" object' });
      continue;
    }

    const { value: data, vars, missing, secrets } = resolveSecrets(entry.data, env);
    if (missing.length) {
      results.push({ ...base, action: 'error', error: `environment variables not set: ${missing.join(', ')}`, envVars: vars });
      continue;
    }

    try {
      if (!schemas.has(entry.type)) {
        schemas.set(entry.type, await client.getCredentialSchema(entry.type).catch((e) => (e.status === 404 ? null : Promise.reject(e))));
      }
      const schema = schemas.get(entry.type);
      if (!schema) {
        results.push({ ...base, action: 'error', error: `unknown credential type "${entry.type}"` });
        continue;
      }

      const found = existing.find((c) => c.type === entry.type && c.name === entry.name);
      // Updates merge with stored data, so only the fields given must be valid
      const problems = checkAgainstSchema(found ? { ...schema, required: [] } : schema, data);
      if (problems.length) {
        results.push({ ...base, action: 'invalid', errors: problems, envVars: vars });
        continue;
      }

      if (dryRun) {
        results.push({ ...base, action: found ? 'would-update' : 'would-create', ...(found ? { id: found.id } : {}), envVars: vars });
      } else if (found) {
        await client.updateCredential(found.id, data);
        results.push({ ...base, id: found.id, action: 'updated', envVars: vars });
      } else {
        const created = await client.createCredential(entry.name, entry.type, data);
        results.push({ ...base, id: created.id, action: 'created', envVars: vars });
      }
    } catch (error) {
      results.push({ ...base, action: 'error', error: scrub(error.message, secrets) });
    }
  }

  const count = (a) => results.filter((r) => r.action === a).length;
  return {
    created: count('created'),
    updated: count('updated'),
    invalid: count('invalid'),
    errors: count('error'),
    results,
  };
}

/**
 * Have n8n test credentials with their stored data. All by default, or by name/id.
 */
export async function testCredentials(client, identifiers = []) {
  const all = await client.listCredentials();
  const targets = identifiers.length ? all.filter((c) => identifiers.includes(c.name) || identifiers.includes(String(c.id))) : all;
  const notFound = identifiers.filter((i) => !all.some((c) => c.name === i || String(c.id) === i));

  const results = notFound.map((name) => ({ name, status: 'not-found' }));
  for (const c of targets) {
    try {
      const r = await client.testCredential(c.id);
      // n8n has no test for some types (e.g. header auth) - that's not a failure
      const status = r?.status === 'OK' ? 'ok' : /no testing function/i.test(r?.message || '') ? 'untestable' : 'failed';
      results.push({ name: c.name, type: c.type, id: c.id, status, message: r?.message });
    } catch (error) {
      results.push({ name: c.name, type: c.type, id: c.id, status: 'untestable', message: error.message });
    }
  }
  return {
    ok: results.filter((r) => r.status === 'ok').length,
    untestable: results.filter((r) => r.status === 'untestable').length,
    failed: results.filter((r) => r.status === 'failed' || r.status === 'not-found').length,
    results,
  };
}
