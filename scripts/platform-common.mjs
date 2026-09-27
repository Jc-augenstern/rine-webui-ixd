import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const local = path.join(root, '.local');
export const logs = path.join(local, 'logs');
export const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function save(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); }
export function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${path.basename(exe)} failed (exit ${result.status}). ${result.stderr || result.error?.message || 'Inspect the local logs.'}`);
  return result.stdout;
}
export function assertIgnored() {
  run('git', ['check-ignore', '.local/runtime-secrets.json']);
}
export function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
export function free(port) {
  return new Promise(resolve => { const socket = net.connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true)); socket.setTimeout(1500, () => { socket.destroy(); resolve(false); }); });
}
export async function waitPort(port) {
  for (let count = 0; count < 80; count++) { if (!(await free(port))) return; await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error(`Port ${port} did not become ready. Inspect .local/logs.`);
}
export function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === 'win32') {
    const output = run('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`]);
    if (!output.trim()) return null;
    const item = JSON.parse(output); return { pid: item.ProcessId, exe: item.ExecutablePath, command: item.CommandLine, created: item.CreationDate };
  }
  try {
    const command = run('ps', ['-p', String(pid), '-o', 'args=']).trim();
    const created = run('ps', ['-p', String(pid), '-o', 'lstart=']).trim();
    return command ? { pid, command, created, exe: '' } : null;
  } catch { return null; }
}
export function ownedProcess(record) {
  if (!record) return false;
  const actual = processInfo(record.pid);
  return !!actual && actual.created === record.created && actual.command === record.command && actual.command.includes(record.identity);
}
export function listeningProcess(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  try {
    const output = process.platform === 'win32'
      ? run('powershell.exe', ['-NoProfile', '-Command', `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`])
      : run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    const pids = [...new Set(output.trim().split(/\s+/).filter(Boolean).map(Number))];
    return pids.length === 1 ? processInfo(pids[0]) : null;
  } catch { return null; }
}
export async function launch(exe, args, { name, identity, cwd = root, env = process.env, port }) {
  if (!(await free(port))) throw new Error(`Port ${port} is occupied. No existing process was stopped.`);
  fs.mkdirSync(logs, { recursive: true });
  const out = fs.openSync(path.join(logs, `${name}.stdout.log`), 'a');
  const err = fs.openSync(path.join(logs, `${name}.stderr.log`), 'a');
  const child = spawn(exe, args, { cwd, env, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
  child.unref(); fs.closeSync(out); fs.closeSync(err);
  await waitPort(port);
  const info = processInfo(child.pid);
  if (!info?.command?.includes(identity)) throw new Error(`Cannot verify ${name} process identity.`);
  return { ...info, name, identity, port };
}
export async function stopProcess(record) {
  if (!ownedProcess(record)) return false;
  if (process.platform === 'win32') run('taskkill.exe', ['/PID', String(record.pid), '/T', '/F']);
  else process.kill(record.pid, 'SIGTERM');
  for (let count = 0; count < 40; count++) { if (await free(record.port)) return true; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Owned process ${record.name} has not released port ${record.port}. Data was retained.`);
}
