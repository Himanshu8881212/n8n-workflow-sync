import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { SyncEngine } from '../src/sync-engine.js';
import { toApiBody } from '../src/n8n-client.js';
import { validateWorkflow } from '../src/validator.js';

// In-memory stand-in for N8nClient. Every write bumps updatedAt, like n8n.
class FakeN8n {
  constructor() {
    this.apiUrl = 'http://fake/api/v1';
    this.workflows = new Map();
    this.tags = new Map();
    this.credentials = [];
    this.nextId = 1;
    this.clock = 0;
    this.bodies = [];
  }
  _touch(wf) {
    wf.updatedAt = `t${++this.clock}`;
    return wf;
  }
  async listWorkflows() { return [...this.workflows.values()]; }
  async getWorkflow(id) {
    const wf = this.workflows.get(String(id));
    if (!wf) throw Object.assign(new Error('not found'), { status: 404 });
    return structuredClone(wf);
  }
  async getWorkflowOrNull(id) { return this.workflows.has(String(id)) ? this.getWorkflow(id) : null; }
  async createWorkflow(wf) {
    const body = toApiBody(wf);
    this.bodies.push(body);
    const created = this._touch({ ...structuredClone(body), id: `wf${this.nextId++}`, active: false, tags: [] });
    this.workflows.set(created.id, created);
    return structuredClone(created);
  }
  async updateWorkflow(id, wf) {
    const body = toApiBody(wf);
    this.bodies.push(body);
    const updated = this._touch({ ...this.workflows.get(id), ...structuredClone(body) });
    this.workflows.set(id, updated);
    return structuredClone(updated);
  }
  async deleteWorkflow(id) {
    if (this.workflows.get(String(id))?.active) throw Object.assign(new Error('Cannot delete a published workflow'), { status: 409 });
    this.workflows.delete(String(id));
  }
  async deactivateWorkflow(id) { this._touch(this.workflows.get(id)).active = false; }
  async listTags() { return [...this.tags.values()]; }
  async createTag(name) {
    const tag = { id: `t${this.tags.size + 1}`, name };
    this.tags.set(name, tag);
    return tag;
  }
  async setWorkflowTags(id, tagIds) {
    const byId = new Map([...this.tags.values()].map((t) => [t.id, t]));
    this._touch(this.workflows.get(id)).tags = tagIds.map((t) => byId.get(t));
  }
  async listCredentials() { return this.credentials; }
  async activateWorkflow(id) {
    const wf = this.workflows.get(id);
    if (!wf.nodes.some((n) => /trigger|webhook/i.test(n.type) && !/manual/i.test(n.type))) throw new Error('no trigger node');
    this._touch(wf).active = true;
    return wf;
  }
  // Simulate someone editing in the n8n UI
  uiEdit(id, fn) { fn(this._touch(this.workflows.get(id))); }
}

const node = (name, type, extra = {}) => ({ id: name, name, type, typeVersion: 1, position: [0, 0], parameters: {}, ...extra });
const webhookFlow = {
  name: 'Hook Flow',
  active: true,
  tags: [{ name: 'x' }],
  createdAt: 'junk',
  nodes: [node('Webhook', 'n8n-nodes-base.webhook', { parameters: { path: 'h' } })],
  connections: {},
};
const manualFlow = { name: 'Manual Flow', nodes: [node('Start', 'n8n-nodes-base.manualTrigger')], connections: {} };

