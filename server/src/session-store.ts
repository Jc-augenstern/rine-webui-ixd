import { createHash } from 'node:crypto';
import type { Session } from 'fastify';
import type { SessionStore } from '@fastify/session';
import type { Pool } from 'pg';
import type { Database } from './db.js';
const hashSid = (sid: string) => createHash('sha256').update(sid).digest('hex');
export class PgSessionStore implements SessionStore {
  constructor(private db: Pool, private now: () => Date, private maxAge: number) {}
  get(sid: string, callback: (error: unknown, session?: Session | null) => void) {
    this.db.query('SELECT data FROM sessions WHERE sid=$1 AND revoked_at IS NULL AND expires_at>$2', [hashSid(sid), this.now()])
      .then(result => callback(null, result.rows[0]?.data || null), error => callback(error));
  }
  set(sid: string, session: Session, callback: (error?: unknown) => void) {
    // Explicit fields prevent opaque plugin identifiers from entering the JSON payload.
    const data = { cookie: session.cookie, userId: session.userId, userVersion: session.userVersion, _csrf: (session as Session & { _csrf?: string })._csrf };
    const expires = session.cookie.expires ? new Date(session.cookie.expires) : new Date(this.now().getTime() + this.maxAge);
    this.db.query(`INSERT INTO sessions(sid,data,user_id,expires_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(sid) DO UPDATE SET data=excluded.data,user_id=excluded.user_id,expires_at=excluded.expires_at WHERE sessions.revoked_at IS NULL`,
      [hashSid(sid), JSON.stringify(data), session.userId || null, expires]).then(() => callback(), error => callback(error));
  }
  destroy(sid: string, callback: (error?: unknown) => void) {
    // Retain a tombstone even for an as-yet unsaved session: an in-flight request cannot recreate it.
    this.db.query(`INSERT INTO sessions(sid,data,expires_at,revoked_at) VALUES($1,'{}',$2,$3)
      ON CONFLICT(sid) DO UPDATE SET revoked_at=excluded.revoked_at`, [hashSid(sid), new Date(this.now().getTime() + this.maxAge), this.now()])
      .then(() => callback(), error => callback(error));
  }
}
export async function revokeSessions(db: Database, userId: string, now: Date) {
  await db.query('UPDATE sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL', [userId, now]);
}
