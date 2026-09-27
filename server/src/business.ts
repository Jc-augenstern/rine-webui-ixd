import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  applicationSchema, decisionSchema, editContentSchema, idSchema, listQuerySchema, reminderSchema, revisionSchema,
  type ApplicationDTO, type CompetitionIntentDTO, type ContentPayload, type FavoriteDTO,
  type NotificationDTO, type ProjectMemberDTO, type RegistrationDTO,
} from '../../shared/platform.js';
import type { AppContext, Actor } from './context.js';
import { HttpError } from './errors.js';
import { requireActor, requireEditor, assertManage } from './security.js';
import { inTransaction, type Database } from './db.js';
import { audit } from './audit.js';
import { responseRoutes } from './content-responses.js';
import {
  adminContentDTO, contentDTO, createWorkDraft, editWorkDraft, getVisibleContent, loadContent,
  managementScopeSql, managementTarget, materializeScheduled, requireRevision, type ContentRow,
} from './content.js';
import { notifyUser, reconcileCompetitionJobs } from './content-notifications.js';

const idParams = z.strictObject({ id: idSchema });
const pagination = z.strictObject({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });
const adminQuery = pagination.extend({ q: z.string().max(200).default(''), status: z.string().max(30).optional(), projectId: idSchema.optional(), eventId: idSchema.optional(), userId: idSchema.optional() });
const date = (value: Date | null | undefined) => value?.toISOString() ?? null;
const publicTitle = `COALESCE(pv.payload->>'title','内容已不可用')`;

function applicationDTO(row: Record<string, any>, management = false): ApplicationDTO {
  return { id: row.id, projectId: row.project_id, projectTitle: row.project_title, positionId: row.position_id,
    positionTitle: row.position_title, motivation: row.motivation, portfolioUrl: row.portfolio_url ?? '', status: row.status,
    decisionReason: row.decision_reason, revision: row.revision, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    ...(management ? { user: { id: row.user_id, displayName: row.display_name, email: row.email } } : {}) };
}
function registrationDTO(row: Record<string, any>, management = false): RegistrationDTO {
  return { id: row.id, eventId: row.event_id, eventTitle: row.event_title, status: row.status,
    startsAt: row.starts_at ?? null, location: row.location ?? '', createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    ...(management ? { user: { id: row.user_id, displayName: row.display_name, email: row.email } } : {}) };
}
function memberDTO(row: Record<string, any>, management = false): ProjectMemberDTO {
  return { id: row.id, projectId: row.project_id, projectTitle: row.project_title, positionId: row.position_id, positionTitle: row.position_title,
    userId: row.user_id, status: row.status, joinedAt: row.joined_at.toISOString(), leftAt: date(row.left_at),
    ...(management ? { user: { id: row.user_id, displayName: row.display_name, email: row.email } } : {}) };
}
function notificationDTO(row: Record<string, any>): NotificationDTO {
  return { id: row.id, type: row.type, title: row.title, body: row.body, contentId: row.content_id, readAt: date(row.read_at), createdAt: row.created_at.toISOString() };
}
/** Stored notification facts never grant continued access to their linked content. */
async function readableNotification(db: Database, ctx: AppContext, actor: Actor, row: Record<string, any>): Promise<NotificationDTO> {
  const notification = notificationDTO(row);
  if (row.content_id && !await getVisibleContent(db, row.content_id, actor, ctx.now())) {
    return { ...notification, title: '关联内容当前不可访问', body: '关联内容当前不可访问', contentId: null };
  }
  return notification;
}
const applicationFrom = `FROM project_applications a JOIN contents c ON c.id=a.project_id
  LEFT JOIN content_versions pv ON pv.id=c.published_version_id JOIN content_versions v ON v.id=c.draft_version_id
  JOIN project_positions p ON p.id=a.position_id JOIN users u ON u.id=a.user_id`;
const applicationColumns = `a.*,${publicTitle} AS project_title,p.title AS position_title,u.display_name,u.email`;
const registrationFrom = `FROM event_registrations r JOIN contents c ON c.id=r.event_id
  LEFT JOIN content_versions pv ON pv.id=c.published_version_id JOIN content_versions v ON v.id=c.draft_version_id JOIN users u ON u.id=r.user_id`;
const registrationColumns = `r.*,${publicTitle} AS event_title,pv.payload#>>'{details,startsAt}' AS starts_at,pv.payload#>>'{details,location}' AS location,u.display_name,u.email`;
const memberFrom = `FROM project_members m JOIN contents c ON c.id=m.project_id LEFT JOIN content_versions pv ON pv.id=c.published_version_id
  JOIN project_positions p ON p.id=m.position_id JOIN users u ON u.id=m.user_id`;
