/**
 * Agents as files, through n8n packages (public API, API key only).
 *
 * The agents folder is an unpacked n8n package, exactly as n8n exports it:
 *
 *   agents/
 *     manifest.json                          what's in the package
 *     agents/<name>-<id>/agent.json          the agent definition (edit this)
 *     agents/<name>-<id>/agent-metadata.json versions (written by n8n)
 *     credentials/<name>-<id>/credential.json credential references (id/name/type, no secrets)
 *
 * pull: POST /n8n-packages/export   (works on current n8n)
 * push: POST /n8n-packages/import   (agent imports need an n8n release after 3.0.0 / 2.46.0,
 *       n8n PR #40892; older n8n rejects it and we say so)
 *
 * Nothing here ever deletes an agent in n8n.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, cp } from 'fs/promises';

const run = promisify(execFile);

// n8n writes package JSON with tabs; keep that so git diffs stay small
const writeJson = (file, data) => writeFile(file, `${JSON.stringify(data, null, '\t')}\n`);
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const newId = () => [...randomBytes(16)].map((b) => ID_CHARS[b % ID_CHARS.length]).join('');

const UNSUPPORTED_IMPORT = /required property 'workflowConflictPolicy'|Agents is not supported yet/i;
const AGENT_NOT_FOUND = /Agent\(s\) not found or not accessible/i;

// n8n requires sourceN8nVersion + sourceId (labels only - echoed back, never compared)
const emptyManifest = () => ({ packageFormatVersion: '1', sourceN8nVersion: 'n8n-sync', sourceId: 'n8n-sync', agents: [], credentials: [], requirements: { credentials: [] } });

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'n8n-agents-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Unpack a .n8np buffer into dir */
export async function unpack(buffer, dir) {
  await withTemp(async (tmp) => {
    const file = join(tmp, 'p.n8np');
    await writeFile(file, buffer);
    await mkdir(dir, { recursive: true });
    await run('tar', ['-xzf', file, '-C', dir]);
  });
}

/** Pack a folder (its non-hidden entries) into a .n8np buffer */
export async function pack(dir) {
  // n8n rejects a package unless manifest.json is the first entry
  const entries = (await readdir(dir)).filter((e) => !e.startsWith('.') && e !== 'manifest.json');
  if (existsSync(join(dir, 'manifest.json'))) entries.unshift('manifest.json');
  return withTemp(async (tmp) => {
    const file = join(tmp, 'p.n8np');
    // COPYFILE_DISABLE: stop macOS tar from adding ._* metadata files
    await run('tar', ['-czf', file, '-C', dir, ...entries], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    return readFile(file);
  });
}

export async function readManifest(dir) {
  const file = join(dir, 'manifest.json');
  return existsSync(file) ? readJson(file) : null;
}

/** Agent folders on disk: [{ folder, target, file, agent }] */
async function localAgents(dir) {
  const root = join(dir, 'agents');
  if (!existsSync(root)) return [];
  const out = [];
  for (const folder of (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const file = join(root, folder, 'agent.json');
    if (existsSync(file)) out.push({ folder, target: `agents/${folder}`, file, agent: await readJson(file) });
  }
  return out;
}

/**
 * Every agent n8n can see: [{ id, name, projectId }].
 * The public API has no "list agents" (and /projects needs a license), so find
 * project ids through workflows and read the agents from a project export.
 * Agents in a project without any workflow aren't found - pull those by id.
 */
export async function discoverAgents(client) {
  const workflows = await client.listWorkflows();
  const projectIds = [...new Set(workflows.flatMap((w) => (w.shared || []).map((s) => s.projectId)).filter(Boolean))];
  if (!projectIds.length) return [];
  const buffer = await client.exportPackage({
    projectIds,
    includeVariableValues: false,
    includeTags: false,
    credentialExportPolicy: 'no-values',
    dependencyPolicy: 'reference-only',
  });
  const manifest = await withTemp(async (tmp) => {
    await unpack(buffer, tmp);
    return readManifest(tmp);
  });
  const projects = manifest?.projects || [];
  return (manifest?.agents || []).map((a) => ({
    id: a.id,
    name: a.name,
    projectId: projects.find((p) => a.target?.startsWith(`${p.target}/`))?.id || null,
  }));
}

/** Resolve names/ids against discovered agents. Unknown values that look like ids pass through. */
function resolveSelection(select, known) {
  return select.map((s) => {
    const hit = known.find((a) => a.id === s) || known.find((a) => a.name === s) || known.find((a) => a.name.toLowerCase() === String(s).toLowerCase());
    if (hit) return hit.id;
    if (/^[A-Za-z0-9]{16}$/.test(s)) return s;
    throw new Error(`No agent "${s}" in n8n (pull by id if its project has no workflows)`);
  });
}

/**
 * Pull agents into dir.
 * @param {Object} opts - { select: names|ids to add, all: every agent n8n can see }
 */
export async function pullAgents(client, dir, { select = [], all = false } = {}) {
  const old = (await readManifest(dir)) || emptyManifest();
  const tracked = (old.agents || []).map((a) => a.id);
  let known = null;
  const discover = async () => (known ??= await discoverAgents(client));

  let ids = [...tracked];
  if (all) ids.push(...(await discover()).map((a) => a.id));
  if (select.length) ids.push(...resolveSelection(select, await discover()));
  ids = [...new Set(ids)];
  if (!ids.length) return { agents: [], kept: [], dir };

  const exportIds = async (agentIds) =>
    client.exportPackage({
      agentIds,
      includeVariableValues: false,
      credentialExportPolicy: 'no-values', // credential files: id/name/type only
      dependencyPolicy: 'reference-only', // workflow tools stay in the workflow sync
    });

  let buffer;
  let missing = [];
  try {
    buffer = await exportIds(ids);
  } catch (error) {
    if (!AGENT_NOT_FOUND.test(error.message)) throw error;
    // n8n doesn't say which; the ones it can't see are local-only (not pushed yet) or deleted
    const visible = new Set((await discover()).map((a) => a.id));
    missing = ids.filter((id) => !visible.has(id));
    const rest = ids.filter((id) => visible.has(id));
    if (!rest.length) return { agents: [], kept: await keepLocal(dir, dir, old, missing), dir };
    buffer = await exportIds(rest);
  }

  return withTemp(async (tmp) => {
    const fresh = join(tmp, 'pkg');
    await unpack(buffer, fresh);
    const manifest = await readManifest(fresh);
    delete manifest.exportedAt; // changes every export, would be git noise

    // Local agents n8n doesn't have (written by hand, not pushed yet) survive a pull
    const exported = new Set((manifest.agents || []).map((a) => a.id));
    const local = (await localAgents(dir)).filter((l) => !l.agent.id || !exported.has(l.agent.id));
    const keepIds = [...new Set([...missing, ...local.map((l) => l.agent.id).filter(Boolean)])];
    const kept = await keepLocal(dir, fresh, old, keepIds, local, manifest);
    await writeJson(join(fresh, 'manifest.json'), manifest);

    // Replace the package part of dir (manifest + top-level folders); other files stay
    await mkdir(dir, { recursive: true });
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory() || e.name === 'manifest.json') await rm(join(dir, e.name), { recursive: true, force: true });
    }
    await cp(fresh, dir, { recursive: true });

    return { agents: (manifest.agents || []).filter((a) => exported.has(a.id)).map(({ id, name }) => ({ id, name })), kept, dir };
  });
}

