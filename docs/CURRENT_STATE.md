# IXD Current State

核对日期：2026-09-28（Asia/Shanghai）。平台 M1～M6 与23项验收保留，见 [PLATFORM_VERIFICATION](PLATFORM_VERIFICATION.md)；最新一轮前台星图与赛事改造见 [STAR_MAP_REDESIGN](STAR_MAP_REDESIGN.md)。实际状态以当前 Git/运行结果为准；长期原则见 [IXD_SPEC](IXD_SPEC.md)，接手规则见 [AGENTS](../AGENTS.md)。

## 1. 仓库、分支和恢复基线

- 用户仓库：Jc-augenstern/rine-webui-ixd；唯一平台分支：feat/ixd-platform-v1。
- 平台实现提交：6b6b783；通知权限补丁：dc4f456。最终交付文档提交见本分支历史；不改 main。
- 起点及只读 archive/ixd-beta-0.4、v0.4.0 的 peeled commit 均为 37cfd60142d79ada1bd473fa2ff791dd64122631，封存引用未移动。
- origin 为用户 Fork；zwh087383/rine-webui-ixd 仅为只读 upstream，push URL 故意无效，并保留 pre-push 目标保护。
- 本轮不公开部署，不购买服务器或修改 DNS。旧视觉归档不包含平台数据库，也不能替代备份。

## 2. 实际完成的能力

| 层 | 实现与数据来源 |
| --- | --- |
| 星图前台 | 原生 TypeScript/Three.js；六业务主星、CORE 六方向二级图、直接列表/详情链接、搜索筛选分页及个人中心。复用原 renderer，运营内容读真实 API。 |
| 登录 | 注册、SMTP 邮箱验证、真实登录、退出、会话恢复、改密/重置、停用限制；原登录视觉、授权/Welcome/星门保留，访客可读公开内容。 |
| 独立后台 | React/Vite 独立入口/构建，无银河音频；九种内容类型、专属表单、媒体选择/引用、用户/授权、申请成员/报名、站点设置与审计。 |
| 内容发布 | 不可变版本、草稿/公开/定时版本隔离、预览、发布、撤回、归档、引用保护删除和乐观锁。后台发布无需 build 即被前台后续读取。 |
| 用户协作 | 真实收藏/提醒、公告已读、参赛意向、项目申请/审批/撤回/成员、活动报名/取消、投稿审核和站内通知。并发名额由 PostgreSQL 事务控制。 |
| 认证授权 | Argon2id、HttpOnly Cookie、CSRF/Origin/限流、服务端会话版本与墓碑撤销；USER/EDITOR/ADMIN、方向/资源/动作/字段授权及独立成员身份。 |
| 存储与任务 | 配置化持久 LocalStorage，图片内容清理、受限静态 PDF/TXT、私有下载和历史引用保护；数据库持久任务含重试、租约、去重及附件删除 outbox。 |
| 运维 | 本机 PostgreSQL/Mailpit，完整启动/停止/健康检查、生产 CLI 初始化/恢复、Compose/Nginx 配置及真实独立备份恢复。 |

六类业务内容全部由后台维护；方向、路线、社团介绍、加入方式、联系文案、站点节点名称/开关/预设同样写入数据库。没有签到、考勤、签到码或相关数据库结构。

旧固定 Demo 认证已删除。账户、内容、业务行为、会话、令牌哈希、任务、通知、媒体引用、版本和审计都在 PostgreSQL；附件字节在持久目录。后台角色、兴趣方向、社团成员身份互不自动提升。私人业务历史及通知不会授予已撤销的关联内容权限。

## 3. 当前本机入口与操作

最新前台增量：六个一级主星拥有栏目专属图形与局部动效；公告、个人中心与六方向原造型保留。CORE 详情的六个文字捷径已移除，主要入口驱动同一 SVG 放大后进入固定六方向小型星系，逆向返回 CORE 详情，再关闭才回一级图。赛事列表采用紧凑筛选和精度/时区感知的时间标尺，未知时间不显示比例。一级星图不再生成“探索社团节点”浮层。代码、逐项验证和继续开发方法见 [本轮报告](STAR_MAP_REDESIGN.md)。

