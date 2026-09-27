import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, local, free, json } from './platform-common.mjs';

const probe = (exe, args) => { const result = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim().split('\n')[0] : null; };
const secrets = fs.existsSync(path.join(local, 'runtime-secrets.json')) ? json(path.join(local, 'runtime-secrets.json')) : null;
const report = {
  node: process.version, nodeSupported: Number(process.versions.node.split('.')[0]) >= 24,
  npm: probe(process.execPath, [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), '--version']),
  git: probe('git', ['--version']), dockerCompose: probe('docker', ['compose', 'version']),
  postgres: secrets ? probe(path.join(secrets.postgres.binDir, process.platform === 'win32' ? 'postgres.exe' : 'postgres'), ['--version']) : probe('postgres', ['--version']),
  mailpit: secrets ? probe(secrets.mailpit.executable, ['version']) : probe('mailpit', ['version']),
  dependenciesInstalled: fs.existsSync(path.join(root, 'node_modules/tsx/package.json')),
  ports: Object.fromEntries(await Promise.all([5173, 5174, 3000, 5433, 1025, 8025].map(async port => [port, await free(port) ? 'available' : 'occupied (not stopped)']))),
};
console.log(JSON.stringify(report, null, 2));
if (!report.nodeSupported || !report.git) process.exitCode = 1;
if (!report.postgres && !report.dockerCompose) console.log('No PostgreSQL yet. Windows x64: node scripts/platform-runtime.mjs setup. Docker option: docs/LOCAL_SETUP.md. No global installation or firewall change is performed.');
