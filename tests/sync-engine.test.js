import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SyncEngine } from '../src/sync-engine.js';
import { toApiBody } from '../src/n8n-client.js';

// In-memory stand-in for N8nClient
class FakeN8n {
  constructor() {
    this.workflows = new Map();
    this.nextId = 1;
    this.bodies = [];
  }
  async listWorkflows() { return [...this.workflows.values()]; }
  async getWorkflow(id) {
    const wf = this.workflows.get(String(id));
    if (!wf) throw Object.assign(new Error('not found'), { status: 404 });
    return wf;
  }
  async workflowExists(id) { return this.workflows.has(String(id)); }
  async createWorkflow(wf) {
    const body = toApiBody(wf);
    this.bodies.push(body);
    const created = { ...body, id: `wf${this.nextId++}`, active: false, updatedAt: new Date().toISOString() };
    this.workflows.set(created.id, created);
    return created;
  }
  async updateWorkflow(id, wf) {
    const body = toApiBody(wf);
    this.bodies.push(body);
    const updated = { ...this.workflows.get(id), ...body, updatedAt: new Date().toISOString() };
    this.workflows.set(id, updated);
    return updated;
  }
  async listTags() { return [...(this.tags ??= new Map()).values()]; }
  async createTag(name) {
    const tag = { id: `t${(this.tags ??= new Map()).size + 1}`, name };
    this.tags.set(name, tag);
    return tag;
  }
  async setWorkflowTags(id, tagIds) {
    const byId = new Map([...(this.tags ??= new Map()).values()].map((t) => [t.id, t]));
    this.workflows.get(id).tags = tagIds.map((t) => byId.get(t));
  }
  async activateWorkflow(id) {
    const wf = this.workflows.get(id);
    if (!wf.nodes.some((n) => /trigger|webhook/i.test(n.type))) throw new Error('no trigger node');
    wf.active = true;
    return wf;
  }
}