const memberColumns = `m.*,${publicTitle} AS project_title,p.title AS position_title,u.display_name,u.email`;

/** Personal history stays accessible, but never grants access to later restricted content edits. */
async function readableBusinessRow(db: Database, ctx: AppContext, actor: Actor, row: Record<string, any>): Promise<Record<string, any>> {
  const contentId = row.project_id || row.event_id || row.competition_id;
  const visible = await getVisibleContent(db, contentId, actor, ctx.now());
  const title = visible?.payload.title ?? '内容已不可用';
  const positions = visible?.payload.details.positions as { id: string; title: string }[] | undefined;
  return { ...row, project_title: title, event_title: title, competition_title: title,
    position_title: positions?.find(position => position.id === row.position_id)?.title ?? '岗位已不可用',
    starts_at: visible?.payload.details.startsAt ?? null, location: visible?.payload.details.location ?? '' };
}
async function ownApplication(db: Database, ctx: AppContext, actor: Actor, id: string) {
  const result = await db.query(`SELECT ${applicationColumns} ${applicationFrom} WHERE a.id=$1 AND a.user_id=$2`, [id, actor.user.id]);
  if (!result.rows[0]) throw new HttpError(404, 'NOT_FOUND', '申请不存在'); return applicationDTO(await readableBusinessRow(db, ctx, actor, result.rows[0]));
}
async function ownRegistration(db: Database, ctx: AppContext, actor: Actor, eventId: string) {
  const result = await db.query(`SELECT ${registrationColumns} ${registrationFrom} WHERE r.event_id=$1 AND r.user_id=$2`, [eventId, actor.user.id]);
  if (!result.rows[0]) throw new HttpError(404, 'NOT_FOUND', '报名不存在'); return registrationDTO(await readableBusinessRow(db, ctx, actor, result.rows[0]));
}
async function activeManagedPayload(db: Database, ctx: AppContext, row: ContentRow): Promise<ContentPayload> {
  if (!row.published_version_id || ['WITHDRAWN', 'ARCHIVED'].includes(row.state) || (row.expires_at && row.expires_at <= ctx.now())) throw new HttpError(409, 'CONTENT_NOT_ACTIVE', '内容当前没有有效的发布版本');
  const version = await db.query<{ payload: ContentPayload }>('SELECT payload FROM content_versions WHERE id=$1', [row.published_version_id]);
  return version.rows[0].payload;
}
function assertProjectOpen(payload: ContentPayload, now: Date) {
  if (!payload.details.recruiting || (payload.details.applicationDeadline && new Date(payload.details.applicationDeadline as string) <= now)) throw new HttpError(409, 'APPLICATIONS_CLOSED', '项目已关闭招募或超过申请截止时间');
}
function checkRegistrationWindow(payload: ContentPayload, now: Date) {
  const d = payload.details;
  if (!d.registrationOpen || d.eventStatus !== 'SCHEDULED' || (d.startsAt && new Date(d.startsAt as string) <= now)
    || (d.registrationStartsAt && new Date(d.registrationStartsAt as string) > now)
    || (d.registrationEndsAt && new Date(d.registrationEndsAt as string) <= now)) throw new HttpError(409, 'REGISTRATIONS_CLOSED', '活动当前不在报名时间内');
}
function managementUserFilter(actor: Actor, query: z.infer<typeof adminQuery>) {
  if (query.userId && actor.user.role !== 'ADMIN') throw new HttpError(403, 'USER_FILTER_FORBIDDEN', '只有管理员可按用户查询跨资源记录');
}

