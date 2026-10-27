#!/usr/bin/env node

/**
 * Sync Engine
 *
 * Pull: n8n -> local files. Push: local files -> n8n (optionally activating).
 * Both directions refuse to overwrite changes made on the other side since
 * the last sync (see state.js) unless forced, and back up what they replace.
 *
 * @module sync-engine
 */

import { existsSync } from 'fs';
import { readFile, writeFile, unlink } from 'fs/promises';
import { join, resolve, dirname, basename, extname, relative, sep } from 'path';
import { winstonLogger as logger } from './logger-enhanced.js';
import { N8nClient, toApiBody } from './n8n-client.js';
import { FileManager, CODE_PARAMS } from './file-manager.js';
import { SyncState } from './state.js';
import { validateWorkflow } from './validator.js';
import { config } from './config.js';

// Fields kept in pulled files. Volatile ones (updatedAt, versionId, ...) are
// dropped so files don't churn in git on every pull.
const PULLED_FIELDS = ['id', 'name', 'active', 'nodes', 'connections', 'settings', 'staticData', 'pinData', 'meta', 'tags'];

// Nodes whose `workflowId` parameter points at another workflow
const SUB_WORKFLOW_TYPES = /executeWorkflow$|toolWorkflow$/i;

/**
 * Key-order-independent JSON, for comparing workflows n8n may have reordered.
 */
export const stable = (v) =>
  JSON.stringify(v, (k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((key) => [key, val[key]]))
      : val,
  );

/**
 * True if the object looks like an n8n workflow export.
 */
export function isWorkflow(obj) {
  return !!obj && typeof obj.name === 'string' && Array.isArray(obj.nodes) && typeof obj.connections === 'object';
}

/**
 * True if local and remote have the same nodes/connections (and settings, if
 * the file has any). Used when there's no sync record to tell who changed what.
 */
function sameContent(local, remote) {
  const pick = (w, withSettings) => ({
    nodes: w.nodes,
    connections: w.connections,
    ...(withSettings ? { settings: w.settings || {} } : {}),
  });
  const withSettings = local.settings !== undefined;
  return stable(pick(local, withSettings)) === stable(pick(remote, withSettings));
}

/**
 * Sync Engine
 */
export class SyncEngine {
  constructor(options = {}) {
    this.client = options.client || new N8nClient(options.apiUrl, options.apiKey);
    this.workflowsDir = resolve(options.workflowsDir || config.paths.workflowsDir);
    this.fileManager = new FileManager(this.workflowsDir);
    this.dryRun = options.dryRun || config.sync.dryRun;
    this.state = new SyncState(this.workflowsDir, this.client.apiUrl || 'default');

    logger.debug('SyncEngine initialized', {
      context: 'SyncEngine',
      workflowsDir: this.workflowsDir,
      dryRun: this.dryRun,
    });
  }

  /**
   * Map of workflow id -> { path, hash, name, codeRefs } for local files.
   */
  async _localIndex() {
    await this.state.load();
    const index = new Map();
    if (!existsSync(this.workflowsDir)) return index;

    const byFile = new Map();
    for (const filePath of await this.fileManager.getAllWorkflowFiles()) {
      try {
        const wf = await this.fileManager.readWorkflow(filePath);
        if (!isWorkflow(wf)) continue;
        const info = { path: filePath, hash: wf._metadata.hash, name: wf.name, codeRefs: wf._metadata.codeRefs, fileId: wf.id };
        byFile.set(this._fileKey(filePath), info);
        if (wf.id) index.set(String(wf.id), info);
      } catch {
        // Unparseable file - not ours to index
      }
    }
    // This instance's ids for files created on another instance
    for (const [id, entry] of this.state.entries()) {
      if (entry.file && byFile.has(entry.file)) index.set(id, byFile.get(entry.file));
    }
    return index;
  }

  /**
   * Stable key for a local file in the sync state.
   */
  _fileKey(filePath) {
    return relative(this.workflowsDir, resolve(filePath)).split(sep).join('/');
  }

  /**
   * Find one remote workflow by id or exact name.
   */
  async findWorkflow(identifier, remote = null) {
    remote ??= await this.client.listWorkflows();
    const byId = remote.find((w) => String(w.id) === String(identifier));
    if (byId) return byId;
    const byName = remote.filter((w) => w.name === identifier);
    if (byName.length > 1) {
      throw new Error(`"${identifier}" matches ${byName.length} workflows (${byName.map((w) => w.id).join(', ')}) - use the id`);
    }
    if (!byName.length) throw Object.assign(new Error(`Workflow not found: ${identifier}`), { status: 404 });
    return byName[0];
  }

