import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { root, local, json, save, run, inside, free } from './platform-common.mjs';

const action = process.argv[2];
const runtime = json(path.join(local, 'runtime-secrets.json'));
const marker = json(path.join(local, 'platform-runtime-owner.json'));
if (marker.repo !== root || marker.dataDir !== path.join(local, 'postgres')) throw new Error('Unknown local database owner. Refusing to back up or restore it.');
const pg = runtime.postgres;
const binary = name => path.join(process.env.PG_BIN || pg.binDir, name + (process.platform === 'win32' ? '.exe' : ''));
const pgEnv = (database, admin = false) => ({ ...process.env, PGHOST: pg.host, PGPORT: String(pg.port), PGDATABASE: database, PGUSER: admin ? pg.adminUser : pg.appUser, PGPASSWORD: admin ? pg.adminPassword : pg.appPassword });
const sql = (database, statement, admin = false) => run(binary('psql'), ['-X', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: pgEnv(database, admin), input: statement }).trim();
const tables = ['users', 'sessions', 'email_tokens', 'contents', 'content_versions', 'directions', 'editor_grants', 'site_settings', 'media', 'content_version_media', 'content_version_links', 'project_positions', 'project_applications', 'project_members', 'event_registrations', 'competition_intents', 'favorites', 'announcement_reads', 'notifications', 'jobs', 'audit_logs', 'schema_migrations'];
const counts = database => Object.fromEntries(tables.map(table => [table, Number(sql(database, `SELECT count(*) FROM ${table};`))]));
const digests = database => Object.fromEntries(tables.map(table => [table, sql(database, `SELECT md5(coalesce(string_agg(row_to_json(record)::text,E'\\n' ORDER BY row_to_json(record)::text),'')) FROM ${table} record;`)]));
async function hash(file) { const value = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) value.update(chunk); return value.digest('hex'); }
async function files(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`Unexpected upload entry ${entry.name}; do not follow links during backup.`);
    result.push({ name: entry.name, bytes: fs.statSync(file).size, sha256: await hash(file) });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

