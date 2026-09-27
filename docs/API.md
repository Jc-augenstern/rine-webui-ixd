# IXD 平台 API 契约

本文件是前后端共同实现目标，阶段完成状态与实际验收见 [PLATFORM_PLAN.md](PLATFORM_PLAN.md)，不能把契约存在当作接口已实现。类型、严格字段与长度以 `shared/platform.ts` 为准；数据库字段见版本化 SQL 迁移。JSON 使用 camelCase，数据库使用 snake_case。

## 通用约定

- 相对前缀 `/api/v1`，成功 `{data, meta?}`；列表 meta `{page,pageSize,total}`。错误 `{error:{code,message,fieldErrors?,requestId?}}`。
- HTTP 400 字段错误、401 未登录、403 无功能权限、404 不存在或无资源可见权限、409 版本/状态/名额冲突、413 超限、429 限流、503 服务不可用。
- `page=1&pageSize=20`，上限100；`q/direction/year/difficulty/phase/sort` 按资源支持，排序有 ID 次键。未知字段拒绝。
- Cookie 为服务端可撤销会话。先 GET `/auth/session` 获取安全用户 DTO 或 null 和 `csrfToken`；所有写操作带 `X-CSRF-Token`，包括登录/注册/重置。会话失效或登录/退出后重新获取 CSRF。
- API 全部 `Cache-Control: no-store`。不向客户端返回密码哈希、完整会话ID、邮件令牌或服务器秘密。
- `ContentPayload` 公共字段与 `details` 专属字段均严格白名单。正文为 Markdown，经服务端安全渲染为 bodyHtml；后台不能提交任意可执行 HTML/JS/CSS。
- 所有编辑动作带 `expectedRevision`；失配返回409，客户端保留未保存输入并提示重新读取。用户 ID 取自会话，不接受自行指定他人 ID 的 `/me` 写入。

## 身份与个人资料

| 方法与路径 | 请求/结果 |
| --- | --- |
| GET `/auth/session` | `SessionDTO`，匿名同样可获取 CSRF；实际用户与授权每次从数据库读取 |
| POST `/auth/register` | `username,email,displayName,password`；创建 USER 并发送本地捕获/正式 SMTP 验证信，不返回令牌 |
| POST `/auth/login` | `account,password`，成功返回 SessionDTO 并轮换 Cookie |
| POST `/auth/logout` | 销毁当前会话 |
| POST `/auth/verify-email` | `token`，一次性验证 |
| POST `/auth/resend-verification` | `email`，通用响应与限流 |
| POST `/auth/forgot-password` | `email`，通用响应；不存在邮箱也不泄漏账号存在性 |
| POST `/auth/reset-password` | `token,password`，一次性、限时，撤销用户已有会话 |
| POST `/auth/change-password` | `currentPassword,password`，须登录，撤销其他会话并轮换当前会话 |
| GET/PATCH `/me` | 自己的 SafeUser；修改仅 displayName/grade/major/directionIds/expectedRevision |
| GET `/me/favorites` | 自己收藏及可见内容；登录即可读取，无邮箱验证门槛 |
| PUT/DELETE `/me/favorites/:contentId` | 收藏/取消；PUT 可带 reminderHours（24/72/168小时），返回 contentId/favorited/reminderHours；DELETE 返回 contentId/favorited=false |
| PUT `/me/announcements/:id/read` | 登录用户记录当前有效 attentionRevision；仅此本人已读写入不要求邮箱已验证；返回 id/read/attentionRevision |
| GET `/notifications` / PUT `/notifications/:id/read` | 仅自己的通知及已读状态；登录即可，无邮箱验证门槛。关联内容当前不可见时，两接口均保留通知身份与已读状态，将 title/body 投影为“关联内容当前不可访问”、contentId 置 null；不改写通知历史 |

## 内容与发布

`kind` 仅允许 shared.contentKinds。六类业务与方向/路线/社团页共用生命周期，接口不返回被隐藏的草稿。公开查询按有效发布版本、服务端时间、有效期和用户权限过滤。定时任务未运行也不能提前公开。

| 方法与路径 | 含义 |
| --- | --- |
| GET `/:kind` / `/:kind/:id` | 公开可见版本列表/详情；仅列表允许上述查询字段 |
| GET `/contents/:id` | 通过关联 UUID 读取现有 ContentDTO（含 kind/title）；同一有效发布/时间/成员过滤，无权或隐藏目标返回404，不因管理员身份绕过公开规则 |
| GET `/site-settings` | 已发布站点名称、文案、节点枚举配置 |
| GET `/admin/contents` | 查询受管理范围内列表，额外 kind/state |
| POST `/admin/contents` | `kind,slug?,payload`，创建草稿 |
| GET `/admin/contents/:id` | 管理 DTO，含草稿及现有 publishedPayload，受权限保护的预览 |
| PATCH `/admin/contents/:id` | `expectedRevision,payload`，保存不可变新草稿版本 |
| POST `/admin/contents/:id/publish` | `expectedRevision,publishAt?,expiresAt?,notifyImportantUpdate?`，立即/定时发布 |
| POST `/admin/contents/:id/withdraw` / `archive` | `expectedRevision`，撤回/归档 |
| DELETE `/admin/contents/:id` | `expectedRevision`，只允许无业务/内容引用且未公开的内容；保护引用 |
| POST `/admin/preview` | `id?,kind,payload`，受管理权限控制的安全 Markdown 预览；现有内容传 id，适配单资源授权 |
| GET/PATCH `/admin/site-settings` | 管理草稿，PATCH 带 expectedRevision 和 payload |
| POST `/admin/site-settings/publish` | expectedRevision，单独发布，不影响运行中的 renderer |