  // ---------------------------------------------------------------- pull

  /**
   * Pull workflows from n8n to local files.
   *
   * By default only workflows already tracked in workflowsDir (a local file
   * has their id) are pulled, so other people's flows on the same instance
   * never land in your folder. Opt in to more explicitly:
   * @param {Object} [opts]
   * @param {string[]} [opts.select] - workflow ids or exact names to pull (adopt into the folder)
   * @param {string[]} [opts.tags] - also pull workflows having any of these tags
   * @param {boolean} [opts.all] - pull every workflow on the instance
   * @param {boolean} [opts.force] - overwrite local files even if they have unpushed changes
   * @param {boolean} [opts.splitCode] - write Code node code to separate .js/.py files
   */
  async pullFromN8n({ select = [], tags = [], all = false, force = false, splitCode = false } = {}) {
    logger.info('Starting pull from n8n', { context: 'SyncEngine' });
    await this.state.load();

    const remote = await this.client.listWorkflows();
    const index = await this._localIndex();
    const wanted = new Set(select.map(String));
    const tagSet = new Set(tags);

    const workflows = remote.filter(
      (w) =>
        all ||
        index.has(String(w.id)) ||
        wanted.has(String(w.id)) ||
        wanted.has(w.name) ||
        (w.tags || []).some((t) => tagSet.has(t.name ?? t)),
    );

    const matched = new Set(workflows.flatMap((w) => [String(w.id), w.name]));
    const notFound = [...wanted].filter((x) => !matched.has(x));
    if (notFound.length) {
      logger.warn(`Not found in n8n: ${notFound.join(', ')}`, { context: 'SyncEngine' });
    }

    const results = notFound.map((x) => ({ name: x, action: 'error', error: 'not found in n8n' }));

    for (const summary of workflows) {
      try {
        results.push(await this._pullOne(summary.id, index, { force, splitCode }));
      } catch (error) {
        logger.error(`Failed to pull workflow: ${summary.name}`, { context: 'SyncEngine', id: summary.id, error: error.message });
        results.push({ name: summary.name, id: summary.id, action: 'error', error: error.message });
      }
    }

    const count = (a) => results.filter((r) => r.action === a).length;
    const result = {
      pulled: count('pulled') + count('dry-run'),
      skipped: count('unchanged'),
      conflicts: count('conflict'),
      errors: count('error'),
      total: workflows.length,
      ignored: remote.length - workflows.length,
      notFound,
      results,
    };
    logger.info('Pull completed', { context: 'SyncEngine', ...result, results: undefined });
    return result;
  }

  async _pullOne(id, index, { force, splitCode }) {
    const full = await this.client.getWorkflow(id);
    const clean = {};
    for (const key of PULLED_FIELDS) {
      if (full[key] !== undefined && full[key] !== null) clean[key] = full[key];
    }
    if (clean.tags) clean.tags = clean.tags.map((t) => ({ id: t.id, name: t.name }));

    const known = index.get(String(full.id));
    // An existing file keeps its own id (it may come from another instance)
    if (known?.fileId) clean.id = known.fileId;
    const filePath = known?.path || this._newPathFor(full);
    const rel = this.fileManager.getRelativePath(filePath);
    const base = { name: full.name, id: String(full.id), file: rel };

    // Keep existing code-file references; --split-code adds new ones
    const refs = new Map((known?.codeRefs || []).map((r) => [`${r.node}\0${r.param}`, r.path]));
    if (splitCode) {
      const stem = basename(filePath, extname(filePath));
      for (const node of clean.nodes || []) {
        for (const param of CODE_PARAMS) {
          const key = `${node.name}\0${param}`;
          if (typeof node.parameters?.[param] === 'string' && !refs.has(key)) {
            const ext = param === 'pythonCode' ? 'py' : 'js';
            refs.set(key, join(dirname(filePath), `${stem}.${this._sanitizeFilename(node.name)}.${ext}`));
          }
        }
      }
    }

    const prepared = this.fileManager.prepareWrite(filePath, clean, refs);
    const entry = this.state.get(full.id);

    if (known && known.hash === prepared.hash) {
      if (!this.dryRun && entry?.updatedAt !== full.updatedAt) {
        await this.state.set(full.id, { updatedAt: full.updatedAt, hash: prepared.hash, file: this._fileKey(filePath) });
      }
      return { ...base, action: 'unchanged' };
    }

    // Guard: don't clobber local edits that were never pushed
    if (known && !force) {
      const localChanged = entry ? entry.hash !== known.hash : true;
      if (localChanged) {
        return {
          ...base,
          action: 'conflict',
          reason: entry
            ? 'local file has changes that were not pushed - push them first, or pull --force to discard them'
            : 'local file differs from n8n and there is no sync record here - pull --force to take the n8n version',
        };
      }
    }

    if (this.dryRun) return { ...base, action: 'dry-run' };

    let backup;
    if (known) backup = await this.state.backup(full.id, 'local', await readFile(known.path, 'utf-8'));
    await this.fileManager.writeWorkflow(filePath, clean, refs);
    index.set(String(full.id), { path: filePath, hash: prepared.hash, name: full.name, fileId: clean.id });
    await this.state.set(full.id, { updatedAt: full.updatedAt, hash: prepared.hash, file: this._fileKey(filePath) });
    logger.info(`Pulled: ${full.name} -> ${rel}`, { context: 'SyncEngine' });
    return { ...base, action: 'pulled', ...(backup ? { backup } : {}) };
  }

