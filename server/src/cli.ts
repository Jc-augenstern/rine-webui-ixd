import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createPool, migrate, inTransaction } from './db.js';
import { seedDevelopment, initializeSite, importClubContent } from './seed.js';
import { hashPassword } from './password.js';
import { usernameSchema } from '../../shared/platform.js';
import { revokeSessions } from './session-store.js';
import { audit } from './audit.js';

async function main() {
  const args = parseArgs({ allowPositionals: true, options: { username: { type: 'string' }, email: { type: 'string' }, output: { type: 'string' } } });
  const command = args.positionals[0];
  if (!['migrate', 'seed-dev', 'admin-init', 'admin-recover', 'content-import'].includes(command)) throw new Error('Use migrate, seed-dev, admin-init, admin-recover or content-import');
  const config = loadConfig(), db = createPool(config.databaseUrl), now = () => new Date();
  try {
    if (command === 'migrate') { console.log(JSON.stringify({ applied: await migrate(db, config.root) })); return; }
    if (command === 'seed-dev') { console.log(`开发初始化完成，随机凭据仅写入：${await seedDevelopment({ config, db, now })}`); return; }
    const username = usernameSchema.parse(args.values.username);
    if (command === 'content-import') {
      const user = await db.query("SELECT id FROM users WHERE lower(username)=lower($1) AND role='ADMIN' AND status='ACTIVE' AND email_verified_at IS NOT NULL", [username]);
      if (!user.rowCount) throw new Error('Named verified administrator does not exist');
      await importClubContent({ config, db, now }, user.rows[0].id);
      await audit(db, user.rows[0].id, 'CLI_CLUB_IMPORT', 'site', null, { source: 'supplied-club-draft' });
      console.log('社团初稿幂等导入完成；已有运营编辑未被覆盖，未创建开发账号或示例业务。'); return;
    }
    const email = command === 'admin-init' ? z.email().parse(args.values.email).toLowerCase() : null;
    if (config.mode === 'production' && !args.values.output) throw new Error('Production requires --output pointing to a protected file outside the served directories');
    const output = resolve(config.root, args.values.output || `.local/admin-access-${Date.now()}.json`);
    if (/(^|[\\/])(public|dist|admin[\\/]dist)([\\/]|$)/i.test(output)) throw new Error('Credential output must not be in a web-served directory');
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await hashPassword(password);
    await mkdir(dirname(output), { recursive: true });
    // Reserve and persist before DB change. Never print the password; no secrets in shell history.
    await writeFile(output, JSON.stringify({ username, password, warning: '管理员访问凭据，妥善保管并登录后修改密码。' }, null, 2), { flag: 'wx', mode: 0o600 });
    await inTransaction(db, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ixd-active-admins'))");
      let id: string;
      if (command === 'admin-init') {
        const result = await client.query("INSERT INTO users(username,email,password_hash,display_name,role,email_verified_at) VALUES($1,$2,$3,$1,'ADMIN',now()) RETURNING id", [username, email, passwordHash]);
        id = result.rows[0].id;
        await initializeSite(client, id, now());
      } else {
        const result = await client.query("UPDATE users SET password_hash=$2,status='ACTIVE',email_verified_at=COALESCE(email_verified_at,now()),profile_version=profile_version+1,auth_version=auth_version+1,updated_at=now() WHERE lower(username)=lower($1) AND role='ADMIN' RETURNING id", [username, passwordHash]);
        if (!result.rowCount) throw new Error('Named administrator does not exist; no account was promoted');
        id = result.rows[0].id;
        await revokeSessions(client, id, now());
        await client.query("UPDATE email_tokens SET consumed_at=$2 WHERE user_id=$1 AND purpose='RESET_PASSWORD' AND consumed_at IS NULL", [id, now()]);
      }
      await audit(client, id, command === 'admin-init' ? 'CLI_ADMIN_INITIALIZE' : 'CLI_ADMIN_RECOVER', 'user', id, { via: 'server-cli' });
    });
    console.log(`管理员操作完成。凭据文件：${output}`);
  } finally { await db.end(); }
}
main().catch(error => { const code = error instanceof z.ZodError ? 'CLI 参数不正确' : error instanceof Error && !('code' in error) ? error.message : '操作失败，请检查数据库及重复账号'; console.error(code); process.exitCode = 1; });
