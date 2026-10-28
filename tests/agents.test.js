import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pack, unpack, pullAgents, pushAgents } from '../src/agents.js';

const tmp = () => mkdtemp(join(tmpdir(), 'agents-test-'));
const json = async (f) => JSON.parse(await readFile(f, 'utf8'));
const put = async (f, data) => {
  await mkdir(join(f, '..'), { recursive: true });
  await writeFile(f, JSON.stringify(data, null, '\t'));
};

const CRED = { id: 'GZqY5q4mr6CsUwEM', name: 'Anthropic account', type: 'anthropicApi' };
const agent = (id, name) => ({ id, name, config: { name, model: 'anthropic/claude-haiku-5-5', credential: CRED.id, instructions: 'hi' } });

/** Build a .n8np like n8n's agent export */
async function packageOf(agents) {
  const d = await tmp();
  for (const a of agents) {
    await put(join(d, `agents/${a.name}-${a.id}/agent.json`), a);
    await put(join(d, `agents/${a.name}-${a.id}/agent-metadata.json`), { versionId: 'v1', publishedVersionId: 'v1' });
  }
  await put(join(d, `credentials/anthropic-${CRED.id}/credential.json`), CRED);
  await put(join(d, 'manifest.json'), {
    packageFormatVersion: '1',
    exportedAt: new Date().toISOString(),
    agents: agents.map((a) => ({ id: a.id, name: a.name, target: `agents/${a.name}-${a.id}` })),
    credentials: [{ id: CRED.id, name: CRED.name, target: `credentials/anthropic-${CRED.id}` }],
    requirements: { credentials: [{ ...CRED, usedBy: agents.map((a) => ({ kind: 'agent', id: a.id })) }] },
  });
  return pack(d);
}

