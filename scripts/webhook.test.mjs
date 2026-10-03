import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { webhook } from '../apps/events/scripts/webhook.mjs';

it('register/remove are idempotent; only the protected env file receives the destination secret', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'b1-webhook-')), envFile = join(directory, '.env.local');
  await writeFile(envFile, 'APP_URL=https://events.example.test\nUNRELATED=value\n', { mode: 0o600 });
  const calls = [], destinations = [];
  const call = async (method, path, body) => {
    calls.push({ method, path });
    if (method === 'GET' && path === 'webhook/destinations/') return destinations.map(({ secret_shared_key: _secret, ...row }) => row);
    if (method === 'POST') { const row = { ...body, uuid: 'fixture-destination', secret_shared_key: 'fixture-only-secret' }; destinations.push(row); return row; }
    if (method === 'GET') return destinations[0];
    if (method === 'PATCH') return Object.assign(destinations[0], body);
    if (method === 'DELETE') destinations.length = 0;
  };
  const url = 'https://events.example.test/api/webhooks/didit', options = { call, envFile, environment: 'test' };
  try {
    const first = await webhook('register', url, options);
    expect(first).toEqual({ label: 'didit-events-test', registered: true });
    expect(JSON.stringify(first)).not.toContain('fixture-only-secret');
    expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    const contents = await readFile(envFile, 'utf8');
    expect(contents).toContain('DIDIT_WEBHOOK_SECRET="fixture-only-secret"');
    expect(contents).toContain('UNRELATED=value');
    await webhook('register', url, options);
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(calls.filter(call => call.method === 'PATCH')).toHaveLength(0);
    expect(await readFile(envFile, 'utf8')).toBe(contents);
    destinations[0].enabled = false;
    await webhook('register', url, options);
    expect(calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
    expect(await webhook('remove', url, options)).toEqual({ label: 'didit-events-test', removed: true });
    await webhook('remove', url, options);
    expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1);
    expect(await readFile(envFile, 'utf8')).not.toContain('DIDIT_WEBHOOK_SECRET');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects invalid URLs and refuses to remove a same-label destination at a different URL', async () => {
  let calls = 0;
  const call = async () => { calls++; return [{ label: 'didit-events-test', uuid: 'fixture', url: 'https://other.example.test/api/webhooks/didit' }]; };
  for (const url of ['http://events.example.test/api/webhooks/didit', 'https://user:password@events.example.test/api/webhooks/didit', 'https://events.example.test/wrong-path']) {
    await expect(webhook('register', url, { call, environment: 'test' })).rejects.toThrow('Invalid webhook URL');
  }
  expect(calls).toBe(0);
  await expect(webhook('remove', 'https://events.example.test/api/webhooks/didit', { call, environment: 'test' })).rejects.toThrow('URL mismatch');
  expect(calls).toBe(1);
});