  /**
   * Choose a file path for a workflow that has no local file yet.
   * First tag becomes the folder; name collisions get the id appended.
   */
  _newPathFor(workflow) {
    const tag = workflow.tags?.[0];
    const folder = tag ? join(this.workflowsDir, this._sanitizeFilename(tag.name || String(tag))) : this.workflowsDir;
    const base = this._sanitizeFilename(workflow.name);
    const path = join(folder, `${base}.json`);
    return existsSync(path) ? join(folder, `${base}_${this._sanitizeFilename(String(workflow.id))}.json`) : path;
  }

  // ---------------------------------------------------------------- push

  /**
   * Push one local workflow file to n8n.
   *
   * Matching order: file `id` -> existing workflow with the same name -> create.
   * After a create (or name match) the n8n id is written back into the file so
   * the next push updates instead of duplicating.
   *
   * Refuses (action "conflict") when the workflow changed in n8n since the last
   * sync, or differs and there's no sync record - unless `force`.
   *
   * Activates when `activate` is true or the file has `"active": true`.
   */
  async pushFile(filePath, { activate = false, force = false, ctx = null } = {}) {
    ctx ??= await this._pushContext();
    const workflow = await this.fileManager.readWorkflow(filePath);
    const rel = this.fileManager.getRelativePath(filePath);

    if (!isWorkflow(workflow)) {
      return { file: rel, action: 'skipped', reason: 'not an n8n workflow (needs name, nodes, connections)' };
    }

    const { errors, warnings } = validateWorkflow(workflow);
    const base = { file: rel, name: workflow.name, ...(warnings.length ? { warnings } : {}) };
    if (errors.length) return { ...base, action: 'invalid', errors };

    const wantActive = activate || workflow.active === true;
    if (this.dryRun) return { ...base, action: 'dry-run', activate: wantActive };

    // This instance's id for the file -> the file's own id -> same name -> new
    const mappedId = this.state.findByFile(this._fileKey(filePath));
    let remote = mappedId ? await this.client.getWorkflowOrNull(mappedId) : null;
    if (!remote && workflow.id) remote = await this.client.getWorkflowOrNull(workflow.id);
    if (!remote && ctx.remoteByName.has(workflow.name)) {
      remote = await this.client.getWorkflow(ctx.remoteByName.get(workflow.name));
    }
    let id = remote ? String(remote.id) : null;
    const entry = id ? this.state.get(id) : null;

    // Guard: don't clobber edits made in n8n since our last sync
    if (remote && !force) {
      if (entry && entry.updatedAt !== remote.updatedAt) {
        return { ...base, id, action: 'conflict', reason: 'changed in n8n since the last sync - pull first, or push --force to overwrite' };
      }
      if (!entry && !sameContent(workflow, remote)) {
        return {
          ...base,
          id,
          action: 'conflict',
          reason: 'exists in n8n with different content and there is no sync record here - pull first, or push --force to overwrite',
        };
      }
    }

    const unchanged = remote && entry && entry.hash === workflow._metadata.hash && entry.updatedAt === remote.updatedAt;
    let action = 'unchanged';
    let backup;
    const subWorkflowIds = new Set();
    const body = this._mapReferences(workflow, ctx, unchanged ? {} : base, subWorkflowIds);

    if (!unchanged) {
      if (remote) {
        backup = await this.state.backup(id, 'remote', remote);
        await this.client.updateWorkflow(id, body);
        action = 'updated';
      } else {
        const created = await this.client.createWorkflow(body);
        id = String(created.id);
        action = 'created';
      }
      ctx.remoteByName.set(workflow.name, id);
      ctx.remoteIds.add(id);
    }

    // Files without an id get this instance's; files with one keep it
    // (other instances are tracked in the sync state)
    if (!workflow.id) {
      await this.fileManager.writeWorkflow(filePath, { id, ...workflow._metadata.raw });
    }

    const result = { ...base, id, action, ...(backup ? { backup } : {}) };

    // Tags aren't accepted in the workflow body; they're set separately by name.
    // No `tags` field in the file = leave the workflow's tags alone.
    if (!unchanged && Array.isArray(workflow.tags)) {
      const names = [...new Set(workflow.tags.map((t) => t?.name ?? t).filter((n) => typeof n === 'string' && n))];
      await this.client.setWorkflowTags(id, await this._tagIds(names));
      result.tags = names;
    }

    if (wantActive && !(unchanged && remote.active)) {
      try {
        // n8n 2.x only publishes a workflow once every sub-workflow it calls is published
        for (const subId of subWorkflowIds) {
          const sub = await this.client.getWorkflowOrNull(subId);
          if (sub && !sub.active) {
            await this.client.activateWorkflow(subId);
            (result.activatedSubWorkflows ??= []).push(sub.name);
          }
        }
        await this.client.activateWorkflow(id);
        result.activated = true;
      } catch (error) {
        result.activated = false;
        result.activationError = error.message;
        logger.warn(`Could not activate ${workflow.name}: ${error.message}`, { context: 'SyncEngine' });
      }
    }

    // New baseline: n8n's updatedAt after all our changes + the file as it is now
    const final = await this.client.getWorkflow(id);
    const { hash } = (await this.fileManager.readWorkflow(filePath))._metadata;
    await this.state.set(id, { updatedAt: final.updatedAt, hash, file: this._fileKey(filePath) });

    logger.info(`Pushed (${action}): ${workflow.name} [${id}]${result.activated ? ' + activated' : ''}`, { context: 'SyncEngine' });
    return result;
  }

