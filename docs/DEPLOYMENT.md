# IXD 平台部署准备

本轮不购买服务器、不改 DNS、不发布公开网站。这里提供可执行配置与上线前步骤；本机未安装 Docker，因此容器构建、正式域名、真实 SMTP 和 TLS 尚需在目标服务器验证。

## 拓扑与需要准备的内容

第一版采用同域：`https://实际域名/` 为前台，`/admin/` 为后台，`/api/v1/` 为 API。Nginx 终止 HTTPS、分开处理前后台静态页面和 API。数据库和 API 没有宿主机公开端口；只有 Nginx 的 80/443 按配置暴露。

准备 Linux 服务器、Docker Engine/Compose、域名、对应 TLS 证书、真实 SMTP 服务，以及独立随机数据库密码和会话密钥。容量根据真实用户及附件规模监测扩容，当前代码验收不构成某一并发容量承诺。

配置文件：

- `deploy/Dockerfile`：独立 API 与 Web 生产镜像目标；Node 编译后运行，不使用开发服务器。
- `deploy/compose.production.yml`：PostgreSQL、API、Nginx、健康检查、持久卷和日志大小限制。
- `deploy/nginx.conf.template`：HTTPS、同域 API、`/admin/` 独立 fallback、敏感响应不缓存。
- `deploy/.env.example`：空白秘密模板；复制到受保护目录后填写，真实值不进 Git。
- `deploy/init-postgres.sh`：只在全新卷建立非超级用户应用角色和数据库，不在每次启动覆盖数据。

镜像版本为 Node 24.18.0、PostgreSQL 17.11、Nginx 1.30.5；上线前核对镜像可用性与安全更新，完成验证后可进一步固定 digest。依据：[PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)、[Nginx 官方镜像](https://hub.docker.com/_/nginx)、[Compose 健康检查依赖](https://docs.docker.com/compose/how-tos/startup-order/)。

## 配置与首次启动

1. 在服务器检出经审核的 `feat/ixd-platform-v1` 提交；保留提交 SHA，勿从旧视觉归档运行平台迁移。
2. 复制模板为受保护的 `production.env`。填写数据库两份不同的 URL-safe 随机密码（建议至少 32 随机字节）、至少 32 字符的随机 `SESSION_SECRET`、域名、SMTP 与证书目录。证书目录必须含 `fullchain.pem` 和 `privkey.pem`。API 不接受生产 Mailpit/localhost SMTP。
3. 模板默认 `HTTP_BIND/HTTPS_BIND=127.0.0.1`，用于本机配置审查；仅在批准上线并配置防火墙后设为所需服务地址。不要通过关闭防火墙解决端口问题。
4. 当前 Compose 使用独立网段 `172.30.42.0/24`，Nginx 地址 `.2`、API `.3`，API 只信任 `.2/32` 的转发头。如果与服务器已有网络冲突，修改网段、两个静态地址以及 `TRUST_PROXY_CIDR`，保持它们一致，不设为信任任意代理。
5. 在仓库根目录执行（将环境文件路径替换为实际值）：

```sh
docker compose --env-file /secure/production.env -f deploy/compose.production.yml config --quiet
docker compose --env-file /secure/production.env -f deploy/compose.production.yml build
docker compose --env-file /secure/production.env -f deploy/compose.production.yml up -d db
docker compose --env-file /secure/production.env -f deploy/compose.production.yml run --rm api node server/dist/server/src/cli.js migrate
docker compose --env-file /secure/production.env -f deploy/compose.production.yml run --rm api node server/dist/server/src/cli.js admin-init --username YOUR_ADMIN --email YOUR_EMAIL --output /data/private/admin-first-access.json
docker compose --env-file /secure/production.env -f deploy/compose.production.yml run --rm api node server/dist/server/src/cli.js content-import --username YOUR_ADMIN
docker compose --env-file /secure/production.env -f deploy/compose.production.yml up -d api web
```

生产不运行 `seed-dev`；测试账号不会自动注入。首个管理员不会由第一个公开注册者获得。初始化输出保存在私有卷，按本地受控方式取出后妥善保管，登录后修改密码。私有卷不映射到 Nginx。

`admin-init` 同时为全新库初始化默认站点节点设置。`content-import` 是可选的受控初稿导入：以指定有效管理员的身份导入用户提供的六方向介绍、关于社团和加入说明，共八项，不创建开发账号或虚构业务示例。重复导入不覆盖后台已编辑的资料。也可跳过导入，登录后台自行新增正式内容。在本地源码环境对应命令为 `npm run content:import -- --username YOUR_ADMIN`。

服务器命令行恢复已有管理员访问时使用（不提升普通账号角色）：

```sh
docker compose --env-file /secure/production.env -f deploy/compose.production.yml run --rm api node server/dist/server/src/cli.js admin-recover --username YOUR_ADMIN --output /data/private/admin-recovery-UNIQUE.json
```

恢复会生成新随机密码、撤销旧会话并记录审计；输出文件必须使用未存在的私有路径。

本次在独立空 PostgreSQL 库中实际执行了生产模式 CLI，以及文档对应的根目录 `npm run db:migrate`、`npm run admin:init -- ...`、`npm run content:import -- ...`（两次）、`npm run admin:recover -- ...`。结果为 1 个管理员、6 方向和 2 页面、默认站点设置已发布、无开发业务示例；新恢复密码校验成功，旧密码失败，恢复有审计记录。证据在本机 `.local/production-cli-verification.json`，未连接正式 SMTP 或启动公开生产服务。

验证 `/api/v1/health`、前台访客内容、真实用户登录、Cookie Secure/HttpOnly/SameSite、后台登录和权限、附件访问、SMTP 验证和重置邮件、任务重启与内容发布。缺少邮件配置会失败，不假装已经发送。

## 更新与运行维护

更新前执行数据库和附件一致备份，再审阅新增迁移；先构建镜像，维护窗口内执行迁移后启动新版本。迁移文件带校验，已经应用的迁移不可直接改写。

容器 stdout/stderr 通过 Docker `json-file` 每文件 10 MB、最多 5 份轮转；Nginx 日志只记不含查询参数的路径，避免一次性令牌进入访问日志。API 日志不打印请求体、Cookie 和密钥。按学校/社团数据保留要求制定数据库审计与备份保留期限，不自动清空业务记录。

上传文件是 `uploads` 持久卷，数据库是 `database` 卷，管理员交付文件是 `private` 卷。重建容器不会重建卷。停止用 `docker compose ... stop`；不自动执行 `down -v`、数据库 reset 或清空上传目录。

后台日常操作见 [ADMIN_GUIDE.md](ADMIN_GUIDE.md)，备份恢复见 [BACKUP_RESTORE.md](BACKUP_RESTORE.md)。需要配置管理员二次认证、运营审查、监控告警和真实设备/真实邮件渠道测试后再正式上线；当前没有宣称已实现管理员二次认证或系统“绝对安全”。

## 迁移与回滚边界

迁移时分别搬迁：数据库内容、上传文件、服务器秘密/SMTP/TLS 配置、代码版本。GitHub 只保存代码、迁移和公开模板。

切回旧 Git tag 不会回滚数据库。`v0.4.0` 是无后端的视觉恢复入口，不是数据库备份。上线版本回滚须先确认旧代码兼容当前 schema，或在受控维护窗口使用经测试的数据库与附件备份；恢复到生产前必须人工核对目标并保护现有数据，禁止直接把恢复演练脚本改为覆盖线上库。
