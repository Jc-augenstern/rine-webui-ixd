import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  contentKinds, createContentSchema, editContentSchema, idSchema, listQuerySchema,
  parsePayload, publishSchema, revisionSchema, siteSettingsSchema,
  type AdminContentDTO, type ContentDTO, type ContentKind, type ContentPayload,
  type EditorGrant, type GrantAction, type SafeUser,
} from '../../shared/platform.js';
import type { AppContext } from './context.js';
import { HttpError } from './errors.js';
import { requireAdmin, requireEditor, assertManage, canManage } from './security.js';
import { inTransaction } from './db.js';
import { audit } from './audit.js';
import { renderMarkdown } from './markdown.js';
import { responseRoutes } from './content-responses.js';
import { cancelContentJobs, notifyUser, queueJob, reconcileCompetitionJobs, type Database } from './content-notifications.js';

export type ContentActor = { user: SafeUser; grants: EditorGrant[] };
export interface VisibleContentRow {
  id: string; kind: ContentKind; slug: string; owner_id: string; revision: number;
  attention_revision: number; payload: ContentPayload; version_id: string;
  created_at: Date; updated_at: Date; published_at: Date | null; expires_at: Date | null;
  author_display_name: string;
}
export interface ContentRow {
  id: string; kind: ContentKind; slug: string; owner_id: string;
  draft_version_id: string | null; published_version_id: string | null; scheduled_version_id: string | null;
  publish_at: Date | null; published_at: Date | null; expires_at: Date | null;
  scheduled_expires_at: Date | null; scheduled_notify_important: boolean;
  state: AdminContentDTO['state']; revision: number; attention_revision: number; review_reason: string;
  created_at: Date; updated_at: Date; payload: ContentPayload; author_display_name: string;
}
export function isPayloadVisible(payload: ContentPayload, actor: ContentActor | null): boolean {
  if (payload.visibility === 'PUBLIC') return true;
  if (!actor || actor.user.status !== 'ACTIVE') return false;
  return payload.visibility === 'AUTHENTICATED' || actor.user.memberStatus === 'MEMBER';
}
const scheduledDue = `(c.scheduled_version_id IS NOT NULL AND c.publish_at <= $1::timestamptz)`;
const effectiveVersion = `CASE WHEN ${scheduledDue} THEN c.scheduled_version_id ELSE c.published_version_id END`;
const effectiveExpiry = `CASE WHEN ${scheduledDue} THEN c.scheduled_expires_at ELSE c.expires_at END`;
const effectivePublished = `CASE WHEN ${scheduledDue} THEN c.publish_at ELSE c.published_at END`;
const publicFrom = `FROM contents c JOIN content_versions v ON v.id=${effectiveVersion}
  JOIN users u ON u.id=c.owner_id`;
// Withdrawing clears a schedule. A later explicit schedule may republish the frozen version,
// while the old published pointer must stay hidden until that new schedule is due.
const publicWhere = `(c.state NOT IN ('WITHDRAWN','ARCHIVED') OR ${scheduledDue})
  AND (${effectiveExpiry} IS NULL OR ${effectiveExpiry}>$1::timestamptz)
  AND (v.payload->>'visibility'='PUBLIC' OR ($2::boolean AND v.payload->>'visibility'='AUTHENTICATED')
    OR ($3::boolean AND v.payload->>'visibility'='MEMBERS'))`;
const publicColumns = `c.id,c.kind,c.slug,c.owner_id,v.revision,v.id AS version_id,v.payload,
  c.attention_revision + CASE WHEN ${scheduledDue} AND c.scheduled_notify_important THEN 1 ELSE 0 END AS attention_revision,
  c.created_at,COALESCE(${effectivePublished},c.created_at) AS updated_at,
  ${effectivePublished} AS published_at,${effectiveExpiry} AS expires_at,u.display_name AS author_display_name`;