  /**
   * Remote lookups shared by every file in one push run.
   */
  async _pushContext() {
    await this.state.load();
    const remote = this.dryRun ? [] : await this.client.listWorkflows();
    const local = await this._localIndex();
    return {
      remoteByName: new Map(remote.map((w) => [w.name, String(w.id)])),
      remoteIds: new Set(remote.map((w) => String(w.id))),
      localIdToName: new Map([...local].map(([id, v]) => [id, v.name])),
      credentials: undefined, // loaded on first use
    };
  }

  /**
   * Request body with instance-specific ids re-pointed by name, so a flow
   * built against dev works on prod:
   *  - node credentials: matched by type + name
   *  - Execute Workflow / Workflow Tool targets: matched by workflow name
   * The file itself is never changed. Problems become warnings on `result`.
   */
  _mapReferences(workflow, ctx, result, subWorkflowIds = new Set()) {
    const warn = (msg) => (result.warnings ??= []).push(msg);
    const nodes = workflow.nodes.map((node) => {
      let out = node;

      if (node.credentials && ctx.credentials) {
        const credentials = {};
        for (const [type, ref] of Object.entries(node.credentials)) {
          const match =
            ctx.credentials.find((c) => c.type === type && c.name === ref?.name) ||
            ctx.credentials.find((c) => c.type === type && String(c.id) === String(ref?.id));
          if (match) credentials[type] = { id: String(match.id), name: match.name };
          else {
            credentials[type] = ref;
            warn(`node "${node.name}": credential "${ref?.name || ref?.id}" (${type}) not found in n8n - create it in the n8n UI`);
          }
        }
        out = { ...out, credentials };
      }

      if (SUB_WORKFLOW_TYPES.test(node.type || '') && node.parameters?.workflowId !== undefined) {
        const ref = node.parameters.workflowId;
        const value = typeof ref === 'object' ? ref?.value : ref;
        const targetName = (typeof ref === 'object' && ref?.cachedResultName) || ctx.localIdToName.get(String(value));
        const targetId = targetName ? ctx.remoteByName.get(targetName) : null;
        if (targetId || ctx.remoteIds.has(String(value))) subWorkflowIds.add(targetId || String(value));
        if (targetId) {
          const workflowId = typeof ref === 'object' ? { ...ref, value: targetId } : targetId;
          if (typeof workflowId === 'object') delete workflowId.cachedResultUrl;
          out = { ...out, parameters: { ...out.parameters, workflowId } };
        } else if (value && !ctx.remoteIds.has(String(value)) && !String(value).startsWith('=')) {
          warn(`node "${node.name}": sub-workflow "${targetName || value}" not found in n8n - push it first`);
        }
      }

      return out;
    });
    return { ...workflow, nodes };
  }

