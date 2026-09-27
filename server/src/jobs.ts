import { randomUUID } from 'node:crypto';
import type { DateValue, SafeUser } from '../../shared/platform.js';
import type { AppContext } from './context.js';
import { inTransaction, type Database } from './db.js';
import { getVisibleContent, loadContent, materializeScheduled } from './content.js';
import { deadlineFingerprint, deadlineKinds, deadlineTime, notifyUser } from './content-notifications.js';
import { LocalStorage } from './storage.js';

interface JobRow { id: string; kind: string; payload: Record<string, unknown>; dedupe_key: string; attempts: number; max_attempts: number; locked_by: string; status: string }
const workerId = randomUUID();
function userDTO(row: Record<string, any>): SafeUser {
  return { id: row.id, username: row.username, email: row.email, displayName: row.display_name, role: row.role, status: row.status,
    memberStatus: row.member_status, emailVerified: Boolean(row.email_verified_at), grade: row.grade, major: row.major,
    directionIds: row.direction_ids, profileVersion: row.profile_version, createdAt: row.created_at.toISOString() };
}
async function finish(db: Database, ctx: AppContext, job: JobRow, status: 'DONE' | 'CANCELLED') {
  await db.query(`UPDATE jobs SET status=$2,finished_at=$3,updated_at=$3,locked_at=NULL,locked_by=NULL,lease_expires_at=NULL
    WHERE id=$1 AND locked_by=$4`, [job.id, status, ctx.now(), workerId]);
}
async function executeJob(db: Database, ctx: AppContext, claimed: JobRow) {
  if (claimed.kind === 'MEDIA_DELETE') {
    const current = await db.query<JobRow>('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [claimed.id]), job = current.rows[0];
    if (!job || job.status !== 'RUNNING' || job.locked_by !== workerId) return;
    try { await new LocalStorage(ctx.config.storagePath).remove(String(job.payload.storageKey ?? '')); }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
    // Metadata was already committed as deleted; retrying a completed unlink is safe.
    await finish(db, ctx, job, 'DONE'); return;
  }
  // Content-before-job matches publishing/favorites and avoids opposite lock order.
  const contentId = String(claimed.payload.contentId ?? '');
  const content = contentId ? await loadContent(db, contentId, true).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null;
    throw error;
  }) : null;
  const current = await db.query<JobRow>('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [claimed.id]), job = current.rows[0];
  if (!job || job.status !== 'RUNNING' || job.locked_by !== workerId) return;
  if (!content) { await finish(db, ctx, job, 'CANCELLED'); return; }
  if (job.kind === 'IMPORTANT_ANNOUNCEMENT') {
    if (content.kind !== 'announcements' || content.attention_revision !== Number(job.payload.attentionRevision)) { await finish(db, ctx, job, 'CANCELLED'); return; }
    const recipients = await db.query(`SELECT id,username,email,display_name,role,status,member_status,email_verified_at,grade,major,direction_ids,profile_version,created_at
      FROM users WHERE status='ACTIVE' AND email_verified_at IS NOT NULL ORDER BY id`);
    for (const row of recipients.rows) {
      const visible = await getVisibleContent(db, content.id, { user: userDTO(row), grants: [] }, ctx.now());
      if (!visible) continue;
      await notifyUser(db, row.id, 'IMPORTANT_ANNOUNCEMENT', `重要公告：${visible.payload.title}`, visible.payload.summary || '请查看公告详情。', content.id, `announcement:${content.id}:${job.payload.attentionRevision}`, ctx.now());
    }
    await finish(db, ctx, job, 'DONE'); return;
  }
  if (job.kind === 'COMPETITION_DEADLINE') {
    const userId = String(job.payload.userId ?? ''), kind = String(job.payload.deadlineKind ?? '');
    if (!deadlineKinds.includes(kind as typeof deadlineKinds[number])) throw new Error('Invalid deadline kind');
    const users = await db.query(`SELECT id,username,email,display_name,role,status,member_status,email_verified_at,grade,major,direction_ids,profile_version,created_at
      FROM users WHERE id=$1 AND status='ACTIVE' AND email_verified_at IS NOT NULL`, [userId]);
    const favorite = await db.query<{ reminder_hours: number[] }>('SELECT reminder_hours FROM favorites WHERE user_id=$1 AND content_id=$2', [userId, content.id]);
    const visible = users.rows[0] ? await getVisibleContent(db, content.id, { user: userDTO(users.rows[0]), grants: [] }, ctx.now()) : null;
    const value = visible?.payload.details[kind] as DateValue | undefined, end = value && deadlineTime(value);
    if (!visible || visible.kind !== 'competitions' || !favorite.rows[0]?.reminder_hours.includes(Number(job.payload.hours))
      || !value || !end || end <= ctx.now() || deadlineFingerprint(value) !== job.payload.fingerprint) { await finish(db, ctx, job, 'CANCELLED'); return; }
    const label = { registrationEnd: '官方报名', internalDeadline: '学校/社团内部材料', submissionDeadline: '作品提交' }[kind as typeof deadlineKinds[number]];
    const time = value.precision === 'date' ? `${value.date}（仅公布日期）` : `${value.at}（${value.timeZone}）`;
    await notifyUser(db, userId, 'COMPETITION_DEADLINE', `赛事截止提醒：${visible.payload.title}`, `${label}截止：${time}。请查看赛事详情及官网最新信息。`, content.id, job.dedupe_key, ctx.now());
    await finish(db, ctx, job, 'DONE'); return;
  }
  throw new Error('Unsupported persistent job kind');
}