function visibilityValues(now: Date, actor: ContentActor | null): unknown[] {
  return [now, Boolean(actor && actor.user.status === 'ACTIVE'), Boolean(actor && actor.user.status === 'ACTIVE' && actor.user.memberStatus === 'MEMBER')];
}
export async function getVisibleContent(db: Pool | PoolClient, id: string, actor: ContentActor | null, now: Date): Promise<VisibleContentRow | null> {
  const result = await db.query<VisibleContentRow>(`SELECT ${publicColumns} ${publicFrom} WHERE ${publicWhere} AND c.id=$4`, [...visibilityValues(now, actor), id]);
  return result.rows[0] ?? null;
}
export const managementTarget = (row: Pick<ContentRow, 'id' | 'kind' | 'owner_id' | 'payload'>) => ({ id: row.id, kind: row.kind, ownerId: row.owner_id, directionIds: row.payload.directionIds });
export async function loadContent(db: Database, id: string, lock = false): Promise<ContentRow> {
  const result = await db.query<ContentRow>(`SELECT c.*,v.payload,u.display_name AS author_display_name FROM contents c
    JOIN content_versions v ON v.id=c.draft_version_id JOIN users u ON u.id=c.owner_id
    WHERE c.id=$1 ${lock ? 'FOR UPDATE OF c' : ''}`, [id]);
  if (!result.rows[0]) throw new HttpError(404, 'NOT_FOUND', '内容不存在或不可访问');
  return result.rows[0];
}
export function requireRevision(row: { revision: number }, expected: number) {
  if (row.revision !== expected) throw new HttpError(409, 'VERSION_CONFLICT', '内容已被修改，请重新读取后比较并保存');
}
export function contentDTO(row: VisibleContentRow): ContentDTO {
  return { id: row.id, kind: row.kind, slug: row.slug, revision: row.revision, state: 'PUBLISHED', attentionRevision: row.attention_revision,
    payload: row.payload, bodyHtml: renderMarkdown(row.payload.body), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null, author: { id: row.owner_id, displayName: row.author_display_name } };
}
export async function adminContentDTO(db: Database, row: ContentRow): Promise<AdminContentDTO> {
  const published = row.published_version_id ? await db.query<{ payload: ContentPayload }>('SELECT payload FROM content_versions WHERE id=$1', [row.published_version_id]) : null;
  return { ...contentDTO({ ...row, version_id: row.draft_version_id! }), state: row.state, ownerId: row.owner_id,
    publishedPayload: published?.rows[0]?.payload ?? null, scheduledAt: row.publish_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null, reviewReason: row.review_reason || null };
}

/** Same SQL scope semantics as assertManage: all direction tags must be covered. */
export function managementScopeSql(actor: ContentActor, action: GrantAction, values: unknown[], contentAlias = 'c', payloadAlias = 'v.payload'): string {
  if (actor.user.role === 'ADMIN') return 'TRUE';
  if (actor.user.role !== 'EDITOR') return 'FALSE';
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const scopes: string[] = [];
  for (const kind of contentKinds) {
    const grants = actor.grants.filter(grant => grant.contentKind === kind && grant.actions.includes(action));
    if (!grants.length) continue;
    const kindParam = bind(kind);
    if (grants.some(grant => !grant.directionId && !grant.contentId)) { scopes.push(`${contentAlias}.kind=${kindParam}`); continue; }
    const specific = grants.flatMap(grant => grant.contentId ? [grant.contentId] : []);
    const directions = [...new Set(grants.flatMap(grant => grant.directionId ? [grant.directionId] : []))];
    const conditions: string[] = [];
    if (specific.length) conditions.push(`${contentAlias}.id=ANY(${bind(specific)}::uuid[])`);
    if (directions.length) conditions.push(`(jsonb_array_length(${payloadAlias}->'directionIds')>0 AND (${payloadAlias}->'directionIds') <@ ${bind(JSON.stringify(directions))}::jsonb)`);
    scopes.push(`(${contentAlias}.kind=${kindParam} AND (${conditions.join(' OR ') || 'FALSE'}))`);
  }
  return scopes.length ? `(${scopes.join(' OR ')})` : 'FALSE';
}

