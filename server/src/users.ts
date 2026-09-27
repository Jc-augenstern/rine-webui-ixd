import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { contentKinds, directionSchema, idSchema, profileSchema, roles, type ContentKind, type ContentPayload } from '../../shared/platform.js';
import type { AppContext } from './context.js';
import { requireActor, requireAdmin, requireEditor, canManage } from './security.js';
import { safeUser, safeUserColumns, getActor, type UserRow } from './user-record.js';
import { inTransaction } from './db.js';
import { HttpError } from './errors.js';
import { audit } from './audit.js';
import { revokeSessions } from './session-store.js';

const paging = z.strictObject({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), q: z.string().max(200).default('') });
const userQuery = paging.extend({ role: z.enum(roles).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional(), memberStatus: z.enum(['NONE', 'MEMBER']).optional(), direction: directionSchema.optional() });
const userEdit = z.strictObject({ expectedRevision: z.number().int().positive(), role: z.enum(roles), status: z.enum(['ACTIVE', 'DISABLED']), memberStatus: z.enum(['NONE', 'MEMBER']) });
const grantsEdit = z.strictObject({ expectedRevision: z.number().int().positive(), grants: z.array(z.strictObject({ contentKind: z.enum(contentKinds), directionId: directionSchema.nullable(), contentId: idSchema.nullable(), actions: z.array(z.enum(['create', 'read', 'update', 'publish', 'archive', 'delete', 'manage'])).min(1).max(7) }).refine(g => !g.directionId || !g.contentId, '方向和具体内容只能选其一')).max(200) });
const targetId = (params: unknown) => z.strictObject({ id: idSchema }).parse(params).id;
function revision(actual: number, expected: number) { if (actual !== expected) throw new HttpError(409, 'REVISION_CONFLICT', '资料已被其他管理员修改，请保留输入并重新读取'); }

