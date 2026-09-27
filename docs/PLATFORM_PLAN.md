# IXD 平台架构与实施进度

2026-09-27 核验。完整目标包含原生星图、独立后台、真实 API/PostgreSQL/认证、六类运营内容、用户协作、本地联调和部署准备。不包含签到/考勤，不以接口预留代替核心功能。最终验收逐项记录在 [PLATFORM_VERIFICATION](PLATFORM_VERIFICATION.md)。

## 工作分支与保护

唯一平台分支 feat/ixd-platform-v1 从只读 v0.4.0 的 37cfd60142d79ada1bd473fa2ff791dd64122631 开始。archive/ixd-beta-0.4 与 Tag 的 peeled commit 一致，引用未改变。main 不改；upstream 只读；最终只推送用户仓库 origin/feat/ixd-platform-v1，不公开部署。

修改前已保存可复测基准：29 文件哈希、四段视频、Beta05 194 项/24 旅程、Beta04 165 项及尾流 32 项。平台后另作源文件对照与动态回归，不能用旧基准代替新版本验收。

## 架构与权威数据

- src 保持原生 TypeScript/Three.js/Vite，复用一个银河 renderer。六业务主星与 CORE 六方向二级图通过业务导航层接入。
- admin 是独立 React/TypeScript/Vite 入口和构建，不加载前台银河、音频或开场。
- server 是 Fastify 模块化单体；数据库访问使用 pg 参数化 SQL、事务和版本化迁移，不并用 ORM，不引入 Redis/微服务。
- shared/platform.ts 统一 DTO、严格字段白名单、枚举、日期精度及表单定义。运营权威数据在 PostgreSQL；不是前后台分别维护 JSON。
- 内容采用容器和不可变版本，草稿/公开/定时指针隔离，公共查询校验有效期、权限和服务端时间。乐观锁避免并发覆盖。
- 会话、邮箱令牌哈希、授权、业务关系、通知、重试/租约任务、媒体引用和审计持久化；本地 Storage 存真实附件字节。
- 认证采用 Argon2id、成熟 Cookie/session/CSRF 插件及 SMTP；角色与成员身份分开，每请求重新校验状态和授权。
- 开发统一127.0.0.1，前后台代理同一API。生产准备为同域前台/、后台/admin/、API/api/v1/，Nginx/Compose和持久卷，不使用Vite开发服务器作为长期生产服务。

内容字段映射见 [CONTENT_MODEL](CONTENT_MODEL.md)，权限见 [PERMISSIONS](PERMISSIONS.md)，接口见 [API](API.md)。原文幂等导入保持规划/示例属性，重复执行不覆盖后台编辑。

新增依赖按官方文档和注册表核对，保留 lockfile，不整体升级原 Three.js/Vite。主要依据：[Fastify 支持策略](https://fastify.dev/docs/latest/Reference/LTS/)、[pg 事务](https://node-postgres.com/features/transactions)、[Fastify session](https://github.com/fastify/session)、[CSRF](https://github.com/fastify/csrf-protection)、[Argon2](https://github.com/ranisalt/node-argon2)、[SMTP](https://nodemailer.com/smtp)、[Sharp 图像校验](https://sharp.pixelplumbing.com/api-constructor/)。

## M1～M6 连续实施结果

| 阶段 | 已完成的实现与证据 | 状态 |
| --- | --- | --- |
| M1 | 版本保护、视觉基准、内容映射、权限矩阵、共享契约、001/002迁移与checksum核对 | 完成 |
| M2 | 真实注册/邮件/会话、独立后台；公告草稿404→后台发布→前台可见/已读，实际跨UI录屏 | 完成 |
| M3 | 六业务栏目和原方向二级图；全部内容API、后台专属表单、页面/运营设置、稳定深链接 | 完成 |
| M4 | 个人中心、收藏/阅读/提醒、申请审批和成员、报名取消、投稿审核、通知；前后台真实闭环 | 完成 |
| M5 | 附件清理与鉴权、细粒度授权、撤权/通知投影、审计、CSRF、并发和异常；生产PWA12项、视觉210项/26旅程及连续性175项 | 完成 |
| M6 | 一键启停、全部构建、干净目录安装、生产空库CLI、Compose/Nginx、22表与5文件独立恢复、中文手册 | 完成；分支推送结果见交付提交与远端 |

## 验收账本与修复记录

用户原定的23项要求逐条保留在 [平台验收报告](PLATFORM_VERIFICATION.md#23-项用户验收映射)，其中标明实际证据与范围；不通过汇总测试数量替代单项验收。

- 原认证测试已迁移为真实网络适配、CSRF、错误、取消和不持久化凭据测试，未删除测试以掩盖不再适用的Demo假设。
- 后台首轮/深入/复杂表单覆盖专属字段、上传选择替换、版本冲突和权限；同一真实延迟响应先复现、再修复选择器竞态。
- 补齐用户方向筛选的API契约、拒绝/退出后的重申请、方向运营关联及收藏稳定链接、通知在内容权限撤销后的安全投影。
- 后台与普通用户隔离浏览器实际录制公告发布读取、项目申请审批结果两条流程，视频及浏览器原始证据留在忽略目录。
- 数据库进程与完整控制器实际停止/重启，非空收藏、报名、申请等22表整行摘要及5附件一致；恢复只创建独立测试库/目录。
- 根目录管理员CLI参数透传和发布选项未保存提醒在真实复测中修复，最终命令及页面重验通过。

## 验证边界

本机Edge手机视口模拟不等于真机Safari/Android。Docker Engine未安装，容器/目标Linux、真实域名TLS及外部SMTP须上线前验证；管理员二次认证、监控告警和容量测试是明确上线加固项。当前不宣称公开上线、手机后台推送或绝对安全。

继续开发按 [CURRENT_STATE](CURRENT_STATE.md) 接手；数据库变更追加迁移。视觉Tag只恢复旧代码，数据回滚必须考虑迁移兼容、数据库与附件备份。
