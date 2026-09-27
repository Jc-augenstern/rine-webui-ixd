import { z } from 'zod';
import { userSchema } from '../../shared/platform.js';
type Schema = Record<string, unknown>;
const string = { type: 'string' }, integer = { type: 'integer' }, boolean = { type: 'boolean' };
const nil = { type: 'null' }, nullable = { anyOf: [string, nil] };
const obj = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties).filter(key => !optional.includes(key)) });
const arr = (items: Schema): Schema => ({ type: 'array', items });
const user = z.toJSONSchema(userSchema) as Schema;
const grant = obj({ id: string, contentKind: string, directionId: nullable, contentId: nullable, actions: arr(string) });
const media = obj({ id: string, originalName: string, mimeType: string, byteSize: integer, accessLevel: string, url: string, referenceCount: integer, createdAt: string });
const detail = obj({ user, grants: arr(grant) });
const meta = obj({ page: integer, pageSize: integer, total: integer });
const envelope = (data: Schema, list = false): Schema => obj(list ? { data: arr(data), meta } : { data });
const message = envelope(obj({ message: string }));

/** Serialize only public DTO fields; never an unrestricted database row. */
export function coreResponse(method: string, url: string): Schema | null {
  const path = url.replace('/api/v1', '');
  if (path === '/health') return envelope(obj({ status: string, service: string }));
  if (path === '/auth/session' || path === '/auth/login' || path === '/auth/change-password') return envelope(obj({ user: { anyOf: [user, nil] }, grants: arr(grant), csrfToken: string, expiresAt: nullable }));
  if (path.startsWith('/auth/')) return message;
  if (path === '/me') return envelope(user);
  if (path === '/admin/users') return envelope(user, true);
  if (path === '/admin/users/:id') return envelope(method === 'GET' ? detail : user);
  if (path.endsWith('/grants')) return envelope(detail);
  if (path.endsWith('/revoke-sessions')) return message;
  if (path === '/admin/overview') return envelope(obj({ counts: { type: 'object', additionalProperties: integer }, pendingApplications: integer, pendingWorks: integer, users: integer }, ['users']));
  if (path === '/admin/audit') return envelope(obj({ id: string, actorId: nullable, actorName: nullable, action: string, resourceType: string, resourceId: nullable, changes: { type: 'object', additionalProperties: true }, createdAt: string }), true);
  if (path === '/media') return envelope(media, method === 'GET');
  if (path === '/admin/media') return envelope(media, true);
  if (path === '/admin/media/:id') return message;
  if (path === '/admin/media/:id/references') return envelope(arr({ anyOf: [obj({ contentId: string, kind: string, title: string, versionId: string, revision: integer, usage: string }), obj({ title: string, restricted: boolean })] }));
  return null;
}