export async function registerUserRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/v1/me', async request => ({ data: requireActor(request, false).user }));
  app.patch('/api/v1/me', async request => {
    const actor = requireActor(request, false);
    const input = profileSchema.parse(request.body);
    const result = await ctx.db.query<UserRow>(`UPDATE users SET display_name=$2,grade=$3,major=$4,direction_ids=$5,profile_version=profile_version+1,updated_at=$6
      WHERE id=$1 AND profile_version=$7 RETURNING ${safeUserColumns}`, [actor.user.id, input.displayName, input.grade, input.major, [...new Set(input.directionIds)], ctx.now(), input.expectedRevision]);
    if (!result.rowCount) throw new HttpError(409, 'REVISION_CONFLICT', '资料已更改，请重新读取后保存');
    return { data: safeUser(result.rows[0]) };
  });
  app.get('/api/v1/admin/users', async request => {
    requireAdmin(request);
    const query = userQuery.parse(request.query);
    const values = [`%${query.q}%`, query.role || null, query.status || null, query.memberStatus || null, query.direction || null];
    const where = `(username ILIKE $1 OR display_name ILIKE $1 OR email ILIKE $1) AND ($2::text IS NULL OR role=$2) AND ($3::text IS NULL OR status=$3) AND ($4::text IS NULL OR member_status=$4) AND ($5::text IS NULL OR $5=ANY(direction_ids))`;
    const count = await ctx.db.query(`SELECT count(*)::int AS n FROM users WHERE ${where}`, values);
    const result = await ctx.db.query<UserRow>(`SELECT ${safeUserColumns} FROM users WHERE ${where} ORDER BY created_at DESC,id LIMIT $6 OFFSET $7`, [...values, query.pageSize, (query.page - 1) * query.pageSize]);
    return { data: result.rows.map(safeUser), meta: { page: query.page, pageSize: query.pageSize, total: count.rows[0].n } };
  });
  app.get('/api/v1/admin/users/:id', async request => {
    requireAdmin(request); const id = targetId(request.params);
    const result = await ctx.db.query<UserRow>(`SELECT ${safeUserColumns} FROM users WHERE id=$1`, [id]);
    if (!result.rowCount) throw new HttpError(404, 'NOT_FOUND', '账号不存在');
    const grants = await ctx.db.query('SELECT id,content_kind AS "contentKind",direction_id AS "directionId",content_id AS "contentId",actions FROM editor_grants WHERE user_id=$1 ORDER BY id', [id]);
    return { data: { user: safeUser(result.rows[0]), grants: grants.rows } };
  });
  app.patch('/api/v1/admin/users/:id', async request => {
    const actor = requireAdmin(request), id = targetId(request.params), input = userEdit.parse(request.body);
    return inTransaction(ctx.db, async db => {
      // All admin removals serialize on one transaction lock, including changes to different users.
      await db.query("SELECT pg_advisory_xact_lock(hashtext('ixd-active-admins'))");
      const current = await db.query<UserRow>(`SELECT ${safeUserColumns} FROM users WHERE id=$1 FOR UPDATE`, [id]);
      const row = current.rows[0]; if (!row) throw new HttpError(404, 'NOT_FOUND', '账号不存在');
      revision(row.profile_version, input.expectedRevision);
      if (input.role === 'ADMIN' && input.status === 'ACTIVE' && !row.email_verified_at) throw new HttpError(400, 'ADMIN_EMAIL_REQUIRED', '提升管理员前须先验证该账号邮箱');
      if (row.role === 'ADMIN' && row.status === 'ACTIVE' && row.email_verified_at && (input.role !== 'ADMIN' || input.status !== 'ACTIVE')) {
        const count = await db.query("SELECT count(*)::int AS n FROM users WHERE role='ADMIN' AND status='ACTIVE' AND email_verified_at IS NOT NULL");
        if (count.rows[0].n < 2) throw new HttpError(409, 'LAST_ADMIN', '不能停用或降级最后一个有效管理员');
      }
      // A concurrent manager may have lost privileges while waiting for this lock.
      const live = await getActor(db, actor.user.id);
      if (live?.user.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', '管理员权限已失效');
      const result = await db.query<UserRow>(`UPDATE users SET role=$2,status=$3,member_status=$4,profile_version=profile_version+1,auth_version=auth_version+1,updated_at=$5 WHERE id=$1 RETURNING ${safeUserColumns}`, [id, input.role, input.status, input.memberStatus, ctx.now()]);
      await revokeSessions(db, id, ctx.now());
      await audit(db, actor.user.id, 'UPDATE_USER_ACCESS', 'user', id, { before: { role: row.role, status: row.status, memberStatus: row.member_status }, after: { role: input.role, status: input.status, memberStatus: input.memberStatus } }, request.id);
      return { data: safeUser(result.rows[0]) };
    });
  });
  app.put('/api/v1/admin/users/:id/grants', async request => {
    const actor = requireAdmin(request), id = targetId(request.params), input = grantsEdit.parse(request.body);
    return inTransaction(ctx.db, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('ixd-active-admins'))");
      const live = await getActor(db, actor.user.id);
      if (live?.user.role !== 'ADMIN' || !live.user.emailVerified) throw new HttpError(403, 'FORBIDDEN', '管理员权限已失效');
      const current = await db.query<UserRow>(`SELECT ${safeUserColumns} FROM users WHERE id=$1 FOR UPDATE`, [id]);
      if (!current.rowCount) throw new HttpError(404, 'NOT_FOUND', '账号不存在');
      revision(current.rows[0].profile_version, input.expectedRevision);
      if (current.rows[0].role !== 'EDITOR') throw new HttpError(400, 'EDITOR_REQUIRED', '授权清单只适用于 EDITOR 账号');
      await db.query('DELETE FROM editor_grants WHERE user_id=$1', [id]);
      for (const grant of input.grants) {
        if (grant.contentId) {
          const content = await db.query('SELECT id FROM contents WHERE id=$1 AND kind=$2', [grant.contentId, grant.contentKind]);
          if (!content.rowCount) throw new HttpError(400, 'INVALID_SCOPE', '授权内容不存在或栏目不匹配');
        }
        await db.query('INSERT INTO editor_grants(user_id,content_kind,direction_id,content_id,actions) VALUES($1,$2,$3,$4,$5)', [id, grant.contentKind, grant.directionId, grant.contentId, [...new Set(grant.actions)]]);
      }
      await db.query('UPDATE users SET profile_version=profile_version+1,auth_version=auth_version+1,updated_at=$2 WHERE id=$1', [id, ctx.now()]);
      await revokeSessions(db, id, ctx.now());
      await audit(db, actor.user.id, 'UPDATE_GRANTS', 'user', id, { grants: input.grants }, request.id);
      const grants = await db.query('SELECT id,content_kind AS "contentKind",direction_id AS "directionId",content_id AS "contentId",actions FROM editor_grants WHERE user_id=$1 ORDER BY id', [id]);
      return { data: { user: safeUser({ ...current.rows[0], profile_version: current.rows[0].profile_version + 1 }), grants: grants.rows } };
    });
  });
  app.post('/api/v1/admin/users/:id/revoke-sessions', async request => {
    const actor = requireAdmin(request), id = targetId(request.params);
    await inTransaction(ctx.db, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('ixd-active-admins'))");
      const live = await getActor(db, actor.user.id);
      if (live?.user.role !== 'ADMIN' || !live.user.emailVerified) throw new HttpError(403, 'FORBIDDEN', '管理员权限已失效');
      const changed = await db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1 RETURNING id', [id]);
      if (!changed.rowCount) throw new HttpError(404, 'NOT_FOUND', '账号不存在');
      await revokeSessions(db, id, ctx.now()); await audit(db, actor.user.id, 'REVOKE_ACCESS', 'user', id, {}, request.id);
    });
    return { data: { message: '现有会话已撤销' } };
  });
  app.get('/api/v1/admin/audit', async request => {
    requireAdmin(request); const query = paging.parse(request.query);
    const count = await ctx.db.query('SELECT count(*)::int AS n FROM audit_logs WHERE action ILIKE $1 OR resource_type ILIKE $1', [`%${query.q}%`]);
    const rows = await ctx.db.query(`SELECT a.id,a.actor_id AS "actorId",u.display_name AS "actorName",a.action,a.resource_type AS "resourceType",a.resource_id AS "resourceId",a.changes,a.created_at AS "createdAt"
      FROM audit_logs a LEFT JOIN users u ON a.actor_id=u.id WHERE a.action ILIKE $1 OR a.resource_type ILIKE $1 ORDER BY a.created_at DESC,a.id LIMIT $2 OFFSET $3`, [`%${query.q}%`, query.pageSize, (query.page - 1) * query.pageSize]);
    return { data: rows.rows, meta: { page: query.page, pageSize: query.pageSize, total: count.rows[0].n } };
  });
  app.get('/api/v1/admin/overview', async request => {
    const actor = requireEditor(request);
    const contents = await ctx.db.query<{ id: string; kind: ContentKind; state: string; payload: ContentPayload }>('SELECT c.id,c.kind,c.state,v.payload FROM contents c JOIN content_versions v ON v.id=c.draft_version_id');
    const counts = Object.fromEntries(contentKinds.map(kind => [kind, 0])) as Record<ContentKind, number>;
    let pendingWorks = 0;
    const projectIds: string[] = [];
    for (const row of contents.rows) {
      if (canManage(actor, { id: row.id, kind: row.kind, directionIds: row.payload.directionIds }, 'read')) { counts[row.kind]++; if (row.kind === 'works' && row.state === 'REVIEW') pendingWorks++; }
      if (row.kind === 'projects' && canManage(actor, { id: row.id, kind: row.kind, directionIds: row.payload.directionIds }, 'manage')) projectIds.push(row.id);
    }
    const applications = await ctx.db.query("SELECT count(*)::int AS n FROM project_applications WHERE status='PENDING' AND project_id=ANY($1::uuid[])", [projectIds]);
    const users = actor.user.role === 'ADMIN' ? (await ctx.db.query('SELECT count(*)::int AS n FROM users')).rows[0].n : undefined;
    return { data: { counts, pendingWorks, pendingApplications: applications.rows[0].n, ...(users === undefined ? {} : { users }) } };
  });
}
