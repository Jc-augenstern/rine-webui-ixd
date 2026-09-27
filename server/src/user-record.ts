import type { SafeUser, EditorGrant } from '../../shared/platform.js';
import type { Database } from './db.js';
import type { Actor } from './context.js';
export const safeUserColumns = 'id,username,email,display_name,role,status,member_status,email_verified_at,grade,major,direction_ids,profile_version,created_at';
export interface UserRow {
  id: string; username: string; email: string; display_name: string; role: SafeUser['role']; status: SafeUser['status'];
  member_status: SafeUser['memberStatus']; email_verified_at: Date | null; grade: string; major: string;
  direction_ids: SafeUser['directionIds']; profile_version: number; created_at: Date;
}
export function safeUser(row: UserRow): SafeUser {
  return { id: row.id, username: row.username, email: row.email, displayName: row.display_name, role: row.role, status: row.status,
    memberStatus: row.member_status, emailVerified: !!row.email_verified_at, grade: row.grade, major: row.major,
    directionIds: row.direction_ids, profileVersion: row.profile_version, createdAt: row.created_at.toISOString() };
}
export async function getActor(db: Database, id: string): Promise<Actor | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${safeUserColumns} FROM users WHERE id=$1 AND status='ACTIVE'`, [id]);
  if (!rows[0]) return null;
  const grants = await db.query<{ id: string; content_kind: EditorGrant['contentKind']; direction_id: EditorGrant['directionId']; content_id: string | null; actions: EditorGrant['actions'] }>('SELECT id,content_kind,direction_id,content_id,actions FROM editor_grants WHERE user_id=$1 ORDER BY id', [id]);
  return { user: safeUser(rows[0]), grants: grants.rows.map(g => ({ id: g.id, contentKind: g.content_kind, directionId: g.direction_id, contentId: g.content_id, actions: g.actions })) };
}