- 前台：[http://127.0.0.1:5173/](http://127.0.0.1:5173/)
- 后台：[http://127.0.0.1:5174/admin/](http://127.0.0.1:5174/admin/)
- API：[http://127.0.0.1:3000/api/v1/health](http://127.0.0.1:3000/api/v1/health)
- 本地测试收件箱：[http://127.0.0.1:8025/](http://127.0.0.1:8025/)

浏览器统一用 127.0.0.1；前后台代理同一 API，未开放任意来源凭据 CORS。数据库与 SMTP 仅本机绑定 5433/1025。实际地址以启动健康检查为准。

开发三类随机身份只保存在本机被忽略的 [.local/development-accounts.json](../.local/development-accounts.json)。在编辑器查看 accounts 中 ADMIN/EDITOR/USER 的用户名和密码；不要把密码复制进公开文档、聊天或 Git。前台开场后进入原登录界面，后台地址直接显示独立登录页。注册/重置邮件到测试收件箱，不向真实用户发开发邮件。

首次运行按 [LOCAL_SETUP](LOCAL_SETUP.md)：npm ci → env:check → env:setup → db:migrate → db:seed → platform:start。日常 npm run platform:start / platform:status / platform:stop；停止保留全部数据，只操作确认属于本控制器的进程。全套停止/重启已实测。

npm run dev 仍启动前台热更新；npm run dev:api / dev:admin 可独立开发。总控制器的 API 不自动 watch，后端源码修改后重启；不要同时占用同一端口。npm run build 生成 dist，build:all 另生成 admin/dist 和 server/dist。

## 4. 验证与局限

以下平台全套测试为 2026-09-27 的历史验收。2026-09-28 的新增前台验证单独见 [STAR_MAP_REDESIGN](STAR_MAP_REDESIGN.md)；本轮有意修改 glyph、星图 UI 与平台前台展示，未修改下列开场/银河、认证、后台、API 或数据库代码。

- 真实 PostgreSQL/SMTP 平台测试 22/22（含父测试）；前台认证 11/11、缓存保护、原内容 18/18、配色/视口及全部构建通过。
- 后台真实表单覆盖六类内容、方向/路线/页面、附件、用户授权、冲突保留输入；跨角色公告发布、申请审批两条实际录屏在 .tools/platform-frontend-real/videos/。
- 前台普通/深浅/手机/减少动态效果、全部栏目/个人中心、重新申请与方向关联闭环已通过。生产包 PWA 12 项通过，818 缓存项均为静态资源；退出/换账号/离线无私人数据，API 故障真实报错。
- 修改前视觉基准保留在 .tools/platform-baseline。原开场、Welcome、星门、银河、尾流、glyph 和原 CSS 源未改写；平台接线变化已作独立比对。最终动态连续性175项、星体210项/26旅程、尾流32项及真实指针3项通过，见验收报告。
- 真实 PostgreSQL 重启、22 表完整行摘要、5 个附件哈希及非空收藏持久性通过；恢复到独立新库/目录，未覆盖当前数据。
- 干净目录安装、迁移、seed、全构建、独立三组件启动/登录通过；生产空库根目录 npm 管理员初始化、两次幂等导入、密码恢复也通过。
- 本机无 Docker，容器配置仅静态/语法检查；真实 Linux/Docker、域名 TLS、外部 SMTP、真机 Safari/不同 GPU、大规模负载仍需上线环境验证。原较大视觉 bundle 和 34 MiB 静态 PWA 包的限制仍在。

## 5. 后续接手与文档索引

先读 AGENTS、IXD_SPEC、本文，再核对 Git、运行进程和 [PLATFORM_PLAN](PLATFORM_PLAN.md)。代码入口为 src/platform/、src/auth/、src/ixd-experience.ts、src/ui/star-map-ui.ts；后台 admin/src/；API server/src/；共享契约 shared/platform.ts；SQL 迁移 server/migrations/。

- [CONTENT_MODEL](CONTENT_MODEL.md)：所有可编辑字段与前后台映射。
- [API](API.md)、[PERMISSIONS](PERMISSIONS.md)：字段、状态、权限与错误契约。
- [ADMIN_GUIDE](ADMIN_GUIDE.md)：发布、赛事时间、申请报名、用户、附件和密码恢复。
- [DEPLOYMENT](DEPLOYMENT.md)：同域生产配置、环境变量、TLS/SMTP/密钥与人工上线检查。
- [BACKUP_RESTORE](BACKUP_RESTORE.md)：数据库和上传同时备份、独立恢复、秘密单独保管。
- [PLATFORM_VERIFICATION](PLATFORM_VERIFICATION.md)：23 项逐条证据、录屏、局限与交付审核。

新增数据库结构必须追加迁移，禁止改写已执行迁移；幂等导入不覆盖运营编辑。新 checkout 执行 node scripts/setup-safe-remotes.mjs 恢复远程保护。当前平台分支继续开发，不重新覆盖旧视觉快照；历史 BETA/DELIVERY/部署文档中的 Demo、旧主星、域名和授权只作溯源。
