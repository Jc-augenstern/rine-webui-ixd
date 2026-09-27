import fs from 'node:fs';
import path from 'node:path';
import { root, local, json, save, run, launch, ownedProcess, stopProcess, free, listeningProcess } from './platform-common.mjs';

const command = process.argv[2] ?? 'start';
const stateFile = path.join(local, 'application-processes.json');
const state = fs.existsSync(stateFile) ? json(stateFile) : { root, services: {} };
if (state.root !== root) throw new Error('Service ownership points at another checkout; refusing to stop or replace it.');
const definitions = [
  { name: 'api', port: 3000, file: path.join(root, 'server/src/index.ts'), args: ['--import', 'tsx', path.join(root, 'server/src/index.ts')], cwd: root, url: 'http://127.0.0.1:3000/api/v1/health', marker: '"status":"ok"' },
  { name: 'frontend', port: 5173, file: path.join(root, 'node_modules/vite/bin/vite.js'), args: [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], cwd: root, url: 'http://127.0.0.1:5173/', marker: 'IXD' },
  { name: 'admin', port: 5174, file: path.join(root, 'node_modules/vite/bin/vite.js'), args: [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5174', '--strictPort'], cwd: path.join(root, 'admin'), url: 'http://127.0.0.1:5174/admin/', marker: 'IXD 管理后台' },
];
async function verify(definition) {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(definition.url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        if (definition.name === 'api') { const body = await response.json(); if (body?.data?.status === 'ok' && body?.data?.service === 'ixd-platform-api') return; }
        else if ((await response.text()).includes(definition.marker)) return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`${definition.name} did not return its expected health response. Inspect .local/logs; no Mock was started.`);
}
if (command === 'start') {
  if (process.platform === 'win32' && fs.existsSync(path.join(local, 'runtime-secrets.json'))) run(process.execPath, ['scripts/platform-runtime.mjs', 'start'], { stdio: 'inherit' });
  // Explicitly run existing preparation hooks; these do not seed or overwrite database data.
  run(process.execPath, ['scripts/patch-rolling-number.mjs'], { stdio: 'inherit' });
  run(process.execPath, ['scripts/export-records.mjs'], { stdio: 'inherit' });
  for (const definition of definitions) {
    if (ownedProcess(state.services[definition.name])) { await verify(definition); continue; }
    if (!(await free(definition.port))) {
      if (definition.name === 'api') {
        const listening = listeningProcess(definition.port);
        const command = listening?.command?.replaceAll('\\', '/').toLowerCase();
        if (!command?.includes(root.replaceAll('\\', '/').toLowerCase() + '/server/')) throw new Error('API port is owned by an unknown checkout/process. It was not reused or stopped; stop its original terminal or choose an isolated configuration.');
      }
      await verify(definition);
      console.log(`Reusing responding ${definition.name} on ${definition.port}. It was not started by this controller and will not be stopped by it.`);
      continue;
    }
    const record = await launch(process.execPath, definition.args, { ...definition, identity: definition.file, env: { ...process.env, NODE_ENV: 'development', IXD_ROOT: root } });
    state.services[definition.name] = record; save(stateFile, state); await verify(definition);
  }
  console.log('Front: http://127.0.0.1:5173/\nAdmin: http://127.0.0.1:5174/admin/\nAPI: http://127.0.0.1:3000/api/v1/\nLocal inbox: http://127.0.0.1:8025/');
} else if (command === 'pause-api') {
  if (await stopProcess(state.services.api)) { delete state.services.api; save(stateFile, state); console.log('Owned API/jobs paused. PostgreSQL, mail capture, frontend and admin remain running. Run platform:start after maintenance.'); }
  else if (!(await free(3000))) throw new Error('API is not owned by this controller. Stop its original terminal for maintenance; no process was stopped.');
  else console.log('API is already stopped. PostgreSQL remains available for backup.');
} else if (command === 'stop') {
  const unmanaged = [];
  for (const definition of [...definitions].reverse()) {
    const stopped = await stopProcess(state.services[definition.name]);
    if (stopped) delete state.services[definition.name];
    else if (!(await free(definition.port))) { unmanaged.push(definition.name); console.log(`Port ${definition.port} belongs to an unverified/unmanaged process; left running.`); }
  }
  save(stateFile, state);
  if (unmanaged.length) console.log(`Dependencies retained because unmanaged services remain: ${unmanaged.join(', ')}. Stop their original terminals first, then run platform:stop again.`);
  else if (process.platform === 'win32' && fs.existsSync(path.join(local, 'runtime-secrets.json'))) run(process.execPath, ['scripts/platform-runtime.mjs', 'stop'], { stdio: 'inherit' });
  console.log('Managed services stopped; database, uploads, messages and credentials retained.');
} else if (command === 'status') {
  console.log(JSON.stringify(await Promise.all(definitions.map(async d => ({ name: d.name, url: d.url, owned: ownedProcess(state.services[d.name]), portInUse: !(await free(d.port)) }))), null, 2));
} else throw new Error('Usage: node scripts/platform-services.mjs start|stop|status|pause-api');
