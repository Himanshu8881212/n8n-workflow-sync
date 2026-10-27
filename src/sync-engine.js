#!/usr/bin/env node

/**
 * Sync Engine
 *
 * Pull: n8n -> local files. Push: local files -> n8n (optionally activating).
 *
 * @module sync-engine
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { winstonLogger as logger } from './logger-enhanced.js';
import { N8nClient } from './n8n-client.js';
import { FileManager } from './file-manager.js';
import { config } from './config.js';

// Fields kept in pulled files. Volatile ones (updatedAt, versionId, ...) are
// dropped so files don't churn in git on every pull.
const PULLED_FIELDS = ['id', 'name', 'active', 'nodes', 'connections', 'settings', 'staticData', 'pinData', 'meta', 'tags'];

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * True if the object looks like an n8n workflow export.
 */
export function isWorkflow(obj) {
  return !!obj && typeof obj.name === 'string' && Array.isArray(obj.nodes) && typeof obj.connections === 'object';
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

    logger.debug('SyncEngine initialized', {
      context: 'SyncEngine',
      workflowsDir: this.workflowsDir,
      dryRun: this.dryRun,
    });
  }

  /**
   * Map of workflow id -> { path, hash } for local files.
   */
  async _localIndex() {
    const index = new Map();
    if (!existsSync(this.workflowsDir)) return index;

    for (const filePath of await this.fileManager.getAllWorkflowFiles()) {
      try {
        const wf = await this.fileManager.readWorkflow(filePath);
        if (isWorkflow(wf) && wf.id) index.set(String(wf.id), { path: filePath, hash: wf._metadata.hash });
      } catch {
        // Unparseable file - not ours to index
      }
    }
    return index;
  }

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
   */
  async pullFromN8n({ select = [], tags = [], all = false } = {}) {
    logger.info('Starting pull from n8n', { context: 'SyncEngine' });

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

    let pulled = 0;
    let skipped = 0;
    let errors = notFound.length;

    for (const summary of workflows) {
      try {
        const full = await this.client.getWorkflow(summary.id);
        const clean = {};
        for (const key of PULLED_FIELDS) {
          if (full[key] !== undefined && full[key] !== null) clean[key] = full[key];
        }
        if (clean.tags) clean.tags = clean.tags.map((t) => ({ id: t.id, name: t.name }));

        const known = index.get(String(full.id));
        const filePath = known?.path || this._newPathFor(full);
        const content = this.fileManager.serialize(filePath, clean);

        if (known && known.hash === sha256(content)) {
          skipped++;
          continue;
        }

        if (this.dryRun) {
          logger.info(`[DRY RUN] Would write: ${this.fileManager.getRelativePath(filePath)}`, { context: 'SyncEngine' });
        } else {
          await this.fileManager.writeWorkflow(filePath, clean);
          index.set(String(full.id), { path: filePath, hash: sha256(content) });
          logger.info(`Pulled: ${full.name} -> ${this.fileManager.getRelativePath(filePath)}`, { context: 'SyncEngine' });
        }
        pulled++;
      } catch (error) {
        logger.error(`Failed to pull workflow: ${summary.name}`, {
          context: 'SyncEngine',
          id: summary.id,
          error: error.message,
        });
        errors++;
      }
    }

    const result = { pulled, skipped, errors, total: workflows.length, ignored: remote.length - workflows.length, notFound };
    logger.info('Pull completed', { context: 'SyncEngine', ...result });
    return result;
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

  /**
   * Push one local workflow file to n8n.
   *
   * Matching order: file `id` -> existing workflow with the same name -> create.
   * After a create (or name match) the n8n id is written back into the file so
   * the next push updates instead of duplicating.
   *
   * Activates when `activate` is true or the file has `"active": true`.
   */
  async pushFile(filePath, { activate = false, remoteByName = null } = {}) {
    const workflow = await this.fileManager.readWorkflow(filePath);
    const rel = this.fileManager.getRelativePath(filePath);

    if (!isWorkflow(workflow)) {
      return { file: rel, action: 'skipped', reason: 'not an n8n workflow (needs name, nodes, connections)' };
    }

    const wantActive = activate || workflow.active === true;

    if (this.dryRun) {
      return { file: rel, name: workflow.name, action: 'dry-run', activate: wantActive };
    }

    let id = workflow.id && (await this.client.workflowExists(workflow.id)) ? String(workflow.id) : null;
    if (!id) {
      if (!remoteByName) {
        remoteByName = new Map((await this.client.listWorkflows()).map((w) => [w.name, String(w.id)]));
      }
      id = remoteByName.get(workflow.name) || null;
    }

    let action;
    if (id) {
      await this.client.updateWorkflow(id, workflow);
      action = 'updated';
    } else {
      const created = await this.client.createWorkflow(workflow);
      id = String(created.id);
      remoteByName?.set(workflow.name, id);
      action = 'created';
    }

    if (String(workflow.id) !== id) {
      const { _metadata, ...rest } = workflow;
      await this.fileManager.writeWorkflow(filePath, { id, ...rest });
    }

    const result = { file: rel, name: workflow.name, id, action };

    // Tags aren't accepted in the workflow body; they're set separately by name.
    // No `tags` field in the file = leave the workflow's tags alone.
    if (Array.isArray(workflow.tags)) {
      const names = [...new Set(workflow.tags.map((t) => t?.name ?? t).filter((n) => typeof n === 'string' && n))];
      await this.client.setWorkflowTags(id, await this._tagIds(names));
      result.tags = names;
    }

    if (wantActive) {
      try {
        await this.client.activateWorkflow(id);
        result.activated = true;
      } catch (error) {
        result.activated = false;
        result.activationError = error.message;
        logger.warn(`Could not activate ${workflow.name}: ${error.message}`, { context: 'SyncEngine' });
      }
    }

    logger.info(`Pushed (${action}): ${workflow.name} [${id}]${result.activated ? ' + activated' : ''}`, {
      context: 'SyncEngine',
    });
    return result;
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
   */
  async pushToN8n({ files = null, activate = false } = {}) {
    logger.info('Starting push to n8n', { context: 'SyncEngine' });
    this._tagCache = null; // tags may have changed in n8n since the last run

    const workflowFiles = files?.length ? files.map((f) => resolve(f)) : await this.fileManager.getAllWorkflowFiles();
    const remoteByName = this.dryRun
      ? null
      : new Map((await this.client.listWorkflows()).map((w) => [w.name, String(w.id)]));

    const results = [];
    for (const filePath of workflowFiles) {
      try {
        results.push(await this.pushFile(filePath, { activate, remoteByName }));
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
      skipped: count((r) => r.action === 'skipped' || r.action === 'dry-run'),
      errors: count((r) => r.action === 'error'),
      activated: count((r) => r.activated === true),
      activationErrors: count((r) => r.activated === false),
      results,
    };

    logger.info('Push completed', { context: 'SyncEngine', ...summary, results: undefined });
    return summary;
  }

  /**
   * Called by the file watcher when a file is added or changed.
   */
  async syncFile(filePath) {
    return this.pushFile(filePath);
  }

  /**
   * Called by the file watcher when a file is deleted. Deliberately does not
   * delete the remote workflow - use `npm run workflows:prune` for that.
   */
  async handleFileDelete(filePath) {
    logger.warn(`Local file deleted, remote workflow left untouched: ${filePath}`, { context: 'SyncEngine' });
  }

  /**
   * Full sync: pull then push
   */
  async fullSync(opts = {}) {
    const pull = await this.pullFromN8n();
    const push = await this.pushToN8n(opts);
    return { pull, push };
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
