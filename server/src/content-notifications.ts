import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DateTime } from 'luxon';
import type { ContentPayload, DateValue } from '../../shared/platform.js';

export type Database = Pool | PoolClient;
export const deadlineKinds = ['registrationEnd', 'internalDeadline', 'submissionDeadline'] as const;
export type DeadlineKind = typeof deadlineKinds[number];

/** Date-only deadlines stay date-only in DTOs; this is a documented reminder clock. */
export function deadlineTime(value: DateValue, reminder = false): Date | null {
  if (value.precision === 'unknown') return null;
  const dt = value.precision === 'datetime'
    ? DateTime.fromISO(value.at!, { setZone: true })
    : reminder ? DateTime.fromISO(value.date!, { zone: value.timeZone }).set({ hour: 9 })
      : DateTime.fromISO(value.date!, { zone: value.timeZone }).endOf('day');
  return dt.isValid ? dt.toJSDate() : null;
}
export function deadlineFingerprint(value: DateValue): string {
  const canonical = value.precision === 'datetime' ? ['datetime', new Date(value.at!).toISOString()] : [value.precision, value.date, value.timeZone];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24);
}
export async function notifyUser(db: Database, userId: string, type: string, title: string, body: string, contentId: string | null, dedupeKey: string, now: Date) {
  await db.query(`INSERT INTO notifications(user_id,type,title,body,content_id,dedupe_key,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,dedupe_key) DO NOTHING`,
  [userId, type, title.slice(0, 200), body.slice(0, 4000), contentId, dedupeKey, now]);
}
export async function queueJob(db: Database, kind: string, payload: Record<string, unknown>, key: string, runAt: Date, now: Date) {
  await db.query(`INSERT INTO jobs(kind,payload,dedupe_key,run_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(dedupe_key) DO UPDATE SET payload=EXCLUDED.payload,
    run_at=EXCLUDED.run_at,status='PENDING',attempts=0,finished_at=NULL,locked_at=NULL,locked_by=NULL,
    lease_expires_at=NULL,last_error=NULL,updated_at=EXCLUDED.updated_at WHERE jobs.status='CANCELLED'`, [kind, payload, key, runAt, now]);
}
export async function cancelContentJobs(db: Database, contentId: string, now: Date) {
  await db.query(`UPDATE jobs SET status='CANCELLED',finished_at=$2,updated_at=$2
    WHERE payload->>'contentId'=$1 AND status IN ('PENDING','RUNNING')`, [contentId, now]);
}

/** Called under the content row lock, after publish or an explicit favorite change. */
export async function reconcileCompetitionJobs(db: Database, contentId: string, payload: ContentPayload | null, now: Date, onlyUserId?: string) {
  const favorites = payload ? await db.query<{ user_id: string; reminder_hours: number[] }>(
    `SELECT f.user_id,f.reminder_hours FROM favorites f JOIN users u ON u.id=f.user_id
     WHERE f.content_id=$1 AND u.status='ACTIVE' ${onlyUserId ? 'AND f.user_id=$2' : ''}`, onlyUserId ? [contentId, onlyUserId] : [contentId]) : { rows: [] };
  const expected: string[] = [];
  for (const favorite of favorites.rows) {
    for (const deadlineKind of deadlineKinds) {
      const date = payload!.details[deadlineKind] as DateValue;
      const target = date && deadlineTime(date, true);
      const end = date && deadlineTime(date);
      if (!target || !end || end.getTime() <= now.getTime()) continue;
      const fingerprint = deadlineFingerprint(date);
      for (const hours of new Set(favorite.reminder_hours)) {
        const key = `deadline:${favorite.user_id}:${contentId}:${deadlineKind}:${fingerprint}:${hours}`;
        expected.push(key);
        const due = new Date(target.getTime() - hours * 3_600_000);
        // Do not bombard a late favorite with every already-missed reminder tier.
        if (due.getTime() < now.getTime()) continue;
        await queueJob(db, 'COMPETITION_DEADLINE', { contentId, userId: favorite.user_id, deadlineKind, fingerprint, hours }, key, due, now);
      }
    }
  }
  await db.query(`UPDATE jobs SET status='CANCELLED',finished_at=$2,updated_at=$2
    WHERE kind='COMPETITION_DEADLINE' AND payload->>'contentId'=$1
    AND status IN ('PENDING','RUNNING') AND NOT(dedupe_key=ANY($3::text[]))
    ${onlyUserId ? "AND payload->>'userId'=$4" : ''}`, onlyUserId ? [contentId, now, expected, onlyUserId] : [contentId, now, expected]);
}
