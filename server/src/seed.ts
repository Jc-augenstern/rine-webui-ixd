import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clubContent, type ClubContent } from '../../src/data/club-content.js';
import { directionKeys, blankPayload, parsePayload, routeKeys, siteSettingsSchema, type ContentKind, type ContentPayload, type Role, type SiteSettings } from '../../shared/platform.js';
import type { AppContext } from './context.js';
import { hashPassword } from './password.js';
import { inTransaction, type Database } from './db.js';
import { getActor } from './user-record.js';
import { applyPublication, loadContent } from './content.js';

const directionNames = ['AI 与智能系统', '具身智能与机器人', '新媒体与交互设计', '文创与视觉设计', 'XR 与交互娱乐', '智能硬件'];
const titles = ['公告中心', '赛事中心', '项目广场', '活动与沙龙', '学习中心', '作品与成果', 'IXD CORE', '个人中心'];
const presets = ['echo-nebula', 'ascent-comet', 'protostar-shell', 'exchange-stars', 'neural-cluster', 'prism-shards', 'ixd-core', 'open-beacon'] as const;
function body(content: ClubContent) {
  return [content.summary, ...content.sections.map(s => `## ${s.title}\n${s.body || ''}\n${(s.items || []).map(i => `- ${i}`).join('\n')}`), content.projects ? `## 典型项目（学习示例）\n${content.projects.map(p => `- ${p}`).join('\n')}` : '', content.notice || ''].filter(Boolean).join('\n\n');
}
export function initialSiteSettings(): SiteSettings {
  return siteSettingsSchema.parse({ siteName: 'IXD ANALYSIS OS', tagline: '在项目中学习，在协作中探索。', contact: '联系渠道待发布。',
    sectionDescriptions: Object.fromEntries(routeKeys.map((key, i) => [key, titles[i]])),
    nodes: routeKeys.map((key, i) => ({ routeKey: key, title: titles[i], subtitle: key.toUpperCase(), enabled: true, visualPreset: presets[i] })),
  });
}
interface DevelopmentAccount { role: Role; username: string; email: string; password: string; id?: string }
export async function initializeSite(db: Database, ownerId: string, now: Date) {
  // Initialize only a pristine row; an administrator's unpublished draft is already real work.
  await db.query("UPDATE site_settings SET draft=$1,published=$1,published_revision=revision,updated_by=$2,published_at=$3 WHERE published_revision=0 AND draft='{}'::jsonb", [JSON.stringify(initialSiteSettings()), ownerId, now]);
}
function contentImporter(ctx: AppContext, ownerId: string) {
  return async (kind: ContentKind, slug: string, input: ContentPayload, published = true) => {
    const payload = parsePayload(kind, input);
    return inTransaction(ctx.db, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [kind === 'pages' ? `ixd-page:${payload.details.pageKey}` : `ixd-import:${kind}:${slug}`]);
      const prior = await db.query('SELECT id FROM contents WHERE kind=$1 AND slug=$2', [kind, slug]);
      if (prior.rowCount) return prior.rows[0].id as string;
      if (kind === 'directions') {
        const direction = await db.query('SELECT content_id FROM directions WHERE id=$1', [payload.details.key]);
        if (direction.rowCount) return direction.rows[0].content_id as string;
      }
      if (kind === 'pages') {
        const page = await db.query("SELECT c.id FROM contents c JOIN content_versions v ON v.id=c.draft_version_id WHERE c.kind='pages' AND v.payload#>>'{details,pageKey}'=$1", [payload.details.pageKey]);
        if (page.rowCount) return page.rows[0].id as string;
      }
      const id = randomUUID(), versionId = randomUUID();
      await db.query('INSERT INTO contents(id,kind,slug,owner_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)', [id, kind, slug, ownerId, ctx.now()]);
      await db.query('INSERT INTO content_versions(id,content_id,revision,payload,created_by,created_at) VALUES($1,$2,1,$3,$4,$5)', [versionId, id, JSON.stringify(payload), ownerId, ctx.now()]);
      await db.query('UPDATE contents SET draft_version_id=$2 WHERE id=$1', [id, versionId]);
      if (kind === 'directions') await db.query('INSERT INTO directions(id,content_id) VALUES($1,$2)', [payload.details.key, id]);
      for (const step of (payload.details.steps || []) as { resourceIds: string[] }[]) for (const resourceId of step.resourceIds) await db.query("INSERT INTO content_version_links(version_id,target_content_id,relation) VALUES($1,$2,'resource') ON CONFLICT DO NOTHING", [versionId, resourceId]);
      if (published) await applyPublication(db, ctx, await loadContent(db, id), versionId, ctx.now(), null, false);
      return id;
    });
  };
}
/** Controlled CLI import of the supplied club draft. No accounts or operational examples. */
export async function importClubContent(ctx: AppContext, ownerId: string) {
  const actor = await getActor(ctx.db, ownerId);
  if (actor?.user.role !== 'ADMIN' || !actor.user.emailVerified) throw new Error('An active verified administrator is required for the content import');
  await initializeSite(ctx.db, ownerId, ctx.now());
  const insert = contentImporter(ctx, ownerId);
  for (const [i, key] of directionKeys.entries()) {
    const source = clubContent[key];
    await insert('directions', `direction-${key}`, { ...blankPayload('directions'), title: directionNames[i], summary: source.summary, body: body(source), directionIds: [key], details: { key, keywords: [...source.keywords || []], learningRoute: '从基础工具与典型项目入手；当前为社团筹建规划，实际学习路线由管理员维护。', relatedContentIds: [] } });
  }
  for (const key of ['about', 'join'] as const) {
    const source = clubContent[key === 'about' ? 'core' : 'join'];
    await insert('pages', key, { ...blankPayload('pages'), title: key === 'about' ? '关于 IXD' : '加入 IXD', summary: source.summary, body: body(source), details: { pageKey: key } });
  }
}
export async function seedDevelopment(ctx: AppContext) {
  if (ctx.config.mode !== 'development') throw new Error('Development seed is forbidden outside development');
  const directory = resolve(ctx.config.root, '.local'); await mkdir(directory, { recursive: true });
  const file = resolve(directory, 'development-accounts.json');
  const accounts: DevelopmentAccount[] = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')).accounts : (['ADMIN', 'EDITOR', 'USER'] as const).map(role => ({ role, username: `ixd-dev-${role.toLowerCase()}`, email: `ixd-dev-${role.toLowerCase()}@example.test`, password: randomBytes(24).toString('base64url') }));
  const save = () => writeFile(file, JSON.stringify({ warning: '仅本地开发随机账号；不要提交、复制到生产或公开密码。', frontendUrl: ctx.config.publicOrigin, adminUrl: `${ctx.config.adminOrigin}/admin/`, mailboxUrl: 'http://127.0.0.1:8025/', accounts }, null, 2), { mode: 0o600 });
  // Persist random credentials before inserts, making an interrupted seed recoverable without changing passwords.
  if (!existsSync(file)) await save();
  for (const account of accounts) {
    const existing = await ctx.db.query('SELECT id FROM users WHERE lower(username)=lower($1)', [account.username]);
    if (existing.rowCount) { account.id = existing.rows[0].id; continue; }
    const inserted = await ctx.db.query('INSERT INTO users(username,email,password_hash,display_name,role,email_verified_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6,$6) RETURNING id', [account.username, account.email, await hashPassword(account.password), `开发示例 · ${account.role}`, account.role, ctx.now()]);
    account.id = inserted.rows[0].id;
  }
  await save();
  const admin = accounts.find(a => a.role === 'ADMIN')!, editor = accounts.find(a => a.role === 'EDITOR')!;
  const actor = await getActor(ctx.db, admin.id!);
  if (actor?.user.role !== 'ADMIN') throw new Error('Development admin has been changed; use the administrator recovery CLI explicitly');
  await inTransaction(ctx.db, async db => {
    const grantsExist = await db.query('SELECT 1 FROM editor_grants WHERE user_id=$1', [editor.id]);
    // Record initialization independently of an empty grants list: revoking all grants must survive later seed runs.
    const seeded = await db.query("SELECT 1 FROM audit_logs WHERE action='DEV_INITIALIZE' AND resource_id=$1", [editor.id]);
    if (!seeded.rowCount) {
      if (!grantsExist.rowCount) for (const kind of ['announcements', 'projects', 'events', 'resources', 'works', 'learning-paths'] as const) await db.query('INSERT INTO editor_grants(user_id,content_kind,direction_id,actions) VALUES($1,$2,$3,$4)', [editor.id, kind, 'ai', ['create', 'read', 'update', 'publish', 'archive', 'delete', 'manage']]);
      await db.query("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,changes) VALUES($1,'DEV_INITIALIZE','user',$2,'{}')", [admin.id, editor.id]);
    }
  });
  await importClubContent(ctx, admin.id!);
  const insert = contentImporter(ctx, admin.id!);
  const sample = (kind: ContentKind, title: string): ContentPayload => ({ ...blankPayload(kind), title: `开发示例 · ${title}`, summary: '仅用于本地功能测试，不代表真实社团运营信息。', body: '这是开发示例，用于验证后台维护、发布与前台读取。请勿作为真实活动或成果传播。', tags: ['开发示例'], directionIds: ['ai'] });
  await insert('announcements', 'dev-announcement', sample('announcements', '平台试运行公告'), false);
  await insert('competitions', 'dev-competition', sample('competitions', '赛事信息待核实'));
  const project = sample('projects', '学习助手协作项目');
  project.details = { ...project.details, recruiting: true, stage: 'RECRUITING', positions: [{ id: randomUUID(), title: '开发体验岗位', description: '仅用于申请与审批测试', capacity: 3, enabled: true, sortOrder: 0 }] };
  await insert('projects', 'dev-project', project);
  const event = sample('events', '本地测试沙龙');
  event.details = { ...event.details, registrationOpen: true, capacity: 3, startsAt: new Date(ctx.now().getTime() + 30 * 86400_000).toISOString(), endsAt: new Date(ctx.now().getTime() + 30 * 86400_000 + 3600_000).toISOString(), location: '本机测试（不是真实活动地点）' };
  await insert('events', 'dev-event', event);
  const resource = await insert('resources', 'dev-resource', sample('resources', '学习资源维护说明'));
  const path = sample('learning-paths', '入门学习路线');
  path.details = { ...path.details, steps: [{ id: randomUUID(), title: '了解资料管理', body: '阅读开发示例，熟悉学习路线。', resourceIds: [resource], sortOrder: 0 }] };
  await insert('learning-paths', 'dev-learning-path', path);
  await insert('works', 'dev-work', sample('works', '作品审核草稿'), false);
  return file;
}
