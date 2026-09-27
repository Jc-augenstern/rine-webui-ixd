# IXD 平台验收与交付记录

核验日期：2026-09-27。范围是同一仓库内的原生星图前台、独立后台、真实 API/PostgreSQL/认证、六业务栏目、用户协作和本地运维。没有签到、考勤、签到码或相关表/API；没有购买服务器、修改 DNS 或公开部署。

**本地 M1～M6 实现与 23 项验收已完成。正式服务器、真实域名/SMTP 和真实移动设备的未验证范围单独列在文末，不把本地结果冒充已公开上线。**

## 版本与交付物

- 工作仓库：`Jc-augenstern/rine-webui-ixd`，分支 `feat/ixd-platform-v1`。完整平台实现为 `6b6b783`，通知权限补丁为 `dc4f456`；最终文档身份以包含本报告的交付提交为准。
- 分支从 `v0.4.0` 的 `37cfd60142d79ada1bd473fa2ff791dd64122631` 继续开发。只读 `archive/ixd-beta-0.4` 和 Tag 的 peeled commit 均保持此值；annotated Tag 对象为 `aa4771e6f35236a5548f86e5bc9c0e72ab9fcee5`。
- 本地和 origin 的 main 保持 `2038d69f5ccbb18c4ebc0e18223e8961b6f9a65b`。upstream 推送地址继续为故意无效的只读保护地址。
- 完整源码在 `src/`、`admin/`、`server/`、`shared/`；迁移、运行脚本、部署配置和 lockfile 随源码交付。生产输出在本机 `dist/`、`admin/dist/`、`server/dist/`，可重新构建，不提交 Git。
- 随机测试账号、数据库、附件、备份、浏览器截图和视频只留在 Git 忽略目录。秘密扫描检查当前本机密码、数据库密码及会话密钥的精确值，没有在可提交文件中发现泄漏。

## 验证环境与方法

Windows、Node 24.18.0/npm 11.16.0、PostgreSQL 17.11、Mailpit 1.31.2。浏览器为本机 Edge 132，桌面与手机尺寸模拟；不将它描述为真实 iPhone/Safari 认证。

API 集成测试在名称以 `_test` 结尾的专用库中创建随机 schema，使用真实 PostgreSQL 事务和实际 SMTP/Mailpit。时间边界注入测试时钟，不修改系统时间。后台与普通用户使用隔离浏览器上下文。业务验收没有用 Mock 响应替代 API；故障验收仅主动中断实际请求。

开发入口为 5173/5174，经代理访问 API 3000。构建产物另由本地 4180 静态验收服务器承载，代理编译 API 3001，连接独立恢复测试库与附件目录；这只是本机生产包验收，不是公开生产部署。

可重复命令：

```powershell
npm run test:platform
npm run check:auth
npm run check:cache
npm run check:content
npm run check:palette
npm run check:viewport
npm run build:all
```

本轮结果：平台集成测试 22/22（Node test 计数含两个父测试）、前台认证适配 11/11、缓存规则 1/1、原档案内容 18/18；配色、视口和三组件构建通过。平台 22 项计数不能代替下面 23 项用户验收要求。最终前台包为 index-BtDYh8oY.js，PWA 版本为 8e6f607be0908d34；后台包为 index-CvZCr0dH.js。

生产 Cookie 注入测试另验证 Secure/HttpOnly/SameSite=Lax/Path=/，只有配置的可信代理提供 HTTPS 转发头时才发送安全 Cookie；伪造来源不能把普通 HTTP 当 HTTPS。正式 TLS 和真实 SMTP 仍须在目标服务器验收。

## 23 项用户验收映射

以下 `auth-media` 指 `server/test/auth-media.test.ts`；`business` 指 `server/test/business.test.ts`。浏览器和运维原始记录路径均相对仓库，留在本机，不上传个人数据。