export async function registerBusinessRoutes(app: FastifyInstance, ctx: AppContext) {
  const routes = responseRoutes(app);
  routes.get('/api/v1/me/favorites', async request => {
    const actor = requireActor(request, false), query = listQuerySchema.parse(request.query);
    const favorites = await ctx.db.query<{ content_id: string; reminder_hours: number[]; created_at: Date }>('SELECT content_id,reminder_hours,created_at FROM favorites WHERE user_id=$1 ORDER BY created_at DESC,content_id', [actor.user.id]);
    const visible: FavoriteDTO[] = [];
    for (const favorite of favorites.rows) {
      const content = await getVisibleContent(ctx.db, favorite.content_id, actor, ctx.now());
      if (!content || (query.direction && !content.payload.directionIds.includes(query.direction)) || (query.q && !`${content.payload.title}\n${content.payload.summary}`.toLowerCase().includes(query.q.toLowerCase()))) continue;
      visible.push({ content: contentDTO(content), reminderHours: favorite.reminder_hours, createdAt: favorite.created_at.toISOString() });
    }
    return { data: visible.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), meta: { page: query.page, pageSize: query.pageSize, total: visible.length } };
  });
  routes.put('/api/v1/me/favorites/:contentId', async request => {
    const actor = requireActor(request), { contentId } = z.strictObject({ contentId: idSchema }).parse(request.params), input = reminderSchema.parse(request.body ?? {});
    const hours = [...new Set(input.reminderHours)];
    await inTransaction(ctx.db, async db => {
      const row = await materializeScheduled(db, ctx, await loadContent(db, contentId, true));
      const visible = await getVisibleContent(db, contentId, actor, ctx.now());
      if (!visible) throw new HttpError(404, 'NOT_FOUND', '内容不存在或不可访问');
      await db.query(`INSERT INTO favorites(user_id,content_id,reminder_hours,created_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id,content_id) DO UPDATE SET reminder_hours=EXCLUDED.reminder_hours`, [actor.user.id, contentId, hours, ctx.now()]);
      if (row.kind === 'competitions') await reconcileCompetitionJobs(db, contentId, visible.payload, ctx.now(), actor.user.id);
    }); return { data: { contentId, favorited: true, reminderHours: hours } };
  });
  routes.delete('/api/v1/me/favorites/:contentId', async request => {
    const actor = requireActor(request), { contentId } = z.strictObject({ contentId: idSchema }).parse(request.params);
    z.strictObject({}).parse(request.body ?? {});
    await inTransaction(ctx.db, async db => {
      await db.query('SELECT id FROM contents WHERE id=$1 FOR UPDATE', [contentId]);
      await db.query('DELETE FROM favorites WHERE user_id=$1 AND content_id=$2', [actor.user.id, contentId]);
      await reconcileCompetitionJobs(db, contentId, null, ctx.now(), actor.user.id);
    }); return { data: { contentId, favorited: false } };
  });
  routes.put('/api/v1/me/announcements/:id/read', async request => {
    const actor = requireActor(request, false), { id } = idParams.parse(request.params); z.strictObject({}).parse(request.body ?? {});
    const row = await getVisibleContent(ctx.db, id, actor, ctx.now());
    if (!row || row.kind !== 'announcements') throw new HttpError(404, 'NOT_FOUND', '公告不存在或不可访问');
    await ctx.db.query(`INSERT INTO announcement_reads(user_id,announcement_id,attention_revision,read_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,announcement_id) DO UPDATE SET attention_revision=GREATEST(announcement_reads.attention_revision,EXCLUDED.attention_revision),read_at=EXCLUDED.read_at`, [actor.user.id, id, row.attention_revision, ctx.now()]);
    return { data: { id, read: true, attentionRevision: row.attention_revision } };
  });
  routes.get('/api/v1/notifications', async request => {
    const actor = requireActor(request, false), query = pagination.extend({ unread: z.enum(['true', 'false']).optional() }).parse(request.query), values: unknown[] = [actor.user.id];
    const where = query.unread === 'true' ? 'AND read_at IS NULL' : query.unread === 'false' ? 'AND read_at IS NOT NULL' : '';
    const count = await ctx.db.query<{ count: string }>(`SELECT count(*) FROM notifications WHERE user_id=$1 ${where}`, values);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await ctx.db.query(`SELECT * FROM notifications WHERE user_id=$1 ${where} ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, values);
    return { data: await Promise.all(result.rows.map(row => readableNotification(ctx.db, ctx, actor, row))), meta: { page: query.page, pageSize: query.pageSize, total: Number(count.rows[0].count) } };
  });
  routes.put('/api/v1/notifications/:id/read', async request => {
    const actor = requireActor(request, false), { id } = idParams.parse(request.params); z.strictObject({}).parse(request.body ?? {});
    const result = await ctx.db.query('UPDATE notifications SET read_at=COALESCE(read_at,$3) WHERE id=$1 AND user_id=$2 RETURNING *', [id, actor.user.id, ctx.now()]);
    if (!result.rows[0]) throw new HttpError(404, 'NOT_FOUND', '通知不存在'); return { data: await readableNotification(ctx.db, ctx, actor, result.rows[0]) };
  });
  routes.put('/api/v1/competitions/:id/intent', async request => {
    const actor = requireActor(request), { id } = idParams.parse(request.params), input = z.strictObject({ note: z.string().max(2000).default('') }).parse(request.body ?? {});
    const data = await inTransaction(ctx.db, async db => {
      await loadContent(db, id, true); const content = await getVisibleContent(db, id, actor, ctx.now());
      if (!content || content.kind !== 'competitions') throw new HttpError(404, 'NOT_FOUND', '赛事不存在或不可访问');
      const result = await db.query(`INSERT INTO competition_intents(competition_id,user_id,note,created_at,updated_at) VALUES($1,$2,$3,$4,$4)
        ON CONFLICT(competition_id,user_id) DO UPDATE SET note=EXCLUDED.note,status='INTERESTED',updated_at=EXCLUDED.updated_at RETURNING *`, [id, actor.user.id, input.note, ctx.now()]);
      const r = result.rows[0]; return { id: r.id, competitionId: id, competitionTitle: content.payload.title, note: r.note, status: r.status, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() } satisfies CompetitionIntentDTO;
    }); return { data };
  });
  routes.delete('/api/v1/competitions/:id/intent', async request => {
    const actor = requireActor(request), { id } = idParams.parse(request.params); z.strictObject({}).parse(request.body ?? {});
    const result = await ctx.db.query("UPDATE competition_intents SET status='WITHDRAWN',updated_at=$3 WHERE competition_id=$1 AND user_id=$2 RETURNING id", [id, actor.user.id, ctx.now()]);
    return { data: { id: result.rows[0]?.id ?? null, competitionId: id, status: 'WITHDRAWN' } };
  });
  routes.get('/api/v1/me/intents', async request => {
    const actor = requireActor(request, false), query = pagination.parse(request.query);
    const count = await ctx.db.query<{ count: string }>('SELECT count(*) FROM competition_intents WHERE user_id=$1', [actor.user.id]);
    const result = await ctx.db.query(`SELECT i.*,${publicTitle} AS competition_title FROM competition_intents i JOIN contents c ON c.id=i.competition_id
      LEFT JOIN content_versions pv ON pv.id=c.published_version_id WHERE i.user_id=$1 ORDER BY i.updated_at DESC,i.id DESC LIMIT $2 OFFSET $3`, [actor.user.id, query.pageSize, (query.page - 1) * query.pageSize]);
    return { data: await Promise.all(result.rows.map(async row => { const r = await readableBusinessRow(ctx.db, ctx, actor, row); return { id: r.id, competitionId: r.competition_id, competitionTitle: r.competition_title, note: r.note, status: r.status, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() }; })), meta: { ...query, total: Number(count.rows[0].count) } };
  });

  routes.post('/api/v1/projects/:id/applications', async (request, reply) => {
    const actor = requireActor(request), { id } = idParams.parse(request.params), input = applicationSchema.parse(request.body);
    const data = await inTransaction(ctx.db, async db => {
      const row = await materializeScheduled(db, ctx, await loadContent(db, id, true)), visible = await getVisibleContent(db, id, actor, ctx.now());
      if (row.kind !== 'projects' || !visible) throw new HttpError(404, 'NOT_FOUND', '项目不存在或不可访问');
      const prior = await db.query('SELECT * FROM project_applications WHERE project_id=$1 AND user_id=$2 FOR UPDATE', [id, actor.user.id]);
      if (prior.rows[0]?.status === 'PENDING') {
        const previous = prior.rows[0];
        if (previous.position_id === input.positionId && previous.motivation === input.motivation && (previous.portfolio_url ?? '') === input.portfolioUrl) return ownApplication(db, ctx, actor, previous.id);
        throw new HttpError(409, 'APPLICATION_PENDING', '已有待处理申请，请先撤回后再重新提交');
      }
      const membership = await db.query("SELECT id FROM project_members WHERE project_id=$1 AND user_id=$2 AND status='ACTIVE'", [id, actor.user.id]);
      if (membership.rowCount) throw new HttpError(409, 'ALREADY_MEMBER', '你已是当前项目成员，无需重复申请');
      assertProjectOpen(visible.payload, ctx.now());
      const positions = await db.query('SELECT * FROM project_positions WHERE id=$1 AND project_id=$2 AND enabled=true FOR UPDATE', [input.positionId, id]);
      if (!positions.rows[0]) throw new HttpError(409, 'POSITION_CLOSED', '岗位不存在或已停止招募');
      const count = await db.query<{ count: string }>("SELECT count(*) FROM project_members WHERE position_id=$1 AND status='ACTIVE'", [input.positionId]);
      if (Number(count.rows[0].count) >= positions.rows[0].capacity) throw new HttpError(409, 'POSITION_FULL', '该岗位名额已满');
      const result = await db.query(`INSERT INTO project_applications(project_id,position_id,user_id,motivation,portfolio_url,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(project_id,user_id) DO UPDATE SET position_id=EXCLUDED.position_id,motivation=EXCLUDED.motivation,
        portfolio_url=EXCLUDED.portfolio_url,status='PENDING',decision_reason='',reviewed_by=NULL,reviewed_at=NULL,
        revision=project_applications.revision+1,updated_at=EXCLUDED.updated_at RETURNING id`, [id, input.positionId, actor.user.id, input.motivation, input.portfolioUrl, ctx.now()]);
      await audit(db, actor.user.id, 'application.submit', 'projects', id, { applicationId: result.rows[0].id }, request.id);
      return ownApplication(db, ctx, actor, result.rows[0].id);
    }); return reply.code(201).send({ data });
  });
  routes.post('/api/v1/me/applications/:id/withdraw', async request => {
    const actor = requireActor(request), { id } = idParams.parse(request.params), input = revisionSchema.parse(request.body);
    const data = await inTransaction(ctx.db, async db => {
      const lookup = await db.query('SELECT project_id FROM project_applications WHERE id=$1 AND user_id=$2', [id, actor.user.id]);
      if (!lookup.rows[0]) throw new HttpError(404, 'NOT_FOUND', '申请不存在'); await loadContent(db, lookup.rows[0].project_id, true);
      const current = await db.query('SELECT * FROM project_applications WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, actor.user.id]), row = current.rows[0];
      if (row.status === 'WITHDRAWN') return ownApplication(db, ctx, actor, id);
      requireRevision(row, input.expectedRevision);
      if (row.status !== 'PENDING') throw new HttpError(409, 'APPLICATION_ALREADY_DECIDED', '仅可撤回待处理申请');
      await db.query("UPDATE project_applications SET status='WITHDRAWN',revision=revision+1,updated_at=$2 WHERE id=$1", [id, ctx.now()]);
      await audit(db, actor.user.id, 'application.withdraw', 'projects', row.project_id, { applicationId: id }, request.id);
      return ownApplication(db, ctx, actor, id);
    }); return { data };
  });
  routes.get('/api/v1/me/applications', async request => {
    const actor = requireActor(request, false), query = pagination.parse(request.query);
    const count = await ctx.db.query<{ count: string }>('SELECT count(*) FROM project_applications WHERE user_id=$1', [actor.user.id]);
    const rows = await ctx.db.query(`SELECT ${applicationColumns} ${applicationFrom} WHERE a.user_id=$1 ORDER BY a.updated_at DESC,a.id DESC LIMIT $2 OFFSET $3`, [actor.user.id, query.pageSize, (query.page - 1) * query.pageSize]);
    return { data: await Promise.all(rows.rows.map(async row => applicationDTO(await readableBusinessRow(ctx.db, ctx, actor, row)))), meta: { ...query, total: Number(count.rows[0].count) } };
  });
  routes.get('/api/v1/me/projects', async request => {
    const actor = requireActor(request, false), query = pagination.parse(request.query);
    const count = await ctx.db.query<{ count: string }>('SELECT count(*) FROM project_members WHERE user_id=$1', [actor.user.id]);
    const rows = await ctx.db.query(`SELECT ${memberColumns} ${memberFrom} WHERE m.user_id=$1 ORDER BY m.joined_at DESC,m.id DESC LIMIT $2 OFFSET $3`, [actor.user.id, query.pageSize, (query.page - 1) * query.pageSize]);
    return { data: await Promise.all(rows.rows.map(async row => memberDTO(await readableBusinessRow(ctx.db, ctx, actor, row)))), meta: { ...query, total: Number(count.rows[0].count) } };
  });
  routes.get('/api/v1/admin/applications', async request => {
    const actor = requireEditor(request), query = adminQuery.parse(request.query); managementUserFilter(actor, query);
    const values: unknown[] = [], where = [managementScopeSql(actor, 'manage', values)];
    const add = (sql: string, value: unknown) => { values.push(value); where.push(`${sql}=$${values.length}`); };
    if (query.userId) add('a.user_id', query.userId); if (query.projectId) add('a.project_id', query.projectId);
    if (query.status) add('a.status', z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']).parse(query.status));
    if (query.q) { values.push(`%${query.q}%`); where.push(`(u.display_name ILIKE $${values.length} OR ${publicTitle} ILIKE $${values.length})`); }
    const count = await ctx.db.query<{ count: string }>(`SELECT count(*) ${applicationFrom} WHERE ${where.join(' AND ')}`, values);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await ctx.db.query(`SELECT ${applicationColumns} ${applicationFrom} WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC,a.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { data: rows.rows.map(row => applicationDTO(row, true)), meta: { page: query.page, pageSize: query.pageSize, total: Number(count.rows[0].count) } };
  });
  routes.post('/api/v1/admin/applications/:id/decision', async request => {
    const actor = requireEditor(request), { id } = idParams.parse(request.params), input = decisionSchema.parse(request.body);
    const data = await inTransaction(ctx.db, async db => {
      const lookup = await db.query('SELECT project_id FROM project_applications WHERE id=$1', [id]);
      if (!lookup.rows[0]) throw new HttpError(404, 'NOT_FOUND', '申请不存在');
      const project = await materializeScheduled(db, ctx, await loadContent(db, lookup.rows[0].project_id, true)); assertManage(actor, managementTarget(project), 'manage');
      const current = await db.query('SELECT * FROM project_applications WHERE id=$1 FOR UPDATE', [id]), application = current.rows[0];
      if (application.status === input.decision) return applicationDTO((await db.query(`SELECT ${applicationColumns} ${applicationFrom} WHERE a.id=$1`, [id])).rows[0], true);
      requireRevision(application, input.expectedRevision);
      if (application.status !== 'PENDING') throw new HttpError(409, 'APPLICATION_ALREADY_DECIDED', '申请已处理或已撤回');
      await activeManagedPayload(db, ctx, project);
      if (input.decision === 'APPROVED') {
        const user = await db.query('SELECT status,email_verified_at FROM users WHERE id=$1 FOR SHARE', [application.user_id]);
        if (!user.rows[0] || user.rows[0].status !== 'ACTIVE' || !user.rows[0].email_verified_at) throw new HttpError(409, 'APPLICANT_INACTIVE', '申请人当前无法加入项目');
        const position = await db.query('SELECT * FROM project_positions WHERE id=$1 AND project_id=$2 FOR UPDATE', [application.position_id, project.id]);
        if (!position.rows[0]?.enabled) throw new HttpError(409, 'POSITION_CLOSED', '岗位已停止招募');
        const count = await db.query<{ count: string }>("SELECT count(*) FROM project_members WHERE position_id=$1 AND status='ACTIVE'", [application.position_id]);
        if (Number(count.rows[0].count) >= position.rows[0].capacity) throw new HttpError(409, 'POSITION_FULL', '岗位名额已满');
        await db.query(`INSERT INTO project_members(project_id,position_id,user_id,application_id,joined_at) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(project_id,user_id) DO UPDATE SET position_id=EXCLUDED.position_id,application_id=EXCLUDED.application_id,status='ACTIVE',joined_at=EXCLUDED.joined_at,left_at=NULL`, [project.id, application.position_id, application.user_id, id, ctx.now()]);
      }
      await db.query('UPDATE project_applications SET status=$2,decision_reason=$3,reviewed_by=$4,reviewed_at=$5,revision=revision+1,updated_at=$5 WHERE id=$1', [id, input.decision, input.reason, actor.user.id, ctx.now()]);
      await notifyUser(db, application.user_id, 'APPLICATION_RESULT', input.decision === 'APPROVED' ? '项目申请已批准' : '项目申请未通过', input.reason || '请在个人中心查看处理结果。', project.id, `application:${id}:${application.revision + 1}`, ctx.now());
      await audit(db, actor.user.id, 'application.decision', 'projects', project.id, { applicationId: id, decision: input.decision }, request.id);
      return applicationDTO((await db.query(`SELECT ${applicationColumns} ${applicationFrom} WHERE a.id=$1`, [id])).rows[0], true);
    }); return { data };
  });
  routes.get('/api/v1/admin/projects/:id/members', async request => {
    const actor = requireEditor(request), { id } = idParams.parse(request.params), query = pagination.parse(request.query), row = await loadContent(ctx.db, id);
    if (row.kind !== 'projects') throw new HttpError(404, 'NOT_FOUND', '项目不存在'); assertManage(actor, managementTarget(row), 'manage');
    const count = await ctx.db.query<{ count: string }>('SELECT count(*) FROM project_members WHERE project_id=$1', [id]);
    const result = await ctx.db.query(`SELECT ${memberColumns} ${memberFrom} WHERE m.project_id=$1 ORDER BY m.joined_at DESC,m.id DESC LIMIT $2 OFFSET $3`, [id, query.pageSize, (query.page - 1) * query.pageSize]);
    return { data: result.rows.map(row => memberDTO(row, true)), meta: { ...query, total: Number(count.rows[0].count) } };
  });
  routes.patch('/api/v1/admin/projects/:id/members/:userId', async request => {
    const actor = requireEditor(request), { id, userId } = idParams.extend({ userId: idSchema }).parse(request.params), input = z.strictObject({ status: z.enum(['LEFT', 'REMOVED']) }).parse(request.body);
    const data = await inTransaction(ctx.db, async db => {
      const project = await loadContent(db, id, true); assertManage(actor, managementTarget(project), 'manage');
      const result = await db.query('SELECT * FROM project_members WHERE project_id=$1 AND user_id=$2 FOR UPDATE', [id, userId]), member = result.rows[0];
      if (!member) throw new HttpError(404, 'NOT_FOUND', '成员不存在');
      if (member.status !== input.status) {
        if (member.status !== 'ACTIVE') throw new HttpError(409, 'MEMBER_NOT_ACTIVE', '成员已经离开项目');
        await db.query('UPDATE project_members SET status=$3,left_at=$4 WHERE project_id=$1 AND user_id=$2', [id, userId, input.status, ctx.now()]);
        await audit(db, actor.user.id, 'member.remove', 'projects', id, { userId, status: input.status }, request.id);
        await notifyUser(db, userId, 'PROJECT_MEMBERSHIP', '项目成员状态已更新', input.status === 'LEFT' ? '已登记离开项目。' : '管理员已移除你的项目成员身份。', id, `membership:${member.id}:${ctx.now().toISOString()}`, ctx.now());
      }
      return memberDTO((await db.query(`SELECT ${memberColumns} ${memberFrom} WHERE m.project_id=$1 AND m.user_id=$2`, [id, userId])).rows[0], true);
    }); return { data };
  });

  routes.post('/api/v1/events/:id/registrations', async request => {
    const actor = requireActor(request), { id } = idParams.parse(request.params); z.strictObject({}).parse(request.body ?? {});
    const data = await inTransaction(ctx.db, async db => {
      const row = await materializeScheduled(db, ctx, await loadContent(db, id, true)), content = await getVisibleContent(db, id, actor, ctx.now());
      if (row.kind !== 'events' || !content) throw new HttpError(404, 'NOT_FOUND', '活动不存在或不可访问');
      const prior = await db.query('SELECT status FROM event_registrations WHERE event_id=$1 AND user_id=$2', [id, actor.user.id]);
      if (prior.rows[0]?.status === 'REGISTERED') return ownRegistration(db, ctx, actor, id);
      checkRegistrationWindow(content.payload, ctx.now());
      const count = await db.query<{ count: string }>("SELECT count(*) FROM event_registrations WHERE event_id=$1 AND status='REGISTERED'", [id]);
      if (Number(count.rows[0].count) >= Number(content.payload.details.capacity)) throw new HttpError(409, 'EVENT_FULL', '活动名额已满');
      await db.query(`INSERT INTO event_registrations(event_id,user_id,created_at,updated_at) VALUES($1,$2,$3,$3)
        ON CONFLICT(event_id,user_id) DO UPDATE SET status='REGISTERED',updated_at=EXCLUDED.updated_at`, [id, actor.user.id, ctx.now()]);
      await audit(db, actor.user.id, 'event.register', 'events', id, {}, request.id); return ownRegistration(db, ctx, actor, id);
    }); return { data };
  });
  routes.delete('/api/v1/events/:id/registrations', async request => {
    const actor = requireActor(request), { id } = idParams.parse(request.params); z.strictObject({}).parse(request.body ?? {});
    const data = await inTransaction(ctx.db, async db => {
      const row = await materializeScheduled(db, ctx, await loadContent(db, id, true));
      const prior = await db.query('SELECT * FROM event_registrations WHERE event_id=$1 AND user_id=$2 FOR UPDATE', [id, actor.user.id]);
      if (!prior.rows[0]) throw new HttpError(404, 'NOT_FOUND', '报名不存在');
      if (prior.rows[0].status === 'CANCELLED') return ownRegistration(db, ctx, actor, id);
      const version = row.published_version_id ? await db.query<{ payload: ContentPayload }>('SELECT payload FROM content_versions WHERE id=$1', [row.published_version_id]) : null;
      const d = version?.rows[0]?.payload.details;
      if (d && d.eventStatus !== 'CANCELLED' && !['WITHDRAWN', 'ARCHIVED'].includes(row.state)) {
        const deadline = d.cancellationDeadline || d.startsAt;
        if (deadline && new Date(deadline as string) <= ctx.now()) throw new HttpError(409, 'CANCELLATION_CLOSED', '已超过允许取消报名的时间');
      }
      await db.query("UPDATE event_registrations SET status='CANCELLED',updated_at=$3 WHERE event_id=$1 AND user_id=$2", [id, actor.user.id, ctx.now()]);
      await audit(db, actor.user.id, 'event.cancel-registration', 'events', id, {}, request.id); return ownRegistration(db, ctx, actor, id);
    }); return { data };
  });
  routes.get('/api/v1/me/registrations', async request => {
    const actor = requireActor(request, false), query = pagination.parse(request.query);
    const count = await ctx.db.query<{ count: string }>('SELECT count(*) FROM event_registrations WHERE user_id=$1', [actor.user.id]);
    const result = await ctx.db.query(`SELECT ${registrationColumns} ${registrationFrom} WHERE r.user_id=$1 ORDER BY r.updated_at DESC,r.id DESC LIMIT $2 OFFSET $3`, [actor.user.id, query.pageSize, (query.page - 1) * query.pageSize]);
    return { data: await Promise.all(result.rows.map(async row => registrationDTO(await readableBusinessRow(ctx.db, ctx, actor, row)))), meta: { ...query, total: Number(count.rows[0].count) } };
  });
  routes.get('/api/v1/admin/registrations', async request => {
    const actor = requireEditor(request), query = adminQuery.parse(request.query); managementUserFilter(actor, query);
    const values: unknown[] = [], where = [managementScopeSql(actor, 'manage', values)];
    const add = (sql: string, value: unknown) => { values.push(value); where.push(`${sql}=$${values.length}`); };
    if (query.userId) add('r.user_id', query.userId); if (query.eventId) add('r.event_id', query.eventId);
    if (query.status) add('r.status', z.enum(['REGISTERED', 'CANCELLED']).parse(query.status));
    if (query.q) { values.push(`%${query.q}%`); where.push(`(u.display_name ILIKE $${values.length} OR ${publicTitle} ILIKE $${values.length})`); }
    const count = await ctx.db.query<{ count: string }>(`SELECT count(*) ${registrationFrom} WHERE ${where.join(' AND ')}`, values);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await ctx.db.query(`SELECT ${registrationColumns} ${registrationFrom} WHERE ${where.join(' AND ')} ORDER BY r.updated_at DESC,r.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { data: rows.rows.map(row => registrationDTO(row, true)), meta: { page: query.page, pageSize: query.pageSize, total: Number(count.rows[0].count) } };
  });

  routes.get('/api/v1/me/works', async request => {
    const actor = requireActor(request, false), query = pagination.parse(request.query);
    const count = await ctx.db.query<{ count: string }>("SELECT count(*) FROM contents WHERE owner_id=$1 AND kind='works'", [actor.user.id]);
    const rows = await ctx.db.query<{ id: string }>("SELECT id FROM contents WHERE owner_id=$1 AND kind='works' ORDER BY updated_at DESC,id DESC LIMIT $2 OFFSET $3", [actor.user.id, query.pageSize, (query.page - 1) * query.pageSize]);
    return { data: await Promise.all(rows.rows.map(async row => adminContentDTO(ctx.db, await loadContent(ctx.db, row.id)))), meta: { ...query, total: Number(count.rows[0].count) } };
  });
  routes.post('/api/v1/me/works', async (request, reply) => {
    const actor = requireActor(request), input = z.strictObject({ payload: z.unknown() }).parse(request.body);
    return reply.code(201).send({ data: await createWorkDraft(ctx, actor, input.payload) });
  });
  routes.patch('/api/v1/me/works/:id', async request => {
    const actor = requireActor(request), { id } = idParams.parse(request.params), input = editContentSchema.parse(request.body);
    return { data: await editWorkDraft(ctx, actor, id, input.expectedRevision, input.payload) };
  });
  routes.post('/api/v1/me/works/:id/submit', async request => {
    const actor = requireActor(request), { id } = idParams.parse(request.params), input = revisionSchema.parse(request.body);
    const data = await inTransaction(ctx.db, async db => {
      const row = await loadContent(db, id, true);
      if (row.kind !== 'works' || row.owner_id !== actor.user.id) throw new HttpError(404, 'NOT_FOUND', '投稿不存在');
      if (row.state === 'REVIEW') return adminContentDTO(db, row);
      requireRevision(row, input.expectedRevision);
      if (row.published_version_id || !['DRAFT', 'RETURNED'].includes(row.state)) throw new HttpError(409, 'WORK_NOT_SUBMITTABLE', '此投稿当前不可提交审核');
      await db.query("UPDATE contents SET state='REVIEW',review_reason='',revision=revision+1,updated_at=$2 WHERE id=$1", [id, ctx.now()]);
      await audit(db, actor.user.id, 'work.submit', 'works', id, {}, request.id); return adminContentDTO(db, await loadContent(db, id));
    }); return { data };
  });
}
