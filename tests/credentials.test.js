import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveSecrets, scrub, pushCredentials, testCredentials } from '../src/credentials.js';

const SCHEMAS = {
  openAiApi: { type: 'object', additionalProperties: false, properties: { apiKey: {}, url: {} }, required: ['apiKey'] },
  httpHeaderAuth: { type: 'object', additionalProperties: false, properties: { name: {}, value: {} }, required: ['name', 'value'] },
};

class FakeN8n {
  constructor() {
    this.creds = [];
    this.calls = [];
  }
  async listCredentials() { return this.creds.map(({ data, ...c }) => c); } // never returns data, like n8n
  async getCredentialSchema(type) {
    if (!SCHEMAS[type]) throw Object.assign(new Error('not found'), { status: 404 });
    return SCHEMAS[type];
  }
  async createCredential(name, type, data) {
    this.calls.push(['create', name, data]);
    if (data.value === 'make-n8n-echo-it') throw new Error(`request/body/data/value "${data.value}" is invalid`);
    const c = { id: `c${this.creds.length + 1}`, name, type, data };
    this.creds.push(c);
    return { id: c.id, name, type };
  }
  async updateCredential(id, data) {
    this.calls.push(['update', id, data]);
    const c = this.creds.find((x) => x.id === id);
    c.data = { ...c.data, ...data };
  }
  async testCredential(id) {
    const c = this.creds.find((x) => x.id === id);
    if (c.type === 'httpHeaderAuth') return { status: 'Error', message: 'No testing function found for this credential.' };
    return c.data.apiKey === 'sk-good' ? { status: 'OK', message: 'Connection successful!' } : { status: 'Error', message: 'Invalid API key' };
  }
}

const writeJson = async (data) => {
  const dir = await mkdtemp(join(tmpdir(), 'creds-'));
  const file = join(dir, 'credentials.n8n.json');
  await writeFile(file, JSON.stringify(data));
  return file;
};

describe('credentials', () => {
  it('resolves {{env.X}} recursively and reports missing vars by name', () => {
    const r = resolveSecrets({ a: '{{env.A}}', nested: { b: 'Bearer {{ env.B }}' }, c: '{{env.MISSING}}', d: 42 }, { A: 'x1', B: 'y2' });
    assert.deepStrictEqual(r.value, { a: 'x1', nested: { b: 'Bearer y2' }, c: '', d: 42 });
    assert.deepStrictEqual(r.missing, ['MISSING']);
    assert.deepStrictEqual(r.vars.sort(), ['A', 'B', 'MISSING']);
  });

  it('scrubs secret values out of messages', () => {
    assert.strictEqual(scrub('bad value sk-123456 here', ['sk-123456']), 'bad value *** here');
  });

  it('creates missing, updates existing (partial merge), never returns secret values', async () => {
    const n8n = new FakeN8n();
    n8n.creds.push({ id: 'c0', name: 'OpenAI', type: 'openAiApi', data: { apiKey: 'old', oauthTokenData: 'keep-me' } });
    const file = await writeJson([
      { name: 'OpenAI', type: 'openAiApi', data: { apiKey: '{{env.OPENAI_KEY}}' } },
      { name: 'Hook', type: 'httpHeaderAuth', data: { name: 'X-Key', value: '{{env.HOOK_KEY}}' } },
    ]);
    const env = { OPENAI_KEY: 'sk-good', HOOK_KEY: 'hook-secret-value' };

    const r = await pushCredentials(n8n, file, { env });
    assert.deepStrictEqual([r.created, r.updated, r.errors], [1, 1, 0]);
    assert.strictEqual(n8n.creds[0].data.oauthTokenData, 'keep-me', 'partial update keeps other fields');
    assert.strictEqual(n8n.creds[0].data.apiKey, 'sk-good');
    const out = JSON.stringify(r);
    assert.ok(!out.includes('sk-good') && !out.includes('hook-secret-value'), 'no secret in result');
    assert.deepStrictEqual(r.results[0].envVars, ['OPENAI_KEY']);
  });

  it('does not call n8n for entries with missing env vars, wrong fields or unknown types', async () => {
    const n8n = new FakeN8n();
    const file = await writeJson([
      { name: 'A', type: 'openAiApi', data: { apiKey: '{{env.NOT_SET}}' } },
      { name: 'B', type: 'openAiApi', data: { apiKy: 'typo' } },
      { name: 'C', type: 'madeUpType', data: { x: '1' } },
      { name: 'D', type: 'openAiApi' },
    ]);
    const r = await pushCredentials(n8n, file, { env: {} });
    assert.strictEqual(n8n.calls.length, 0);
    assert.match(r.results[0].error, /NOT_SET/);
    assert.deepStrictEqual(r.results[1].errors, ['missing field "apiKey"', 'unknown field "apiKy" (fields: apiKey, url)']);
    assert.match(r.results[2].error, /unknown credential type/);
    assert.match(r.results[3].error, /needs/);
  });

  it('scrubs secrets that n8n echoes back in errors', async () => {
    const n8n = new FakeN8n();
    const file = await writeJson([{ name: 'H', type: 'httpHeaderAuth', data: { name: 'X', value: '{{env.V}}' } }]);
    const r = await pushCredentials(n8n, file, { env: { V: 'make-n8n-echo-it' } });
    assert.strictEqual(r.errors, 1);
    assert.ok(!JSON.stringify(r).includes('make-n8n-echo-it'));
    assert.match(r.results[0].error, /\*\*\*/);
  });

  it('dry run checks everything but changes nothing', async () => {
    const n8n = new FakeN8n();
    const file = await writeJson([{ name: 'OpenAI', type: 'openAiApi', data: { apiKey: '{{env.K}}' } }]);
    const r = await pushCredentials(n8n, file, { env: { K: 'sk-x' }, dryRun: true });
    assert.strictEqual(r.results[0].action, 'would-create');
    assert.strictEqual(n8n.calls.length, 0);
  });

  it('tests credentials via n8n and reports unknown names', async () => {
    const n8n = new FakeN8n();
    n8n.creds.push({ id: 'c1', name: 'Good', type: 'openAiApi', data: { apiKey: 'sk-good' } });
    n8n.creds.push({ id: 'c2', name: 'Bad', type: 'openAiApi', data: { apiKey: 'nope' } });
    n8n.creds.push({ id: 'c3', name: 'Header', type: 'httpHeaderAuth', data: {} });
    const r = await testCredentials(n8n, ['Good', 'Bad', 'Header', 'Ghost']);
    assert.deepStrictEqual(r.results.map((x) => [x.name, x.status]), [['Ghost', 'not-found'], ['Good', 'ok'], ['Bad', 'failed'], ['Header', 'untestable']]);
    assert.deepStrictEqual([r.failed, r.untestable], [2, 1]);
  });
});
