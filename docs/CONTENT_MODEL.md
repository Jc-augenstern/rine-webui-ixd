# IXD 平台内容与数据契约

本文件是平台分支的数据模型及完整编辑映射，不是功能已经通过验收的声明。实施进度见 [PLATFORM_PLAN.md](PLATFORM_PLAN.md)，权限见 [PERMISSIONS.md](PERMISSIONS.md)。字段与输入校验以 [shared/platform.ts](../shared/platform.ts) 为共同契约，数据库约束见 [001_platform.sql](../server/migrations/001_platform.sql)。数据库字段使用 snake_case，API 使用 camelCase。

## 1. 数据来源和边界

- PostgreSQL 是运营内容、账号和用户行为的权威来源。前后台读取同一个 API，不各自维护静态 JSON。
- 原 `club-content.ts` 中六方向、社团介绍与加入说明可作为一次性幂等导入来源。导入记录保持稳定 key；再次执行不能覆盖编辑者后来保存的内容。
- 筹建规划、典型项目、开发示例不转写成真实成员、获奖、活动或赛事日程。没有资料的栏目可以为空。
- 银河 shader、相机、布局算法、动画曲线、共享星体身份与音频仍由代码维护。管理后台只选择已实现的路由及视觉预设，不接受可执行 JS/CSS/HTML。
- 开发 seed 与生产管理员初始化分离；迁移只建立结构，不注入测试账号、密码或运营示例。本平台不包含签到或考勤实体。

## 2. 内容容器与版本

`contents.kind` 固定为 `announcements / competitions / projects / events / resources / works / directions / learning-paths / pages`。前六项为六大业务栏目，其余承载二级方向、学习路线和社团页面，不是额外的一级主星。

| 实体 | 作用与关键字段 |
| --- | --- |
| `contents` | 稳定 `id`、`kind`、`slug`、`owner_id`；`draft_version_id`、`published_version_id`、`scheduled_version_id`；计划 `publish_at`、真实 `published_at`、生效 `expires_at`、计划 `scheduled_expires_at/scheduled_notify_important`；`state`、`revision`、`attention_revision`、`review_reason` 与时间戳。 |
| `content_versions` | 不可变 `id/content_id/revision/payload/created_by/created_at`。保存产生新版本，数据库触发器禁止原地 UPDATE。 |
| `content_version_media` | 版本到附件的引用，`usage` 为 `attachment / cover / inline`；历史版本引用也保护附件不被误删。 |
| `content_version_links` | 版本到相关内容的引用，`relation` 为 `related / resource / project / direction`；路线资料、作品项目及方向关联有外键保护。 |
| `directions` | 固定方向 key 与对应内容容器的唯一映射；兴趣方向与编辑授权无关。 |
| `site_settings` | 单行 `id=true`，分别保存 `draft/published` JSON，`revision/published_revision`、操作者及时间；保存草稿不改线上配置。 |

三个版本指针通过复合外键保证版本属于该内容，不能把 A 的公开版本指向 B。`(content_id, revision)` 唯一；`(kind, slug)` 唯一。业务保存使用 `expectedRevision`，不匹配返回 409，而不是覆盖别人刚保存的内容。

### 公共 payload

| 字段 | 含义 |
| --- | --- |
| `title / summary / body` | 标题、摘要与 Markdown 正文；正文源码与安全渲染结果分开，公开及后台预览采用同样的安全策略。 |
| `visibility` | `PUBLIC` 访客可读；`AUTHENTICATED` 需有效登录；`MEMBERS` 需有效登录且具有社团成员身份。 |
| `directionIds` | 六方向 key 数组；不能重复，不赋予任何权限。 |
| `attachmentIds / coverId` | 附件列表和可空封面 UUID，保存时校验访问与引用权限。 |
| `pinned / importance / sortOrder / tags` | 置顶、`normal/important`、排序与标签。重要程度本身不意味着每次文字修改都发提醒。 |
| `details` | 对应 kind 的严格字段白名单，未知字段拒绝。 |

六方向 key 固定为 `ai / robotics / interaction / visual / xr / hardware`，分别复用已有方向星体造型与内容身份。

### 状态与发布隔离

状态为 `DRAFT / PUBLISHED / WITHDRAWN / ARCHIVED / REVIEW / RETURNED`。审核状态用于用户投稿；定时发布用版本指针及服务端时间表示，不额外伪造一个前端状态。