  /**
   * Resolve tag names to ids, creating missing tags. Ids differ between n8n
   * instances, so files are matched by tag name, never by id.
   */
  async _tagIds(names) {
    if (!names.length) return [];
    if (!this._tagCache) {
      this._tagCache = new Map((await this.client.listTags()).map((t) => [t.name, t.id]));
    }
    const ids = [];
    for (const name of names) {
      if (!this._tagCache.has(name)) {
        this._tagCache.set(name, (await this.client.createTag(name)).id);
      }
      ids.push(this._tagCache.get(name));
    }
    return ids;
  }

  /**
   * Push local workflows to n8n.
   * @param {Object} [opts]
   * @param {string[]} [opts.files] - specific files; default: every workflow file in workflowsDir
   * @param {boolean} [opts.activate] - activate every pushed workflow
   * @param {boolean} [opts.force] - overwrite even if n8n changed since the last sync
   */
  async pushToN8n({ files = null, activate = false, force = false } = {}) {
    logger.info('Starting push to n8n', { context: 'SyncEngine' });
    this._tagCache = null; // tags may have changed in n8n since the last run

    const ctx = await this._pushContext();
    if (!this.dryRun) {
      try {
        ctx.credentials = await this.client.listCredentials();
      } catch (error) {
        logger.warn(`Can't list credentials, skipping credential mapping: ${error.message}`, { context: 'SyncEngine' });
      }
    }

    const workflowFiles = files?.length ? files.map((f) => resolve(f)) : await this.fileManager.getAllWorkflowFiles();
    // Sub-workflows first, so callers can be re-pointed at their new ids.
    // ponytail: one level of ordering; deeper call chains may need a second push.
    const callsOthers = async (f) => {
      try {
        return /executeWorkflow"|toolWorkflow"/.test(await readFile(f, 'utf-8')) ? 1 : 0;
      } catch {
        return 0;
      }
    };
    const order = await Promise.all(workflowFiles.map(callsOthers));
    const sorted = workflowFiles.map((f, i) => [f, order[i]]).sort((a, b) => a[1] - b[1]).map(([f]) => f);

    const results = [];
    for (const filePath of sorted) {
      try {
        results.push(await this.pushFile(filePath, { activate, force, ctx }));
      } catch (error) {
        logger.error(`Failed to push: ${filePath}`, { context: 'SyncEngine', error: error.message });
        results.push({ file: this.fileManager.getRelativePath(filePath), action: 'error', error: error.message });
      }
    }

    const count = (fn) => results.filter(fn).length;
    const summary = {
      total: workflowFiles.length,
      pushed: count((r) => r.action === 'created'),
      updated: count((r) => r.action === 'updated'),
      unchanged: count((r) => r.action === 'unchanged'),
      skipped: count((r) => r.action === 'skipped' || r.action === 'dry-run'),
      invalid: count((r) => r.action === 'invalid'),
      conflicts: count((r) => r.action === 'conflict'),
      errors: count((r) => r.action === 'error'),
      activated: count((r) => r.activated === true),
      activationErrors: count((r) => r.activated === false),
      warnings: count((r) => r.warnings?.length),
      results,
    };

    logger.info('Push completed', { context: 'SyncEngine', ...summary, results: undefined });
    return summary;
  }

  /**
   * Called by the file watcher when a file is added or changed.
   */
  async syncFile(filePath) {
    const result = await this.pushFile(filePath);
    if (result.action === 'conflict' || result.action === 'invalid') {
      logger.warn(`Not pushed (${result.action}): ${result.file} - ${result.reason || result.errors.join('; ')}`, { context: 'SyncEngine' });
    }
    return result;
  }

  /**
   * Called by the file watcher when a file is deleted. Deliberately does not
   * delete the remote workflow - `n8n-sync prune` does that on request.
   */
  async handleFileDelete(filePath) {
    logger.warn(`Local file deleted, remote workflow left untouched (run \`n8n-sync prune\` to delete it): ${filePath}`, {
      context: 'SyncEngine',
    });
  }

  /**
   * Full sync: pull then push
   */
  async fullSync(opts = {}) {
    const pull = await this.pullFromN8n();
    const push = await this.pushToN8n(opts);
    return { pull, push };
  }

  // ---------------------------------------------------------------- diff