公告重新提醒仅在明确选择 `notifyImportantUpdate` 时增加 attentionRevision。普通改字和保存草稿不重置已读。

## 协作与投稿

| 方法与路径 | 含义 |
| --- | --- |
| PUT/DELETE `/competitions/:id/intent` | 内部参赛意向/撤回，与官网报名严格区分 |
| POST `/projects/:id/applications` | `positionId,motivation,portfolioUrl`，一人一项目；服务端事务 |
| POST `/me/applications/:id/withdraw` | expectedRevision；仅本人待处理申请，返回 ApplicationDTO；已撤回重复请求幂等 |
| GET `/me/applications` / `/me/projects` | 自己的申请结果/项目成员状态；登录即可读取 |
| POST/DELETE `/events/:id/registrations` | 空 body 或空对象；报名/取消，行锁+唯一约束，受窗口/容量/状态限制；返回 RegistrationDTO |
| GET `/me/registrations` / `/me/intents` | 自己的报名/内部参赛意向；登录即可读取 |
| GET/POST `/me/works` | 自己投稿列表（登录即可读取）/创建作品草稿（需验证邮箱）；POST body 为 {payload}，返回 AdminContentDTO（禁止状态和owner字段） |
| PATCH `/me/works/:id` | 本人未发布作品，expectedRevision+payload |
| POST `/me/works/:id/submit` | 本人草稿进入审核，expectedRevision |
| POST `/admin/contents/:id/return` | 退回作品与原因，expectedRevision/reason |
| GET `/admin/applications` / `/admin/registrations` | 仅授权项目/活动的必要信息，q/page/pageSize/status 与 projectId/eventId 筛选；userId 筛选仅 ADMIN 可用；分别返回 ApplicationDTO/RegistrationDTO |
| POST `/admin/applications/:id/decision` | expectedRevision/decision(APPROVED或REJECTED)/reason；批准和成员写入同事务 |
| GET `/admin/projects/:id/members` | 授权项目成员 |
| PATCH `/admin/projects/:id/members/:userId` | body {status:LEFT或REMOVED}，行锁事务释放岗位名额并审计，重复相同终态幂等；返回 ProjectMemberDTO |

所有上述列表都返回 `data` 与 `meta`。个人 applications/projects/registrations/intents/works 列表接受 page/pageSize；favorites 接受通用列表查询。notifications 另支持 unread=true/false，标为已读返回 NotificationDTO。管理内容新建、保存、发布、撤回、归档及退回均返回 AdminContentDTO。站点设置 GET/PATCH 返回 payload/publishedPayload/revision/publishedRevision/updatedAt/publishedAt；发布返回 revision/published，客户端可再 GET 最新配置。

审批/报名/撤销必须重新检查当前有效发布版本和权限；重复请求不得重复占名额。活动取消、重要时间变化、申请结果与收藏赛事截止经数据库任务/通知闭环，不依赖页面打开。

## 管理与附件

- GET `/admin/users`、GET/PATCH `/admin/users/:id`：ADMIN，搜索分页筛选；PATCH 白名单 role/status/memberStatus/expectedRevision，最后有效管理员受事务保护。
- PUT `/admin/users/:id/grants`：ADMIN 编辑授权清单；POST `/admin/users/:id/revoke-sessions`：ADMIN 撤销会话。
- GET `/admin/audit`、GET `/admin/overview`：权限对应的日志/总览，绝不返回秘密字段。
- POST `/media`：已登录且验证邮箱的上传（multipart），可见级别和文件类型受限；GET `/media/:id/download`：权限及有效引用校验。
- GET `/admin/media`、GET `/admin/media/:id/references`、DELETE `/admin/media/:id`：按管理范围；有引用禁止删除。新文件替换只更新新版本的引用，旧版本仍可追溯。
- GET `/health`：检查数据库连接，成功返回 `{"data":{"status":"ok","service":"ixd-platform-api"}}`，不泄漏连接字符串。运行控制器同时检查固定服务标识与本地进程归属，不会仅凭任意 API 的 `status=ok` 接管服务；生产初始化、迁移、管理员创建只通过受控 CLI，绝无公开 reset/seed/admin 初始化接口。

## 服务端模块协作约定

`server/src/context.ts` 提供 `AppContext {db: Pool, config: AppConfig, now: () => Date}`；`request.actor` 为 `{user:SafeUser,grants:EditorGrant[]}` 或 null。root 维护 auth/app/config/db/errors/security；内容及协作模块通过 `registerContentRoutes(app,ctx)` / `registerBusinessRoutes(app,ctx)` 接入。事务使用同一 pg client；权限帮助器统一实现，不在路由临时复制角色判断。模块间先按 shared 与迁移协作，有契约变化先同步。