describe('SyncEngine', () => {
  let dir, n8n, engine;
  const read = async (f) => JSON.parse(await readFile(join(dir, f), 'utf-8'));
  const put = (f, wf) => writeFile(join(dir, f), JSON.stringify(wf, null, 2));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'n8n-sync-'));
    n8n = new FakeN8n();
    engine = new SyncEngine({ workflowsDir: dir, client: n8n });
  });

  describe('push', () => {
    it('creates, writes id back, sends only writable fields, activates; re-push is a no-op', async () => {
      await put('hook.json', webhookFlow);
      await put('package.json', { name: 'not-a-workflow' });

      const r = await engine.pushToN8n();
      assert.deepStrictEqual([r.pushed, r.skipped, r.activated], [1, 1, 1]);
      assert.deepStrictEqual(Object.keys(n8n.bodies[0]).sort(), ['connections', 'name', 'nodes', 'settings']);
      assert.strictEqual((await read('hook.json')).id, 'wf1');

      const r2 = await engine.pushToN8n();
      assert.strictEqual(r2.unchanged, 1);
      assert.strictEqual(n8n.bodies.length, 1, 'nothing re-sent');

      await put('hook.json', { ...(await read('hook.json')), nodes: [node('Webhook', 'n8n-nodes-base.webhook', { parameters: { path: 'h2' } })] });
      const r3 = await engine.pushToN8n();
      assert.strictEqual(r3.updated, 1);
      assert.strictEqual(n8n.workflows.size, 1);
    });

    it('adopts an identical remote workflow by name instead of duplicating', async () => {
      await n8n.createWorkflow(manualFlow);
      await put('manual.json', manualFlow);
      const r = await engine.pushToN8n();
      assert.strictEqual(r.updated, 1);
      assert.strictEqual(n8n.workflows.size, 1);
    });

    it('reports activation failure without failing the push', async () => {
      const f = join(dir, 'm.json');
      await writeFile(f, JSON.stringify(manualFlow));
      const r = await engine.pushToN8n({ files: [f], activate: true });
      assert.strictEqual(r.pushed, 1);
      assert.strictEqual(r.activationErrors, 1);
      assert.match(r.results[0].activationError, /trigger/);
    });

    it('sets tags by name, creates missing ones, leaves tags alone when file has none', async () => {
      await n8n.createTag('existing');
      await put('t.json', { ...manualFlow, tags: [{ id: 'other-instance-id', name: 'existing' }, 'new-tag'] });
      await engine.pushToN8n();
      const id = (await read('t.json')).id;
      assert.deepStrictEqual(n8n.workflows.get(id).tags.map((t) => t.name), ['existing', 'new-tag']);
      assert.strictEqual(n8n.tags.size, 2, 'existing tag reused');

      const { tags, ...noTags } = await read('t.json');
      await put('t.json', { ...noTags, nodes: [...noTags.nodes, node('Set', 'n8n-nodes-base.set')] });
      await engine.pushToN8n();
      assert.strictEqual(n8n.workflows.get(id).tags.length, 2);

      await put('t.json', { ...(await read('t.json')), tags: [] });
      await engine.pushToN8n();
      assert.strictEqual(n8n.workflows.get(id).tags.length, 0);
    });

    it('refuses to overwrite edits made in n8n since the last sync, unless forced (with backup)', async () => {
      await put('m.json', manualFlow);
      await engine.pushToN8n();
      const id = (await read('m.json')).id;
      n8n.uiEdit(id, (wf) => (wf.nodes[0].name = 'Edited In UI'));

      await put('m.json', { ...(await read('m.json')), nodes: [node('Local', 'n8n-nodes-base.manualTrigger')] });
      const r = await engine.pushToN8n();
      assert.strictEqual(r.conflicts, 1);
      assert.match(r.results[0].reason, /changed in n8n/);
      assert.strictEqual(n8n.workflows.get(id).nodes[0].name, 'Edited In UI', 'n8n untouched');

      const forced = await engine.pushToN8n({ force: true });
      assert.strictEqual(forced.updated, 1);
      assert.ok(existsSync(forced.results[0].backup), 'remote version backed up');
      assert.match(await readFile(forced.results[0].backup, 'utf-8'), /Edited In UI/);
    });

    it('refuses when n8n has a different workflow with no sync record (fresh clone)', async () => {
      const remote = await n8n.createWorkflow(manualFlow);
      await put('m.json', { ...manualFlow, id: remote.id, nodes: [node('Different', 'n8n-nodes-base.manualTrigger')] });
      const r = await engine.pushToN8n();
      assert.strictEqual(r.conflicts, 1);
      assert.match(r.results[0].reason, /no sync record/);
    });

    it('validates before sending: broken connections are not pushed', async () => {
      await put('bad.json', { ...manualFlow, connections: { Start: { main: [[{ node: 'Nope', type: 'main', index: 0 }]] } } });
      const r = await engine.pushToN8n();
      assert.strictEqual(r.invalid, 1);
      assert.match(r.results[0].errors[0], /Nope/);
      assert.strictEqual(n8n.bodies.length, 0);
    });

    it('re-points credentials by type+name for the target instance without touching the file', async () => {
      n8n.credentials = [{ id: 'prod-9', name: 'Team Slack', type: 'slackApi' }];
      const flow = {
        ...manualFlow,
        nodes: [
          ...manualFlow.nodes,
          node('Slack', 'n8n-nodes-base.slack', { credentials: { slackApi: { id: 'dev-1', name: 'Team Slack' } } }),
          node('Mail', 'n8n-nodes-base.gmail', { credentials: { gmailOAuth2: { id: 'dev-2', name: 'Missing Cred' } } }),
        ],
      };
      await put('c.json', flow);
      const r = await engine.pushToN8n();
      assert.deepStrictEqual(n8n.bodies[0].nodes[1].credentials, { slackApi: { id: 'prod-9', name: 'Team Slack' } });
      assert.match(r.results[0].warnings.join(), /Missing Cred.*not found/);
      assert.strictEqual((await read('c.json')).nodes[1].credentials.slackApi.id, 'dev-1', 'file keeps its own ids');
    });

    it('pushes sub-workflows first and re-points Execute Workflow nodes by name', async () => {
      await put('a-caller.json', {
        ...manualFlow,
        name: 'Caller',
        nodes: [
          ...manualFlow.nodes,
          node('Call Sub', 'n8n-nodes-base.executeWorkflow', {
            parameters: { workflowId: { __rl: true, value: 'dev-sub-id', mode: 'list', cachedResultName: 'Sub' } },
          }),
        ],
      });
      await put('b-sub.json', { ...manualFlow, name: 'Sub', id: 'dev-sub-id' });
      await engine.pushToN8n({ force: true });
      assert.strictEqual((await read('b-sub.json')).id, 'dev-sub-id', 'file keeps the id it was written with');
      const subId = [...n8n.workflows.values()].find((w) => w.name === 'Sub').id;
      const callerBody = n8n.bodies.find((b) => b.name === 'Caller');
      assert.strictEqual(callerBody.nodes[1].parameters.workflowId.value, subId);
    });

    it('inlines @file: code references when pushing', async () => {
      await writeFile(join(dir, 'flow.transform.js'), 'return [{ json: { ok: 1 } }];');
      await put('flow.json', { ...manualFlow, nodes: [...manualFlow.nodes, node('Transform', 'n8n-nodes-base.code', { parameters: { jsCode: '@file:./flow.transform.js' } })] });
      await engine.pushToN8n();
      assert.strictEqual(n8n.bodies[0].nodes[1].parameters.jsCode, 'return [{ json: { ok: 1 } }];');
      assert.strictEqual((await read('flow.json')).nodes[1].parameters.jsCode, '@file:./flow.transform.js', 'ref kept in file');
    });
  });

  it('tracks a second instance (prod) without rewriting the file ids', async () => {
    await put('m.json', manualFlow);
    await engine.pushToN8n();
    const devId = (await read('m.json')).id;

    const prod = new FakeN8n();
    prod.apiUrl = 'http://prod/api/v1';
    prod.nextId = 100;
    const prodEngine = new SyncEngine({ workflowsDir: dir, client: prod });
    const r = await prodEngine.pushToN8n();
    assert.strictEqual(r.pushed, 1);
    assert.strictEqual((await read('m.json')).id, devId, 'file still has the dev id');

    // Re-push to prod updates the same prod workflow; prod pull tracks it
    await put('m.json', { ...(await read('m.json')), nodes: [node('Changed', 'n8n-nodes-base.manualTrigger')] });
    assert.strictEqual((await prodEngine.pushToN8n()).updated, 1);
    assert.strictEqual(prod.workflows.size, 1);
    prod.uiEdit('wf100', (wf) => (wf.nodes[0].name = 'Prod UI'));
    const p = await prodEngine.pullFromN8n();
    assert.strictEqual(p.pulled, 1);
    assert.strictEqual((await read('m.json')).id, devId, 'pull from prod keeps the file id');
    assert.strictEqual(n8n.workflows.size, 1, 'dev untouched');
  });

  it('watcher sync never pushes backups, state or config files', async () => {
    await put('m.json', manualFlow);
    await engine.pushToN8n();
    n8n.uiEdit((await read('m.json')).id, (wf) => (wf.nodes[0].name = 'Newer'));
    await put('m.json', { ...(await read('m.json')), name: 'Local' });
    const forced = await engine.pushToN8n({ force: true }); // writes a backup of the remote
    const before = n8n.bodies.length;
    for (const f of [forced.results[0].backup, join(dir, '.n8n-sync', 'state.json'), join(dir, 'credentials.n8n.json')]) {
      assert.strictEqual((await engine.syncFile(f)).action, 'skipped', f);
    }
    assert.strictEqual(n8n.bodies.length, before, 'nothing pushed');

    const { EnhancedFileWatcher } = await import('../src/watcher-enhanced.js');
    const w = new EnhancedFileWatcher(dir, engine);
    assert.strictEqual(w.isIgnored(forced.results[0].backup), true);
    assert.strictEqual(w.isIgnored(join(dir, '.n8n-sync', 'state.json')), true);
    assert.strictEqual(w.isIgnored(join(dir, 'sub', 'flow.json')), false);
    assert.strictEqual(w.isIgnored(join(dir, 'flow.code.js')), false);
  });

  describe('pull', () => {
    it('writes into tag folders, handles name collisions, skips unchanged, no path escape', async () => {
      await n8n.createWorkflow({ ...manualFlow, name: 'Same Name' });
      await n8n.createWorkflow({ ...manualFlow, name: 'Same Name' });
      const evil = await n8n.createWorkflow({ ...manualFlow, name: '../../evil' });
      n8n.workflows.get(evil.id).tags = [{ id: 't', name: '../..' }];

      const r = await engine.pullFromN8n({ all: true });
      assert.deepStrictEqual([r.pulled, r.errors], [3, 0]);
      const files = (await readdir(dir, { recursive: true })).map((f) => f.split(sep).join('/')).filter((f) => !f.startsWith('.n8n-sync')).sort();
      assert.deepStrictEqual(files, ['_', '_/_evil.json', 'same_name.json', 'same_name_wf2.json']);
      assert.strictEqual((await read('same_name.json')).updatedAt, undefined, 'volatile fields stripped');

      const r2 = await engine.pullFromN8n();
      assert.strictEqual(r2.skipped, 3, 'tracked files are pulled by default');
    });

    it('defaults to tracked workflows only; select/tag opt in more', async () => {
      const mine = await n8n.createWorkflow({ ...manualFlow, name: 'Mine' });
      await n8n.createWorkflow({ ...manualFlow, name: 'Someone Else' });
      const tagged = await n8n.createWorkflow({ ...manualFlow, name: 'Tagged' });
      n8n.workflows.get(tagged.id).tags = [{ id: 't1', name: 'team-a' }];
      await put('mine.json', { ...manualFlow, id: mine.id, name: 'Mine' });

      const r = await engine.pullFromN8n({ force: true });
      assert.deepStrictEqual([r.total, r.ignored], [1, 2]);

      const r2 = await engine.pullFromN8n({ select: ['Someone Else', 'nope'], tags: ['team-a'] });
      assert.deepStrictEqual(r2.notFound, ['nope']);
      assert.strictEqual(r2.errors, 1);
      const files = (await readdir(dir, { recursive: true })).map((f) => f.split(sep).join('/')).filter((f) => !f.startsWith('.n8n-sync')).sort();
      assert.deepStrictEqual(files, ['mine.json', 'someone_else.json', 'team-a', 'team-a/tagged.json']);

      const r3 = await engine.pullFromN8n();
      assert.deepStrictEqual([r3.total, r3.ignored], [3, 0]);
    });

    it('refuses to overwrite unpushed local edits, unless forced (with backup)', async () => {
      await put('m.json', manualFlow);
      await engine.pushToN8n();
      const id = (await read('m.json')).id;
      n8n.uiEdit(id, (wf) => (wf.nodes[0].name = 'From UI'));
      await put('m.json', { ...(await read('m.json')), name: 'Local Rename' });

      const r = await engine.pullFromN8n();
      assert.strictEqual(r.conflicts, 1);
      assert.strictEqual((await read('m.json')).name, 'Local Rename', 'local file untouched');

      const forced = await engine.pullFromN8n({ force: true });
      assert.strictEqual(forced.pulled, 1);
      assert.strictEqual((await read('m.json')).nodes[0].name, 'From UI');
      assert.match(await readFile(forced.results[0].backup, 'utf-8'), /Local Rename/);
    });

    it('pulls n8n edits cleanly when the local file is unchanged since last sync', async () => {
      await put('m.json', manualFlow);
      await engine.pushToN8n();
      n8n.uiEdit((await read('m.json')).id, (wf) => (wf.nodes[0].name = 'From UI'));
      const r = await engine.pullFromN8n();
      assert.deepStrictEqual([r.pulled, r.conflicts], [1, 0]);
    });

    it('keeps code in its own file: updates the .js, keeps the reference; --split-code splits new ones', async () => {
      await writeFile(join(dir, 'f.code.js'), 'return [];');
      await put('f.json', { ...manualFlow, nodes: [...manualFlow.nodes, node('Code', 'n8n-nodes-base.code', { parameters: { jsCode: '@file:./f.code.js' } })] });
      await engine.pushToN8n();
      const id = (await read('f.json')).id;
      n8n.uiEdit(id, (wf) => (wf.nodes[1].parameters.jsCode = 'return [{ json: { fromUi: true } }];'));

      await engine.pullFromN8n();
      assert.strictEqual(await readFile(join(dir, 'f.code.js'), 'utf-8'), 'return [{ json: { fromUi: true } }];');
      assert.strictEqual((await read('f.json')).nodes[1].parameters.jsCode, '@file:./f.code.js');

      const other = await n8n.createWorkflow({ ...manualFlow, name: 'Inline', nodes: [...manualFlow.nodes, node('My Code', 'n8n-nodes-base.code', { parameters: { jsCode: 'return 1;' } })] });
      await engine.pullFromN8n({ select: [other.id], splitCode: true });
      assert.strictEqual((await read('inline.json')).nodes[1].parameters.jsCode, '@file:./inline.my_code.js');
      assert.strictEqual(await readFile(join(dir, 'inline.my_code.js'), 'utf-8'), 'return 1;');
    });
  });

  describe('delete & prune', () => {
    it('deletes from n8n (unpublishing first) and locally (incl. code files), with backups', async () => {
      await writeFile(join(dir, 'd.code.js'), 'return [];');
      await put('d.json', { ...webhookFlow, name: 'Manual Flow', nodes: [...webhookFlow.nodes, node('Code', 'n8n-nodes-base.code', { parameters: { jsCode: '@file:./d.code.js' } })], connections: {} });
      await engine.pushToN8n();
      assert.strictEqual([...n8n.workflows.values()][0].active, true);
      const id = (await read('d.json')).id;

      const r = await engine.deleteWorkflows(['Manual Flow', 'does-not-exist']);
      assert.deepStrictEqual([r.deleted, r.errors], [1, 1]);
      assert.strictEqual(n8n.workflows.has(id), false);
      assert.strictEqual(existsSync(join(dir, 'd.json')), false);
      assert.strictEqual(existsSync(join(dir, 'd.code.js')), false);
      const backups = await readdir(join(dir, '.n8n-sync', 'backups', id));
      assert.strictEqual(backups.length, 2);
    });

    it('prune only targets workflows this folder synced whose file is gone', async () => {
      await put('keep.json', { ...manualFlow, name: 'Keep' });
      await put('gone.json', { ...manualFlow, name: 'Gone' });
      await engine.pushToN8n();
      await n8n.createWorkflow({ ...manualFlow, name: 'Someone Elses Flow' });
      await rm(join(dir, 'gone.json'));

      const candidates = await engine.pruneCandidates();
      assert.deepStrictEqual(candidates.map((c) => c.name), ['Gone']);
    });
  });

  describe('executions', () => {
    it('summarizes errors per node', () => {
      const s = engine.summarizeExecution({
        id: '7',
        status: 'error',
        startedAt: '2026-01-01T00:00:00.000Z',
        stoppedAt: '2026-01-01T00:00:01.500Z',
        data: { resultData: { lastNodeExecuted: 'HTTP', error: { message: 'boom', node: { name: 'HTTP' } }, runData: { HTTP: [{ error: { message: '404 Not Found' } }] } } },
      });
      assert.deepStrictEqual([s.status, s.durationMs, s.error.node, s.nodeErrors[0].message], ['error', 1500, 'HTTP', '404 Not Found']);
    });
  });
});

describe('validator', () => {
  it('catches duplicate names, bad connections, missing fields; warns on no trigger', () => {
    const { errors, warnings } = validateWorkflow({
      name: 'x',
      nodes: [node('A', 'n8n-nodes-base.set'), node('A', 'n8n-nodes-base.set'), { name: 'B' }],
      connections: { Ghost: { main: [[{ node: 'A' }]] }, A: { main: [[{ node: 'Missing' }]] } },
    });
    assert.ok(errors.some((e) => /duplicate/.test(e)));
    assert.ok(errors.some((e) => /"B": missing `type`/.test(e)));
    assert.ok(errors.some((e) => /Ghost/.test(e)));
    assert.ok(errors.some((e) => /Missing/.test(e)));
    assert.ok(warnings.some((w) => /no automatic trigger/.test(w)));
  });

  it('passes a valid webhook flow', () => {
    assert.deepStrictEqual(validateWorkflow(webhookFlow), { errors: [], warnings: [] });
  });
});
