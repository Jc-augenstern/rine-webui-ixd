# IXD · STAR MAP / ANALYSIS OS

保留 IXD 开场、Welcome、星门、银河与星体旅程的社团内容与协作平台。原生 TypeScript / Three.js 前台，独立 React 管理后台，Fastify API 与 PostgreSQL 数据库。

工作仓库：[Jc-augenstern/rine-webui-ixd](https://github.com/Jc-augenstern/rine-webui-ixd)。开发分支：feat/ixd-platform-v1。只读视觉基线 archive/ixd-beta-0.4 / v0.4.0 均为 37cfd60142d79ada1bd473fa2ff791dd64122631。本地 M1～M6 与23项验收已完成，逐项证据、实测范围及上线前待配置事项见 [平台验收报告](docs/PLATFORM_VERIFICATION.md)。

## 在 Windows 本地开始

需要 Git、Node.js 24 和 npm。在项目根目录的 PowerShell 中依次运行：

```powershell
npm ci
npm run env:check
npm run env:setup
npm run db:migrate
npm run db:seed
npm run platform:start
```

首次 setup 下载本地便携 PostgreSQL 和 Mailpit，不安装系统服务、不改全局安全设置。已有环境按 [LOCAL_SETUP](docs/LOCAL_SETUP.md) 复用；非 Windows 可用文档中的 Docker Compose 本地依赖方案。数据库、上传、测试邮件和随机凭据均保留在被 Git 忽略的本地目录。

| 入口 | 地址 |
| --- | --- |
| 星图前台 | [127.0.0.1:5173](http://127.0.0.1:5173/) |
| 管理后台 | [127.0.0.1:5174/admin/](http://127.0.0.1:5174/admin/) |
| API 健康检查 | [127.0.0.1:3000/api/v1/health](http://127.0.0.1:3000/api/v1/health) |
| 测试收件箱 | [127.0.0.1:8025](http://127.0.0.1:8025/) |

以启动命令实际检查结果为准。前后台统一使用 127.0.0.1，通过 Vite 代理访问 API。端口冲突会报告，不杀死其他项目进程。

日常只需 npm run platform:start；用 npm run platform:status 检查，用 npm run platform:stop 停止本控制器管理的服务并保留数据。独立热更新开发可分别运行 npm run dev、npm run dev:api、npm run dev:admin；不要与同端口总启动重复运行。总启动的 API 修改后需重启，独立 dev:api 可自动重启。

## 登录和邮件

打开前台，保留原开场后进入身份接入界面；可选择访客阅读公开内容。真实登录成功接续 AUTHENTICATING → IDENTITY CONFIRMED → PERMISSION AUTHORIZED → WELCOME → 星门 → 星图。错误、超时或 API 不可用会显示真实反馈。

开发初始化生成 ADMIN、受限 EDITOR、USER 三类随机测试账号，**账号和密码仅在本机 [.local/development-accounts.json](.local/development-accounts.json)**。不要提交或公开这个文件。旧 ixd-demo 公开 Demo 逻辑已移除，不能用于真实平台登录。

注册、验证和重置使用本地 Mailpit。打开收件箱中的邮件链接即可验证邮箱或设置新密码，普通 API 不返回令牌。生产需真实 SMTP，不能启用开发种子或本地捕获邮箱。管理员初始化、忘记密码恢复及日常操作见 [ADMIN_GUIDE](docs/ADMIN_GUIDE.md)。

## 内容与协作

- 公告：草稿、预览、发布、定时、有效期、撤回、已读与明确的重要更新提醒。
- 赛事：官方/内部/作品截止分别维护，保留未知与日期精度；收藏、提醒、内部意向和官网报名分别展示。
- 项目：岗位、容量、申请、批准/拒绝、撤回、成员；服务端事务处理并发。
- 活动：报名窗口、容量、取消报名、变更通知、回顾和资料。不含签到或考勤。
- 学习：六方向资源、路线和步骤，后台维护后前台读取同一数据库。
- 作品：个人草稿、审核、退回、发布、作者和有依据的获奖记录。

CORE 内保留六方向二级星图，复用原 renderer。个人中心提供资料、收藏、申请、参与项目、报名、投稿、通知及账号设置。后台另可维护社团介绍、加入说明、联系渠道、栏目文案及已实现节点预设。内容变更无需重新构建前台。

社团原文来自用户的筹建初稿；典型项目与开发数据均明确标为规划/示例，不冒充真实成员、奖项或赛事日期。

## 构建和验证

```powershell
npm run check:auth
npm run test:platform
npm run check:cache
npm run check:content
npm run check:palette
npm run check:viewport
npm run build:all
```

前台生产产物 dist，后台 admin/dist，服务端 server/dist；均可重新构建，不提交 Git。npm run build 仍单独构建前台。真实数据库测试仅使用专用 _test 库，测试邮件只去本机捕获服务。平台集成测试22/22、原认证迁移测试11/11、全部构建、实际业务录制、生产PWA和视觉回归通过；完整23项验收及尚未验证范围见 [平台验收报告](docs/PLATFORM_VERIFICATION.md)。

未来正式部署使用生产构建、同域反向代理、PostgreSQL 持久卷和正式 SMTP，见 [DEPLOYMENT](docs/DEPLOYMENT.md)。本任务不购买服务器、不改 DNS、不公开部署。npm run dev / Vite preview 不作为长期生产服务。

## 备份与继续开发

[BACKUP_RESTORE](docs/BACKUP_RESTORE.md) 说明维护窗口、数据库与附件一起备份、恢复到全新测试库/目录，以及秘密配置的单独保管。代码回到旧 tag 不会回退数据库；视觉归档不是数据备份。

继续开发前阅读 [AGENTS](AGENTS.md)、[IXD_SPEC](docs/IXD_SPEC.md)、[CURRENT_STATE](docs/CURRENT_STATE.md)，检查当前分支及未提交改动，再按 [API](docs/API.md)、[CONTENT_MODEL](docs/CONTENT_MODEL.md)、[PERMISSIONS](docs/PERMISSIONS.md) 修改对应模块。新增数据库结构使用追加迁移，不编辑已执行 SQL；运营内容在后台维护，视觉算法仍由代码维护。

origin 仅为用户 Fork；zwh087383/rine-webui-ixd 是只读 upstream，禁止写入或向其创建 PR。新检出运行 node scripts/setup-safe-remotes.mjs 恢复保护。最终验证后仅推送 origin/feat/ixd-platform-v1，不修改 main、archive 或 tag，也不由旧部署文档推断当前公开发布授权。

## 保留的原工程

原档案、360° 查看器、美术、音频、设置和版权保留；原工程说明见 [UPSTREAM-README](docs/UPSTREAM-README.md) 与 LICENSE。Beta05/Beta04 等历史验收记录继续用于视觉溯源。Novecento 是单独授权字体，不随 Git 分发，缺少时使用既有内置字形回退；MiSans 分包许可与 MIT 署名保留。