export async function canUseMedia(db: Database, mediaId: string, actor: ContentActor): Promise<boolean> {
  const media = await db.query<{ owner_id: string }>('SELECT owner_id FROM media WHERE id=$1', [mediaId]);
  if (!media.rows[0]) return false;
  if (actor.user.role === 'ADMIN' || media.rows[0].owner_id === actor.user.id) return true;
  const references = await db.query<ContentRow>(`SELECT DISTINCT c.id,c.kind,c.owner_id,v.payload FROM content_version_media r
    JOIN content_versions rv ON rv.id=r.version_id JOIN contents c ON c.id=rv.content_id
    JOIN content_versions v ON v.id=c.draft_version_id WHERE r.media_id=$1`, [mediaId]);
  return references.rows.some(row => canManage(actor, managementTarget(row), 'read'));
}
function mediaRefs(payload: ContentPayload, origin: string): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  const add = (id: unknown, usage: string) => { if (typeof id === 'string') refs.set(id, new Set([...(refs.get(id) ?? []), usage])); };
  payload.attachmentIds.forEach(id => add(id, 'attachment')); add(payload.coverId, 'cover');
  ((payload.details.materialIds as string[] | undefined) ?? []).forEach(id => add(id, 'attachment'));
  ((payload.details.imageIds as string[] | undefined) ?? []).forEach(id => add(id, 'inline'));
  // The safe Markdown renderer also permits ordinary attachment links in prose.
  // They need the same permission and deletion protection as form-selected files.
  for (const match of renderMarkdown(payload.body).matchAll(/\bhref="([^"]+)"/g)) {
    try {
      const url = new URL(match[1].replaceAll('&amp;', '&'), origin);
      const media = url.origin === origin && /^\/api\/v1\/media\/([a-f0-9-]{36})\/download\/?$/i.exec(url.pathname);
      if (media && idSchema.safeParse(media[1]).success) add(media[1], 'inline');
    } catch { /* External/non-URL prose does not create a local storage reference. */ }
  }
  return refs;
}
async function persistReferences(db: Database, versionId: string, payload: ContentPayload, actor: ContentActor, now: Date, origin: string) {
  for (const [mediaId, usages] of mediaRefs(payload, origin)) {
    if (!await canUseMedia(db, mediaId, actor)) throw new HttpError(403, 'MEDIA_FORBIDDEN', '所选附件不存在或不在你的权限范围内');
    for (const usage of usages) await db.query('INSERT INTO content_version_media(version_id,media_id,usage) VALUES($1,$2,$3)', [versionId, mediaId, usage]);
  }
  const links = new Map<string, string>();
  for (const id of (payload.details.relatedContentIds as string[] | undefined) ?? []) links.set(id, 'related');
  if (payload.details.projectId) links.set(payload.details.projectId as string, 'project');
  for (const step of (payload.details.steps as { resourceIds: string[] }[] | undefined) ?? []) for (const id of step.resourceIds) links.set(id, 'resource');
  for (const [targetId, relation] of links) {
    const target = await loadContent(db, targetId);
    if ((relation === 'project' && target.kind !== 'projects') || (relation === 'resource' && target.kind !== 'resources')) throw new HttpError(400, 'INVALID_RELATION', '关联内容类型不正确');
    if (!await getVisibleContent(db, targetId, actor, now) && !canManage(actor, managementTarget(target), 'read')) throw new HttpError(403, 'RELATION_FORBIDDEN', '关联内容不在可访问范围内');
    await db.query('INSERT INTO content_version_links(version_id,target_content_id,relation) VALUES($1,$2,$3)', [versionId, targetId, relation]);
  }
  const directions = await db.query<{ content_id: string }>('SELECT content_id FROM directions WHERE id=ANY($1::text[])', [payload.directionIds]);
  for (const direction of directions.rows) await db.query(`INSERT INTO content_version_links(version_id,target_content_id,relation)
    VALUES($1,$2,'direction') ON CONFLICT DO NOTHING`, [versionId, direction.content_id]);
}
function validateDetails(kind: ContentKind, payload: ContentPayload) {
  const details = payload.details;
  if (kind === 'projects') {
    const positions = details.positions as { id: string }[];
    if (new Set(positions.map(position => position.id)).size !== positions.length) throw new HttpError(400, 'DUPLICATE_POSITION', '岗位标识不能重复');
  }
  if (kind === 'events') {
    const before = (left: string, right: string) => { if (details[left] && details[right] && new Date(details[left] as string) >= new Date(details[right] as string)) throw new HttpError(400, 'INVALID_WINDOW', '结束时间必须晚于开始时间'); };
    before('startsAt', 'endsAt'); before('registrationStartsAt', 'registrationEndsAt');
    if (details.registrationOpen && !details.startsAt) throw new HttpError(400, 'EVENT_TIME_REQUIRED', '开放报名之前请填写活动开始时间');
  }
  if (kind === 'learning-paths') {
    const steps = details.steps as { id: string }[];
    if (new Set(steps.map(step => step.id)).size !== steps.length) throw new HttpError(400, 'DUPLICATE_STEP', '路线步骤标识不能重复');
  }
}
async function insertDraft(db: Database, ctx: AppContext, actor: ContentActor, kind: ContentKind, payload: ContentPayload, slug?: string): Promise<ContentRow> {
  validateDetails(kind, payload);
  if (kind === 'pages') {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ixd-page:${payload.details.pageKey}`]);
    const existing = await db.query(`SELECT c.id FROM contents c JOIN content_versions v ON v.id=c.draft_version_id WHERE c.kind='pages' AND v.payload#>>'{details,pageKey}'=$1`, [payload.details.pageKey]);
    if (existing.rowCount) throw new HttpError(409, 'PAGE_EXISTS', '该社团页面已经存在，请编辑现有页面');
  }
  const id = randomUUID(), versionId = randomUUID(), now = ctx.now();
  await db.query(`INSERT INTO contents(id,kind,slug,owner_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)`, [id, kind, slug ?? `${kind}-${id.slice(0, 12)}`, actor.user.id, now]);
  await db.query(`INSERT INTO content_versions(id,content_id,revision,payload,created_by,created_at) VALUES($1,$2,1,$3,$4,$5)`, [versionId, id, payload, actor.user.id, now]);
  await db.query('UPDATE contents SET draft_version_id=$2 WHERE id=$1', [id, versionId]);
  await persistReferences(db, versionId, payload, actor, now, ctx.config.publicOrigin);
  if (kind === 'directions') await db.query('INSERT INTO directions(id,content_id) VALUES($1,$2)', [payload.details.key, id]);
  await audit(db, actor.user.id, 'content.create', kind, id, { revision: 1 });
  return loadContent(db, id);
}
async function saveDraft(db: Database, ctx: AppContext, actor: ContentActor, row: ContentRow, payload: ContentPayload): Promise<ContentRow> {
  validateDetails(row.kind, payload);
  if ((row.kind === 'directions' && row.payload.details.key !== payload.details.key) || (row.kind === 'pages' && row.payload.details.pageKey !== payload.details.pageKey)) throw new HttpError(400, 'STABLE_KEY', '方向或页面用途标识不能改为另一条内容');
  const versionId = randomUUID(), revision = row.revision + 1, now = ctx.now();
  await db.query('INSERT INTO content_versions(id,content_id,revision,payload,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)', [versionId, row.id, revision, payload, actor.user.id, now]);
  await persistReferences(db, versionId, payload, actor, now, ctx.config.publicOrigin);
  await db.query(`UPDATE contents SET draft_version_id=$2,revision=$3,updated_at=$4 WHERE id=$1`, [row.id, versionId, revision, now]);
  await audit(db, actor.user.id, 'content.save-draft', row.kind, row.id, { revision });
  return loadContent(db, row.id);
}
export async function createWorkDraft(ctx: AppContext, actor: ContentActor, input: unknown): Promise<AdminContentDTO> {
  const payload = parsePayload('works', input);
  return inTransaction(ctx.db, async db => adminContentDTO(db, await insertDraft(db, ctx, actor, 'works', payload)));
}
export async function editWorkDraft(ctx: AppContext, actor: ContentActor, id: string, expected: number, input: unknown): Promise<AdminContentDTO> {
  return inTransaction(ctx.db, async db => {
    const row = await loadContent(db, id, true);
    if (row.kind !== 'works' || row.owner_id !== actor.user.id) throw new HttpError(404, 'NOT_FOUND', '投稿不存在');
    if (row.published_version_id || !['DRAFT', 'RETURNED'].includes(row.state)) throw new HttpError(409, 'WORK_NOT_EDITABLE', '仅可修改自己的未发布草稿或退回稿');
    requireRevision(row, expected);
    return adminContentDTO(db, await saveDraft(db, ctx, actor, row, parsePayload('works', input)));
  });
}