  /**
   * Compare tracked flow files with n8n. Only this folder's flows are
   * considered. For each: which fields differ and which side changed since
   * the last sync (so you know whether to push or pull).
   */
  async diff() {
    const index = await this._localIndex();
    const remote = await this.client.listWorkflows();
    const remoteById = new Map(remote.map((w) => [String(w.id), w]));
    const remoteByName = new Map(remote.map((w) => [w.name, w]));
    const files = [...new Map([...index.values()].map((v) => [v.path, v])).values()];
    // Files without an id aren't in the index
    for (const f of await this.fileManager.getAllWorkflowFiles()) {
      if (!files.some((v) => v.path === f)) files.push({ path: f });
    }

    const results = [];
    for (const info of files) {
      let wf;
      try {
        wf = await this.fileManager.readWorkflow(info.path);
      } catch (error) {
        results.push({ file: this.fileManager.getRelativePath(info.path), status: 'error', error: error.message });
        continue;
      }
      if (!isWorkflow(wf)) continue;
      const file = this.fileManager.getRelativePath(info.path);
      const mappedId = this.state.findByFile(this._fileKey(info.path));
      const summary = remoteById.get(mappedId) || remoteById.get(String(wf.id)) || remoteByName.get(wf.name);
      if (!summary) {
        results.push({ file, name: wf.name, status: 'not-in-n8n' });
        continue;
      }
      const r = await this.client.getWorkflow(summary.id);
      const fields = [];
      const tagNames = (t) => (t || []).map((x) => x?.name ?? x).sort();
      if (stable(wf.nodes) !== stable(r.nodes)) fields.push('nodes');
      if (stable(wf.connections) !== stable(r.connections)) fields.push('connections');
      if (wf.settings !== undefined && stable(wf.settings) !== stable(r.settings || {})) fields.push('settings');
      if (wf.tags !== undefined && stable(tagNames(wf.tags)) !== stable(tagNames(r.tags))) fields.push('tags');
      if (wf.name !== r.name) fields.push('name');
      if (wf.active !== undefined && wf.active !== r.active) fields.push('active');

      const entry = this.state.get(r.id);
      results.push({
        file,
        name: wf.name,
        id: String(r.id),
        status: fields.length ? 'changed' : 'unchanged',
        ...(fields.length ? { fields } : {}),
        ...(fields.length && entry
          ? { localChanged: entry.hash !== wf._metadata.hash, n8nChanged: entry.updatedAt !== r.updatedAt }
          : {}),
      });
    }

    for (const c of await this.pruneCandidates()) {
      results.push({ name: c.name, id: c.id, status: 'deleted-locally' });
    }
    return results;
  }

  // ---------------------------------------------------------------- delete