/**
 * Copy local-only agent folders (and their manifest entries / credentials) from
 * dir into the fresh package. Returns their names.
 */
async function keepLocal(dir, fresh, old, ids, local = null, manifest = null) {
  local ??= await localAgents(dir);
  const keep = local.filter((l) => !l.agent.id || ids.includes(l.agent.id));
  if (fresh === dir || !manifest) return keep.map((l) => l.agent.name || l.folder);
  for (const l of keep) {
    await cp(join(dir, l.target), join(fresh, l.target), { recursive: true });
    const entry = (old.agents || []).find((a) => a.id === l.agent.id);
    if (entry && !manifest.agents.some((a) => a.id === entry.id)) manifest.agents.push(entry);
    // credentials only this agent used
    for (const req of old.requirements?.credentials || []) {
      if (!req.usedBy?.some((u) => u.kind === 'agent' && u.id === l.agent.id)) continue;
      manifest.requirements ??= {};
      manifest.requirements.credentials ??= [];
      if (!manifest.requirements.credentials.some((r) => r.id === req.id)) manifest.requirements.credentials.push(req);
      const cred = (old.credentials || []).find((c) => c.id === req.id);
      manifest.credentials ??= [];
      if (cred && !manifest.credentials.some((c) => c.id === cred.id)) {
        manifest.credentials.push(cred);
        if (existsSync(join(dir, cred.target))) await cp(join(dir, cred.target), join(fresh, cred.target), { recursive: true });
      }
    }
  }
  return keep.map((l) => l.agent.name || l.folder);
}

/**
 * Bring manifest.json in line with the agent folders before a push:
 * - agent.json without an id gets one (new agent written by hand)
 * - agent folders missing from the manifest are added; entries without a folder dropped
 * - the agent's model credential (config.credential) is listed as a requirement,
 *   looked up in n8n when the package doesn't have it yet
 * @returns {{ manifest, agents, warnings }}
 */
