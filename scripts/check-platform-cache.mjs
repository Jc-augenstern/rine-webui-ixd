import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('service worker bypasses all private/API/admin requests, including accidental precache entries', async () => {
  const events = {}, cacheReads = [];
  const paths = ['index.html', 'assets/app.js', 'admin/index.html', 'api/v1/auth/session', 'api/v1/me', 'api/v1/notifications', 'api/v1/admin/users', 'media/private.png'];
  const source = (await readFile(new URL('./pwa-worker.js', import.meta.url), 'utf8')).replace('__CACHE_VERSION__', '"test"').replace('__PRECACHE_FILES__', JSON.stringify(paths));
  runInNewContext(source, { URL, Request, self: { registration: { scope: 'https://ixd.example/' }, location: { origin: 'https://ixd.example' }, addEventListener: (type, fn) => { events[type] = fn; } }, caches: { open: async () => ({ match: async key => { cacheReads.push(key); return 'static'; } }) }, fetch: async () => 'network' });
  async function request(path, mode = 'cors', method = 'GET') {
    let response;
    events.fetch({ request: { method, url: `https://ixd.example/${path}`, mode }, respondWith(value) { response = value; } });
    return response === undefined ? undefined : await response;
  }
  for (const path of paths.filter(p => /^(api|admin|media)/.test(p))) assert.equal(await request(path, path.startsWith('admin') ? 'navigate' : 'cors'), undefined, path);
  assert.equal(await request('admin/', 'navigate'), undefined);
  assert.equal(await request('index.html?token=private', 'navigate'), undefined);
  assert.equal(await request('api/v1/auth/login', 'cors', 'POST'), undefined);
  assert.equal(await request('', 'navigate'), 'static');
  assert.equal(await request('assets/app.js'), 'static');
  assert.deepEqual(cacheReads, ['https://ixd.example/index.html', 'https://ixd.example/assets/app.js']);
});
