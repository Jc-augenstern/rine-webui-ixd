# IXD Current State

**核对日期：2026-09-27（Asia/Shanghai）。平台开发进行中，尚未最终交付。**

本文件描述当前平台工作区，不能用旧视觉版报告代替平台验收。长期规范见 [IXD_SPEC](IXD_SPEC.md)，开发边界见 [AGENTS](../AGENTS.md)，完整验收账本见 [PLATFORM_PLAN](PLATFORM_PLAN.md)。2026-09-23 的原视觉状态可从只读 v0.4.0 标签恢复。

## 1. 分支与恢复基线

- 仓库：Jc-augenstern/rine-webui-ixd；当前分支：feat/ixd-platform-v1。
- 平台分支起点、archive/ixd-beta-0.4、v0.4.0 均为 37cfd60142d79ada1bd473fa2ff791dd64122631。封存引用不动，main 不改。
- origin 是用户 Fork；zwh087383/rine-webui-ixd 只读 upstream，push URL 为故意无效地址，pre-push hook 限定写入目标。
- 当前功能改动尚未完成最终验证和推送；实时 Git 状态优先于本文。

## 2. 当前代码与实际能力

| 层 | 当前实现 | 验证边界 |
| --- | --- | --- |
| 原生星图前台 | 真实 API/CSRF 会话适配，注册/访客/恢复/邮箱链接；六业务栏目、CORE 二级方向、个人资料/收藏/申请/报名/投稿/通知 | TypeScript 与迁移后的认证测试通过；真实浏览器全链路、视觉回归进行中 |
| 独立后台 | React/Vite 中文侧栏、九种内容编辑表单、日期精度、岗位/路线、媒体、用户授权、申请/报名、配置、日志 | 独立构建与首轮 21 项真实 UI 检查通过；尚待全项验收 |
| API | Fastify 模块化认证、授权、内容、协作、任务、媒体、用户和审计 | 构建通过；真实 PostgreSQL 集成测试持续补充与复跑 |
| 数据库 | pg 参数化 SQL、版本化迁移；内容草稿/公开/计划版本、会话、邮箱令牌、用户行为、通知、附件引用、审计 | 开发库与专用测试库真实迁移、幂等复跑；未使用浏览器 Mock 后端 |
| 认证 | Argon2id、HttpOnly Cookie、CSRF、Origin、限流、邮件一次性令牌、会话墓碑与 auth_version 撤销 | 注册/验证/重置/密码变更/注销、拒绝越权、并发最后管理员等真实数据库测试通过 |
| 附件 | 持久本地 Storage；PNG/JPEG/WebP、受限静态 PDF、UTF-8 TXT；私有访问与版本引用保护 | 实际字节上传、类型/主动内容拒绝、下载隔离与引用保护测试通过 |
| 运维 | 便携 PostgreSQL/Mailpit 运行；正式一键启动/备份/部署脚本正在形成 | 尚未完成干净环境、独立恢复、生产环境验收；未公开部署 |

没有签到、考勤、签到码或签到表。生产部署、真实 SMTP 与管理员二次认证等上线加固不以本地测试结果冒充已上线。

## 3. 本机运行与测试身份

当前实际地址：

