import type { FastifyInstance, RouteHandlerMethod, HTTPMethods } from 'fastify';

type Schema = Record<string, any>;
const string = { type: 'string' }, integer = { type: 'integer' }, boolean = { type: 'boolean' };
const nullableString = { anyOf: [string, { type: 'null' }] };
const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: 'object', additionalProperties: false, properties, required: Object.keys(properties).filter(key => !optional.includes(key)),
});
const array = (items: Schema) => ({ type: 'array', items });
const record = { type: 'object', additionalProperties: true };
const user = object({ id: string, displayName: string, email: string });
const payload = object({ title: string, summary: string, body: string, visibility: { type: 'string', enum: ['PUBLIC', 'AUTHENTICATED', 'MEMBERS'] },
  directionIds: array(string), attachmentIds: array(string), coverId: nullableString, pinned: boolean,
  importance: { type: 'string', enum: ['normal', 'important'] }, sortOrder: integer, tags: array(string), details: record });
const contentFields = { id: string, kind: string, slug: string, revision: integer, state: string, attentionRevision: integer,
  payload, bodyHtml: string, createdAt: string, updatedAt: string, publishedAt: nullableString,
  author: object({ id: string, displayName: string }), read: boolean };
export const contentResponse = object(contentFields, ['read']);
export const adminContentResponse = object({ ...contentFields, ownerId: string, publishedPayload: { anyOf: [payload, { type: 'null' }] }, scheduledAt: nullableString, expiresAt: nullableString, reviewReason: nullableString }, ['read']);
const application = object({ id: string, projectId: string, projectTitle: string, positionId: string, positionTitle: string,
  motivation: string, portfolioUrl: string, status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] }, decisionReason: string,
  revision: integer, createdAt: string, updatedAt: string, user }, ['user']);
const registration = object({ id: string, eventId: string, eventTitle: string, status: { type: 'string', enum: ['REGISTERED', 'CANCELLED'] },
  startsAt: nullableString, location: string, createdAt: string, updatedAt: string, user }, ['user']);
const member = object({ id: string, projectId: string, projectTitle: string, positionId: string, positionTitle: string, userId: string,
  status: { type: 'string', enum: ['ACTIVE', 'LEFT', 'REMOVED'] }, joinedAt: string, leftAt: nullableString, user }, ['user']);
const intent = object({ id: string, competitionId: string, competitionTitle: string, note: string, status: string, createdAt: string, updatedAt: string });
const notification = object({ id: string, type: string, title: string, body: string, contentId: nullableString, readAt: nullableString, createdAt: string });
const site = object({ siteName: string, tagline: string, contact: string, sectionDescriptions: record, nodes: array(object({ routeKey: string, title: string, subtitle: string, enabled: boolean, visualPreset: string })) });
const settings = object({ payload: record, publishedPayload: record, revision: integer, publishedRevision: integer, updatedAt: string, publishedAt: nullableString });
const meta = object({ page: integer, pageSize: integer, total: integer });
const envelope = (data: Schema, list = false) => object(list ? { data: array(data), meta } : { data });

function response(method: string, url: string): Schema {
  const path = url.replace('/api/v1', '');
  if (path === '/contents/:id') return envelope(contentResponse);
  if (path === '/admin/preview') return envelope(object({ bodyHtml: string }));
  if (path === '/site-settings') return envelope(site);
  if (path === '/admin/site-settings/publish') return envelope(object({ revision: integer, published: boolean }));
  if (path === '/admin/site-settings') return envelope(settings);
  if (path === '/admin/contents' && method === 'GET') return envelope(adminContentResponse, true);
  if (path.startsWith('/admin/contents')) return envelope(method === 'DELETE' ? object({ deleted: boolean }) : adminContentResponse);
  if (path === '/me/favorites') return envelope(object({ content: contentResponse, reminderHours: array(integer), createdAt: string }), true);
  if (path.startsWith('/me/favorites/')) return envelope(method === 'PUT' ? object({ contentId: string, favorited: boolean, reminderHours: array(integer) }) : object({ contentId: string, favorited: boolean }));
  if (path.startsWith('/me/announcements/')) return envelope(object({ id: string, read: boolean, attentionRevision: integer }));
  if (path === '/notifications') return envelope(notification, true);
  if (path.startsWith('/notifications/')) return envelope(notification);
  if (path.endsWith('/intent')) return envelope(method === 'DELETE' ? object({ id: nullableString, competitionId: string, status: string }) : intent);
  if (path === '/me/intents') return envelope(intent, true);
  if (path === '/me/applications' || path === '/admin/applications') return envelope(application, true);
  if (path.endsWith('/applications') || path.includes('/applications/')) return envelope(application);
  if (path === '/me/projects' || path.endsWith('/members')) return envelope(member, true);
  if (path.includes('/members/')) return envelope(member);
  if (path === '/me/registrations' || path === '/admin/registrations') return envelope(registration, true);
  if (path.endsWith('/registrations')) return envelope(registration);
  if (path === '/me/works') return envelope(adminContentResponse, method === 'GET');
  if (path.startsWith('/me/works/')) return envelope(adminContentResponse);
  return envelope(contentResponse, !path.endsWith('/:id'));
}

/** Output allowlists complement strict shared input schemas; error schemas stay global. */
export function responseRoutes(app: FastifyInstance) {
  const register = (method: HTTPMethods) => (url: string, handler: RouteHandlerMethod) => {
    const success = response(method, url);
    app.route({ method, url, schema: { response: { 200: success, 201: success } }, handler });
  };
  return { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') };
}