async function validatePublication(db: Database, row: ContentRow, payload: ContentPayload, scheduled: boolean) {
  if (row.kind === 'projects') {
    const positions = payload.details.positions as { id: string; capacity: number }[];
    const active = await db.query<{ position_id: string; count: string }>("SELECT position_id,count(*) FROM project_members WHERE project_id=$1 AND status='ACTIVE' GROUP BY position_id", [row.id]);
    for (const member of active.rows) {
      const position = positions.find(item => item.id === member.position_id);
      if (position && position.capacity < Number(member.count)) throw new HttpError(409, 'CAPACITY_BELOW_MEMBERS', '岗位名额不能少于现有成员');
    }
    if (scheduled) {
      const previous = await db.query<{ id: string; capacity: number }>('SELECT id,capacity FROM project_positions WHERE project_id=$1', [row.id]);
      if (positions.some(position => { const old = previous.rows.find(item => item.id === position.id); return old && position.capacity < old.capacity; })) throw new HttpError(409, 'SCHEDULED_CAPACITY_REDUCTION', '减少岗位名额须即时发布，以便事务核对最新人数');
    }
  }
  if (row.kind === 'events') {
    const registered = await db.query<{ count: string }>("SELECT count(*) FROM event_registrations WHERE event_id=$1 AND status='REGISTERED'", [row.id]);
    if (Number(registered.rows[0].count) > Number(payload.details.capacity)) throw new HttpError(409, 'CAPACITY_BELOW_REGISTRATIONS', '活动名额不能少于现有报名人数');
    if (scheduled && row.published_version_id) {
      const old = await db.query<{ payload: ContentPayload }>('SELECT payload FROM content_versions WHERE id=$1', [row.published_version_id]);
      if (Number(payload.details.capacity) < Number(old.rows[0].payload.details.capacity)) throw new HttpError(409, 'SCHEDULED_CAPACITY_REDUCTION', '减少活动名额须即时发布，以便核对最新人数');
    }
  }
}
/** Caller holds contents row lock. Used by publishing, worker and business writes. */
export async function applyPublication(db: Database, ctx: AppContext, row: ContentRow, versionId: string, at: Date, expiresAt: Date | null, notifyImportant: boolean): Promise<void> {
  const result = await db.query<{ payload: ContentPayload }>('SELECT payload FROM content_versions WHERE id=$1 AND content_id=$2', [versionId, row.id]);
  if (!result.rows[0]) throw new HttpError(409, 'VERSION_MISSING', '待发布版本不存在');
  const payload = result.rows[0].payload;
  await validatePublication(db, row, payload, false);
  const previous = row.published_version_id ? await db.query<{ payload: ContentPayload }>('SELECT payload FROM content_versions WHERE id=$1', [row.published_version_id]) : null;
  if (row.kind === 'projects') {
    const positions = payload.details.positions as { id: string; title: string; description: string; capacity: number; enabled: boolean; sortOrder: number }[];
    await db.query('UPDATE project_positions SET enabled=false,revision=revision+1 WHERE project_id=$1 AND NOT(id=ANY($2::uuid[]))', [row.id, positions.map(position => position.id)]);
    for (const position of positions) {
      const written = await db.query(`INSERT INTO project_positions(id,project_id,title,description,capacity,enabled,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,
        capacity=EXCLUDED.capacity,enabled=EXCLUDED.enabled,sort_order=EXCLUDED.sort_order,revision=project_positions.revision+1
        WHERE project_positions.project_id=EXCLUDED.project_id RETURNING id`, [position.id, row.id, position.title, position.description, position.capacity, position.enabled, position.sortOrder]);
      if (!written.rowCount) throw new HttpError(409, 'POSITION_OWNERSHIP', '岗位标识已被其他项目使用');
    }
  }
  const attention = row.attention_revision + (notifyImportant ? 1 : 0), now = ctx.now();
  await db.query(`UPDATE contents SET published_version_id=$2,published_at=$3,expires_at=$4,state='PUBLISHED',
    scheduled_version_id=NULL,publish_at=NULL,scheduled_expires_at=NULL,scheduled_notify_important=false,
    attention_revision=$5,revision=revision+1,updated_at=$6,review_reason='' WHERE id=$1`, [row.id, versionId, at, expiresAt, attention, now]);
  if (row.kind === 'announcements' && notifyImportant) await queueJob(db, 'IMPORTANT_ANNOUNCEMENT', { contentId: row.id, attentionRevision: attention }, `announcement:${row.id}:${attention}`, now, now);
  if (row.kind === 'competitions') await reconcileCompetitionJobs(db, row.id, payload, now);
  if (row.kind === 'events' && previous?.rows[0]) {
    const old = previous.rows[0].payload.details, next = payload.details;
    const cancelled = old.eventStatus !== 'CANCELLED' && next.eventStatus === 'CANCELLED';
    const changed = ['startsAt', 'endsAt', 'location', 'onlineUrl'].some(key => old[key] !== next[key]);
    if (cancelled || changed) {
      const users = await db.query<{ user_id: string }>("SELECT user_id FROM event_registrations WHERE event_id=$1 AND status='REGISTERED'", [row.id]);
      for (const user of users.rows) await notifyUser(db, user.user_id, cancelled ? 'EVENT_CANCELLED' : 'EVENT_CHANGED', `${cancelled ? '活动已取消' : '活动信息更新'}：${payload.title}`, cancelled ? '已报名活动取消，请查看详情。' : '活动时间或地点发生变化，请查看最新详情。', row.id, `event:${row.id}:${versionId}:${user.user_id}`, now);
    }
  }
}
export async function materializeScheduled(db: Database, ctx: AppContext, row: ContentRow): Promise<ContentRow> {
  if (row.scheduled_version_id && row.publish_at && row.publish_at <= ctx.now()) {
    await applyPublication(db, ctx, row, row.scheduled_version_id, row.publish_at, row.scheduled_expires_at, row.scheduled_notify_important);
    return loadContent(db, row.id);
  }
  return row;
}