export async function prepareManifest(client, dir) {
  const manifest = (await readManifest(dir)) || emptyManifest();
  const warnings = [];
  const agents = await localAgents(dir);
  if (!agents.length) throw new Error(`No agents in ${join(dir, 'agents')} (expected agents/<name>/agent.json)`);

  manifest.packageFormatVersion ??= '1';
  manifest.sourceN8nVersion ||= 'n8n-sync';
  manifest.sourceId ||= 'n8n-sync';
  manifest.agents = (manifest.agents || []).filter((a) => agents.some((l) => l.target === a.target));
  manifest.credentials ??= [];
  manifest.requirements ??= {};
  manifest.requirements.credentials ??= [];
  let credentials = null;

  for (const l of agents) {
    if (!l.agent.name) throw new Error(`${l.file}: "name" is required`);
    // n8n's agent file schema requires these; a hand-written agent can leave them out
    const filled = { id: l.agent.id || newId(), ...l.agent, availableInMCP: l.agent.availableInMCP ?? false, skills: l.agent.skills ?? {}, tools: l.agent.tools ?? {}, tasks: l.agent.tasks ?? {} };
    if (JSON.stringify(filled) !== JSON.stringify(l.agent)) {
      l.agent = filled;
      await writeJson(l.file, l.agent);
    }
    // n8n requires agent-metadata.json; a new agent has no versions yet
    const meta = join(dir, l.target, 'agent-metadata.json');
    if (!existsSync(meta)) await writeJson(meta, { versionId: null, publishedVersionId: null });
    const entry = manifest.agents.find((a) => a.target === l.target);
    if (entry) Object.assign(entry, { id: l.agent.id, name: l.agent.name });
    else manifest.agents.push({ id: l.agent.id, name: l.agent.name, target: l.target });

    const credId = l.agent.config?.credential;
    if (!credId) continue;
    let req = manifest.requirements.credentials.find((r) => r.id === credId);
    if (!req) {
      credentials ??= await client.listCredentials().catch(() => []);
      const cred = credentials.find((c) => c.id === credId || c.name === credId);
      if (!cred) {
        warnings.push(`${l.agent.name}: credential "${credId}" not found in n8n - the import will create an empty placeholder`);
        continue;
      }
      if (cred.id !== credId) {
        l.agent.config.credential = cred.id; // allow a credential name in agent.json
        await writeJson(l.file, l.agent);
      }
      req = manifest.requirements.credentials.find((r) => r.id === cred.id);
      if (!req) {
        req = { id: cred.id, name: cred.name, type: cred.type, usedBy: [] };
        manifest.requirements.credentials.push(req);
      }
      if (!manifest.credentials.some((c) => c.id === cred.id)) {
        const target = `credentials/${slug(cred.name)}-${cred.id}`;
        await mkdir(join(dir, target), { recursive: true });
        await writeJson(join(dir, target, 'credential.json'), { id: cred.id, name: cred.name, type: cred.type });
        manifest.credentials.push({ id: cred.id, name: cred.name, target });
      }
    }
    req.usedBy ??= [];
    if (!req.usedBy.some((u) => u.kind === 'agent' && u.id === l.agent.id)) req.usedBy.push({ kind: 'agent', id: l.agent.id });
  }

  return { manifest, agents: agents.map((l) => ({ id: l.agent.id, name: l.agent.name })), warnings };
}

/**
 * Push the agents folder to n8n as a package.
 * @param {Object} opts - { dryRun, projectId, conflictPolicy, publishingPolicy }
 */
export async function pushAgents(client, dir, { dryRun = false, projectId, conflictPolicy = 'new-version', publishingPolicy } = {}) {
  if (dryRun) {
    // Don't touch files: report what's there
    const agents = (await localAgents(dir)).map((l) => ({ id: l.agent.id || '(new)', name: l.agent.name, file: l.file }));
    return { dryRun: true, agents, warnings: [] };
  }

  const { manifest, agents, warnings } = await prepareManifest(client, dir);
  await writeJson(join(dir, 'manifest.json'), manifest);
  const buffer = await pack(dir);

  try {
    const result = await client.importPackage(buffer, {
      projectId,
      conflictPolicy,
      publishingPolicy,
      idPolicy: 'source', // agents keep their ids, so the next push updates instead of duplicating
    });
    return {
      agents: (result.agents || []).map((a) => ({
        id: a.localId,
        name: a.name,
        status: a.status,
        publishing: a.publishing?.state || null,
        channels: (a.channels || []).filter((c) => c.status === 'setup-required').map((c) => c.setupUrl || c.type),
      })),
      credentials: result.credentials || null,
      warnings,
      sent: agents,
    };
  } catch (error) {
    if (UNSUPPORTED_IMPORT.test(error.message)) {
      const e = new Error(
        'This n8n version cannot import agents yet. Agent import through the public API needs n8n 3.0.1 or newer ' +
          '- update n8n, then push again. ' +
          `Your agent files are ready (${basename(dir)}/).`,
      );
      e.unsupported = true;
      throw e;
    }
    if (error.issues) {
      error.message += `\n${error.issues.map((i) => `  - ${i.message || i.code || JSON.stringify(i)}`).join('\n')}`;
    }
    throw error;
  }
}