/** Deterministic test entry: reads ctx.now(), never changes the OS clock. */
export async function runDueJobs(ctx: AppContext): Promise<{ published: number; processed: number; failed: number }> {
  const result = { published: 0, processed: 0, failed: 0 }, now = ctx.now();
  await ctx.db.query(`UPDATE jobs SET status='FAILED',finished_at=$1,updated_at=$1,last_error='retry limit reached'
    WHERE status='RUNNING' AND lease_expires_at <= $1 AND attempts >= max_attempts`, [now]);
  // The schedule is durable in contents even if the worker was offline at its due time.
  const due = await ctx.db.query<{ id: string }>(`SELECT id FROM contents WHERE scheduled_version_id IS NOT NULL AND publish_at <= $1
    ORDER BY publish_at,id LIMIT 100`, [now]);
  for (const item of due.rows) {
    try {
      await inTransaction(ctx.db, async db => {
        const locked = await db.query('SELECT id FROM contents WHERE id=$1 FOR UPDATE SKIP LOCKED', [item.id]);
        if (!locked.rowCount) return;
        const row = await loadContent(db, item.id);
        if (row.scheduled_version_id && row.publish_at && row.publish_at <= ctx.now()) { await materializeScheduled(db, ctx, row); result.published++; }
      });
    } catch { result.failed++; }
  }
  for (let iteration = 0; iteration < 100; iteration++) {
    const claimed = await inTransaction(ctx.db, async db => {
      const candidate = await db.query<JobRow>(`SELECT * FROM jobs WHERE attempts < max_attempts
        AND ((status='PENDING' AND run_at <= $1) OR (status='RUNNING' AND lease_expires_at <= $1))
        ORDER BY run_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, [ctx.now()]);
      if (!candidate.rows[0]) return null;
      const job = candidate.rows[0];
      const updated = await db.query<JobRow>(`UPDATE jobs SET status='RUNNING',attempts=attempts+1,locked_at=$2,
        locked_by=$3,lease_expires_at=$4,updated_at=$2 WHERE id=$1 RETURNING *`, [job.id, ctx.now(), workerId, new Date(ctx.now().getTime() + 30_000)]);
      return updated.rows[0];
    });
    if (!claimed) break;
    try { await inTransaction(ctx.db, db => executeJob(db, ctx, claimed)); result.processed++; }
    catch (error) {
      result.failed++;
      const exhausted = claimed.attempts >= claimed.max_attempts;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code).slice(0, 80) : 'JOB_PROCESSING_ERROR';
      await ctx.db.query(`UPDATE jobs SET status=$2,last_error=$3,run_at=$4,finished_at=$5,locked_at=NULL,locked_by=NULL,
        lease_expires_at=NULL,updated_at=$6 WHERE id=$1 AND status='RUNNING' AND locked_by=$7`,
      [claimed.id, exhausted ? 'FAILED' : 'PENDING', code, new Date(ctx.now().getTime() + Math.min(300_000, 1000 * 2 ** claimed.attempts)), exhausted ? ctx.now() : null, ctx.now(), workerId]);
    }
  }
  return result;
}

export function startJobs(ctx: AppContext): () => Promise<void> {
  let stopped = false, running: Promise<unknown> | null = null;
  const tick = () => {
    if (stopped || running) return;
    running = runDueJobs(ctx).then(result => {
      if (result.failed) console.error(`[ixd-jobs] ${result.failed} task(s) failed; inspect persisted job status and retry records.`);
    }).catch(() => { console.error('[ixd-jobs] Worker cycle unavailable; retrying on the next cycle.'); }).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 1000); timer.unref(); tick();
  return async () => { stopped = true; clearInterval(timer); if (running) await running; };
}
