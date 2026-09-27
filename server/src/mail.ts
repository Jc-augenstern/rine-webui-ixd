import nodemailer from 'nodemailer';
import { randomBytes, createHash } from 'node:crypto';
import type { AppContext } from './context.js';
import { HttpError } from './errors.js';
import { inTransaction } from './db.js';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export type TokenPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';
export async function sendAccountMail(ctx: AppContext, user: { id: string; email: string }, purpose: TokenPurpose) {
  const token = randomBytes(32).toString('base64url');
  const now = ctx.now();
  await inTransaction(ctx.db, async db => {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    await db.query('UPDATE email_tokens SET consumed_at=$3 WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL', [user.id, purpose, now]);
    await db.query('INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at,created_at) VALUES($1,$2,$3,$4,$5)',
      [tokenHash(token), user.id, purpose, new Date(now.getTime() + (purpose === 'VERIFY_EMAIL' ? 24 : 1) * 3600_000), now]);
  });
  const route = purpose === 'VERIFY_EMAIL' ? 'verify-email' : 'reset-password';
  const link = `${ctx.config.publicOrigin}/#auth/${route}?token=${encodeURIComponent(token)}`;
  const transport = nodemailer.createTransport({
    host: ctx.config.smtp.host, port: ctx.config.smtp.port, secure: ctx.config.smtp.secure,
    auth: ctx.config.smtp.user ? { user: ctx.config.smtp.user, pass: ctx.config.smtp.password } : undefined,
    requireTLS: ctx.config.mode === 'production', connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    logger: false, debug: false,
  });
  try {
    await transport.sendMail({ from: ctx.config.smtp.from, to: user.email,
      subject: purpose === 'VERIFY_EMAIL' ? 'IXD · 验证邮箱' : 'IXD · 重置密码',
      text: `${purpose === 'VERIFY_EMAIL' ? '请验证您的 IXD 邮箱，此链接 24 小时有效。' : '请重置您的 IXD 密码，此链接 1 小时有效。'}\n\n${link}\n\n链接只能使用一次。如非本人操作，请忽略。`,
    });
  } catch {
    await ctx.db.query('UPDATE email_tokens SET consumed_at=$2 WHERE token_hash=$1', [tokenHash(token), ctx.now()]);
    throw new HttpError(503, 'MAIL_UNAVAILABLE', '邮件暂未发送成功，请稍后在登录界面重新发送');
  } finally { transport.close(); }
}