function addSearch(values: unknown[], where: string[], query: z.infer<typeof listQuerySchema>, payload = 'v.payload') {
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (query.q) where.push(`(${payload}->>'title' ILIKE ${bind(`%${query.q}%`)} OR ${payload}->>'summary' ILIKE $${values.length} OR ${payload}->>'body' ILIKE $${values.length})`);
  if (query.direction) where.push(`(${payload}->'directionIds') ? ${bind(query.direction)}`);
  if (query.year) where.push(`${payload}#>>'{details,year}'=${bind(String(query.year))}`);
  if (query.difficulty) where.push(`${payload}#>>'{details,difficulty}'=${bind(query.difficulty)}`);
}
const deadlineExpression = (field: string, end = true) => `COALESCE(NULLIF(v.payload#>>'{details,${field},at}','')::timestamptz,
  (NULLIF(v.payload#>>'{details,${field},date}','')::date + TIME '${end ? '23:59:59.999999' : '00:00:00'}') AT TIME ZONE COALESCE(v.payload#>>'{details,${field},timeZone}','Asia/Shanghai'))`;
function orderSql(sort: string, kind?: ContentKind) {
  const sorts: Record<string, string> = { oldest: 'c.created_at ASC,c.id ASC', title: "v.payload->>'title' ASC,c.id ASC", order: "(v.payload->>'sortOrder')::integer ASC,c.id ASC", newest: 'c.created_at DESC,c.id DESC' };
  if (sort === 'deadline' && kind === 'competitions') return `${deadlineExpression('registrationEnd')} ASC NULLS LAST,c.id ASC`;
  return sorts[sort] ?? sorts.newest;
}
async function attachReadState(db: Database, rows: ContentDTO[], actor: ContentActor | null) {
  if (!actor) return;
  const read = await db.query<{ announcement_id: string; attention_revision: number }>('SELECT announcement_id,attention_revision FROM announcement_reads WHERE user_id=$1 AND announcement_id=ANY($2::uuid[])', [actor.user.id, rows.filter(row => row.kind === 'announcements').map(row => row.id)]);
  for (const row of rows) if (row.kind === 'announcements') row.read = Boolean(read.rows.find(item => item.announcement_id === row.id && item.attention_revision >= row.attentionRevision));
}
const idParams = z.strictObject({ id: idSchema });

