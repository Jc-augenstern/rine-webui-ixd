# IXD 平台本地启动

平台代码位于 `feat/ixd-platform-v1`。旧视觉归档 `v0.4.0` 不包含数据库。前台、后台和 API 使用同一套 PostgreSQL 数据，不使用 Mock 作为联调后端。

## Windows 首次准备

需要 Git、Node.js 24 或更高版本及 npm。进入仓库根目录后执行：

```powershell
npm ci
node scripts/platform-check.mjs
node scripts/platform-runtime.mjs setup
npm run db:migrate
npm run db:seed
node scripts/platform-services.mjs start
```

`setup` 使用 PostgreSQL 17.11 与 Mailpit 1.31.2 的 Windows x64 便携包，只写项目内被忽略的目录，不修改全局 PATH、Windows 服务、防火墙或安全设置。首次下载约 390 MB；解压后需要额外磁盘空间。下载失败会保留 `.partial`，请检查网络与该文件后处理，不会自动覆盖已有数据库。

新环境二进制在 `.local/runtime/`，数据库在 `.local/postgres/`，测试邮件在 `.local/mailpit.db`。本次已准备环境的二进制路径由 `.local/runtime-secrets.json` 记录；正式脚本支持复用，不依赖临时研究脚本。PostgreSQL 应用角色没有超级用户、创建角色或创建数据库权限；开发库 `ixd_platform_dev` 与测试库 `ixd_platform_test` 分开。