class FakeN8n {
  constructor(agents, { importSupported = true } = {}) {
    this.agents = agents;
    this.importSupported = importSupported;
    this.calls = [];
  }
  async listWorkflows() {
    return [{ id: 'w1', shared: [{ projectId: 'p1' }] }];
  }
  async listCredentials() {
    return [CRED];
  }
  async exportPackage(body) {
    this.calls.push(['export', body]);
    if (body.projectIds) {
      const d = await tmp();
      await put(join(d, 'manifest.json'), {
        projects: [{ id: 'p1', target: 'projects/me-p1' }],
        agents: this.agents.map((a) => ({ id: a.id, name: a.name, target: `projects/me-p1/agents/${a.name}-${a.id}` })),
      });
      return pack(d);
    }
    const found = this.agents.filter((a) => body.agentIds.includes(a.id));
    if (found.length !== body.agentIds.length) throw new Error(`n8n API error: 400 - ${body.agentIds.length - found.length} Agent(s) not found or not accessible. Export aborted.`);
    return packageOf(found);
  }
  async importPackage(buffer, fields) {
    if (!this.importSupported) throw Object.assign(new Error("n8n API error: 400 - request/body must have required property 'workflowConflictPolicy'"), { status: 400 });
    const d = await tmp();
    await unpack(buffer, d);
    const f = join(d, '..', 'pkg.n8np');
    await writeFile(f, buffer);
    const { stdout } = await promisify(execFile)('tar', ['-tzf', f]);
    this.firstEntry = stdout.split(/\r?\n/)[0].replace(/^\.\//, '');
    const manifest = await json(join(d, 'manifest.json'));
    this.calls.push(['import', fields, manifest, await readdir(d)]);
    return {
      agents: manifest.agents.map((a) => ({ sourceAgentId: a.id, localId: a.id, name: a.name, status: this.agents.some((x) => x.id === a.id) ? 'updated' : 'created', publishing: { state: 'unchanged' }, channels: [] })),
      credentials: { matched: [CRED.id], stubbed: [] },
    };
  }
}

describe('agents', () => {
  it('pull --all writes the unpacked package without exportedAt, by name too', async () => {
    const n8n = new FakeN8n([agent('AAAAAAAAAAAAAAAA', 'test'), agent('BBBBBBBBBBBBBBBB', 'news')]);
    const dir = join(await tmp(), 'agents');
    const r = await pullAgents(n8n, dir, { all: true });
    assert.deepStrictEqual(r.agents.map((a) => a.name).sort(), ['news', 'test']);
    const m = await json(join(dir, 'manifest.json'));
    assert.strictEqual(m.exportedAt, undefined);
    assert.ok(existsSync(join(dir, 'agents/test-AAAAAAAAAAAAAAAA/agent.json')));
    const exp = n8n.calls.find(([k, b]) => k === 'export' && b.agentIds)[1];
    assert.strictEqual(exp.credentialExportPolicy, 'no-values');

    const dir2 = join(await tmp(), 'agents');
    await pullAgents(n8n, dir2, { select: ['news'] });
    assert.deepStrictEqual((await json(join(dir2, 'manifest.json'))).agents.map((a) => a.name), ['news']);
    await assert.rejects(pullAgents(n8n, dir2, { select: ['nope'] }), /No agent "nope"/);
  });

  it('a hand-written agent survives pull and gets an id + manifest entry on push', async () => {
    const n8n = new FakeN8n([agent('AAAAAAAAAAAAAAAA', 'test')]);
    const dir = join(await tmp(), 'agents');
    await pullAgents(n8n, dir, { all: true });
    await put(join(dir, 'agents/researcher/agent.json'), { name: 'researcher', config: { name: 'researcher', model: 'anthropic/claude-haiku-5-5', credential: 'Anthropic account', instructions: 'research' } });

    const pulled = await pullAgents(n8n, dir);
    assert.deepStrictEqual(pulled.kept, ['researcher']);
    assert.ok(existsSync(join(dir, 'agents/researcher/agent.json')), 'local agent kept');

    const r = await pushAgents(n8n, dir, { publishingPolicy: 'publish-all' });
    const written = await json(join(dir, 'agents/researcher/agent.json'));
    assert.match(written.id, /^[A-Za-z0-9]{16}$/);
    assert.deepStrictEqual(await json(join(dir, 'agents/researcher/agent-metadata.json')), { versionId: null, publishedVersionId: null });
    assert.deepStrictEqual([written.availableInMCP, written.skills, written.tools, written.tasks], [false, {}, {}, {}], 'schema defaults filled');
    assert.strictEqual(written.config.credential, CRED.id, 'credential name resolved to id');
    assert.deepStrictEqual(r.agents.map((a) => `${a.name}:${a.status}`).sort(), ['researcher:created', 'test:updated']);

    const [, fields, manifest, entries] = n8n.calls.find(([k]) => k === 'import');
    assert.deepStrictEqual(fields, { projectId: undefined, conflictPolicy: 'new-version', publishingPolicy: 'publish-all', idPolicy: 'source' });
    assert.ok(manifest.agents.some((a) => a.id === written.id && a.target === 'agents/researcher'));
    assert.ok(manifest.requirements.credentials[0].usedBy.some((u) => u.id === written.id));
    assert.ok(!entries.some((e) => e.startsWith('._')), 'no macOS metadata files');
    assert.strictEqual(n8n.firstEntry, 'manifest.json', 'n8n requires manifest.json first');
    assert.ok(manifest.sourceN8nVersion && manifest.sourceId, 'n8n requires sourceN8nVersion + sourceId');

    // after n8n has it, a pull refreshes it like any other agent
    n8n.agents.push(written);
    const again = await pullAgents(n8n, dir);
    assert.deepStrictEqual(again.kept, []);
    assert.ok(again.agents.some((a) => a.id === written.id));
  });

  it('keeps tracked agents that n8n no longer has', async () => {
    const n8n = new FakeN8n([agent('AAAAAAAAAAAAAAAA', 'test'), agent('BBBBBBBBBBBBBBBB', 'news')]);
    const dir = join(await tmp(), 'agents');
    await pullAgents(n8n, dir, { all: true });
    n8n.agents = n8n.agents.filter((a) => a.name !== 'news');
    const r = await pullAgents(n8n, dir);
    assert.deepStrictEqual(r.agents.map((a) => a.name), ['test']);
    assert.deepStrictEqual(r.kept, ['news']);
    assert.ok((await json(join(dir, 'manifest.json'))).agents.some((a) => a.name === 'news'));
  });

  it('explains when n8n is too old to import agents', async () => {
    const n8n = new FakeN8n([agent('AAAAAAAAAAAAAAAA', 'test')], { importSupported: false });
    const dir = join(await tmp(), 'agents');
    await pullAgents(n8n, dir, { all: true });
    await assert.rejects(pushAgents(n8n, dir), (e) => e.unsupported && /cannot import agents yet/.test(e.message));
  });
});
