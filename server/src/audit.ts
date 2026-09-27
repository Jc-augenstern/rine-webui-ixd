import type { Database } from './db.js';
const forbiddenKey = /password|secret|token|session|cookie|authorization|email|motivation|portfolio|body|payload/i;
function summary(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[omitted]';
  if (Array.isArray(value)) return value.slice(0, 100).map(v => summary(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !forbiddenKey.test(key)).map(([key, item]) => [key, summary(item, depth + 1)]));
  if (typeof value === 'string') return value.slice(0, 300);
  return value;
}
export async function audit(db: Database, actorId: string | null, action: string, resourceType: string, resourceId: string | null, changes: unknown = {}, requestId?: string) {
  await db.query('INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,changes,request_id) VALUES($1,$2,$3,$4,$5,$6)', [actorId, action, resourceType, resourceId, JSON.stringify(summary(changes)), requestId || null]);
}
