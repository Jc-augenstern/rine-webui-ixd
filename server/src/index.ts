import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs.js';

async function main() {
  const { app, ctx } = await buildApp(loadConfig());
  await app.listen({ host: ctx.config.host, port: ctx.config.port });
  const stopJobs = startJobs(ctx);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (closing) return; closing = true;
    void Promise.resolve(stopJobs()).then(() => app.close()).then(() => process.exit(0));
  });
}
main().catch(() => { console.error('IXD API 启动失败。请检查数据库、环境变量及端口；未启动替代或 Mock 服务。'); process.exitCode = 1; });