1. 新建或保存：写入新版本并更新草稿指针及 revision，公开指针保持原值。
2. 立即发布：锁内容行并核对 revision，校验引用、范围和业务约束；同步岗位等运营数据；更新公开指针，清理已被替代的计划版本。
3. 定时发布：冻结本次计划版本与 `publish_at`。后续继续保存其他草稿不能悄悄替换计划发布内容。
4. 撤回/归档：立即停止公开查询，取消计划发布及有关 pending 提醒；保留版本用于核对及恢复编辑。
5. 公开查询只读取有效公开版本，或已到期可生效的计划版本；即使任务进程暂停也必须以服务端时间检查，未来版本绝不提前返回。
6. 已发布内容安排未来更新时，到期前保持旧公开版本可见。公开可见范围取有效版本的 `payload.visibility`，不能被未发布草稿改变。
7. `expires_at` 是生效发布配置；普通草稿保存不能提前变更线上有效期。未来版本期限与提醒意图分别存 `scheduled_expires_at/scheduled_notify_important`，到期才切换，不提前改变旧公开版。
8. 撤回/归档后可明确安排未来重新发布；到期前仍隐藏旧公开版本，到期后只启用本次冻结的计划版本。再次撤回会清除该计划，不会日后自动恢复。

列表、详情、搜索、收藏目标校验、内容关联与附件下载共用公开过滤规则：已有有效发布版本且未撤回/归档，或明确安排的重新发布版本已经到期；同时必须未过期、满足该版本的可见范围。没有权限的目标不会先下载到客户端再隐藏。

## 3. 前台 → 字段 → API → 后台的完整映射

所有类别通过 `/api/v1/<kind>` 提供公开可读列表/详情，通过受保护的 `/api/v1/admin/...` 维护。管理写接口须验证功能、资源和字段权限；API 的具体操作路径在服务实现/API 文档中统一维护，本表不为每行文字另建接口。

| 前台位置 | 实体/字段 | 后台编辑位置 | 修改者 | 可见时机 |
| --- | --- | --- | --- | --- |
| 公告列表、详情、置顶/重要标记 | `announcements` 公共 payload；`details={}`；容器发布时间与有效期 | 公告管理 | ADMIN 或有对应授权的 EDITOR | 发布后；草稿、未来、撤回、无权限内容由服务端过滤。 |
| 赛事列表、方向/年份筛选、截止排序、详情 | `competitions`，见下方完整字段 | 赛事管理 | ADMIN / 授权 EDITOR | 生效发布版本；未知日期仍为空。 |
| 项目列表、负责人、阶段、展示、招募岗位 | `projects` + `project_positions` | 项目管理、申请管理 | ADMIN / 授权 EDITOR | 内容发布时同步生效岗位；保存草稿不改名额。 |
| 活动预告、详情、报名窗口、回顾与资料 | `events` + `event_registrations` | 活动管理、报名管理 | ADMIN / 授权 EDITOR | 内容发布后；取消与重要时间变更触发通知。 |
| 学习资料、筛选、外链、附件 | `resources` | 学习资源与路线 | ADMIN / 授权 EDITOR | 发布后；不虚构教师背书或认证。 |
| 路线阅读、步骤顺序及关联资料 | `learning-paths` | 学习资源与路线 | ADMIN / 授权 EDITOR | 路线发布后；所关联资料另行检查访问权限。 |
| 作品列表、作者、图集、项目和获奖依据 | `works` | 作品审核与管理 | USER 自己未发布草稿；ADMIN / 授权 EDITOR 审核发布 | 审核后发布才公开；退回原因仅本人及有权管理者可见。 |
| 社团介绍内六方向二级星图与详情 | `directions`，稳定 key 对应容器 | 社团介绍与方向 | ADMIN / 授权 EDITOR | 发布后；不新建第二套重型银河 renderer。 |
| 社团介绍、加入方法、报名渠道说明 | `pages.details.pageKey=about/join` | 社团介绍与方向 | ADMIN / 授权 EDITOR | 页面发布后；尚未提供联系方式时说明待发布。 |
| 名称、标语、联系方式、栏目说明和节点标题/开关/预设 | `site_settings.published` | 站点内容设置 | ADMIN | 显式发布配置后；不重新 build。 |
| 图片与附件展示、替换、下载 | `media`、版本附件引用 | 媒体附件、内容表单选择器 | 自己上传者及有资源权限管理者 | 公开下载取决于有效发布引用与文件级权限，不因 UUID 难猜就公开。 |