  /**
   * Delete workflows from n8n (by id or exact name) and their local files.
   * Both are backed up to .n8n-sync/backups first.
   * @param {string[]} identifiers
   * @param {Object} [opts] - { keepFile }
   */
  async deleteWorkflows(identifiers, { keepFile = false } = {}) {
    await this.state.load();
    const remote = await this.client.listWorkflows();
    const index = await this._localIndex();
    const results = [];

    for (const identifier of identifiers) {
      try {
        let target = null;
        try {
          target = await this.findWorkflow(identifier, remote);
        } catch (error) {
          if (error.status !== 404) throw error;
        }
        const id = target ? String(target.id) : [...index].find(([i, v]) => i === String(identifier) || v.name === identifier)?.[0];
        const local = id ? index.get(id) : null;
        if (!target && !local) {
          results.push({ identifier, action: 'error', error: 'not found in n8n or in this folder' });
          continue;
        }

        const result = { identifier, id, name: target?.name || local?.name, remote: !!target, file: local ? this.fileManager.getRelativePath(local.path) : null };
        if (this.dryRun) {
          results.push({ ...result, action: 'dry-run', wouldDeleteFile: !!local && !keepFile });
          continue;
        }

        if (target) {
          const full = await this.client.getWorkflow(id);
          await this.state.backup(id, 'remote-deleted', full);
          // n8n 2.x refuses to delete a published (active) workflow
          if (full.active) await this.client.deactivateWorkflow(id);
          // ...and unpublishing finishes asynchronously, so retry briefly on 409
          for (let attempt = 0; ; attempt++) {
            try {
              await this.client.deleteWorkflow(id);
              break;
            } catch (error) {
              if (error.status !== 409 || attempt >= 20) throw error;
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }
        if (local && !keepFile) {
          await this.state.backup(id, 'local-deleted', await readFile(local.path, 'utf-8'));
          for (const ref of local.codeRefs || []) await unlink(ref.path).catch(() => {});
          await unlink(local.path);
        }
        await this.state.remove(id);
        results.push({ ...result, action: 'deleted', deletedFile: !!local && !keepFile });
      } catch (error) {
        results.push({ identifier, action: 'error', error: error.message });
      }
    }
    return { deleted: results.filter((r) => r.action === 'deleted').length, errors: results.filter((r) => r.action === 'error').length, results };
  }

  /**
   * Workflows this folder synced before whose local file is now gone.
   * Only those are candidates - flows never synced from here are never touched.
   */
  async pruneCandidates() {
    await this.state.load();
    const index = await this._localIndex();
    const remote = await this.client.listWorkflows();
    const remoteById = new Map(remote.map((w) => [String(w.id), w]));
    return this.state
      .entries()
      .filter(([id]) => !index.has(id) && remoteById.has(id))
      .map(([id]) => ({ id, name: remoteById.get(id).name, active: remoteById.get(id).active }));
  }

  // ---------------------------------------------------------------- executions

  /**
   * Compact, error-focused view of an execution.
   */
  summarizeExecution(e) {
    const runData = e.data?.resultData?.runData || {};
    const nodeErrors = [];
    for (const [node, runs] of Object.entries(runData)) {
      for (const run of runs || []) {
        if (run?.error) nodeErrors.push({ node, message: run.error.message, description: run.error.description || undefined });
      }
    }
    const err = e.data?.resultData?.error;
    return {
      id: e.id,
      workflowId: e.workflowId,
      status: e.status,
      mode: e.mode,
      startedAt: e.startedAt,
      stoppedAt: e.stoppedAt,
      durationMs: e.startedAt && e.stoppedAt ? new Date(e.stoppedAt) - new Date(e.startedAt) : null,
      lastNode: e.data?.resultData?.lastNodeExecuted,
      ...(err ? { error: { message: err.message, node: err.node?.name || nodeErrors[0]?.node, description: err.description || undefined } } : {}),
      ...(nodeErrors.length ? { nodeErrors } : {}),
    };
  }

  /**
   * Recent executions of one workflow (newest first).
   */
  async getExecutions(identifier, { limit = 5, status } = {}) {
    const wf = await this.findWorkflow(identifier);
    const executions = await this.client.listExecutions({ workflowId: wf.id, status, limit, includeData: true });
    return { workflow: { id: wf.id, name: wf.name, active: wf.active }, executions: executions.map((e) => this.summarizeExecution(e)) };
  }

  /**
   * Call an active workflow's production webhook and return the HTTP response
   * plus the resulting execution. Only webhook-triggered workflows can be run
   * from outside n8n (the public API can't start manual/schedule triggers).
   */
  async runWorkflow(identifier, { data = null, method = null, timeoutMs = 15000 } = {}) {
    const summary = await this.findWorkflow(identifier);
    const wf = await this.client.getWorkflow(summary.id);
    const hook = wf.nodes.find((n) => /\.webhook$/i.test(n.type) && !n.disabled);
    if (!hook) throw new Error(`"${wf.name}" has no Webhook trigger - it can only be run from the n8n UI`);
    if (!wf.active) throw new Error(`"${wf.name}" is not active - activate it first (production webhooks only work when active)`);

    const base = (config.n8n.webhookUrl || this.client.apiUrl.replace(/\/api\/v\d+\/?$/, '')).replace(/\/+$/, '');
    const url = `${base}/webhook/${String(hook.parameters?.path || hook.webhookId).replace(/^\/+/, '')}`;
    const httpMethod = (method || hook.parameters?.httpMethod || 'GET').toUpperCase();

    const startedAfter = Date.now() - 1000;
    const response = await fetch(url, {
      method: httpMethod,
      headers: { 'Content-Type': 'application/json' },
      ...(httpMethod === 'GET' || httpMethod === 'HEAD' ? {} : { body: JSON.stringify(data ?? {}) }),
    });
    const text = await response.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON
    }

    // Wait for the execution to show up and finish
    let execution = null;
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; ) {
      const [latest] = await this.client.listExecutions({ workflowId: wf.id, limit: 1, includeData: true });
      if (latest && new Date(latest.startedAt).getTime() >= startedAfter && !['running', 'new', 'waiting'].includes(latest.status)) {
        execution = this.summarizeExecution(latest);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    return {
      workflow: { id: wf.id, name: wf.name },
      request: { method: httpMethod, url },
      response: { status: response.status, body },
      execution,
    };
  }

  // ---------------------------------------------------------------- data tables & variables

  /**
   * Data table schemas <-> file ([{ name, columns: [{ name, type }] }]).
   * Rows are data, not config, and are never synced. Pull refreshes tables
   * already listed in the file (all with `all`).
   */
  async pullDataTables(filePath, { all = false } = {}) {
    const existing = existsSync(filePath) ? JSON.parse(await readFile(filePath, 'utf-8')) : [];
    const tracked = new Set(existing.map((t) => t.name));
    const tables = [];
    for (const t of await this.client.listDataTables()) {
      if (!all && !tracked.has(t.name)) continue;
      const columns = t.columns || (await this.client.listDataTableColumns(t.id));
      tables.push({ name: t.name, columns: columns.map((c) => ({ name: c.name, type: c.type })) });
    }
    const missing = [...tracked].filter((n) => !tables.some((t) => t.name === n));
    if (!this.dryRun) await writeFile(filePath, JSON.stringify(tables, null, 2) + '\n', 'utf-8');
    return { tables: tables.map((t) => t.name), missingInN8n: missing };
  }

  /**
   * Create missing tables / columns. Never deletes or retypes anything.
   */
  async pushDataTables(filePath) {
    const wanted = JSON.parse(await readFile(filePath, 'utf-8'));
    const remote = await this.client.listDataTables();
    const results = [];
    for (const table of wanted) {
      const found = remote.find((t) => t.name === table.name);
      if (!found) {
        if (!this.dryRun) await this.client.createDataTable(table.name, table.columns || []);
        results.push({ table: table.name, action: this.dryRun ? 'dry-run' : 'created' });
        continue;
      }
      const columns = found.columns || (await this.client.listDataTableColumns(found.id));
      const added = [];
      const warnings = [];
      for (const col of table.columns || []) {
        const have = columns.find((c) => c.name === col.name);
        if (!have) {
          if (!this.dryRun) await this.client.addDataTableColumn(found.id, { name: col.name, type: col.type });
          added.push(col.name);
        } else if (have.type !== col.type) {
          warnings.push(`column "${col.name}" is ${have.type} in n8n, ${col.type} in file - not changed`);
        }
      }
      for (const c of columns) {
        if (!(table.columns || []).some((col) => col.name === c.name) && !['id', 'createdAt', 'updatedAt'].includes(c.name)) {
          warnings.push(`column "${c.name}" exists only in n8n - not deleted`);
        }
      }
      results.push({ table: table.name, action: added.length ? 'updated' : 'unchanged', ...(added.length ? { added } : {}), ...(warnings.length ? { warnings } : {}) });
    }
    return { results };
  }

  /**
   * Variables <-> file ({ KEY: "value" }). n8n licence feature.
   * Pull refreshes keys already in the file (all with `all`).
   */
  async pullVariables(filePath, { all = false } = {}) {
    const existing = existsSync(filePath) ? JSON.parse(await readFile(filePath, 'utf-8')) : {};
    const vars = await this._variables();
    const out = {};
    for (const v of vars) if (all || v.key in existing) out[v.key] = v.value;
    if (!this.dryRun) await writeFile(filePath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
    return { keys: Object.keys(out), missingInN8n: Object.keys(existing).filter((k) => !(k in out)) };
  }

  /**
   * Create missing / update changed variables. Never deletes.
   */
  async pushVariables(filePath) {
    const wanted = JSON.parse(await readFile(filePath, 'utf-8'));
    const remote = await this._variables();
    const results = [];
    for (const [key, value] of Object.entries(wanted)) {
      const found = remote.find((v) => v.key === key);
      if (found && found.value === String(value)) {
        results.push({ key, action: 'unchanged' });
      } else {
        if (!this.dryRun) {
          if (found) await this.client.updateVariable(found.id, key, String(value));
          else await this.client.createVariable(key, String(value));
        }
        results.push({ key, action: this.dryRun ? 'dry-run' : found ? 'updated' : 'created' });
      }
    }
    return { results };
  }

  async _variables() {
    try {
      return await this.client.listVariables();
    } catch (error) {
      if (error.status === 403) throw new Error(`Variables need a licensed n8n (Pro/Enterprise): ${error.message}`);
      throw error;
    }
  }

  /**
   * Sanitize filename (also strips path separators and dots, so names/tags
   * can never escape workflowsDir)
   */
  _sanitizeFilename(name) {
    return (
      String(name ?? '')
        .replace(/[^a-z0-9_-]/gi, '_')
        .replace(/_+/g, '_')
        .toLowerCase() || 'workflow'
    );
  }
}

export default SyncEngine;
