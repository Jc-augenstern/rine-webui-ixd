import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, local, logs, json, save, run, free, assertIgnored, launch, stopProcess, ownedProcess } from './platform-common.mjs';

const secretFile = path.join(local, 'runtime-secrets.json');
const ownerFile = path.join(local, 'platform-runtime-owner.json');
const processFile = path.join(local, 'portable-processes.json');
const runtime = path.join(local, 'runtime');
const data = path.join(local, 'postgres');
const old = fs.existsSync(secretFile) ? json(secretFile) : null;
const pgBin = old?.postgres.binDir ?? path.join(runtime, 'postgresql/pgsql/bin');
const mailExe = old?.mailpit.executable ?? path.join(runtime, 'mailpit/mailpit.exe');
let command = process.argv[2] ?? 'status';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Portable mode requires Windows x64. Use deploy/compose.local.yml or configure PostgreSQL and local SMTP on this platform.');
function owner() {
  const marker = json(ownerFile);
  if (marker.repo !== root || marker.dataDir !== data || marker.purpose !== 'IXD platform local development') throw new Error('Unknown database ownership. Refusing to access this cluster.');
  return json(secretFile);
}
function pgStatus() { return spawnSync(path.join(pgBin, 'pg_ctl.exe'), ['status', '-D', data], { windowsHide: true }).status === 0; }
async function pgStart() {
  owner(); if (pgStatus()) return;
  if (!(await free(5433))) throw new Error('PostgreSQL port 5433 is already occupied. No process was stopped.');
  fs.mkdirSync(logs, { recursive: true });
  run(path.join(pgBin, 'pg_ctl.exe'), ['start', '-D', data, '-l', path.join(logs, 'postgres.log'), '-w', '-t', '30', '-o', '-h 127.0.0.1 -p 5433'], { stdio: 'ignore' });
}
async function downloadBinaries() {
  assertIgnored(); fs.mkdirSync(runtime, { recursive: true });
  const artifacts = [
    { executable: path.join(pgBin, 'postgres.exe'), folder: 'postgresql', filename: 'postgresql-17.11-4-windows-x64-binaries.zip', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.11-4-windows-x64-binaries.zip', digest: 'b9424ee7bc60b52450ff910a3630225df32e633f3cb29c1d126d9299d59aea28' },
    { executable: mailExe, folder: 'mailpit', filename: 'mailpit-v1.31.2-windows-amd64.zip', url: 'https://github.com/axllent/mailpit/releases/download/v1.31.2/mailpit-windows-amd64.zip', digest: '42c20e5c3254125ea7489847811f10d70e39de573fe41d03a61412c87913e995' },
  ];
  for (const artifact of artifacts) {
    if (fs.existsSync(artifact.executable)) continue;
    const archive = path.join(runtime, artifact.filename);
    if (!fs.existsSync(archive)) {
      console.log(`Downloading official portable runtime: ${artifact.filename}`);
      const response = await fetch(artifact.url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok || !response.body) throw new Error(`Runtime download returned HTTP ${response.status}`);
      const descriptor = fs.openSync(`${archive}.partial`, 'wx');
      try { for await (const chunk of response.body) fs.writeSync(descriptor, chunk); } finally { fs.closeSync(descriptor); }
      fs.renameSync(`${archive}.partial`, archive);
    }
    const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
    if (hash.digest('hex') !== artifact.digest) throw new Error(`Digest mismatch for ${artifact.filename}; nothing executed.`);
    const target = path.join(runtime, artifact.folder);
    if (fs.existsSync(target)) throw new Error(`Incomplete runtime folder exists: ${target}. Inspect it manually; existing files will not be overwritten.`);
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(target)}`], { stdio: 'inherit' });
    if (!fs.existsSync(artifact.executable)) throw new Error('Runtime executable missing after extraction.');
  }
}
async function initialize() {
  assertIgnored();
  if (fs.existsSync(data) || fs.existsSync(secretFile) || fs.existsSync(ownerFile)) throw new Error('Runtime already has data or ownership records. Use start; setup will never reset data.');
  for (const port of [5433, 1025, 8025]) if (!(await free(port))) throw new Error(`Port ${port} is occupied. No process was stopped.`);
  fs.mkdirSync(logs, { recursive: true });
  const adminPassword = randomBytes(32).toString('base64url'), appPassword = randomBytes(32).toString('base64url');
  const settings = {
    createdAt: new Date().toISOString(),
    postgres: { host: '127.0.0.1', port: 5433, adminUser: 'ixd_local_admin', adminPassword, appUser: 'ixd_platform', appPassword, devDatabase: 'ixd_platform_dev', testDatabase: 'ixd_platform_test', binDir: pgBin, dataDir: data },
    databaseUrl: `postgresql://ixd_platform:${appPassword}@127.0.0.1:5433/ixd_platform_dev`, testDatabaseUrl: `postgresql://ixd_platform:${appPassword}@127.0.0.1:5433/ixd_platform_test`, pgUser: 'ixd_platform', pgPassword: appPassword, pgPort: 5433,
    mailpit: { smtpHost: '127.0.0.1', smtpPort: 1025, inboxUrl: 'http://127.0.0.1:8025/', executable: mailExe },
  };
  save(secretFile, settings); save(ownerFile, { purpose: 'IXD platform local development', repo: root, dataDir: data, createdAt: settings.createdAt });
  const passwordFile = path.join(local, 'postgres-init-password.txt'); fs.writeFileSync(passwordFile, `${adminPassword}\n`, { mode: 0o600 });
  try { run(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', settings.postgres.adminUser, '--pwfile', passwordFile, '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256', '--data-checksums']); }
  finally { fs.unlinkSync(passwordFile); }
  fs.appendFileSync(path.join(data, 'postgresql.conf'), "\n# IXD local runtime\nlisten_addresses = '127.0.0.1'\nport = 5433\ntimezone = 'UTC'\nlog_timezone = 'UTC'\n");
  await pgStart();
  run(path.join(pgBin, 'psql.exe'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '5433', '-U', settings.postgres.adminUser, '-d', 'postgres', '-f', '-'], {
    env: { ...process.env, PGPASSWORD: adminPassword },
    input: `CREATE ROLE ixd_platform LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE;\nCREATE DATABASE ixd_platform_dev OWNER ixd_platform;\nCREATE DATABASE ixd_platform_test OWNER ixd_platform;\n`,
  });
}
async function mailStart() {
  owner(); const state = fs.existsSync(processFile) ? json(processFile) : {};
  if (ownedProcess(state.mailpit)) return;
  if (!(await free(8025)) || !(await free(1025))) {
    // Adopt only the earlier project-owned runtime after exact PID, creation-time and path verification.
    const legacy = path.join(local, 'runtime-processes.json');
    if (fs.existsSync(legacy) && json(legacy).mailpit?.exe === mailExe) {
      const { processInfo } = await import('./platform-common.mjs'); const previous = json(legacy).mailpit; const actual = processInfo(previous.pid);
      if (actual?.created === previous.creationDate && actual.exe === mailExe && actual.command.includes(path.join(local, 'mailpit.db'))) { save(processFile, { mailpit: { ...actual, name: 'mailpit', identity: path.join(local, 'mailpit.db'), port: 8025 } }); return; }
    }
    throw new Error('Mail capture ports are occupied by another process; no process was stopped.');
  }
  const process = await launch(mailExe, ['--listen', '127.0.0.1:8025', '--smtp', '127.0.0.1:1025', '--database', path.join(local, 'mailpit.db'), '--allowed-hosts', '127.0.0.1,localhost', '--disable-version-check', '--smtp-disable-rdns', '--block-remote-css-and-fonts', '--max', '1000'], { name: 'mailpit', identity: path.join(local, 'mailpit.db'), port: 8025 });
  save(processFile, { mailpit: process });
}
if (command === 'setup') { await downloadBinaries(); if (!fs.existsSync(secretFile)) await initialize(); else owner(); command = 'start'; }
if (command === 'start') { await pgStart(); await mailStart(); }
else if (command === 'stop') {
  owner(); const state = fs.existsSync(processFile) ? json(processFile) : {};
  await stopProcess(state.mailpit);
  if (pgStatus()) run(path.join(pgBin, 'pg_ctl.exe'), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '30']);
  console.log('IXD database and mail capture stopped. All data retained.'); process.exit(0);
} else if (command !== 'status') throw new Error('Usage: node scripts/platform-runtime.mjs setup|start|stop|status');
owner(); console.log(JSON.stringify({ postgres: pgStatus(), database: '127.0.0.1:5433', inbox: 'http://127.0.0.1:8025/', credentialsFile: secretFile }, null, 2));
