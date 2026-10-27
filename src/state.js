/**
 * Per-folder sync state + backups, kept in <workflowsDir>/.n8n-sync/
 * (hidden, so it's never scanned as a workflow; gitignore it).
 *
 *   state.json  { "<n8n api url>": { "<workflow id>": { updatedAt, hash, file } } }
 *               updatedAt = n8n's updatedAt right after our last push/pull
 *               hash      = local file (+ code files) hash at that moment
 *               file      = local file (relative to the folder) - the file's own
 *                           `id` is from whichever instance created it, so other
 *                           instances (prod) are matched through this
 *   backups/    copies taken before anything is overwritten or deleted
 *
 * Keyed by instance URL so dev and prod don't share baselines.
 *
 * @module state
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export class SyncState {
  constructor(workflowsDir, instanceUrl) {
    this.dir = join(workflowsDir, '.n8n-sync');
    this.file = join(this.dir, 'state.json');
    this.instance = instanceUrl;
    this.data = null;
  }

  async load() {
    if (this.data) return this;
    try {
      this.data = existsSync(this.file) ? JSON.parse(await readFile(this.file, 'utf-8')) : {};
    } catch {
      this.data = {}; // corrupt state = no baselines; guards then compare content
    }
    this.data[this.instance] ??= {};
    return this;
  }

  get(id) {
    return this.data[this.instance][String(id)];
  }

  /**
   * Remote id this instance uses for a local file (ids differ per instance).
   */
  findByFile(file) {
    return this.entries().find(([, e]) => e.file === file)?.[0] ?? null;
  }

  entries() {
    return Object.entries(this.data[this.instance]);
  }

  async set(id, entry) {
    this.data[this.instance][String(id)] = entry;
    await this.save();
  }

  async remove(id) {
    delete this.data[this.instance][String(id)];
    await this.save();
  }

  async save() {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify(this.data, null, 2) + '\n', 'utf-8');
  }

  /**
   * Save a copy of something about to be overwritten/deleted.
   * ponytail: backups are never rotated; delete .n8n-sync/backups when it gets big.
   */
  async backup(id, kind, content) {
    const dir = join(this.dir, 'backups', String(id).replace(/[^a-zA-Z0-9_-]/g, '_'));
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}.json`);
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf-8');
    return path;
  }
}
