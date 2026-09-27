import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { createPool, migrate } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/password.js';
import { PgSessionStore } from '../src/session-store.js';
import { blankPayload, parsePayload, userSchema, type Role } from '../../shared/platform.js';

class Client {
  cookie = ''; csrf = ''; ip: string;
  constructor(private app: FastifyInstance, serial: number) { this.ip = `127.0.1.${serial}`; }
  async call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, extra: Record<string, string> = {}) {
    const response = await this.app.inject({ method, url: `/api/v1${url}`, remoteAddress: this.ip,
      headers: { cookie: this.cookie, ...(method === 'GET' ? {} : { 'x-csrf-token': this.csrf }), ...extra },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    const set = response.headers['set-cookie'];
    if (set) this.cookie = (Array.isArray(set) ? set[0] : String(set)).split(';')[0];
    const json = response.headers['content-type']?.includes('application/json') ? response.json() : null;
    if (json?.data?.csrfToken) this.csrf = json.data.csrfToken;
    return { status: response.statusCode, json, headers: response.headers, bytes: response.rawPayload };
  }
  async init() { assert.equal((await this.call('GET', '/auth/session')).status, 200); }
  async login(account: string, password: string) { await this.init(); const result = await this.call('POST', '/auth/login', { account, password }); assert.equal(result.status, 200, result.json?.error?.code); return result.json.data; }
}
async function mailToken(email: string, subject: string) {
  const search = await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  assert.equal(search.status, 200, 'Real local mail capture must be available');
  const inbox = await search.json() as { messages: { ID: string; Subject: string }[] };
  const message = inbox.messages.find(m => m.Subject.includes(subject));
  assert.ok(message, 'Expected real SMTP message');
  const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`)).json() as { Text: string };
  const token = detail.Text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  assert.ok(token, 'Email must contain a usable link');
  return token;
}
function multipart(bytes: Buffer, name: string, mime: string, access = 'PRIVATE') {
  const boundary = `ixd-${randomUUID()}`;
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="accessLevel"\r\n\r\n${access}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

test('real PostgreSQL authentication, ownership, media and access lifecycle', { timeout: 120_000 }, async t => {
  const config = loadConfig('test'), adminDb = createPool(config.databaseUrl), schema = `ixd_auth_${randomBytes(8).toString('hex')}`;
  await adminDb.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(config.databaseUrl); url.searchParams.set('options', `-c search_path=${schema}`);
  const db = createPool(url.href), storagePath = resolve(config.root, '.local/test-uploads', schema);
  config.storagePath = storagePath; await mkdir(storagePath, { recursive: true });
  let clock = new Date();
  await migrate(db, config.root); assert.deepEqual(await migrate(db, config.root), []);
  const { app } = await buildApp(config, { db, now: () => new Date(clock), logger: false });
  const clients = Array.from({ length: 10 }, (_, i) => new Client(app, i + 1));
  const [guest, user, other, admin, editor, mailClient] = clients;
  const fixtures = new Map<Role, { id: string; username: string; password: string }>();
  async function fixture(role: Role) {
    const username = `${role.toLowerCase()}_${randomBytes(5).toString('hex')}`, password = randomBytes(18).toString('base64url');
    const inserted = await db.query("INSERT INTO users(username,email,password_hash,display_name,role,email_verified_at) VALUES($1,$2,$3,$1,$4,now()) RETURNING id", [username, `${username}@example.test`, await hashPassword(password), role]);
    const account = { id: inserted.rows[0].id as string, username, password }; fixtures.set(role, account); return account;
  }
  try {
    await t.test('production cookies require HTTPS from the configured trusted proxy', async () => {
      const production = await buildApp({ ...config, mode: 'production', trustProxy: '127.0.0.1/32', publicOrigin: 'https://ixd.example', adminOrigin: 'https://ixd.example' }, { db, logger: false });
      try {
        const secure = await production.app.inject({ method: 'GET', url: '/api/v1/auth/session', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-proto': 'https' } });
        assert.equal(secure.statusCode, 200);
        const cookie = String(secure.headers['set-cookie']);
        for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(attribute));
        assert.equal(secure.headers['cache-control'], 'no-store');
        const forged = await production.app.inject({ method: 'GET', url: '/api/v1/auth/session', remoteAddress: '192.0.2.12', headers: { 'x-forwarded-proto': 'https' } });
        assert.equal(forged.headers['set-cookie'], undefined, 'Untrusted forwarding headers must not authorize a Secure cookie over plain HTTP');
        const health = await production.app.inject({ method: 'GET', url: '/api/v1/health' });
        assert.deepEqual(health.json(), { data: { status: 'ok', service: 'ixd-platform-api' } });
      } finally { await production.app.close(); }
    });
    await t.test('registration, real email verification, strict fields and secure session login/logout', async () => {
      await guest.init();
      assert.equal((await guest.call('GET', '/admin/users')).status, 401);
      assert.equal((await guest.call('POST', '/auth/login', { account: 'no-account', password: 'x' }, { 'x-csrf-token': '' })).status, 403);
      assert.equal((await guest.call('POST', '/auth/login', { account: 'no-account', password: 'x' }, { origin: 'https://untrusted.example' })).status, 403);
      const username = `signup_${randomBytes(5).toString('hex')}`, email = `${username}@example.test`, password = ` ${randomBytes(18).toString('base64url')} `;
      assert.equal((await guest.call('POST', '/auth/register', { username, email, displayName: '本地测试', password, role: 'ADMIN' })).status, 400);
      const registration = await guest.call('POST', '/auth/register', { username, email, displayName: '本地测试', password });
      assert.equal(registration.status, 201); assert.ok(!JSON.stringify(registration.json).includes('token'));
      assert.equal((await user.login(` ${username} `, password)).user.emailVerified, false);
      assert.equal((await user.call('POST', '/media', {})).status, 403);
      const token = await mailToken(email, '验证邮箱');
      assert.equal((await guest.call('POST', '/auth/verify-email', { token })).status, 200);
      assert.equal((await guest.call('POST', '/auth/verify-email', { token })).status, 400);
      const restored = await user.call('GET', '/auth/session');
      assert.equal(restored.json.data.user.emailVerified, true); userSchema.parse(restored.json.data.user);
      assert.equal((await user.call('GET', '/admin/users')).status, 403);
      assert.equal((await user.call('PATCH', '/me', { expectedRevision: restored.json.data.user.profileVersion, displayName: 'x', grade: '', major: '', directionIds: [], role: 'ADMIN' })).status, 400);
      assert.equal(restored.headers['cache-control'], 'no-store');
      assert.ok(String(restored.headers['set-cookie']).includes('HttpOnly')); assert.ok(String(restored.headers['set-cookie']).includes('SameSite=Lax'));
      assert.equal((await user.call('POST', '/auth/logout', {})).status, 200);
      assert.equal((await user.call('GET', '/me')).status, 401);
      await user.init();
      assert.equal((await user.call('POST', '/auth/login', { account: username, password: password.trim() })).status, 401);
      await user.login(username, password);
      assert.equal((await user.call('GET', `/me/${randomUUID()}`)).status, 404);
      const newPassword = randomBytes(24).toString('base64url');
      await mailClient.init();
      assert.equal((await mailClient.call('POST', '/auth/forgot-password', { email })).status, 200);
      const reset = await mailToken(email, '重置密码');
      assert.equal((await mailClient.call('POST', '/auth/reset-password', { token: reset, password: newPassword })).status, 200);
      assert.equal((await mailClient.call('POST', '/auth/reset-password', { token: reset, password: newPassword })).status, 400);
      assert.equal((await user.call('GET', '/me')).status, 401, 'Reset revokes existing sessions');
      await user.login(username, newPassword);
      assert.equal((await mailClient.call('POST', '/auth/forgot-password', { email })).status, 200);
      const expired = await mailToken(email, '重置密码');
      const originalClock = clock; clock = new Date(clock.getTime() + 2 * 3600_000);
      assert.equal((await mailClient.call('POST', '/auth/reset-password', { token: expired, password: newPassword })).status, 400);
      clock = originalClock;
      const changed = await user.call('POST', '/auth/change-password', { currentPassword: newPassword, password });
      assert.equal(changed.status, 200); assert.equal((await user.call('GET', '/me')).status, 200);
      assert.equal((await mailClient.call('POST', '/auth/reset-password', { token: expired, password: newPassword })).status, 400, 'Changing a password consumes earlier reset links, even before their expiry');
    });
    await t.test('admin fields, scoped editor, optimistic locking, revoke, last admin and tombstones', async () => {
      const adminAccount = await fixture('ADMIN'), editorAccount = await fixture('EDITOR'), otherAccount = await fixture('USER');
      await admin.login(adminAccount.username, adminAccount.password); await editor.login(editorAccount.username, editorAccount.password); await other.login(otherAccount.username, otherAccount.password);
      const list = await admin.call('GET', '/admin/users'); assert.equal(list.status, 200);
      assert.ok(!JSON.stringify(list.json).match(/password_hash|token_hash|sessionSecret/));
      const profile = await other.call('PATCH', '/me', { expectedRevision: 1, displayName: '方向筛选测试', grade: '', major: '', directionIds: ['ai'] });
      assert.equal(profile.status, 200);
      const filtered = await admin.call('GET', '/admin/users?direction=ai&role=USER&pageSize=1');
      assert.equal(filtered.status, 200); assert.equal(filtered.json.meta.total, 1);
      assert.deepEqual(filtered.json.data.map((u: { id: string }) => u.id), [otherAccount.id]);
      assert.equal((await admin.call('GET', '/admin/users?direction=hardware')).json.meta.total, 0);
      assert.equal((await admin.call('GET', '/admin/users?direction=invalid')).status, 400);
      assert.equal((await editor.call('GET', '/admin/users')).status, 403);
      assert.equal((await editor.call('PUT', `/admin/users/${editorAccount.id}/grants`, { expectedRevision: 1, grants: [] })).status, 403);
      let payload = parsePayload('announcements', { ...blankPayload('announcements'), title: '受限公告', directionIds: ['ai'] });
      assert.equal((await editor.call('POST', '/admin/contents', { kind: 'announcements', payload })).status, 403);
      const grant = await admin.call('PUT', `/admin/users/${editorAccount.id}/grants`, { expectedRevision: 1, grants: [{ contentKind: 'announcements', directionId: 'ai', contentId: null, actions: ['create', 'read', 'update', 'publish'] }] });
      assert.equal(grant.status, 200); assert.equal((await editor.call('GET', '/me')).status, 401);
      await editor.login(editorAccount.username, editorAccount.password);
      assert.equal((await editor.call('POST', '/admin/contents', { kind: 'announcements', payload })).status, 201);
      payload = { ...payload, directionIds: ['ai', 'hardware'] };
      assert.equal((await editor.call('POST', '/admin/contents', { kind: 'announcements', payload })).status, 403);
      const old = await admin.call('GET', `/admin/users/${otherAccount.id}`);
      const input = { expectedRevision: old.json.data.user.profileVersion, role: 'USER', status: 'DISABLED', memberStatus: 'NONE' };
      assert.equal((await admin.call('PATCH', `/admin/users/${otherAccount.id}`, input)).status, 200);
      assert.equal((await admin.call('PATCH', `/admin/users/${otherAccount.id}`, input)).status, 409);
      assert.equal((await other.call('GET', '/me')).status, 401);
      const unverified = await db.query("INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,$3,'unverified') RETURNING id", [`unverified_${randomBytes(4).toString('hex')}`, `unverified_${randomUUID()}@example.test`, await hashPassword(randomUUID())]);
      const promote = await admin.call('PATCH', `/admin/users/${unverified.rows[0].id}`, { expectedRevision: 1, role: 'ADMIN', status: 'ACTIVE', memberStatus: 'NONE' });
      assert.equal(promote.status, 400); assert.equal(promote.json.error.code, 'ADMIN_EMAIL_REQUIRED');
      await db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [editorAccount.id]);
      const staleSession = await editor.call('GET', '/auth/session');
      assert.equal(staleSession.status, 200); assert.equal(staleSession.json.data.user, null);
      const last = await admin.call('PATCH', `/admin/users/${adminAccount.id}`, { expectedRevision: 1, role: 'USER', status: 'ACTIVE', memberStatus: 'NONE' });
      assert.equal(last.status, 409); assert.equal(last.json.error.code, 'LAST_ADMIN');
      const sessionStore = new PgSessionStore(db, () => clock, 86400_000), sid = randomBytes(24).toString('base64url');
      const data = { cookie: { originalMaxAge: 86400_000, expires: new Date(clock.getTime() + 86400_000) }, userId: adminAccount.id };
      const save = () => new Promise<void>((resolve, reject) => sessionStore.set(sid, data, error => error ? reject(error) : resolve()));
      await save(); await new Promise<void>((resolve, reject) => sessionStore.destroy(sid, error => error ? reject(error) : resolve())); await save();
      const restored = await new Promise((resolve, reject) => sessionStore.get(sid, (error, value) => error ? reject(error) : resolve(value)));
      assert.equal(restored, null, 'Inflight save must not resurrect a revoked session');
      const sessions = await db.query('SELECT sid,data FROM sessions');
      assert.ok(sessions.rows.every(row => /^[a-f0-9]{64}$/.test(row.sid) && !('encryptedSessionId' in row.data)));
    });
    await t.test('real uploads, MIME/path/active-content rejection, private downloads and historical references', async () => {
      const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#abcdef' } }).png().toBuffer();
      async function upload(client: Client, data: Buffer, name: string, mime: string, access = 'PRIVATE') {
        const part = multipart(data, name, mime, access); return client.call('POST', '/media', part.body, part.headers);
      }
      const privateMedia = await upload(user, png, 'private.png', 'image/png'); assert.equal(privateMedia.status, 201);
      const privateId = privateMedia.json.data.id;
      assert.equal((await guest.call('GET', `/media/${privateId}/download`)).status, 404);
      assert.equal((await user.call('GET', `/media/${privateId}/download`)).status, 200);
      assert.equal((await editor.call('GET', `/media/${privateId}/download`)).status, 404);
      assert.equal((await upload(user, png, 'fake.jpg', 'image/jpeg')).status, 400);
      assert.equal((await upload(user, png.subarray(0, 35), 'broken.png', 'image/png')).status, 400);
      assert.equal((await upload(user, Buffer.from('<html><script>bad()</script></html>'), 'fake.png', 'image/png')).status, 400);
      assert.equal((await upload(user, Buffer.from('<svg onload="bad()">'), 'active.txt', 'text/plain')).status, 400);
      assert.equal((await upload(user, Buffer.from('%PDF-1.4\n1 0 obj << /JavaScript (alert(1)) >> endobj\n%%EOF'), 'active.pdf', 'application/pdf')).status, 400);
      const publicMedia = await upload(admin, png, '公开图像.png', 'image/png', 'PUBLIC'); assert.equal(publicMedia.status, 201);
      const mediaId = publicMedia.json.data.id;
      let payload = parsePayload('announcements', { ...blankPayload('announcements'), title: '附件隔离公告', body: '<script>bad()</script>\n[unsafe](javascript:alert(1))\n\n**safe**', coverId: mediaId });
      const draft = await admin.call('POST', '/admin/contents', { kind: 'announcements', payload }); assert.equal(draft.status, 201);
      assert.equal((await guest.call('GET', `/media/${mediaId}/download`)).status, 404);
      const published = await admin.call('POST', `/admin/contents/${draft.json.data.id}/publish`, { expectedRevision: draft.json.data.revision }); assert.equal(published.status, 200);
      assert.equal((await guest.call('GET', `/media/${mediaId}/download`)).status, 200);
      const content = await guest.call('GET', `/announcements/${draft.json.data.id}`);
      assert.ok(!content.json.data.bodyHtml.match(/<script|javascript:/i)); assert.ok(content.json.data.bodyHtml.includes('<strong>safe</strong>'));
      assert.equal((await admin.call('DELETE', `/admin/media/${mediaId}`)).status, 409);
      const references = await admin.call('GET', `/admin/media/${mediaId}/references`); assert.ok(references.json.data.length > 0);
      const mediaList = await admin.call('GET', '/admin/media'); assert.equal(mediaList.status, 200);
      assert.equal((await user.call('GET', '/admin/media')).status, 403);
      assert.equal((await user.call('GET', '/media')).status, 200);
      payload = { ...payload, coverId: null };
      const edit = await admin.call('PATCH', `/admin/contents/${draft.json.data.id}`, { expectedRevision: published.json.data.revision, payload }); assert.equal(edit.status, 200);
      assert.equal((await admin.call('DELETE', `/admin/media/${mediaId}`)).status, 409, 'History references protect replaced attachments');
    });
    await t.test('concurrent administrator removal cannot remove the last active administrator; authentication is rate limited', async () => {
      const original = await admin.call('GET', '/me'), second = await fixture('ADMIN'), secondClient = clients[6];
      await secondClient.login(second.username, second.password);
      const results = await Promise.all([
        admin.call('PATCH', `/admin/users/${original.json.data.id}`, { expectedRevision: original.json.data.profileVersion, role: 'USER', status: 'ACTIVE', memberStatus: 'NONE' }),
        secondClient.call('PATCH', `/admin/users/${second.id}`, { expectedRevision: 1, role: 'USER', status: 'ACTIVE', memberStatus: 'NONE' }),
      ]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE role='ADMIN' AND status='ACTIVE'")).rows[0].n, 1);
      const throttled = clients[9]; await throttled.init();
      for (let i = 0; i < 10; i++) assert.equal((await throttled.call('POST', '/auth/login', { account: 'not-present', password: 'incorrect' })).status, 401);
      assert.equal((await throttled.call('POST', '/auth/login', { account: 'not-present', password: 'incorrect' })).status, 429);
    });
  } finally {
    await app.close(); await db.end();
    // This exact random schema was created by this test, in the guarded *_test database.
    await adminDb.query(`DROP SCHEMA ${schema} CASCADE`); await adminDb.end();
    assert.ok(storagePath.startsWith(resolve(config.root, '.local/test-uploads') + (process.platform === 'win32' ? '\\' : '/')));
    await rm(storagePath, { recursive: true, force: true });
  }
});