if (action === 'backup') {
  if (!(await free(Number(process.env.PORT || 3000)))) throw new Error('Stop API/jobs before backup so database and attachments form one consistent maintenance snapshot. Keep PostgreSQL running.');
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + randomBytes(3).toString('hex');
  const target = path.join(root, 'backups', `ixd-${id}`);
  const uploads = path.resolve(root, process.env.STORAGE_PATH || '.local/uploads');
  fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
  fs.mkdirSync(target, { recursive: false });
  const fileRecords = await files(uploads), rowCounts = counts(pg.devDatabase), rowDigests = digests(pg.devDatabase);
  run(binary('pg_dump'), ['--format=custom', '--no-owner', '--no-acl', '--file', path.join(target, 'database.dump')], { env: pgEnv(pg.devDatabase) });
  fs.mkdirSync(path.join(target, 'uploads'));
  for (const file of fileRecords) fs.copyFileSync(path.join(uploads, file.name), path.join(target, 'uploads', file.name), fs.constants.COPYFILE_EXCL);
  if (JSON.stringify(await files(uploads)) !== JSON.stringify(fileRecords)) throw new Error('Uploads changed during backup. This folder has no complete manifest and must not be used for restore.');
  if (JSON.stringify(digests(pg.devDatabase)) !== JSON.stringify(rowDigests)) throw new Error('Database changed during backup. Stop all writers and retry; this incomplete folder must not be restored.');
  save(path.join(target, 'manifest.json'), { format: 1, createdAt: new Date().toISOString(), sourceDatabase: pg.devDatabase, postgresVersion: sql(pg.devDatabase, 'SHOW server_version;'), gitCommit: run('git', ['rev-parse', 'HEAD']).trim(), maintenanceSnapshot: true, counts: rowCounts, rowDigests, files: fileRecords, databaseSha256: await hash(path.join(target, 'database.dump')), serverConfigSecretsIncluded: false });
  console.log(`Backup complete: ${target}\nTreat database and uploads as private data; encrypt off-machine copies. Server secrets are not included.`);
} else if (action === 'restore') {
  const source = path.resolve(process.argv[3] || '');
  if (!inside(path.join(root, 'backups'), source)) throw new Error('Select an existing backup inside this repository backups/ directory. Restore never overwrites the live database.');
  const manifest = json(path.join(source, 'manifest.json'));
  if (manifest.format !== 1 || !manifest.maintenanceSnapshot) throw new Error('Missing verified backup manifest.');
  if (await hash(path.join(source, 'database.dump')) !== manifest.databaseSha256) throw new Error('Database dump digest mismatch.');
  for (const file of manifest.files) {
    if (path.basename(file.name) !== file.name || await hash(path.join(source, 'uploads', file.name)) !== file.sha256) throw new Error('Upload digest/path mismatch.');
  }
  const suffix = `${Date.now()}_${randomBytes(3).toString('hex')}`;
  const database = `ixd_restore_${suffix}_test`;
  const target = path.join(local, 'restores', database);
  if (fs.existsSync(target)) throw new Error('Restore directory already exists.');
  if (sql('postgres', `SELECT count(*) FROM pg_database WHERE datname='${database}';`, true) !== '0') throw new Error('Restore database already exists.');
  sql('postgres', `CREATE DATABASE "${database}" OWNER "${pg.appUser}";`, true);
  fs.mkdirSync(target, { recursive: true });
  save(path.join(target, 'restore-owner.json'), { root, database, purpose: 'isolated IXD restore verification', source });
  run(binary('pg_restore'), ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', database, path.join(source, 'database.dump')], { env: pgEnv(database) });
  fs.mkdirSync(path.join(target, 'uploads'));
  for (const file of manifest.files) fs.copyFileSync(path.join(source, 'uploads', file.name), path.join(target, 'uploads', file.name), fs.constants.COPYFILE_EXCL);
  const restoredCounts = counts(database);
  for (const table of Object.keys(manifest.counts)) if (restoredCounts[table] !== manifest.counts[table]) throw new Error(`Restored row count mismatch: ${table}`);
  const restoredDigests = digests(database);
  if (manifest.rowDigests) for (const table of Object.keys(manifest.rowDigests)) if (restoredDigests[table] !== manifest.rowDigests[table]) throw new Error(`Restored row data mismatch: ${table}`);
  const restoredFiles = await files(path.join(target, 'uploads'));
  if (JSON.stringify(restoredFiles) !== JSON.stringify(manifest.files)) throw new Error('Restored attachment byte/hash mismatch.');
  const media = JSON.parse(sql(database, "SELECT coalesce(json_agg(json_build_object('key',storage_key,'bytes',byte_size)), '[]') FROM media;"));
  for (const record of media) { if (path.basename(record.key) !== record.key || fs.statSync(path.join(target, 'uploads', record.key)).size !== Number(record.bytes)) throw new Error('Restored database media reference is missing or damaged.'); }
  const report = { verifiedAt: new Date().toISOString(), source, database, uploads: path.join(target, 'uploads'), counts: restoredCounts, rowDigests: restoredDigests, rowDataCompared: !!manifest.rowDigests, verifiedFiles: restoredFiles.length, files: restoredFiles, mediaReferencesVerified: media.length, liveDatabaseUnchanged: true };
  save(path.join(target, 'verification.json'), report);
  save(path.join(target, 'connection.private.json'), { databaseUrl: `postgresql://${encodeURIComponent(pg.appUser)}:${encodeURIComponent(pg.appPassword)}@${pg.host}:${pg.port}/${database}`, storagePath: path.join(target, 'uploads'), warning: 'Isolated restore only; never point production at this verification database.' });
  console.log(JSON.stringify(report, null, 2));
} else throw new Error('Usage: node scripts/platform-backup.mjs backup | restore <backups/ixd-directory>');