export async function registerContentRoutes(app: FastifyInstance, ctx: AppContext) {
  const routes = responseRoutes(app);
  for (const kind of contentKinds) {
    routes.get(`/api/v1/${kind}`, async request => {
      const query = listQuerySchema.parse(request.query), values = visibilityValues(ctx.now(), request.actor), where = [publicWhere];
      values.push(kind); where.push(`c.kind=$${values.length}`); addSearch(values, where, query);
      if (query.phase && kind === 'competitions') {
        const start = deadlineExpression('registrationStart', false), end = deadlineExpression('registrationEnd');
        const phases = { upcoming: `${start}>$1::timestamptz`, open: `(${start} IS NULL OR ${start}<=$1::timestamptz) AND (${end} IS NULL OR ${end}>=$1::timestamptz) AND (${start} IS NOT NULL OR ${end} IS NOT NULL)`, closed: `${end}<$1::timestamptz`, unknown: `${start} IS NULL AND ${end} IS NULL` };
        where.push(phases[query.phase]);
      }
      const count = await ctx.db.query<{ count: string }>(`SELECT count(*) ${publicFrom} WHERE ${where.join(' AND ')}`, values);
      values.push(query.pageSize, (query.page - 1) * query.pageSize);
      const result = await ctx.db.query<VisibleContentRow>(`SELECT ${publicColumns} ${publicFrom} WHERE ${where.join(' AND ')}
        ORDER BY (v.payload->>'pinned')::boolean DESC,${orderSql(query.sort, kind)} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
      const data = result.rows.map(contentDTO); await attachReadState(ctx.db, data, request.actor);
      return { data, meta: { page: query.page, pageSize: query.pageSize, total: Number(count.rows[0].count) } };
    });
    routes.get(`/api/v1/${kind}/:id`, async request => {
      const { id } = idParams.parse(request.params), row = await getVisibleContent(ctx.db, id, request.actor, ctx.now());
      if (!row || row.kind !== kind) throw new HttpError(404, 'NOT_FOUND', '内容不存在或不可访问');
      const data = contentDTO(row); await attachReadState(ctx.db, [data], request.actor); return { data };
    });
  }
  routes.get('/api/v1/contents/:id', async request => {
    const { id } = idParams.parse(request.params); z.strictObject({}).parse(request.query);
    const row = await getVisibleContent(ctx.db, id, request.actor, ctx.now());
    if (!row) throw new HttpError(404, 'NOT_FOUND', '内容不存在或不可访问');
    const data = contentDTO(row); await attachReadState(ctx.db, [data], request.actor); return { data };
  });
  routes.get('/api/v1/site-settings', async () => {
    const result = await ctx.db.query<{ published: unknown }>('SELECT published FROM site_settings WHERE id=true');
    const settings = siteSettingsSchema.safeParse(result.rows[0]?.published);
    if (!settings.success) throw new HttpError(503, 'SITE_NOT_INITIALIZED', '站点资料尚未初始化');
    return { data: settings.data };
  });
  routes.get('/api/v1/admin/contents', async request => {
    const actor = requireEditor(request), query = listQuerySchema.extend({ kind: z.enum(contentKinds).optional() }).parse(request.query);
    const values: unknown[] = [], where = [managementScopeSql(actor, 'read', values)];
    if (query.kind) { values.push(query.kind); where.push(`c.kind=$${values.length}`); }
    if (query.state) { values.push(query.state); where.push(`c.state=$${values.length}`); }
    addSearch(values, where, query);
    const from = 'FROM contents c JOIN content_versions v ON v.id=c.draft_version_id JOIN users u ON u.id=c.owner_id';
    const count = await ctx.db.query<{ count: string }>(`SELECT count(*) ${from} WHERE ${where.join(' AND ')}`, values);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await ctx.db.query<ContentRow>(`SELECT c.*,v.payload,u.display_name AS author_display_name ${from} WHERE ${where.join(' AND ')} ORDER BY ${orderSql(query.sort, query.kind)} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { data: await Promise.all(result.rows.map(row => adminContentDTO(ctx.db, row))), meta: { page: query.page, pageSize: query.pageSize, total: Number(count.rows[0].count) } };
  });
  routes.post('/api/v1/admin/contents', async (request, reply) => {
    const actor = requireEditor(request), input = createContentSchema.parse(request.body), payload = parsePayload(input.kind, input.payload);
    assertManage(actor, { kind: input.kind, directionIds: payload.directionIds }, 'create');
    const data = await inTransaction(ctx.db, async db => adminContentDTO(db, await insertDraft(db, ctx, actor, input.kind, payload, input.slug)));
    return reply.code(201).send({ data });
  });
  routes.get('/api/v1/admin/contents/:id', async request => {
    const actor = requireEditor(request), { id } = idParams.parse(request.params), row = await loadContent(ctx.db, id);
    assertManage(actor, managementTarget(row), 'read'); return { data: await adminContentDTO(ctx.db, row) };
  });
  routes.patch('/api/v1/admin/contents/:id', async request => {
    const actor = requireEditor(request), { id } = idParams.parse(request.params), input = editContentSchema.parse(request.body);
    const data = await inTransaction(ctx.db, async db => {
      const row = await materializeScheduled(db, ctx, await loadContent(db, id, true)); requireRevision(row, input.expectedRevision);
      assertManage(actor, managementTarget(row), 'update'); const payload = parsePayload(row.kind, input.payload);
      assertManage(actor, { ...managementTarget(row), directionIds: payload.directionIds }, 'update');
      return adminContentDTO(db, await saveDraft(db, ctx, actor, row, payload));
    }); return { data };
  });
  routes.post('/api/v1/admin/contents/:id/publish', async request => {
    const actor = requireEditor(request), { id } = idParams.parse(request.params), input = publishSchema.parse(request.body);
    const data = await inTransaction(ctx.db, async db => {
      const row = await materializeScheduled(db, ctx, await loadContent(db, id, true)); requireRevision(row, input.expectedRevision);
      assertManage(actor, managementTarget(row), 'publish');
      const now = ctx.now(), at = input.publishAt ? new Date(input.publishAt) : now, expiry = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiry && expiry <= at) throw new HttpError(400, 'INVALID_EXPIRY', '有效期必须晚于发布时间');
      if (at < now && input.publishAt) throw new HttpError(400, 'PAST_SCHEDULE', '定时发布时间不能在过去');
      const important = row.kind === 'announcements' && (input.notifyImportantUpdate || (!row.published_version_id && row.payload.importance === 'important'));
      await validatePublication(db, row, row.payload, at > now);
      if (at > now) {
        await db.query(`UPDATE contents SET scheduled_version_id=draft_version_id,publish_at=$2,scheduled_expires_at=$3,
          scheduled_notify_important=$4,revision=revision+1,updated_at=$5 WHERE id=$1`, [id, at, expiry, important, now]);
      } else await applyPublication(db, ctx, row, row.draft_version_id!, now, expiry, important);
      await audit(db, actor.user.id, at > now ? 'content.schedule' : 'content.publish', row.kind, id, { versionId: row.draft_version_id, publishAt: at.toISOString() }, request.id);
      return adminContentDTO(db, await loadContent(db, id));
    }); return { data };
  });
  for (const [action, state] of [['withdraw', 'WITHDRAWN'], ['archive', 'ARCHIVED']] as const) {
    routes.post(`/api/v1/admin/contents/:id/${action}`, async request => {
      const actor = requireEditor(request), { id } = idParams.parse(request.params), input = revisionSchema.parse(request.body);
      const data = await inTransaction(ctx.db, async db => {
        const row = await loadContent(db, id, true); requireRevision(row, input.expectedRevision); assertManage(actor, managementTarget(row), 'archive');
        await db.query(`UPDATE contents SET state=$2,scheduled_version_id=NULL,publish_at=NULL,scheduled_expires_at=NULL,
          scheduled_notify_important=false,revision=revision+1,updated_at=$3 WHERE id=$1`, [id, state, ctx.now()]);
        await cancelContentJobs(db, id, ctx.now()); await audit(db, actor.user.id, `content.${action}`, row.kind, id, {}, request.id);
        return adminContentDTO(db, await loadContent(db, id));
      }); return { data };
    });
  }
  routes.delete('/api/v1/admin/contents/:id', async request => {
    const actor = requireEditor(request), { id } = idParams.parse(request.params), input = revisionSchema.parse(request.body);
    await inTransaction(ctx.db, async db => {
      const row = await loadContent(db, id, true); requireRevision(row, input.expectedRevision); assertManage(actor, managementTarget(row), 'delete');
      if (row.published_version_id || row.scheduled_version_id) throw new HttpError(409, 'CONTENT_HAS_PUBLIC_HISTORY', '已发布内容请撤回或归档，保留历史');
      const refs = await db.query('SELECT version_id FROM content_version_links WHERE target_content_id=$1 LIMIT 1', [id]);
      if (refs.rowCount) throw new HttpError(409, 'CONTENT_REFERENCED', '该内容仍被其他版本引用，不能删除');
      if (row.kind === 'directions') throw new HttpError(409, 'STABLE_DIRECTION', '六方向入口须保留，可编辑其内容');
      await cancelContentJobs(db, id, ctx.now());
      await db.query('DELETE FROM contents WHERE id=$1', [id]); await audit(db, actor.user.id, 'content.delete', row.kind, id, {}, request.id);
    }); return { data: { deleted: true } };
  });
  routes.post('/api/v1/admin/preview', async request => {
    const actor = requireEditor(request), input = z.strictObject({ id: idSchema.optional(), kind: z.enum(contentKinds), payload: z.unknown() }).parse(request.body), payload = parsePayload(input.kind, input.payload);
    if (input.id) {
      const row = await loadContent(ctx.db, input.id);
      if (row.kind !== input.kind) throw new HttpError(400, 'KIND_MISMATCH', '预览内容类型与原内容不一致');
      assertManage(actor, managementTarget(row), 'update');
      assertManage(actor, { ...managementTarget(row), directionIds: payload.directionIds }, 'update');
    } else if (!canManage(actor, { kind: input.kind, directionIds: payload.directionIds }, 'create') && !canManage(actor, { kind: input.kind, directionIds: payload.directionIds }, 'update')) throw new HttpError(403, 'FORBIDDEN', '没有该内容的预览权限');
    return { data: { bodyHtml: renderMarkdown(payload.body) } };
  });
  routes.post('/api/v1/admin/contents/:id/return', async request => {
    const actor = requireEditor(request), { id } = idParams.parse(request.params), input = revisionSchema.extend({ reason: z.string().trim().min(1).max(2000) }).parse(request.body);
    const data = await inTransaction(ctx.db, async db => {
      const row = await loadContent(db, id, true); requireRevision(row, input.expectedRevision); assertManage(actor, managementTarget(row), 'publish');
      if (row.kind !== 'works' || row.state !== 'REVIEW' || row.published_version_id) throw new HttpError(409, 'NOT_IN_REVIEW', '仅可退回正在审核的未发布投稿');
      await db.query("UPDATE contents SET state='RETURNED',review_reason=$2,revision=revision+1,updated_at=$3 WHERE id=$1", [id, input.reason, ctx.now()]);
      await notifyUser(db, row.owner_id, 'WORK_RETURNED', `投稿已退回：${row.payload.title}`, input.reason, id, `work-return:${id}:${row.revision + 1}`, ctx.now());
      await audit(db, actor.user.id, 'work.return', row.kind, id, { reason: input.reason }, request.id); return adminContentDTO(db, await loadContent(db, id));
    }); return { data };
  });
  routes.get('/api/v1/admin/site-settings', async request => {
    requireAdmin(request); const result = await ctx.db.query('SELECT draft,published,revision,published_revision,updated_at,published_at FROM site_settings WHERE id=true');
    const row = result.rows[0]; return { data: { payload: row.draft, publishedPayload: row.published, revision: row.revision, publishedRevision: row.published_revision, updatedAt: row.updated_at.toISOString(), publishedAt: row.published_at?.toISOString() ?? null } };
  });
  routes.patch('/api/v1/admin/site-settings', async request => {
    const actor = requireAdmin(request), input = revisionSchema.extend({ payload: siteSettingsSchema }).parse(request.body);
    const row = await inTransaction(ctx.db, async db => {
      const result = await db.query('SELECT * FROM site_settings WHERE id=true FOR UPDATE'); requireRevision(result.rows[0], input.expectedRevision);
      const updated = await db.query('UPDATE site_settings SET draft=$1,revision=revision+1,updated_by=$2,updated_at=$3 WHERE id=true RETURNING *', [input.payload, actor.user.id, ctx.now()]);
      await audit(db, actor.user.id, 'settings.save-draft', 'site-settings', 'site', { revision: input.expectedRevision + 1 }, request.id); return updated.rows[0];
    }); return { data: { payload: row.draft, publishedPayload: row.published, revision: row.revision, publishedRevision: row.published_revision, updatedAt: row.updated_at.toISOString(), publishedAt: row.published_at?.toISOString() ?? null } };
  });
  routes.post('/api/v1/admin/site-settings/publish', async request => {
    const actor = requireAdmin(request), input = revisionSchema.parse(request.body);
    return inTransaction(ctx.db, async db => {
      const result = await db.query('SELECT * FROM site_settings WHERE id=true FOR UPDATE'); requireRevision(result.rows[0], input.expectedRevision); siteSettingsSchema.parse(result.rows[0].draft);
      await db.query('UPDATE site_settings SET published=draft,published_revision=revision,updated_by=$1,published_at=$2 WHERE id=true', [actor.user.id, ctx.now()]);
      await audit(db, actor.user.id, 'settings.publish', 'site-settings', 'site', { revision: input.expectedRevision }, request.id); return { data: { revision: input.expectedRevision, published: true } };
    });
  });
}