### 各类 details 精确字段

| kind | details 字段 |
| --- | --- |
| `competitions` | `edition, year, organizer, eligibility, tracks, registrationStart, registrationEnd, internalDeadline, submissionDeadline, officialUrl, registrationUrl, sourceUrl, lastVerifiedAt`。方向使用公共 `directionIds`。 |
| `projects` | `leaderName, stage, recruiting, applicationDeadline, showcaseUrl, positions[]`；岗位含 `id, title, description, capacity, enabled, sortOrder`。负责人文字不授予后台权限。 |
| `events` | `startsAt, endsAt, timeZone, location, onlineUrl, registrationStartsAt, registrationEndsAt, cancellationDeadline, registrationOpen, capacity, eventStatus, recap, materialIds`。 |
| `resources` | `difficulty, resourceType, externalUrl, sourceUrl, licenseNote`；难度为初/中/高级，类型为文章/视频/工具/文件/课程。 |
| `works` | `authors[{userId,name}], projectId, imageIds, demoUrl, awards[{title,evidenceUrl}]`；`userId` 可空，作者仅展示名称；奖项必须填写依据链接。 |
| `directions` | `key, keywords, learningRoute, relatedContentIds`。 |
| `learning-paths` | `difficulty, steps[{id,title,body,resourceIds,sortOrder}]`。 |
| `pages` | `pageKey: about / join`，正文使用公共 `body`。 |

API 仅允许 http/https 外链，不接受 javascript/data URL。资源的 `sourceUrl/licenseNote` 用于清楚标记来源与使用说明，不代表平台替原作者授予许可。

### 日期精度

赛事四类日期统一为 `{ precision, date, at, timeZone }`：

- `unknown`：`date=null, at=null`，显示待公布/待核实，不产生截止提醒或假倒计时。
- `date`：仅 `date=YYYY-MM-DD`，`at=null`；展示日期精度，不制造秒级截止时刻。
- `datetime`：仅 `at` 为带 UTC offset 的 ISO 时间，`date=null`；数据库任务到期时间使用 `timestamptz`。
- `timeZone` 默认 `Asia/Shanghai`，须为有效 IANA 时区。日历日期提醒采用清楚的固定本地时段规则，不能把规则生成的提醒时间宣称为官方截止时刻。

官方报名截止、学校/社团内部材料截止、作品提交截止分别显示，不混成一个“截止日期”。`officialUrl/registrationUrl` 是外部正式报名入口；平台内 `competition_intents` 只是参赛意向。

### 网站设置

`siteName, tagline, contact, sectionDescriptions, nodes`。`about/join` 正文属于 `pages` 版本，不在 settings 另存第二份。

`nodes` 必须各含一次八种已实现 `routeKey`：`announcements / competitions / projects / events / learning / works / core / account`，字段为 `routeKey/title/subtitle/enabled/visualPreset`。`core/account` 保持启用。预设只能从已有十二种视觉枚举选择，不能填写任意脚本、CSS 或新路由。暗星仍是代码定义的保留空间。

## 4. 用户行为与协作数据

| 表 | 状态/唯一约束与规则 |
| --- | --- |
| `favorites` | 唯一 `(user_id,content_id)`；提醒档位 `24/72/168` 小时，默认 24，空数组关闭提醒。取消收藏取消相关 pending 任务。 |
| `competition_intents` | 唯一 `(competition_id,user_id)`；`INTERESTED/WITHDRAWN`；可选 note，不代表已完成官网报名。 |
| `project_applications` | 唯一 `(project_id,user_id)`；`PENDING/APPROVED/REJECTED/WITHDRAWN`，岗位、意向说明、可选作品链接、审核原因及 revision。重试不能生成第二份申请。 |
| `project_members` | 唯一 `(project_id,user_id)`；`ACTIVE/LEFT/REMOVED`；岗位、来源申请、加入/离开时间。申请和岗位通过复合外键保持同项目、同用户。 |
| `event_registrations` | 唯一 `(event_id,user_id)`；`REGISTERED/CANCELLED`；取消后显式重新报名才重新占用名额。 |
| `announcement_reads` | 唯一 `(user_id,announcement_id)`；已读 `attention_revision/read_at`，只有发布时主动标记重要更新才提高提醒版本。 |
| `notifications` | 持久的站内通知，唯一 `(user_id,dedupe_key)`，含类型、简短标题/正文、关联内容、已读时间。 |