| # | 要求与结果 | 权威证据与覆盖范围 |
| --- | --- | --- |
| 1 | 注册、验证、登录、退出、重置：通过 | auth-media 实际邮件一次性令牌、旧会话撤销；`.tools/platform-frontend-real/auth-mobile.json` 实际手机尺寸页面完成完整邮箱与改密流程。 |
| 2 | 后台用户出现且资料/角色正确：通过 | auth-media 安全字段与方向/角色分页筛选；后台 complex/supplement 新注册账号、角色与授权保存后刷新读取。 |
| 3 | USER 后台和管理 API 拒绝：通过 | auth-media 401/403；`.tools/admin-deep-review/results.json` 普通用户页面拒绝、EDITOR 受限菜单与直达访问。 |
| 4 | 他人收藏、申请、资料隔离：通过 | auth-media 资料白名单/未知他人资料路径；business 自己收藏、申请、通知及附件归属拒绝，个人历史不泄漏失去权限后的内容。 |
| 5 | EDITOR 范围和自我提权拒绝：通过 | business 全方向覆盖、单资源预览、原范围/目标范围检查；supplement 实际受限账号可保存授权项目、无发布权限、范围外 403。 |
| 6 | 公告草稿隐藏、发布可见、撤回隐藏：通过 | business 生命周期；`.tools/admin-ui-review/results.json`；`flows.json` 和实际公告跨 UI 录屏。 |
| 7 | 编辑发布稿不提前改变线上版本：通过 | business 不可变版本、草稿/公开指针；后台 UI 保存新草稿后公开正文仍旧，重新发布才改变。 |
| 8 | 赛事三类截止、未知与日期精度：通过 | complex 的日期/UTC+8 时刻/未知保存刷新发布；business 时区和精度规则；前台 business.json 无编造倒计时。 |
| 9 | 收藏/取消/提醒去重：通过 | 前台真实收藏与 72 小时配置恢复；business 取消、重订阅、截止变更、租约重领、通知唯一键。 |
| 10 | 项目申请到成员状态闭环：通过 | business 重复、批准/拒绝/撤回、最后名额并发、成员退出后重申；申请跨 UI 实际录屏；edge-workflows.json 实测 REJECTED/WITHDRAWN/LEFT/REMOVED 均可重申，ACTIVE 不重复申请，只有 PENDING 可撤回。 |
| 11 | 活动报名/取消/并发名额：通过 | business 最后名额并发、取消释放、活动取消/变更通知；前台 business.json 实际报名与取消。 |
| 12 | 学习路线/资源后台维护并前台更新：通过 | complex 编辑资源、上传替换、路线步骤关联、保存刷新发布后公共 API 一致；前台业务筛选和路线阅读。 |
| 13 | 用户投稿审核及所有权：通过 | business 本人未发布稿、他人拒绝、退回/再提交/发布；前台真实上传、修改并提交 REVIEW，同时公开 API 404。 |
| 14 | 图片/附件、权限下载、替换/引用保护：通过 | auth-media 真实图像解码重编码、错误类型/主动内容拒绝；complex/supplement 上传选择替换、公开下载和引用 409；business 正文附件引用及持久删除任务。 |
| 15 | 停用/撤权后旧会话失效：通过 | auth-media auth_version、墓碑防复活、修改授权/状态撤销、并发最后管理员；business 实时权限及降权后的业务和通知投影。成员降权、内容撤回/过期后，历史通知的列表和已读响应不再返回受限标题/正文，数据库事实保持不变。 |
| 16 | 数据库和 API 重启持久化：通过 | `.local/restart-verification.json` 实际 PostgreSQL 停止/启动，22 表完整行摘要和 5 个附件一致，包括非空收藏、报名、申请、账号和内容；controller 全套重启另验。 |
| 17 | API 故障真实报错，无 Mock：通过 | check:auth 拒绝不可用/畸形成功；production-pwa.json 中实际离线公告显示连接错误和重试、没有伪造列表，恢复网络后重试读取真实 API。 |
| 18 | 定时任务恢复/去重/不提前发布：通过 | business 冻结计划版本、未来 404、到期/过期不依赖 worker、撤回取消计划；另 `.local/worker-process-restart-verification.json` 在真实 claim 提交后终止 worker PID39100，注入时钟越过租约后 PID42436 恢复 DONE/通知1，第三进程 PID43556 不重复，未来公告四个检查点均404。未改系统时钟，不冒充整机断电试验。 |
| 19 | PWA 退出与换账号隔离：通过 | check:cache 覆盖 API/admin/media/敏感 query 即使误入预缓存仍绕过；production-pwa.json 12 项实际验收，818 缓存项均为静态资源，退出清私人 DOM/会话，离线无旧资料，换 ADMIN 无上一 USER 投稿，后台仍为独立页面。 |
| 20 | 普通/深浅/手机/减少动态效果：通过 | auth-mobile 8 项、initial 23 项、mobile-business 17 项；视觉回归 210 项/26 次旅程与四种主题偏好组合；390px/高DPR/减少动态效果的真实业务表单、导航和溢出检查通过，真实设备范围见限制。 |
| 21 | 开场/尾流/星体连续性：通过 | 独立基准与29文件源哈希对照；visual-regression 210项/26旅程；visual-continuity 175项覆盖自然开场/授权/Welcome/同一Logo与画布/重播/窄屏/无WebGL回退；solver32项、motion-current3项及325真实帧验证快慢尾流恢复、内容聚焦刷新保留画布/星体/阅读位置/尾流历史。 |
| 22 | 备份恢复到独立环境：通过 | `backups/ixd-20260927060956218-a038db` 恢复到新库 `ixd_restore_1790489403795_7d26a4_test` 和 `.local/restores/` 新目录；22 表行摘要及 5 个文件 SHA256 一致，7 条媒体引用完整。 |
| 23 | 干净环境安装/迁移/启动/构建：通过 | `.local/clean-install-verification.json`：未复制旧依赖/构建/秘密，npm ci→迁移→seed→全构建→三个 HTTP→新管理员登录；生产空库 CLI 独立初始化与两次幂等导入另验。 |

## 实际录制与视觉证据