const triggerFlow = {
  name: 'Hook Flow',
  active: true,
  tags: [{ name: 'x' }],
  createdAt: 'junk',
  nodes: [{ id: 'a', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, position: [0, 0], parameters: { path: 'h' } }],
  connections: {},
};
const manualFlow = {
  name: 'Manual Flow',
  nodes: [{ id: 'b', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
  connections: {},
};

describe('SyncEngine', () => {
  let dir, n8n, engine;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'n8n-sync-'));
    n8n = new FakeN8n();
    engine = new SyncEngine({ workflowsDir: dir, client: n8n });
  });

  it('push creates, writes id back, sends only writable fields, activates', async () => {
    await writeFile(join(dir, 'hook.json'), JSON.stringify(triggerFlow));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'not-a-workflow' }));

    const r = await engine.pushToN8n();
    assert.strictEqual(r.pushed, 1);
    assert.strictEqual(r.skipped, 1);
    assert.strictEqual(r.activated, 1);
    assert.deepStrictEqual(Object.keys(n8n.bodies[0]).sort(), ['connections', 'name', 'nodes', 'settings']);

    const saved = JSON.parse(await readFile(join(dir, 'hook.json'), 'utf-8'));
    assert.strictEqual(saved.id, 'wf1');

    // Second push updates instead of duplicating
    const r2 = await engine.pushToN8n();
    assert.strictEqual(r2.updated, 1);
    assert.strictEqual(n8n.workflows.size, 1);
  });

  it('push sets tags by name, creates missing ones, leaves tags alone when file has none', async () => {
    await n8n.createTag('existing');
    const f = join(dir, 't.json');
    await writeFile(f, JSON.stringify({ ...manualFlow, tags: [{ id: 'other-instance-id', name: 'existing' }, 'new-tag'] }));
    await engine.pushToN8n({ files: [f] });
    const id = JSON.parse(await readFile(f, 'utf-8')).id;
    assert.deepStrictEqual(n8n.workflows.get(id).tags.map((t) => t.name), ['existing', 'new-tag']);
    assert.strictEqual(n8n.tags.size, 2, 'existing tag reused, not duplicated');

    // File without `tags` -> remote tags untouched
    const { tags, ...noTags } = JSON.parse(await readFile(f, 'utf-8'));
    await writeFile(f, JSON.stringify(noTags));
    await engine.pushToN8n({ files: [f] });
    assert.strictEqual(n8n.workflows.get(id).tags.length, 2);

    // Empty array -> tags cleared
    await writeFile(f, JSON.stringify({ ...noTags, tags: [] }));
    await engine.pushToN8n({ files: [f] });
    assert.strictEqual(n8n.workflows.get(id).tags.length, 0);
  });

  it('push matches existing remote workflow by name instead of duplicating', async () => {
    await n8n.createWorkflow(manualFlow);
    await writeFile(join(dir, 'manual.json'), JSON.stringify(manualFlow));
    const r = await engine.pushToN8n();
    assert.strictEqual(r.updated, 1);
    assert.strictEqual(n8n.workflows.size, 1);
  });

  it('--activate reports activation failure without failing the push', async () => {
    const f = join(dir, 'm.json');
    await writeFile(f, JSON.stringify({ ...manualFlow, nodes: [{ ...manualFlow.nodes[0], type: 'n8n-nodes-base.set' }] }));
    const r = await engine.pushToN8n({ files: [f], activate: true });
    assert.strictEqual(r.pushed, 1);
    assert.strictEqual(r.activationErrors, 1);
    assert.match(r.results[0].activationError, /trigger/);
  });

  it('pull writes into tag folders, handles name collisions, skips unchanged, no path escape', async () => {
    await n8n.createWorkflow({ ...manualFlow, name: 'Same Name' });
    await n8n.createWorkflow({ ...manualFlow, name: 'Same Name' });
    const evil = await n8n.createWorkflow({ ...manualFlow, name: '../../evil' });
    n8n.workflows.get(evil.id).tags = [{ id: 't', name: '../..' }];

    const r = await engine.pullFromN8n({ all: true });
    assert.strictEqual(r.pulled, 3);
    assert.strictEqual(r.errors, 0);
    const files = (await readdir(dir, { recursive: true })).sort();
    assert.deepStrictEqual(files, ['_', '_/_evil.json', 'same_name.json', 'same_name_wf2.json']);

    const saved = JSON.parse(await readFile(join(dir, 'same_name.json'), 'utf-8'));
    assert.strictEqual(saved.updatedAt, undefined, 'volatile fields stripped');

    const r2 = await engine.pullFromN8n();
    assert.strictEqual(r2.skipped, 3, 'tracked files are pulled by default');
  });

  it('pull defaults to tracked workflows only; select/tag opt in more', async () => {
    const mine = await n8n.createWorkflow({ ...manualFlow, name: 'Mine' });
    await n8n.createWorkflow({ ...manualFlow, name: 'Someone Else' });
    const tagged = await n8n.createWorkflow({ ...manualFlow, name: 'Tagged' });
    n8n.workflows.get(tagged.id).tags = [{ id: 't1', name: 'team-a' }];
    await writeFile(join(dir, 'mine.json'), JSON.stringify({ ...manualFlow, id: mine.id, name: 'Mine' }));

    const r = await engine.pullFromN8n();
    assert.deepStrictEqual([r.pulled, r.ignored], [1, 2]);
    assert.deepStrictEqual((await readdir(dir)).sort(), ['mine.json']);

    const r2 = await engine.pullFromN8n({ select: ['Someone Else', 'nope'], tags: ['team-a'] });
    assert.deepStrictEqual(r2.notFound, ['nope']);
    assert.strictEqual(r2.errors, 1);
    assert.deepStrictEqual((await readdir(dir, { recursive: true })).sort(), ['mine.json', 'someone_else.json', 'team-a', 'team-a/tagged.json']);

    // Adopted flows are now tracked, so a plain pull keeps them in sync
    const r3 = await engine.pullFromN8n();
    assert.deepStrictEqual([r3.total, r3.ignored], [3, 0]);
  });
});
