import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { registerSchema, loginSchema, tokenSchema, resetSchema, emailSchema, changePasswordSchema, type SessionDTO } from '../../shared/platform.js';
import type { AppContext } from './context.js';
import { getActor, type UserRow } from './user-record.js';
import { HttpError } from './errors.js';
import { inTransaction } from './db.js';
import { requireActor } from './security.js';
import { hashPassword, verifyPassword } from './password.js';
import { sendAccountMail, tokenHash, type TokenPurpose } from './mail.js';
import { revokeSessions } from './session-store.js';
import { audit } from './audit.js';

export function sessionDTO(request: FastifyRequest, reply: FastifyReply): SessionDTO {
  const csrfToken = reply.generateCsrf();
  return { user: request.actor?.user || null, grants: request.actor?.grants || [], csrfToken,
    expiresAt: request.actor ? new Date(request.session.cookie.expires || Date.now()).toISOString() : null };
}
export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const dummyHash = await hashPassword(randomBytes(32).toString('base64url'));
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  app.get('/api/v1/auth/session', async (request, reply) => ({ data: sessionDTO(request, reply) }));
  app.post('/api/v1/auth/register', limited, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const passwordHash = await hashPassword(input.password);
    const user = await inTransaction(ctx.db, async db => {
      const result = await db.query('INSERT INTO users(username,email,password_hash,display_name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5) RETURNING id,email', [input.username, input.email.toLowerCase(), passwordHash, input.displayName, ctx.now()]);
      await audit(db, result.rows[0].id, 'REGISTER', 'user', result.rows[0].id, {}, request.id);
      return result.rows[0];
    });
    await sendAccountMail(ctx, user, 'VERIFY_EMAIL');
    return reply.code(201).send({ data: { message: '账号已创建，请在邮箱中打开验证链接后登录' } });
  });
  app.post('/api/v1/auth/login', limited, async (request, reply) => {
    const { account, password } = loginSchema.parse(request.body);
    const result = await ctx.db.query<UserRow & { password_hash: string; auth_version: number }>('SELECT * FROM users WHERE lower(username)=lower($1) OR lower(email)=lower($1) LIMIT 1', [account]);
    const row = result.rows[0];
    const valid = await verifyPassword(row?.password_hash || dummyHash, password);
    if (!row || !valid || row.status !== 'ACTIVE') throw new HttpError(401, 'INVALID_IDENTITY', 'ACCESS DENIED / INVALID IDENTITY');
    await request.session.regenerate();
    request.session.userId = row.id;
    request.session.userVersion = row.auth_version;
    request.actor = await getActor(ctx.db, row.id);
    if (!request.actor) { await request.session.destroy(); throw new HttpError(401, 'INVALID_IDENTITY', '账号当前无法登录'); }
    await request.session.save();
    await audit(ctx.db, row.id, 'LOGIN', 'user', row.id, {}, request.id);
    return { data: sessionDTO(request, reply) };
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    await request.session.destroy();
    request.actor = null;
    reply.clearCookie('ixd-session', { path: '/' });
    return { data: { message: '已退出' } };
  });
  async function consumeToken(token: string, purpose: TokenPurpose, password?: string) {
    const passwordHash = password ? await hashPassword(password) : null;
    return inTransaction(ctx.db, async db => {
      // User lock precedes token lock across issuance/consumption/password changes.
      const found = await db.query('SELECT user_id FROM email_tokens WHERE token_hash=$1 AND purpose=$2', [tokenHash(token), purpose]);
      const userId = found.rows[0]?.user_id;
      if (!userId) throw new HttpError(400, 'TOKEN_INVALID', '链接无效或已过期，请重新申请');
      const user = await db.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR UPDATE", [userId]);
      const consumed = await db.query('UPDATE email_tokens SET consumed_at=$3 WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>$3 RETURNING user_id', [tokenHash(token), purpose, ctx.now()]);
      if (!user.rowCount || !consumed.rowCount) throw new HttpError(400, 'TOKEN_INVALID', '链接无效或已过期，请重新申请');
      if (purpose === 'VERIFY_EMAIL') await db.query('UPDATE users SET email_verified_at=$2,profile_version=profile_version+1,updated_at=$2 WHERE id=$1', [userId, ctx.now()]);
      else {
        await db.query('UPDATE users SET password_hash=$2,auth_version=auth_version+1,updated_at=$3 WHERE id=$1', [userId, passwordHash, ctx.now()]);
        await revokeSessions(db, userId, ctx.now());
      }
      await audit(db, userId, purpose, 'user', userId);
      return userId;
    });
  }
  app.post('/api/v1/auth/verify-email', limited, async request => {
    await consumeToken(tokenSchema.parse(request.body).token, 'VERIFY_EMAIL');
    return { data: { message: '邮箱已验证，可以登录或继续操作' } };
  });
  app.post('/api/v1/auth/reset-password', limited, async request => {
    const input = resetSchema.parse(request.body);
    await consumeToken(input.token, 'RESET_PASSWORD', input.password);
    return { data: { message: '密码已更新，所有旧会话已撤销，请重新登录' } };
  });
  for (const [route, purpose] of [['resend-verification', 'VERIFY_EMAIL'], ['forgot-password', 'RESET_PASSWORD']] as const) {
    app.post(`/api/v1/auth/${route}`, { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async request => {
      const { email } = emailSchema.parse(request.body);
      const result = await ctx.db.query("SELECT id,email,email_verified_at FROM users WHERE lower(email)=lower($1) AND status='ACTIVE'", [email]);
      const row = result.rows[0];
      if (row && (purpose !== 'VERIFY_EMAIL' || !row.email_verified_at)) await sendAccountMail(ctx, row, purpose);
      return { data: { message: '如果该邮箱符合条件，您会收到邮件。请检查收件箱。' } };
    });
  }
  app.post('/api/v1/auth/change-password', limited, async (request, reply) => {
    const actor = requireActor(request, false);
    const { currentPassword, password } = changePasswordSchema.parse(request.body);
    const passwordHash = await hashPassword(password);
    const generation = await inTransaction(ctx.db, async db => {
      const result = await db.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [actor.user.id]);
      if (!await verifyPassword(result.rows[0].password_hash, currentPassword)) throw new HttpError(400, 'INVALID_PASSWORD', '当前密码不正确');
      const updated = await db.query('UPDATE users SET password_hash=$2,auth_version=auth_version+1,updated_at=$3 WHERE id=$1 RETURNING auth_version', [actor.user.id, passwordHash, ctx.now()]);
      await revokeSessions(db, actor.user.id, ctx.now());
      await db.query("UPDATE email_tokens SET consumed_at=$2 WHERE user_id=$1 AND purpose='RESET_PASSWORD' AND consumed_at IS NULL", [actor.user.id, ctx.now()]);
      await audit(db, actor.user.id, 'CHANGE_PASSWORD', 'user', actor.user.id, {}, request.id);
      return updated.rows[0].auth_version as number;
    });
    await request.session.regenerate();
    request.session.userId = actor.user.id;
    request.session.userVersion = generation;
    return { data: sessionDTO(request, reply) };
  });
}