- 前台：[http://127.0.0.1:5173/](http://127.0.0.1:5173/)
- 后台：[http://127.0.0.1:5174/admin/](http://127.0.0.1:5174/admin/)
- API 健康检查：[http://127.0.0.1:3000/api/v1/health](http://127.0.0.1:3000/api/v1/health)
- 测试收件箱：[http://127.0.0.1:8025/](http://127.0.0.1:8025/)

前后台都通过开发代理访问同一 API，统一使用 127.0.0.1。数据库本机端口 5433，SMTP 本机端口 1025。不要随意终止占用端口的其他项目。

开发随机 ADMIN / 受限 EDITOR / USER 的凭据位于仓库内被 Git 忽略的 [.local/development-accounts.json](../.local/development-accounts.json)，仅本机读取。旧 ixd-demo 固定账号已移除，不能绕过真实认证。访问前台后保留原开场与登录视觉，成功认证接续 Welcome/星门；公开内容可选访客进入。

当前已可运行的命令：npm run db:migrate、npm run db:seed、npm run dev、npm run dev:api、npm run dev:admin、npm run test:platform、npm run build:all。迁移只加结构，开发 seed 幂等，不覆盖管理员后续编辑。正式单命令启动及完整 README 正在验收前完善。

本地注册和重置邮件发送到 Mailpit，在收件箱打开对应邮件链接。接口不返回验证/重置令牌；生产配置拒绝本地测试 SMTP 和开发种子。

## 4. 模块入口

| 范围 | 入口 |
| --- | --- |
| 平台前台 API、路由与业务 UI | src/platform/、src/auth/、src/ixd-experience.ts、src/ui/star-map-ui.ts |
| 保留视觉渲染 | src/galaxy/、src/boot.ts、src/ui/ixd-portal.ts、src/ui/galaxy-glyph.ts |
| 后台 | admin/src/、admin/vite.config.ts；独立 admin/dist |
| API 注册和进程 | server/src/app.ts、index.ts、config.ts |
| 认证和权限 | auth.ts、mail.ts、session-store.ts、security.ts、users.ts |
| 内容/业务/任务 | content.ts、content-responses.ts、business.ts、jobs.ts、content-notifications.ts |
| 附件 | media.ts、storage.ts；文件在可配置持久目录，默认 .local/uploads |
| 迁移/CLI/导入 | server/migrations/、db.ts、cli.ts、seed.ts |
| 契约 | shared/platform.ts；字段、状态、DTO 与表单定义共同维护 |
| 安全与业务验证 | server/test/；scripts/check-ixd-auth.mjs、check-platform-cache.mjs；真实浏览器证据 .tools/ |
| 运维 | scripts/platform-*.mjs、deploy/；进度以文件和实测结果为准 |

## 5. 验证和已知待办

已完成 M1；M2 公告后台/API 纵向链路通过，前台跨 UI 视频正在验证。M3～M6 的代码持续集成，不能据此宣布全部完成。

- 修改前视觉基准在 .tools/platform-baseline：四段录屏、29 文件哈希、主题/移动/降级/星体与尾流回归。平台修改后的完整视觉比较仍待完成。
- 独立后台首轮证据在 .tools/admin-ui-review；前台真 API 验证在 .tools/platform-frontend-real。测试数字可能随复跑变化，以结果文件及平台验收报告为准。
- PWA 已显式绕过 API、后台、媒体及敏感查询参数；退出/换账号的实际生产 PWA 验收仍待完成。
- 原 check:palette 浅色假设已迁移；PWA 初始颜色与原有默认深色统一。银河配色、运动参数没有因此改变。
- 仍须完成全部 23 项最终验收，特别是生产 PWA、数据库进程重启、独立备份恢复、干净环境安装与全部视觉回归；完成前不推送最终成果。
- 历史大 bundle、真实手机/Safari/GPU 覆盖不足仍需如实注明。本机桌面视口不能证明所有设备表现一致。

## 6. 接手顺序

先读 AGENTS、IXD_SPEC、本文，再读 PLATFORM_PLAN/CONTENT_MODEL/API/PERMISSIONS；检查当前 Git、运行进程和相关源码。新工作继续此平台分支，不重新 clone、不从旧视觉版整目录覆盖。

历史 BETA05/BETA04、GALAXY、DELIVERY、VERIFICATION、PWA 和原部署记录保留技术溯源价值；其中旧 Demo、旧主星导航、旧域名/推送授权不是平台当前规范。封存视觉 Tag 是代码恢复入口，不是数据库/附件备份；回滚代码必须另行评估迁移兼容和数据恢复。
