import type { FastifyRequest } from 'fastify';
import type { ContentKind, DirectionKey, GrantAction } from '../../shared/platform.js';
import type { Actor } from './context.js';
import { HttpError } from './errors.js';
export interface ManagedResource { id?: string; kind: ContentKind; directionIds: DirectionKey[]; ownerId?: string }
export function requireActor(request: FastifyRequest, verified = true): Actor {
  if (!request.actor) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录');
  if (verified && !request.actor.user.emailVerified) throw new HttpError(403, 'EMAIL_NOT_VERIFIED', '请先验证邮箱后再进行此操作');
  return request.actor;
}
export function requireEditor(request: FastifyRequest): Actor {
  const actor = requireActor(request);
  if (!['EDITOR', 'ADMIN'].includes(actor.user.role)) throw new HttpError(403, 'FORBIDDEN', '此账号没有管理权限');
  return actor;
}
export function requireAdmin(request: FastifyRequest): Actor {
  const actor = requireActor(request);
  if (actor.user.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', '需要管理员权限');
  return actor;
}
export function canManage(actor: Actor | null, resource: ManagedResource, action: GrantAction): boolean {
  if (!actor || actor.user.status !== 'ACTIVE' || !actor.user.emailVerified) return false;
  if (actor.user.role === 'ADMIN') return true;
  if (actor.user.role !== 'EDITOR') return false;
  const grants = actor.grants.filter(g => g.contentKind === resource.kind && g.actions.includes(action));
  if (grants.some(g => !g.directionId && (!g.contentId || g.contentId === resource.id))) return true;
  return resource.directionIds.length > 0 && resource.directionIds.every(d => grants.some(g => g.directionId === d && !g.contentId));
}
export function assertManage(actor: Actor, resource: ManagedResource, action: GrantAction): void {
  if (!canManage(actor, resource, action)) throw new HttpError(403, 'SCOPE_FORBIDDEN', '没有此资源或操作的授权');
}
