import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, migrate } from '../src/db.js';
import { hashPassword } from '../src/password.js';
import { runDueJobs } from '../src/jobs.js';
import { deadlineFingerprint, queueJob } from '../src/content-notifications.js';
import { LocalStorage } from '../src/storage.js';
import { blankPayload, routeKeys, visualPresets, type ContentKind, type ContentPayload } from '../../shared/platform.js';

test('real PostgreSQL content, collaboration and durable jobs', { timeout: 120_000 }, async t => {
  const config = loadConfig('test'), control = createPool(config.databaseUrl);
  const schema = `ixd_business_${randomUUID().replaceAll('-', '')}`;
  const storagePath = await mkdtemp(join(tmpdir(), 'ixd-business-test-'));
  assert.match(schema, /^ixd_business_[a-f0-9]{32}$/);
  await control.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: config.databaseUrl, options: `-c search_path=${schema}`, max: 12 });
  let application: Awaited<ReturnType<typeof buildApp>> | undefined;
  const base = new Date(), clock = { now: base };
  const future = (hours: number) => new Date(base.getTime() + hours * 3_600_000).toISOString();
  try {
    const migrations = await migrate(db, config.root);
    assert.ok(migrations.includes('001_platform.sql'));
    assert.ok(migrations.includes('002_auth_generation.sql'));
    assert.deepEqual(await migrate(db, config.root), []);
    application = await buildApp({ ...config, storagePath }, { db, now: () => clock.now, logger: false });
    const { app, ctx } = application;
    const password = `Test-${randomUUID()}-a9`, hash = await hashPassword(password), users: Record<string, string> = {};
    for (const [name, role] of [['admin', 'ADMIN'], ['editor', 'EDITOR'], ['alice', 'USER'], ['bob', 'USER'], ['unverified', 'USER']]) {
      const result = await db.query(`INSERT INTO users(username,email,password_hash,display_name,role,email_verified_at)
        VALUES($1,$2,$3,$1,$4,$5) RETURNING id`, [name, `${name}@example.invalid`, hash, role, name === 'unverified' ? null : base]);
      users[name] = result.rows[0].id;
    }
    await db.query(`INSERT INTO editor_grants(user_id,content_kind,direction_id,actions) VALUES($1,'announcements','ai',$2)`, [users.editor, ['create', 'read', 'update', 'publish', 'archive', 'delete', 'manage']]);
    class Client {
      cookie = ''; csrf = ''; ip: string;
      constructor(index: number) { this.ip = `127.0.0.${20 + index}`; }
      async call(method: string, path: string, payload?: unknown, expected = 200) {
        const response = await app.inject({ method: method as any, url: `/api/v1${path}`, payload: payload as any, remoteAddress: this.ip,
          headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(!['GET', 'HEAD'].includes(method) ? { 'x-csrf-token': this.csrf, origin: config.publicOrigin } : {}) } });
        const cookies = response.headers['set-cookie'];
        if (cookies) this.cookie = (Array.isArray(cookies) ? cookies : [cookies]).map(cookie => cookie.split(';')[0]).join('; ');
        const body = response.json();
        if (body.data?.csrfToken) this.csrf = body.data.csrfToken;
        assert.equal(response.statusCode, expected, `${method} ${path}: ${response.statusCode} ${body.error?.code ?? ''} ${body.error?.message ?? ''}`);
        return body;
      }
      async login(name: string) { await this.call('GET', '/auth/session'); await this.call('POST', '/auth/login', { account: name, password }); }
    }
    const admin = new Client(1), editor = new Client(2), alice = new Client(3), bob = new Client(4), unverified = new Client(5), guest = new Client(6);
    for (const [client, name] of [[admin, 'admin'], [editor, 'editor'], [alice, 'alice'], [bob, 'bob'], [unverified, 'unverified']] as const) await client.login(name);
    const payload = (kind: ContentKind, title: string, details: Record<string, unknown> = {}): ContentPayload => ({ ...blankPayload(kind), title, body: `正文 ${title}`, directionIds: ['ai'], details: { ...blankPayload(kind).details, ...details } });
    const create = async (kind: ContentKind, data: ContentPayload) => (await admin.call('POST', '/admin/contents', { kind, payload: data }, 201)).data;
    const publish = async (row: any, extra = {}) => (await admin.call('POST', `/admin/contents/${row.id}/publish`, { expectedRevision: row.revision, ...extra })).data;
    const edit = async (row: any, data: ContentPayload) => (await admin.call('PATCH', `/admin/contents/${row.id}`, { expectedRevision: row.revision, payload: data })).data;
    let announcement: any;

    await t.test('M2 draft → publish → native public API; published draft isolation and read epochs', async () => {
      announcement = await create('announcements', payload('announcements', '公告纵向链路'));
      await guest.call('GET', `/announcements/${announcement.id}`, undefined, 404);
      assert.equal((await guest.call('GET', '/announcements?q=公告纵向链路')).meta.total, 0);
      await alice.call('GET', '/admin/contents', undefined, 403);
      announcement = await publish(announcement);
      assert.equal((await guest.call('GET', `/announcements/${announcement.id}`)).data.payload.title, '公告纵向链路');
      await alice.call('PUT', `/me/announcements/${announcement.id}/read`, {});
      await unverified.call('PUT', `/me/announcements/${announcement.id}/read`, {});
      const changed = { ...announcement.payload, body: '新正文只在草稿里', visibility: 'MEMBERS' as const };
      announcement = await edit(announcement, changed);
      assert.equal((await guest.call('GET', `/announcements/${announcement.id}`)).data.payload.body, '正文 公告纵向链路');
      await admin.call('PATCH', `/admin/contents/${announcement.id}`, { expectedRevision: 1, payload: changed }, 409);
      announcement = await publish(announcement);
      await guest.call('GET', `/announcements/${announcement.id}`, undefined, 404);
      await alice.call('GET', `/announcements/${announcement.id}`, undefined, 404);
      await db.query("UPDATE users SET member_status='MEMBER' WHERE id=$1", [users.alice]);
      assert.equal((await alice.call('GET', `/announcements/${announcement.id}`)).data.read, true);
      announcement = await edit(announcement, { ...announcement.payload, body: '明确的重要更新' });
      announcement = await publish(announcement, { notifyImportantUpdate: true });
      assert.equal((await alice.call('GET', `/announcements/${announcement.id}`)).data.read, false);
      await runDueJobs(ctx);
      assert.equal((await db.query('SELECT count(*) FROM notifications WHERE user_id=$1 AND content_id=$2', [users.alice, announcement.id])).rows[0].count, '1');
      assert.equal((await db.query('SELECT count(*) FROM notifications WHERE user_id=$1 AND content_id=$2', [users.bob, announcement.id])).rows[0].count, '0');
      const note = (await alice.call('GET', '/notifications')).data[0]; await bob.call('PUT', `/notifications/${note.id}/read`, {}, 404);
      announcement = (await admin.call('POST', `/admin/contents/${announcement.id}/withdraw`, { expectedRevision: announcement.revision })).data;
      await alice.call('GET', `/announcements/${announcement.id}`, undefined, 404);
    });

    await t.test('unverified accounts can read their own state without bypassing verified business writes', async () => {
      for (const path of ['/me/favorites', '/notifications', '/me/intents', '/me/applications', '/me/projects', '/me/registrations', '/me/works']) {
        const result = await unverified.call('GET', path); assert.deepEqual(result.data, []);
        await guest.call('GET', path, undefined, 401);
      }
      const publicRow = await publish(await create('announcements', payload('announcements', '未验证用户公开正文')));
      await unverified.call('GET', `/announcements/${publicRow.id}`);
      await unverified.call('PUT', `/me/announcements/${publicRow.id}/read`, {});
      await unverified.call('PUT', `/me/favorites/${publicRow.id}`, {}, 403);
      await unverified.call('POST', '/me/works', { payload: payload('works', '未验证不能投稿') }, 403);
      const notification = await db.query(`INSERT INTO notifications(user_id,type,title,body,dedupe_key)
        VALUES($1,'TEST','本人通知','仅本人可读',$2) RETURNING id`, [users.unverified, randomUUID()]);
      await unverified.call('PUT', `/notifications/${notification.rows[0].id}/read`, {});
      await alice.call('PUT', `/notifications/${notification.rows[0].id}/read`, {}, 404);
    });

    await t.test('strict schemas and editor function/resource/field scope', async () => {
      const outOfScope = { ...payload('announcements', 'XR公告'), directionIds: ['xr'] };
      await editor.call('POST', '/admin/contents', { kind: 'announcements', payload: outOfScope }, 403);
      const row = (await editor.call('POST', '/admin/contents', { kind: 'announcements', payload: payload('announcements', 'AI范围公告') }, 201)).data;
      await editor.call('PATCH', `/admin/contents/${row.id}`, { expectedRevision: row.revision, payload: outOfScope }, 403);
      await editor.call('PATCH', `/admin/contents/${row.id}`, { expectedRevision: row.revision, payload: { ...row.payload, role: 'ADMIN' } }, 400);
      await editor.call('GET', '/admin/users', undefined, 403);
      const mixed = await create('announcements', { ...payload('announcements', '跨方向公告'), directionIds: ['ai', 'xr'] });
      await editor.call('GET', `/admin/contents/${mixed.id}`, undefined, 403);
      await admin.call('POST', '/admin/preview', { kind: 'announcements', payload: { ...row.payload, body: '<script>alert(1)</script>\n[x](javascript:alert(1))' } }).then(result => {
        assert.doesNotMatch(result.data.bodyHtml, /<script|javascript:/i);
      });
      await db.query('DELETE FROM editor_grants WHERE user_id=$1', [users.editor]);
      await editor.call('GET', `/admin/contents/${row.id}`, undefined, 403);
      await db.query("INSERT INTO editor_grants(user_id,content_kind,content_id,actions) VALUES($1,'announcements',$2,$3)", [users.editor, row.id, ['read', 'update']]);
      await editor.call('POST', '/admin/preview', { id: row.id, kind: 'announcements', payload: row.payload });
      await editor.call('POST', '/admin/preview', { id: mixed.id, kind: 'announcements', payload: mixed.payload }, 403);
      await editor.call('POST', '/admin/preview', { kind: 'announcements', payload: row.payload }, 403);
      await db.query('DELETE FROM editor_grants WHERE user_id=$1', [users.editor]);
      const anonymousMutation = await app.inject({ method: 'POST', url: '/api/v1/admin/contents', headers: { cookie: admin.cookie }, payload: { kind: 'announcements', payload: row.payload } });
      assert.equal(anonymousMutation.statusCode, 403);
    });

    await t.test('directions, pages, resources, routes and site settings are editable with reference protection', async () => {
      const direction = await publish(await create('directions', payload('directions', 'AI方向', { key: 'ai', keywords: ['测试'], learningRoute: '路线介绍', relatedContentIds: [] })));
      assert.equal((await guest.call('GET', `/directions/${direction.id}`)).data.payload.details.key, 'ai');
      const page = await publish(await create('pages', payload('pages', '社团介绍', { pageKey: 'about' })));
      assert.equal((await guest.call('GET', `/pages/${page.id}`)).data.payload.title, '社团介绍');
      let resource = await publish(await create('resources', payload('resources', '公开学习资料')));
      const route = await publish(await create('learning-paths', payload('learning-paths', '学习路线', { steps: [{ id: randomUUID(), title: '第一步', body: '阅读资料', resourceIds: [resource.id], sortOrder: 0 }] })));
      assert.deepEqual((await guest.call('GET', `/learning-paths/${route.id}`)).data.payload.details.steps[0].resourceIds, [resource.id]);
      resource = await edit(resource, { ...resource.payload, body: '资料已经更新' }); await publish(resource);
      assert.equal((await guest.call('GET', `/resources/${resource.id}`)).data.payload.body, '资料已经更新');
      const draftResource = await create('resources', payload('resources', '被草稿引用的资料'));
      await create('learning-paths', payload('learning-paths', '未发布路线引用', { steps: [{ id: randomUUID(), title: '预览', body: '', resourceIds: [draftResource.id], sortOrder: 0 }] }));
      await admin.call('DELETE', `/admin/contents/${draftResource.id}`, { expectedRevision: draftResource.revision }, 409);
      const settings = (await admin.call('GET', '/admin/site-settings')).data;
      const site = { siteName: '测试 IXD', tagline: '真实数据库', contact: '开发示例', sectionDescriptions: Object.fromEntries(routeKeys.map(key => [key, `栏目 ${key}`])), nodes: routeKeys.map((routeKey, index) => ({ routeKey, title: routeKey, subtitle: '', enabled: true, visualPreset: visualPresets[index] })) };
      const saved = (await admin.call('PATCH', '/admin/site-settings', { expectedRevision: settings.revision, payload: site })).data;
      await guest.call('GET', '/site-settings', undefined, 503);
      await admin.call('POST', '/admin/site-settings/publish', { expectedRevision: saved.revision });
      assert.equal((await guest.call('GET', '/site-settings')).data.siteName, '测试 IXD');
      await admin.call('PATCH', '/admin/site-settings', { expectedRevision: saved.revision, payload: { ...site, siteName: '仍是草稿' } });
      assert.equal((await guest.call('GET', '/site-settings')).data.siteName, '测试 IXD');
      await admin.call('PATCH', '/admin/site-settings', { expectedRevision: saved.revision, payload: site }, 409);
    });

    await t.test('generic related-content lookup uses effective published visibility, dates and hidden-state filtering', async () => {
      let row = await create('resources', payload('resources', '关联内容过滤'));
      await guest.call('GET', `/contents/${row.id}`, undefined, 404);
      await admin.call('GET', `/contents/${row.id}`, undefined, 404);
      row = await publish(row);
      assert.deepEqual((await guest.call('GET', `/contents/${row.id}`)).data, (await guest.call('GET', `/resources/${row.id}`)).data);
      row = await edit(row, { ...row.payload, visibility: 'MEMBERS', title: '仅成员的新标题' });
      assert.equal((await guest.call('GET', `/contents/${row.id}`)).data.payload.title, '关联内容过滤');
      row = await publish(row);
      await guest.call('GET', `/contents/${row.id}`, undefined, 404); await bob.call('GET', `/contents/${row.id}`, undefined, 404);
      assert.equal((await alice.call('GET', `/contents/${row.id}`)).data.payload.title, '仅成员的新标题');
      row = await publish(await edit(row, { ...row.payload, visibility: 'AUTHENTICATED' }));
      await guest.call('GET', `/contents/${row.id}`, undefined, 404); await unverified.call('GET', `/contents/${row.id}`);
      row = (await admin.call('POST', `/admin/contents/${row.id}/withdraw`, { expectedRevision: row.revision })).data;
      await alice.call('GET', `/contents/${row.id}`, undefined, 404);
      row = await publish(row, { publishAt: future(0.1), expiresAt: future(0.2) });
      await alice.call('GET', `/contents/${row.id}`, undefined, 404);
      clock.now = new Date(future(0.11)); await alice.call('GET', `/contents/${row.id}`);
      clock.now = new Date(future(0.21)); await alice.call('GET', `/contents/${row.id}`, undefined, 404); clock.now = base;
      await guest.call('GET', `/contents/${randomUUID()}`, undefined, 404);
    });

    await t.test('project applications, concurrent last place approval, rejection, withdrawal and membership', async () => {
      const positionId = randomUUID();
      const project = await publish(await create('projects', payload('projects', '并发项目', { recruiting: true, applicationDeadline: future(24), positions: [{ id: positionId, title: '开发', description: '', capacity: 1, enabled: true, sortOrder: 0 }] })));
      const input = { positionId, motivation: '我希望加入这个开发示例项目。', portfolioUrl: '' };
      const a = (await alice.call('POST', `/projects/${project.id}/applications`, input, 201)).data;
      const b = (await bob.call('POST', `/projects/${project.id}/applications`, input, 201)).data;
      assert.equal((await alice.call('POST', `/projects/${project.id}/applications`, input, 201)).data.id, a.id);
      const outcomes = await Promise.all([a, b].map(async item => {
        const response = await app.inject({ method: 'POST', url: `/api/v1/admin/applications/${item.id}/decision`, headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, origin: config.publicOrigin }, payload: { expectedRevision: item.revision, decision: 'APPROVED', reason: '测试批准' } });
        return { item, status: response.statusCode, data: response.json().data };
      }));
      assert.deepEqual(outcomes.map(item => item.status).sort(), [200, 409]);
      assert.equal((await db.query("SELECT count(*) FROM project_members WHERE project_id=$1 AND status='ACTIVE'", [project.id])).rows[0].count, '1');
      const loser = outcomes.find(item => item.status === 409)!.item, loserClient = loser.id === a.id ? alice : bob;
      await (loserClient === alice ? bob : alice).call('POST', `/me/applications/${loser.id}/withdraw`, { expectedRevision: loser.revision }, 404);
      await loserClient.call('POST', `/me/applications/${loser.id}/withdraw`, { expectedRevision: loser.revision });
      const winner = outcomes.find(item => item.status === 200)!.data, winnerId = winner.user.id;
      await admin.call('PATCH', `/admin/projects/${project.id}/members/${winnerId}`, { status: 'LEFT' });
      assert.equal((await db.query("SELECT count(*) FROM project_members WHERE project_id=$1 AND status='ACTIVE'", [project.id])).rows[0].count, '0');
      const winnerClient = winnerId === users.alice ? alice : bob;
      const reapply = (await winnerClient.call('POST', `/projects/${project.id}/applications`, input, 201)).data;
      assert.equal(reapply.status, 'PENDING');
      await winnerClient.call('POST', `/me/applications/${reapply.id}/withdraw`, { expectedRevision: reapply.revision });
      const resubmitted = (await loserClient.call('POST', `/projects/${project.id}/applications`, input, 201)).data;
      const rejected = (await admin.call('POST', `/admin/applications/${resubmitted.id}/decision`, { expectedRevision: resubmitted.revision, decision: 'REJECTED', reason: '测试退回结果' })).data;
      assert.equal(rejected.status, 'REJECTED');
      assert.ok((await loserClient.call('GET', '/me/applications')).data.some((item: any) => item.id === rejected.id && item.decisionReason === '测试退回结果'));
      assert.equal((await admin.call('GET', `/admin/applications?userId=${users.alice}`)).meta.total, 1);
      await editor.call('GET', `/admin/applications?userId=${users.alice}`, undefined, 403);
    });

    await t.test('event last-place concurrency, cancellation releases capacity and activity cancellation notifies', async () => {
      let event = await publish(await create('events', payload('events', '名额测试活动', { startsAt: future(48), endsAt: future(49), registrationStartsAt: future(-1), registrationEndsAt: future(24), registrationOpen: true, capacity: 1 })));
      const attempts = await Promise.all([alice, bob].map(async client => {
        const response = await app.inject({ method: 'POST', url: `/api/v1/events/${event.id}/registrations`, headers: { cookie: client.cookie, 'x-csrf-token': client.csrf, origin: config.publicOrigin }, payload: {} });
        return { client, status: response.statusCode };
      }));
      assert.deepEqual(attempts.map(item => item.status).sort(), [200, 409]);
      const winner = attempts.find(item => item.status === 200)!.client, loser = attempts.find(item => item.status === 409)!.client;
      await winner.call('POST', `/events/${event.id}/registrations`, {});
      assert.equal((await db.query("SELECT count(*) FROM event_registrations WHERE event_id=$1 AND status='REGISTERED'", [event.id])).rows[0].count, '1');
      await winner.call('DELETE', `/events/${event.id}/registrations`, {}); await loser.call('POST', `/events/${event.id}/registrations`, {});
      event = await edit(event, { ...event.payload, details: { ...event.payload.details, eventStatus: 'CANCELLED' } }); event = await publish(event);
      const loserId = loser === alice ? users.alice : users.bob;
      assert.equal((await db.query("SELECT count(*) FROM notifications WHERE user_id=$1 AND content_id=$2 AND type='EVENT_CANCELLED'", [loserId, event.id])).rows[0].count, '1');
      await loser.call('DELETE', `/events/${event.id}/registrations`, {});
    });

    await t.test('personal history preserves own status but hides restricted, withdrawn and expired associated content', async () => {
      const positionId = randomUUID();
      let project = await publish(await create('projects', payload('projects', '可见项目历史', { recruiting: true, positions: [{ id: positionId, title: '公开岗位', description: '', capacity: 2, enabled: true, sortOrder: 0 }] })));
      const application = (await bob.call('POST', `/projects/${project.id}/applications`, { positionId, motivation: '申请这个用于权限测试的项目。', portfolioUrl: '' }, 201)).data;
      await admin.call('POST', `/admin/applications/${application.id}/decision`, { expectedRevision: application.revision, decision: 'APPROVED', reason: '' });
      let event = await publish(await create('events', payload('events', '可见活动历史', { registrationOpen: true, capacity: 2, startsAt: future(24), location: '原公开地点' })));
      const registration = (await bob.call('POST', `/events/${event.id}/registrations`, {})).data;
      let competition = await publish(await create('competitions', payload('competitions', '可见意向历史')));
      await bob.call('PUT', `/competitions/${competition.id}/intent`, {});
      await db.query("UPDATE users SET member_status='MEMBER' WHERE id=$1", [users.bob]);
      project = await publish(await edit(project, { ...project.payload, visibility: 'MEMBERS', title: '成员内部项目标题', details: { ...project.payload.details, positions: [{ id: positionId, title: '成员内部岗位', description: '', capacity: 2, enabled: true, sortOrder: 0 }] } }));
      event = await publish(await edit(event, { ...event.payload, visibility: 'MEMBERS', title: '成员内部活动标题', details: { ...event.payload.details, location: '成员内部地点' } }));
      competition = await publish(await edit(competition, { ...competition.payload, visibility: 'MEMBERS', title: '成员内部赛事标题' }));
      assert.equal((await bob.call('GET', '/me/registrations')).data.find((r: any) => r.id === registration.id).location, '成员内部地点');
      await db.query("UPDATE users SET member_status='NONE' WHERE id=$1", [users.bob]);
      const hiddenRegistration = (await bob.call('GET', '/me/registrations')).data.find((r: any) => r.id === registration.id);
      assert.equal(hiddenRegistration.eventTitle, '内容已不可用'); assert.equal(hiddenRegistration.location, ''); assert.equal(hiddenRegistration.startsAt, null); assert.equal(hiddenRegistration.status, 'REGISTERED');
      const hiddenApplication = (await bob.call('GET', '/me/applications')).data.find((r: any) => r.id === application.id);
      assert.equal(hiddenApplication.projectTitle, '内容已不可用'); assert.equal(hiddenApplication.positionTitle, '岗位已不可用'); assert.equal(hiddenApplication.status, 'APPROVED');
      assert.equal((await bob.call('GET', '/me/projects')).data.find((r: any) => r.projectId === project.id).projectTitle, '内容已不可用');
      assert.equal((await bob.call('GET', '/me/intents')).data.find((r: any) => r.competitionId === competition.id).competitionTitle, '内容已不可用');
      await db.query("UPDATE users SET member_status='MEMBER' WHERE id=$1", [users.bob]);
      await admin.call('POST', `/admin/contents/${event.id}/withdraw`, { expectedRevision: event.revision });
      assert.equal((await bob.call('GET', '/me/registrations')).data.find((r: any) => r.id === registration.id).eventTitle, '内容已不可用');
      const cancelled = (await bob.call('DELETE', `/events/${event.id}/registrations`, {})).data;
      assert.equal(cancelled.status, 'CANCELLED'); assert.equal(cancelled.location, '');
      await publish(project, { expiresAt: future(0.1) }); clock.now = new Date(future(0.11));
      assert.equal((await bob.call('GET', '/me/projects')).data.find((r: any) => r.projectId === project.id).projectTitle, '内容已不可用');
      clock.now = base; await db.query("UPDATE users SET member_status='NONE' WHERE id=$1", [users.bob]);
    });

    await t.test('own work drafts cannot elevate status, edit others or bypass review', async () => {
      let work = (await alice.call('POST', '/me/works', { payload: payload('works', '用户投稿', { authors: [{ userId: users.alice, name: 'Alice' }] }) }, 201)).data;
      await bob.call('PATCH', `/me/works/${work.id}`, { expectedRevision: work.revision, payload: work.payload }, 404);
      await alice.call('POST', '/me/works', { payload: work.payload, state: 'PUBLISHED' }, 400);
      await alice.call('POST', `/admin/contents/${work.id}/publish`, { expectedRevision: work.revision }, 403);
      work = (await alice.call('POST', `/me/works/${work.id}/submit`, { expectedRevision: work.revision })).data;
      await guest.call('GET', `/works/${work.id}`, undefined, 404);
      await alice.call('PATCH', `/me/works/${work.id}`, { expectedRevision: work.revision, payload: work.payload }, 409);
      work = (await admin.call('POST', `/admin/contents/${work.id}/return`, { expectedRevision: work.revision, reason: '请补充说明' })).data;
      assert.equal((await alice.call('GET', '/me/works')).data.find((item: any) => item.id === work.id).reviewReason, '请补充说明');
      work = (await alice.call('PATCH', `/me/works/${work.id}`, { expectedRevision: work.revision, payload: { ...work.payload, body: '补充后的作品说明' } })).data;
      work = (await alice.call('POST', `/me/works/${work.id}/submit`, { expectedRevision: work.revision })).data; work = await publish(work);
      assert.equal((await guest.call('GET', `/works/${work.id}`)).data.payload.body, '补充后的作品说明');
      await alice.call('PATCH', `/me/works/${work.id}`, { expectedRevision: work.revision, payload: work.payload }, 409);
    });

    await t.test('unknown/date precision, favorites and durable deduplicated deadline jobs', async () => {
      let competition = await publish(await create('competitions', payload('competitions', '真实精度赛事')));
      assert.equal((await guest.call('GET', '/competitions?phase=unknown&sort=deadline')).data.find((item: any) => item.id === competition.id).payload.details.registrationEnd.precision, 'unknown');
      await alice.call('PUT', `/competitions/${competition.id}/intent`, { note: '仅参赛意向' });
      assert.equal((await alice.call('GET', '/me/intents')).data[0].status, 'INTERESTED');
      await alice.call('DELETE', `/competitions/${competition.id}/intent`, {});
      const precise = { precision: 'datetime', date: null, at: future(26), timeZone: 'Asia/Shanghai' };
      assert.equal(deadlineFingerprint(precise as any), deadlineFingerprint({ ...precise, at: new Date(future(26)).toISOString().replace('Z', '+00:00'), timeZone: 'UTC' } as any));
      competition = await edit(competition, { ...competition.payload, details: { ...competition.payload.details, registrationEnd: precise } }); competition = await publish(competition);
      await alice.call('PUT', `/me/favorites/${competition.id}`, { reminderHours: [24] });
      await alice.call('DELETE', `/me/favorites/${competition.id}`, {});
      assert.equal((await db.query("SELECT status FROM jobs WHERE payload->>'contentId'=$1", [competition.id])).rows[0].status, 'CANCELLED');
      await alice.call('PUT', `/me/favorites/${competition.id}`, { reminderHours: [24] });
      assert.equal((await db.query("SELECT status FROM jobs WHERE payload->>'contentId'=$1", [competition.id])).rows[0].status, 'PENDING');
      competition = await edit(competition, { ...competition.payload, details: { ...competition.payload.details, registrationEnd: { ...precise, at: future(28) } } }); competition = await publish(competition);
      clock.now = new Date(future(2.1)); await runDueJobs(ctx);
      assert.equal((await db.query('SELECT count(*) FROM notifications WHERE user_id=$1 AND content_id=$2', [users.alice, competition.id])).rows[0].count, '0');
      clock.now = new Date(future(4.1));
      await db.query("UPDATE jobs SET status='RUNNING',locked_by='interrupted-test-worker',locked_at=$2,lease_expires_at=$2,attempts=1 WHERE payload->>'contentId'=$1 AND status='PENDING'", [competition.id, new Date(future(4))]);
      await runDueJobs(ctx); await runDueJobs(ctx);
      assert.equal((await db.query('SELECT count(*) FROM notifications WHERE user_id=$1 AND content_id=$2', [users.alice, competition.id])).rows[0].count, '1');
      assert.equal((await db.query("SELECT count(*) FROM jobs WHERE payload->>'contentId'=$1 AND status='DONE'", [competition.id])).rows[0].count, '1');
      clock.now = base;
    });

    await t.test('private ownership boundaries for bookmarks, inline attachments and restartable file cleanup', async () => {
      const source = await publish(await create('resources', payload('resources', '仅Alice收藏')));
      await alice.call('PUT', `/me/favorites/${source.id}`, {});
      assert.ok((await alice.call('GET', '/me/favorites')).data.some((item: any) => item.content.id === source.id));
      assert.ok(!(await bob.call('GET', '/me/favorites')).data.some((item: any) => item.content.id === source.id));
      await bob.call('GET', `/me/favorites?userId=${users.alice}`, undefined, 400);
      await alice.call('PUT', `/me/favorites/${source.id}`, { userId: users.bob }, 400);
      const mediaId = randomUUID(), key = `${mediaId}.txt`, storage = new LocalStorage(storagePath);
      await storage.put(key, Buffer.from('owned test attachment'));
      await db.query("INSERT INTO media(id,owner_id,storage_key,original_name,mime_type,byte_size,access_level) VALUES($1,$2,$3,'test.txt','text/plain',21,'PRIVATE')", [mediaId, users.alice, key]);
      await bob.call('POST', '/me/works', { payload: { ...payload('works', '不可盗用附件'), body: `[附件](/api/v1/media/${mediaId}/download)` } }, 403);
      const work = (await alice.call('POST', '/me/works', { payload: { ...payload('works', '正文附件'), body: `[附件](/api/v1/media/${mediaId}/download)` } }, 201)).data;
      assert.equal((await db.query('SELECT count(*) FROM content_version_media r JOIN content_versions v ON v.id=r.version_id WHERE v.content_id=$1 AND r.media_id=$2', [work.id, mediaId])).rows[0].count, '1');
      await admin.call('DELETE', `/admin/media/${mediaId}`, undefined, 409);
      const orphanKey = `${randomUUID()}.txt`; await storage.put(orphanKey, Buffer.from('delete after metadata commit'));
      await queueJob(db, 'MEDIA_DELETE', { storageKey: orphanKey }, `media-delete:${randomUUID()}`, base, base);
      await runDueJobs(ctx); await assert.rejects(access(join(storagePath, orphanKey)), /ENOENT/);
      await queueJob(db, 'MEDIA_DELETE', { storageKey: orphanKey }, `media-delete-retry:${randomUUID()}`, base, base);
      await runDueJobs(ctx);
      assert.equal((await db.query("SELECT count(*) FROM jobs WHERE kind='MEDIA_DELETE' AND status='DONE'")).rows[0].count, '2');
    });

    await t.test('scheduled versions never leak early, remain frozen across newer drafts, and expire without worker', async () => {
      let row = await create('announcements', { ...payload('announcements', '计划发布版本'), importance: 'important' });
      row = await publish(row, { publishAt: future(0.1), expiresAt: future(0.2) });
      row = await edit(row, { ...row.payload, title: '继续修改的未发布草稿' });
      await guest.call('GET', `/announcements/${row.id}`, undefined, 404); await runDueJobs(ctx);
      assert.equal((await db.query('SELECT published_version_id FROM contents WHERE id=$1', [row.id])).rows[0].published_version_id, null);
      clock.now = new Date(future(0.11));
      assert.equal((await guest.call('GET', `/announcements/${row.id}`)).data.payload.title, '计划发布版本');
      await runDueJobs(ctx); await runDueJobs(ctx);
      assert.equal((await db.query("SELECT count(*) FROM notifications WHERE content_id=$1 AND user_id=$2", [row.id, users.alice])).rows[0].count, '1');
      assert.equal((await admin.call('GET', `/admin/contents/${row.id}`)).data.payload.title, '继续修改的未发布草稿');
      clock.now = new Date(future(0.21)); await guest.call('GET', `/announcements/${row.id}`, undefined, 404); clock.now = base;
    });

    await t.test('explicit future republication keeps withdrawn history hidden and withdrawal cancels the schedule', async () => {
      let row = await publish(await create('announcements', payload('announcements', '原发布版本')));
      row = (await admin.call('POST', `/admin/contents/${row.id}/withdraw`, { expectedRevision: row.revision })).data;
      row = await edit(row, { ...row.payload, title: '重新定时发布' });
      row = await publish(row, { publishAt: future(0.1) });
      await guest.call('GET', `/announcements/${row.id}`, undefined, 404); await runDueJobs(ctx);
      await guest.call('GET', `/announcements/${row.id}`, undefined, 404);
      clock.now = new Date(future(0.11));
      assert.equal((await guest.call('GET', `/announcements/${row.id}`)).data.payload.title, '重新定时发布');
      await runDueJobs(ctx);
      row = (await admin.call('GET', `/admin/contents/${row.id}`)).data; assert.equal(row.state, 'PUBLISHED');
      row = (await admin.call('POST', `/admin/contents/${row.id}/archive`, { expectedRevision: row.revision })).data;
      row = await publish(row, { publishAt: future(0.2) });
      row = (await admin.call('POST', `/admin/contents/${row.id}/withdraw`, { expectedRevision: row.revision })).data;
      clock.now = new Date(future(0.21)); await runDueJobs(ctx);
      await guest.call('GET', `/announcements/${row.id}`, undefined, 404);
      assert.equal((await admin.call('GET', `/admin/contents/${row.id}`)).data.scheduledAt, null);
      clock.now = base;
    });

    await t.test('database constraints, business persistence across app restart and no attendance schema', async () => {
      const row = (await db.query('SELECT id FROM content_versions LIMIT 1')).rows[0];
      await assert.rejects(db.query("UPDATE content_versions SET payload='{}' WHERE id=$1", [row.id]), /immutable/);
      const counts = await db.query('SELECT (SELECT count(*) FROM project_applications)::integer applications,(SELECT count(*) FROM event_registrations)::integer registrations,(SELECT count(*) FROM favorites)::integer favorites');
      await app.close(); application = await buildApp({ ...config, storagePath }, { db, now: () => clock.now, logger: false });
      const after = await db.query('SELECT (SELECT count(*) FROM project_applications)::integer applications,(SELECT count(*) FROM event_registrations)::integer registrations,(SELECT count(*) FROM favorites)::integer favorites');
      assert.deepEqual(after.rows, counts.rows);
      const tables = await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1', [schema]);
      assert.ok(tables.rows.every(row => !/attendance|check.?in/i.test(row.table_name)));
    });
  } finally {
    if (application) await application.app.close(); await db.end();
    await control.query(`DROP SCHEMA "${schema}" CASCADE`); await control.end();
    assert.ok(storagePath.startsWith(join(tmpdir(), 'ixd-business-test-')));
    await rm(storagePath, { recursive: true });
  }
});
