import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function providerCall(method, path, body) {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) throw new Error('DIDIT_API_KEY missing');
  const response = await fetch(`https://verification.didit.me/v3/${path}`, {
    method, headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok && !(method === 'DELETE' && response.status === 404)) throw new Error('Webhook management failed');
  return response.status === 204 || response.status === 404 ? undefined : response.json();
}
async function saveSecret(path, url, secret) {
  let text = '';
  try { text = await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!secret && !text.split('\n').includes(`DIDIT_WEBHOOK_URL=${JSON.stringify(url)}`)) return;
  text = text.split('\n').filter(line => !/^\s*(?:export\s+)?DIDIT_WEBHOOK_(?:SECRET|URL)=/.test(line)).join('\n').trimEnd();
  if (secret) text += `\nDIDIT_WEBHOOK_URL=${JSON.stringify(url)}\nDIDIT_WEBHOOK_SECRET=${JSON.stringify(secret)}`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${text}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
  await chmod(path, 0o600);
}
/** Injected management transport keeps tests local. Returned values never contain a secret. */
export async function webhook(command, destination, options = {}) {
  if (!['register', 'remove'].includes(command)) throw new Error('Usage: webhook.mjs register|remove <url>');
  const url = new URL(destination);
  if (url.username || url.password || url.hash || url.search || url.pathname !== '/api/webhooks/didit' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid webhook URL');
  const environment = options.environment ?? (process.env.DIDIT_ENV || (url.hostname.includes('staging') ? 'staging' : ['localhost', '127.0.0.1'].includes(url.hostname) ? 'development' : 'production'));
  if (!/^[a-z0-9-]{1,40}$/.test(environment)) throw new Error('Invalid Didit environment');
  const label = `didit-events-${environment}`, call = options.call ?? providerCall;
  const file = options.envFile ?? fileURLToPath(new URL('../.env.local', import.meta.url));
  const destinations = await call('GET', 'webhook/destinations/');
  if (!Array.isArray(destinations)) throw new Error('Invalid webhook destination list');
  const matches = destinations.filter(row => row.label === label);
  if (matches.length > 1) throw new Error('Duplicate webhook destination label');
  const existing = matches[0];
  if (command === 'remove') {
    if (existing && existing.url !== url.href) throw new Error('Webhook destination URL mismatch');
    if (existing) await call('DELETE', `webhook/destinations/${encodeURIComponent(existing.uuid)}/`);
    await saveSecret(file, url.href, null);
    return { label, removed: !!existing };
  }
  const desired = { label, url: url.href, enabled: true, webhook_version: 'v3', subscribed_events: ['status.updated', 'data.updated'] };
  const same = existing && existing.url === url.href && existing.enabled && existing.webhook_version === 'v3' &&
    JSON.stringify([...existing.subscribed_events].sort()) === JSON.stringify([...desired.subscribed_events].sort());
  const saved = !existing ? await call('POST', 'webhook/destinations/', desired) : same ? await call('GET', `webhook/destinations/${encodeURIComponent(existing.uuid)}/`) : await call('PATCH', `webhook/destinations/${encodeURIComponent(existing.uuid)}/`, desired);
  if (typeof saved?.secret_shared_key !== 'string' || !saved.secret_shared_key || /[\r\n\0]/.test(saved.secret_shared_key)) throw new Error('Webhook secret unavailable');
  await saveSecret(file, url.href, saved.secret_shared_key);
  return { label, registered: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await webhook(process.argv[2], process.argv[3]);
    console.log(`${result.label}: ${result.registered ? 'registered' : 'removed'}`);
  } catch { console.error('Webhook management failed; check the command, URL, environment and API configuration.'); process.exitCode = 1; }
}