两条视频是实际 Chromium compositor 帧按原时间戳编码，非截图代替业务录制：

- `.tools/platform-frontend-real/videos/announcement-flow.mp4`：独立 ADMIN/USER，保存草稿并核验公开 404，后台发布，前台读取并持久化已读；193 个实际帧。
- `.tools/platform-frontend-real/videos/application-flow.mp4`：用户填写申请，后台批准并创建成员，用户在申请与参与项目中看到结果；507 个实际帧。

修改前 `.tools/platform-baseline/` 保存四段视频、29 个源文件哈希和 Beta05 194 项/24 旅程、Beta04 165 项、尾流 32 项基准。`source-comparison.json` 显示仅六个授权接线文件变化；原 main/startup/boot/Welcome/portal、银河求解器和 shader、glyph、原 CSS 没有改写。新增业务 UI 不创建第二个银河 renderer。

后台初轮 21 项、深入表单 9 项、复杂表单 11 项与 supplement 记录存在部分流程重叠，不把它们相加宣称独立端到端场景数量。相同真实 API 延迟 1.2 秒复现并修复了关联选择器旧响应覆盖问题，before/after 单独保留。失败截图用于问题溯源，最终结果以对应成功 JSON 和本报告状态为准。

完整前台汇总为 `.tools/platform-frontend-real/verification-summary.json`，所列11套最终记录没有未处理 pageerror。连续性中途一次因协作归一换行触发 Vite HMR 而中断，历史报告保留为 results-hmr-interruption.json；源冻结后的完整175项通过。错误密码401、刻意禁用WebGL及阻断资源是预期负面用例。`videos/motion-current.mp4` 为当前尾流实际录帧，固定相机/星空时间只用于观察流体，不冒充普通开场录像。

## 运维与安全交付

`npm run platform:start`、`platform:status`、`platform:stop` 是日常入口，数据停止后保留。`.local/controller-lifecycle-verification.json` 记录全部自有组件真实停止和重启，六个本机端口停止后均关闭，重启后 API/前后台/数据库/邮件恢复且数据一致。控制器核实 API 身份与进程归属，不会因为端口被占就杀其他项目。

最终源码和编译 API 已重启；`.local/final-delivery-health.json` 确认前台、后台、API、测试收件箱均 HTTP200，三个本机随机身份都能实际登录/退出，ADMIN 用户管理返回200、EDITOR/USER 返回403。交付时开发服务保持运行。

生产空库只创建一个经 CLI 初始化的 ADMIN、默认站点设置和可选六方向/两页面初稿；不创建开发账号或示例业务。证据 `.local/production-cli-verification.json` 还实测根目录 npm 参数透传、管理员恢复后新密码验证通过/旧密码失败及恢复审计。开发账号仅在 `.local/development-accounts.json`，不要打印到聊天、README 或提交记录。

附件由真实 LocalStorage 实现，图片解码重编码、PDF 采用保守的静态格式限制并作为受控附件下载；未接入云对象存储，未宣称 PDF 解析或整套系统绝对安全。站内提醒是数据库通知，不是手机、微信、短信或浏览器后台推送。

截至推送前检查，用户 Fork 的 Pages 未启用，Actions 工作流、Webhook、部署记录均为空；仓库保留的旧 Vercel 静态配置不代表本平台已经部署。只允许推送本平台分支，不合并 main 或改归档/Tag。

## 已知限制与上线前配置

- 本机没有 Docker Engine：Compose、Dockerfile、反向代理和 shell 脚本完成静态审阅/语法检查；不能声称已经在 Docker 或正式 Linux 主机跑过。Linux 镜像构建、持久卷权限及容器恢复需目标环境验证。
- 未购买服务器或域名；仍需准备 Linux/Docker、域名/TLS、正式 SMTP、随机数据库密码和会话密钥，按部署文档执行迁移和管理员初始化。
- 未配置或测试外部发信渠道、管理员二次认证、线上监控告警；上线前完成安全与运营审查、实际邮件投递及真实设备测试。
- Windows Edge 的手机视口不是 iPhone/Safari/Android 真机。不同 GPU 的持续帧率、网络负载与大规模并发容量未作承诺。
- 前台保留原有较大 Three.js/视觉包，Vite 大 chunk 警告仍在；Zod 注释的打包警告不阻断构建。PWA 静态发行约 34 MiB；没有为压包重写受保护视觉。
- Novecento 属独立授权字体，不在 Git；无授权包环境使用原有内置字形回退。社团规划与开发示例不代表真实成果。

操作方法分别见 [LOCAL_SETUP](LOCAL_SETUP.md)、[ADMIN_GUIDE](ADMIN_GUIDE.md)、[DEPLOYMENT](DEPLOYMENT.md)、[BACKUP_RESTORE](BACKUP_RESTORE.md)。继续开发先读 [AGENTS](../AGENTS.md)、[IXD_SPEC](IXD_SPEC.md)、[CURRENT_STATE](CURRENT_STATE.md)，按共享契约追加迁移；切回视觉 Tag 不等于恢复数据库。