报名事务锁活动内容行，验证当前有效发布版本、报名窗口和人数，再写唯一报名记录。取消报名在 `cancellationDeadline` 前允许；为空时沿用活动开始时间，已取消活动允许用户清理自己的报名状态。规则须同时体现在按钮说明与服务端。

审批事务按统一顺序锁项目/岗位和申请，重新计算活跃成员数；批准与成员建立、拒绝/撤回与状态变化、结果通知在同一事务内完成。重复审批返回冲突或已有结果，不重复占位。已批准成员退出是成员管理动作，不把“撤回待处理申请”偷偷解释成退出项目。

发布项目岗位时校验容量不得低于现有活跃成员数。有申请/成员引用的岗位不能物理删除；不再招募时停用。活动改小名额也不得低于现有有效报名人数。

## 5. 附件、关联和持久任务

`media` 保存服务器生成的 `storage_key`、安全原名、验证后 MIME、实际字节数、拥有者及 PUBLIC/PRIVATE 级别。文件存在可配置持久目录，与数据库、dist、Git 分开。数据库不保存用户可控制的磁盘绝对路径。

保存内容版本时同步提取以下引用：公共附件/封面、活动 `materialIds`、作品 `imageIds`、安全 Markdown 正文中的本站附件链接，以及作品 `projectId`、方向 `relatedContentIds`、路线步骤 `resourceIds`。引用表保护草稿、发布版及历史记录。删除有引用的文件/内容时返回可理解的引用列表；“替换文件”创建新文件并更新新版本引用，不覆盖仍被历史使用的字节。

文件上传要检查拥有者/资源权限、数量、大小、允许格式和真实内容；不接受可执行脚本、HTML 或未经清理的主动内容。私有文件下载逐次鉴权。PUBLIC 只表示允许公开使用，未发布草稿中的文件不能因此自动获得匿名读取权限。

`jobs` 包含 `kind/payload/dedupe_key/status/run_at/attempts/max_attempts/locked_at/locked_by/lease_expires_at/last_error/finished_at`。`PENDING` 任务按到期时间领取，运行租约超时可重试，终态为 `DONE/CANCELLED/FAILED`；错误摘要不能包含令牌或密码。

删除附件先在同一数据库事务删除未引用的元数据并写入 `MEDIA_DELETE` 任务；提交后异步清理字节，文件已不存在视为幂等成功。数据库提交失败时不提前丢失原文件；进程重启可继续清理。定时发布持久保存在内容版本指针与计划时间中，不依赖内存定时器保存业务事实。

赛事提醒去重键应包含用户、赛事、截止类别、截止值/精度/时区的 fingerprint 和提前档位。修改截止或取消收藏后取消旧任务；执行时再次检查当前收藏、可见范围和日期 fingerprint。插入通知和完成任务使用同一事务及唯一约束，重启不重发。

发布、重要公告、申请结果、活动取消/重要变更与赛事截止提醒均需持久化。站内通知不等于微信、短信、邮件推送或手机后台通知，不宣称未配置的外部能力。

## 6. 账号、审计及维护

`users` 中角色、ACTIVE/DISABLED、NONE/MEMBER 和兴趣方向分别存储；基础资料有独立 `profile_version`。`sessions.sid` 保存成熟会话插件 ID 的 SHA256，数据只在服务端；每次请求查用户状态和实时授权。撤销使用 `revoked_at` 墓碑，进行中旧请求不能通过会话保存把已退出的会话复活。`email_tokens` 仅保存哈希、用途、用户、到期与消费时间。

`audit_logs` 记录操作者、动作、目标、时间和允许的变更摘要，不存敏感完整载荷。用户停用、角色调整、授权修改、审核与发布都应记录；首位管理员通过受控 CLI 建立，种子不提供生产万能账号。

应用启动不覆盖运营数据；迁移 ledger 由迁移器统一管理。备份必须同时涵盖数据库、文件及服务器配置的安全副本。切回旧视觉 tag 不会自动回退数据结构，也不能代替备份。
