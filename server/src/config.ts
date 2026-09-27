import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppConfig {
  mode: 'development' | 'test' | 'production'; root: string; databaseUrl: string;
  host: string; port: number; publicOrigin: string; adminOrigin: string; sessionSecret: string;
  storagePath: string; sessionMaxAge: number; trustProxy: string | false;
  smtp: { host: string; port: number; secure: boolean; user?: string; password?: string; from: string };
}
export function loadConfig(mode?: string): AppConfig {
  const root = resolve(process.env.IXD_ROOT || (existsSync(resolve('server/package.json')) ? '.' : '..'));
  const envFile = resolve(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  mode ||= process.env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('Unsupported NODE_ENV');
  const production = mode === 'production';
  const localPath = resolve(root, '.local');
  let local: { databaseUrl?: string; testDatabaseUrl?: string } = {};
  if (!production && existsSync(resolve(localPath, 'runtime-secrets.json'))) local = JSON.parse(readFileSync(resolve(localPath, 'runtime-secrets.json'), 'utf8'));
  const databaseUrl = (mode === 'test' ? process.env.TEST_DATABASE_URL || local.testDatabaseUrl : process.env.DATABASE_URL || local.databaseUrl) || '';
  if (!databaseUrl) throw new Error('DATABASE_URL is required. Run the local environment setup or configure PostgreSQL.');
  const dbUrl = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  if (mode === 'test' && !dbUrl.pathname.endsWith('_test')) throw new Error('Test database name must end with _test');
  let sessionSecret = process.env.SESSION_SECRET || '';
  if (!sessionSecret && !production) {
    mkdirSync(localPath, { recursive: true });
    const secretFile = resolve(localPath, 'app-secrets.json');
    if (!existsSync(secretFile)) {
      try { writeFileSync(secretFile, JSON.stringify({ sessionSecret: randomBytes(48).toString('base64url') }), { flag: 'wx', mode: 0o600 }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
    sessionSecret = JSON.parse(readFileSync(secretFile, 'utf8')).sessionSecret;
  }
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  const publicOrigin = new URL(process.env.APP_PUBLIC_URL || (production ? '' : 'http://127.0.0.1:5173')).origin;
  const adminOrigin = new URL(process.env.ADMIN_PUBLIC_URL || (production ? publicOrigin : 'http://127.0.0.1:5174')).origin;
  if (production && (!publicOrigin.startsWith('https://') || !adminOrigin.startsWith('https://'))) throw new Error('Production public URLs must use HTTPS');
  const smtpHost = process.env.SMTP_HOST || (production ? '' : '127.0.0.1');
  if (!smtpHost || (production && /^(localhost|127\.0\.0\.1|mailpit)$/i.test(smtpHost))) throw new Error('Production requires a real SMTP_HOST');
  if (production && !process.env.SMTP_FROM) throw new Error('Production requires SMTP_FROM');
  const port = Number(process.env.PORT || 3000);
  const smtpPort = Number(process.env.SMTP_PORT || (production ? 587 : 1025));
  if (![port, smtpPort].every(p => Number.isInteger(p) && p > 0 && p < 65536)) throw new Error('Invalid listen or SMTP port');
  if (!production && !['127.0.0.1', 'localhost', '::1', 'mailpit'].includes(smtpHost)) throw new Error('Development mail must use a local capture service');
  return {
    mode: mode as AppConfig['mode'], root, databaseUrl, host: process.env.HOST || '127.0.0.1', port,
    publicOrigin, adminOrigin, sessionSecret, storagePath: resolve(root, process.env.STORAGE_PATH || '.local/uploads'),
    sessionMaxAge: 24 * 60 * 60 * 1000, trustProxy: process.env.TRUST_PROXY_CIDR || (process.env.TRUST_PROXY === '1' ? 'loopback' : false),
    smtp: { host: smtpHost, port: smtpPort, secure: process.env.SMTP_SECURE === '1', user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.SMTP_FROM || 'IXD <no-reply@ixd.local>' },
  };
}
