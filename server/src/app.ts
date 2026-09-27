import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import csrf from '@fastify/csrf-protection';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { createPool } from './db.js';
import { PgSessionStore } from './session-store.js';
import { getActor } from './user-record.js';
import { HttpError, installErrorHandler } from './errors.js';
import { registerAuthRoutes } from './auth.js';
import { registerUserRoutes } from './users.js';
import { registerContentRoutes } from './content.js';
import { registerBusinessRoutes } from './business.js';
import { registerMediaRoutes } from './media.js';
import { coreResponse } from './core-responses.js';

export async function buildApp(config: AppConfig, options: { db?: Pool; now?: () => Date; logger?: boolean } = {}) {
  const db = options.db || createPool(config.databaseUrl);
  const ctx: AppContext = { config, db, now: options.now || (() => new Date()) };
  const app = Fastify({ bodyLimit: 300_000, trustProxy: config.trustProxy,
    logger: options.logger === false ? false : { level: 'info', serializers: {
      req: req => ({ method: req.method, path: req.url?.split('?')[0], remoteAddress: req.ip }),
      res: res => ({ statusCode: res.statusCode }),
    }, redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body', 'res.headers.set-cookie'] },
  });
  installErrorHandler(app);
  app.addHook('onRoute', route => {
    if (route.schema?.response) return;
    const response = coreResponse(String(route.method), route.url);
    if (response) route.schema = { ...route.schema, response: { 200: response, 201: response } };
  });
  app.decorateRequest('actor', null);
  await app.register(cookie);
  await app.register(session, { secret: config.sessionSecret, cookieName: 'ixd-session', store: new PgSessionStore(db, ctx.now, config.sessionMaxAge),
    cookie: { path: '/', httpOnly: true, sameSite: 'lax', secure: config.mode === 'production', maxAge: config.sessionMaxAge },
    saveUninitialized: false, rolling: true,
  });
  await app.register(csrf, { sessionPlugin: '@fastify/session', getToken: request => typeof request.headers['x-csrf-token'] === 'string' ? request.headers['x-csrf-token'] : undefined, logLevel: 'debug' });
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute', keyGenerator: request => request.ip });
  await app.register(multipart, { limits: { files: 1, fields: 1, fieldSize: 30, fileSize: 10 * 1024 * 1024, parts: 2 } });
  app.addHook('onRequest', async request => {
    const userId = request.session.userId;
    if (userId) {
      const generation = await db.query('SELECT auth_version FROM users WHERE id=$1', [userId]);
      request.actor = generation.rows[0]?.auth_version === request.session.userVersion ? await getActor(db, userId) : null;
      if (!request.actor) await request.session.regenerate();
    }
  });
  app.addHook('onRequest', (request, reply, done) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return done();
    const origin = request.headers.origin;
    if (origin && ![config.publicOrigin, config.adminOrigin].includes(origin)) return done(new HttpError(403, 'ORIGIN_FORBIDDEN', '请求来源不受信任'));
    app.csrfProtection(request, reply, done);
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    return payload;
  });
  app.get('/api/v1/health', async () => { await db.query('SELECT 1'); return { data: { status: 'ok', service: 'ixd-platform-api' } }; });
  await registerAuthRoutes(app, ctx);
  await registerUserRoutes(app, ctx);
  await registerContentRoutes(app, ctx);
  await registerBusinessRoutes(app, ctx);
  await registerMediaRoutes(app, ctx);
  if (!options.db) app.addHook('onClose', async () => { await db.end(); });
  return { app, ctx };
}