下载来源：[PostgreSQL Windows 官方入口](https://www.postgresql.org/download/windows/)、[EDB 二进制目录](https://www.enterprisedb.com/download-postgresql-binaries)、[Mailpit 官方安装说明](https://mailpit.axllent.org/docs/install/)。脚本固定文件摘要。Mailpit 摘要匹配 GitHub 发布资产；PostgreSQL 摘要来自本次官方 HTTPS 下载的固定文件，并核对了官方响应的 multipart ETag，**不是声称 EDB 发布了 SHA256 签名**。

## 日常进入

| 入口 | 默认地址 |
| --- | --- |
| 星图前台 | `http://127.0.0.1:5173/` |
| 管理后台 | `http://127.0.0.1:5174/admin/` |
| API 健康检查 | `http://127.0.0.1:3000/api/v1/health` |
| 测试收件箱 | `http://127.0.0.1:8025/` |

浏览器始终使用 `127.0.0.1`，不要混用 `localhost`。前台和后台的 `/api` 都由各自 Vite 代理到同一 API；没有开放携带凭据的任意来源 CORS。

启动、状态与停止：

```powershell
node scripts/platform-services.mjs start
node scripts/platform-services.mjs status
node scripts/platform-services.mjs stop
```

总启动会启动本项目便携数据库、测试邮件、API（包含持久化任务循环）、前台、后台，并验证实际响应。API 校验固定 `ixd-platform-api` 标识；复用已有 API 还须确认监听进程命令属于当前 checkout，无法确认时拒绝接管。它不自动重新迁移或 seed。API 源码修改后需停止并重新启动；独立开发也可用 `npm run dev:api` 获得自动重启。前台和后台使用 Vite 热更新。短维护可用 `node scripts/platform-services.mjs pause-api` 仅暂停本控制器启动的 API/任务，保持 PostgreSQL 供备份使用，之后 `start` 恢复。

停止保留数据库、上传文件、邮件和凭据。控制器只停止由它记录、且 PID/创建时间/命令仍一致的进程；端口上已有正常服务时可复用，但未接管的进程不在停止范围内。只要仍有未接管的应用运行，数据库与邮件依赖也保持运行。它会明确报告被保留的服务。请在原启动终端按 Ctrl+C 停止这些服务，再用总启动统一管理；不要随意杀死端口上的其他项目。

端口冲突会报错，不静默改端口或关闭其他程序。日志位于 `.local/logs/`。可分别用 `node scripts/platform-runtime.mjs start|stop|status` 控制数据库与邮件工具。

## 开发身份与测试邮箱

运行 `npm run db:seed` 后，管理员、受限编辑者和普通用户的随机开发密码只保存在：

```text
.local/development-accounts.json
```

字段为 `accounts` 数组，每项含 `role/username/email/password/id`。请在本机编辑器打开文件查看，不将密码贴到公共聊天、README 或 Git。初始化幂等，不覆盖管理员后来编辑的内容或密码。旧 Demo 账号不能绕过服务端认证。

数据库随机凭据在 `.local/runtime-secrets.json`；应用会话密钥在 `.local/app-secrets.json`。这些都必须保留在 Git 忽略目录。

注册后打开测试收件箱，按收件人查找验证邮件并点击验证链接；忘记密码同样在这里取得一次性重置链接。开发 SMTP 只投递到本地捕获服务，不向真实用户发测试邮件，正式 API 不直接返回验证或重置令牌。

## 单独构建与验证

```powershell
npm run build:all
npm run test:platform
```

输出分别是前台 `dist/`、后台 `admin/dist/`、API `server/dist/`。`npm run build` 继续只构建原前台。API 的生产启动用编译后的 Node 文件，不使用 Vite preview 充当生产服务器。

平台 API 测试必须使用 `TEST_DATABASE_URL` 指向名称以 `_test` 结尾的专用库；不能指向未知或生产数据库。浏览器验收使用隔离用户上下文，具体结果见平台验收报告。这里只给运行方法，不把脚本存在当作已验证。

本次已将当时当前可提交源文件复制到 `.tools/clean-platform-1790488853755` 的干净目录，未复制旧依赖、构建、数据库或凭据；实际通过 `npm ci`、迁移、开发 seed、`build:all`、独立 API/前后台启动及新管理员真实登录。使用全新 `ixd_clean_1790488853755_test` 数据库，验证后仅停止自己的临时进程，记录位于 `.local/clean-install-verification.json`。后续源代码变更仍以最终构建与验收报告为准。

正式控制器也已做整套实测：核实历史 Vite 进程与当前源码归属后，移交给控制器启动；执行 `platform:stop` 后，3000/5173/5174/5433/1025/8025 六个端口全部关闭，再 `platform:start` 全部恢复。22 张数据库表的整行摘要、非空收藏及 5 个上传文件的 SHA256 保持一致，最终保留服务运行。证据位于 `.local/controller-lifecycle-verification.json`。

## Docker Compose 可选方案

Docker 不是当前 Windows 便携方案的前置条件。本机未安装 Docker，容器启动尚未在本机验证。已有 Docker 的 Linux/macOS/Windows 可使用：

1. 将 `deploy/.env.example` 复制到被忽略的 `.local/compose.env`，填写独立随机 `POSTGRES_ADMIN_PASSWORD`、`POSTGRES_APP_PASSWORD`，不要写入 Git。
2. 先停止同端口的便携 PostgreSQL/Mailpit，再执行：

```text
docker compose --env-file .local/compose.env -f deploy/compose.local.yml up -d
```

3. 在仓库 `.env` 配置应用连接（将占位值换成上一步密码）：

```dotenv
DATABASE_URL=postgresql://ixd_platform:URL_SAFE_RANDOM_PASSWORD@127.0.0.1:5433/ixd_platform_dev
TEST_DATABASE_URL=postgresql://ixd_platform:URL_SAFE_RANDOM_PASSWORD@127.0.0.1:5433/ixd_platform_test
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
```

4. 按上文迁移、seed，再启动三个应用进程。Compose 模式不要同时启动旧的便携运行时；如同一 checkout 保留了便携运行时凭据，请分别用 `npm run dev`、`npm run dev:admin`、`npm run dev:api` 启动应用。
5. 停止时使用 `docker compose ... stop`。**不要使用 `down -v`**，它会删除持久化数据卷。

生产环境、管理员初始化及备份分别见 [DEPLOYMENT.md](DEPLOYMENT.md)、[ADMIN_GUIDE.md](ADMIN_GUIDE.md)、[BACKUP_RESTORE.md](BACKUP_RESTORE.md)。
