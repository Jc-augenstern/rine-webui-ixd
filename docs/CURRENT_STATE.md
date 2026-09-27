# IXD Current State

**状态核对日期：2026-09-23（Asia/Shanghai）。** 本文是动态快照；以当前代码、实际运行和 Git 状态校正。长期原则见 [IXD_SPEC.md](IXD_SPEC.md)，工作规则见 [AGENTS.md](../AGENTS.md)。历史报告中的“最新”“已完成”只适用于其记录时间。

## 1. 当前版本概况

- 工作 Fork：`Jc-augenstern/rine-webui-ixd`；当前开发分支：`feat/ixd-star-map-redesign`。
- 生成本文时的参考提交：`ea2374e3eb7eb0093f4ffef79bd7ff2a84f463cb`，`fix(ixd): restore welcome motion and continuous star journeys`。这是快照，不是永久版本号。
- 最近功能迭代称为 Beta 0.5；`package.json` 仍为 `rhine-lab-analysis-os@1.0.0`，两者不是同一版本编号体系。
- 原生 TypeScript + Three.js + Vite；无 React/Vue，无真实后端账户系统。当前正常入口为 IXD 启动、Demo 登录和星图。
- 主链路：准备 → Logo / 登录 → 认证 / 授权 → 2× Welcome → 星门 → 银河 → 星体详情 → 返回。
- `main.ts` 管理应用生命周期、设置、音频与旧模式；`ixd-experience.ts` 管理新体验；`auth/`、`galaxy/`、`ui/`、`data/` 分别负责认证、背景、交互展示和内容。

整理开始时工作区干净；本轮仅新增两份核心文档并补充 AGENTS，未提交，功能代码仍在上述参考提交。之后请重新检查 Git，不把本段作为永久状态。

## 2. 当前已经完成的功能

| 模块 | 当前实际行为 |
| --- | --- |
| 首屏与主题 | 初始 HTML 和应用默认深色，系统浅色不覆盖首次默认；保留已存浅色。设置可切换，并可仅将配色恢复为默认深色。银河始终保持深空背景。 |
| 启动准备 | 文字与进度条共用 1500 ms 阶段时钟，填满后前景淡出 500 ms；共享背景不退出。该进度是体验时间轴，不是网络加载百分比。 |
| Logo / 登录 | 原 Logo 绘制后左移，登录框同步进入；未提交前持续等待。跳过开场只到登录，不越过认证。 |
| Demo auth | 固定测试凭证、异步可取消服务、错误反馈、重复提交保护；密码查看按钮保留输入与选区，切换状态有可访问性标签。无后端、token 或持久登录。 |
| Welcome / 星门 | 授权后加速播放原 Welcome；保留局部色块、文字反差和短暂显隐。实际 Logo 节点衔接星门，背后的银河 canvas 延续到主页；星门支持跳过。减少动态效果时不闪烁。 |
| 银河空间 | 一层云图和远、中、近三层星尘；最大 2600 粒子。相机采用有阻尼的整体视差，无自由轨道旋转。WebGL 路径本轮抽查为 4 draw calls、2 textures。 |
| 鼠标尾流 | 有历史状态的固定步长平流/扩散求解器，快细慢宽、卷动、惯性与恢复；停止或移出后不再注入。保留原蓝紫 atlas；当前显示位移增益为 1.4，未同步放大模拟强度、速度或半径。 |
| 星图与内容 | 12 个启用节点（6 方向 + 6 功能）及 6 个暗星；不同节点使用不同 SVG 预设和固定种子。成长路径与已探索提示是前端页面内体验。 |
| 星体旅程 | 同一 `.sm-node-visual` DOM/SVG 从真实节点直接飞到最终详情位置，再展开终端；关闭时连续归位。保留循环相位与线宽关系，兼容途中关闭、重复进入和 resize；不重新初始化银河。 |
| 详情交互 | 鼠标/键盘进入、Esc/按钮返回、焦点管理与背景 inert；初次进入星图可读取 `#star/<id>` 定位，仍须先登录，不是绕过认证的独立页面。 |
| 设置与音频 | 音效/音乐及音量、画质预设、自定义、超级性能、减少动态效果、主题、重播、可用时全屏及 PWA 提示。音频须浏览器用户手势解锁；保留原有声音资源。 |
| 响应式与降级 | 桌面详情星体在左侧，移动端在上方；限制 DPR/像素预算，紧凑视口、低硬件或持续慢帧可降级；隐藏页面暂停。减少动态效果减少持续渲染。WebGL 失败/丢失有静态 atlas 回退和可用 UI。 |
| 构建与旧工程 | 开发、生产构建、预览与 PWA 脚本保留；原档案、模型、美术和壁纸能力仍在仓库，普通星图入口不创建旧 ArchiveScene，但旧模块仍进入 bundle。 |

表内时间、粒子数和显示增益是当前实现快照，不是 IXD_SPEC 的永久常量。画质设置沿用原工程；其中部分模型/档案选项仅影响旧模式，不能假定每个选项都改变银河。

## 3. 当前主要交互流程

**进入登录：** 启动开发服务后打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)，等待准备和 Logo 动画，即显示登录表单，无需另找登录路由。

- 账号：`ixd-demo`
- 密码：`ixd2026`
- 配置：[src/auth/dev-auth-config.ts](../src/auth/dev-auth-config.ts)。账号会去除首尾空格；密码按原值精确比较。
- 这是公开的前端开发测试账号，**不代表真实安全认证**。刷新页面须重新登录，认证不写入浏览器 storage/cookie，也不请求账户 API。

提交错误输入 → `ACCESS DENIED / INVALID IDENTITY` → 可重试。

提交正确输入 → `ACCESS SYSTEM → AUTHENTICATING → IDENTITY CONFIRMED → PERMISSION AUTHORIZED → 2× WELCOME TO IXD → 星门 → 星图`。

选择星体 → 同一星体飞抵详情位置 → 终端展开 → 阅读 → 返回按钮或 Esc → 星体连续归位。暗星不可作为已开放内容进入；成长路径按钮可定位对应方向。已探索状态仅保留在当前页面实例中。

打开画质与设置 → 调整配色/音频/画质等 → 关闭返回；“恢复默认”只重置配色。“重播开场”重新进入登录流程，不保留已认证身份。保存的浅色不会自动迁移为深色。

开发专用的旧档案入口为 `/?experience=archive&scene=archive`；仅 DEV 可绕开星图体验做历史对照。正常生产入口不会因该参数跳过登录。没有独立后台、注册或真实报名提交页面。

## 4. 当前文件结构与职责

| 想修改什么 | 优先阅读 |
| --- | --- |
| 应用入口、偏好、设置、帧循环、旧模式 | [src/main.ts](../src/main.ts)、[index.html](../index.html)、[src/theme-ui.ts](../src/theme-ui.ts) |
| 启动阶段、登录衔接、重播、Logo 共享 | [src/ixd-experience.ts](../src/ixd-experience.ts)、[对应 CSS](../src/ixd-experience.css)、[startup-preparation.ts](../src/startup-preparation.ts)、[welcome-transition.ts](../src/welcome-transition.ts) |
| 原 Welcome 动作与 Logo | [src/boot.ts](../src/boot.ts)、[boot-motion.ts](../src/boot-motion.ts)、[boot-lettering.ts](../src/boot-lettering.ts)、[ixd-mark.ts](../src/ixd-mark.ts)；先查 Beta 0.5 校准记录 |
| 测试凭证与未来 API 适配 | [dev-auth-config.ts](../src/auth/dev-auth-config.ts)、[auth-service.ts](../src/auth/auth-service.ts)、[auth-types.ts](../src/auth/auth-types.ts)；当前导出的 authService 指向 Demo 实现，接后端时替换服务并调整身份/结果契约 |
| 登录界面与密码按钮 | [login-panel.ts](../src/auth/login-panel.ts)、[password-toggle.css](../src/auth/password-toggle.css)，表单布局另见 ixd-experience.css |
| 银河预算、渲染、回退、视差 | [galaxy-scene.ts](../src/galaxy/galaxy-scene.ts)、[galaxy-camera.ts](../src/galaxy/galaxy-camera.ts) |
| 输入采样、尾流模拟与云尘投影 | [galaxy-interaction.ts](../src/galaxy/galaxy-interaction.ts)、[galaxy-atmosphere.ts](../src/galaxy/galaxy-atmosphere.ts)、[star-field.ts](../src/galaxy/star-field.ts)、[nebula-texture.ts](../src/galaxy/nebula-texture.ts) |
| 节点/社团文案/方向与视觉预设 | [src/data/club-content.ts](../src/data/club-content.ts)、[src/data/star-map.ts](../src/data/star-map.ts) |
| 星图、详情、共享星体与焦点 | [star-map-ui.ts](../src/ui/star-map-ui.ts)、[star-map.css](../src/ui/star-map.css)、[galaxy-glyph.ts](../src/ui/galaxy-glyph.ts)、[galaxy-glyph.css](../src/ui/galaxy-glyph.css) |
| 星门 | [ixd-portal.ts](../src/ui/ixd-portal.ts)、[ixd-portal.css](../src/ui/ixd-portal.css) |
| 共用画质/声音/配色 | [render-quality.ts](../src/render-quality.ts)、[audio.ts](../src/audio.ts)、[audio-settings.ts](../src/audio-settings.ts)、[palette.ts](../src/palette.ts) |
| 依赖、资源生成、PWA | [package.json](../package.json)、[vite.config.ts](../vite.config.ts)、[src/pwa.ts](../src/pwa.ts)、[scripts/build-pwa.mjs](../scripts/build-pwa.mjs)、[scripts/prepare-webfonts.mjs](../scripts/prepare-webfonts.mjs) |

`content/`、`art/`、旧 scene/model-viewer/workbench 及 `wallpaper/` 是保留的原档案与壁纸工程，不是当前星图内容的第二份权威来源。原始参考素材和 `.tools/` 本地验证产物不等于可移植的仓库文件。

## 5. 当前已知问题 / 待优化项

### KNOWN ISSUES / 已知边界

- 最近生产构建仍有大于 500 kB 的 chunk 提示。当前保留的旧模块与资源使首包/PWA 缓存较大；现有 `dist` 主 JS 约 931 kB、CSS 约 702 kB（未压缩），PWA 清单合计约 33.8 MiB。这是构建体积问题，不等于构建失败。
- 旧偏好对象会保存主题，无法判断既存浅色究竟是早期自动默认还是用户手动选择，因此目前统一保留；可在设置恢复默认深色。
- Demo 无真实账户、服务端授权、成员数据或报名接收。项目/成长/竞赛内容来自初稿规划，加入渠道待发布；这是当前产品边界，不应写成已上线能力。
- 本机浏览器和移动视口验证不覆盖所有真实手机、Safari 或 GPU。帧率和上下文恢复能力不能据此保证跨设备一致；完整设备覆盖 **Needs verification**。
- 历史说明中的旧参数、域名与验收编号存在过期内容，已在第 9 节明确适用范围。未发现本次抽查范围内新的阻断错误；不据此宣称所有功能无 bug。

### POSSIBLE FUTURE WORK / 按用户后续需求决定

- 用户需要真实身份系统时，用后端 API 替换 Demo 服务，并在服务端实现权限；当前没有排期或默认实现承诺。
- 有新的真实社团资料后再补充成果、联系人、活动时间与报名方式。
- 有性能或发布需求时，再评估旧模式拆包、PWA 缓存范围和真实设备回归，保持既有视觉与交互原则。

这些是可选方向，不是本轮遗留必做任务；文档整理不附带源码修复。

## 6. 当前验证状态

**本次文档整理实际执行：**

| 检查 | 本次结果与范围 |
| --- | --- |
| `npm run check:auth` | 10 通过、0 失败；覆盖正确/错误凭证、输入规则、取消、无持久认证及无账户网络请求。 |
| 现有开发/生产服务 | `5173` 与 `4173` 返回 HTTP 200；生产页加载现有 dist 资源。服务与产物已在整理前存在。 |
| 生产版只读浏览器抽查 | Edge 132.0.2957.115，1440×900，新浏览器上下文、系统浅色；验证默认深色、错误后正确登录、12 启用/6 暗星、AI 详情及 Esc 返回、主题恢复默认、重播回登录。无 pageerror/console.error；生产未暴露 DEV 的 debugGalaxy。 |
| 文档自检 | 已复读三份核心文档，77 个本地链接有效，AGENTS 原有内容完整保留，Git 差异检查通过；变更仅为 AGENTS 与两份新文档。 |

本轮**没有重跑** `npm ci`、开发启动钩子、生产 build、完整浏览器回归或逐帧视觉比较，避免纯文档任务触发资源生成。下面是已有结果，不能表述为本轮重新通过：

| 已有证据 | 快照与限制 |
| --- | --- |
| [BETA05-VERIFICATION.md](BETA05-VERIFICATION.md) | 该功能轮 `npm run build` 成功，并记录主题、开屏、Welcome、尾流增益与全部星体旅程验收；保留复现命令和环境说明，本轮未重跑构建。 |
| 本机 `.tools/beta05-production-final/results.json` | 已核对现有 JSON：107 个检查记录，无 errors / consoleErrors；生产地址 4173。 |
| 本机 `.tools/beta05-production-special/results.json` | 已核对现有 JSON：194 个检查记录、24 次星体旅程、无 errors。 |
| 本机 `.tools/beta05-regression/results.json` | 已核对现有 JSON：163 个检查记录，无 errors / consoleErrors，另有 2 条预期诊断；开发地址 5173。 |
| 当前 `dist/` | 已存在生产目录；`pwa-build.json` 标识 `577674f1c53b4b10`，818 个预缓存文件；当前主包 `index-KbfJVH8C.js`。与上述记录一同作为现有产物证据，不替代新环境 build。 |

`.tools/` 和 `dist/` 被 Git 忽略，新 clone 不会获得这些本地产物；可提交的验收说明与脚本才是复现入口。各报告的检查数存在重叠，不相加成独立测试总数。

功能修改应按范围运行 auth、build 和真实浏览器验证；银河/动效变更还需专项与视觉对照，数值断言不能证明艺术效果。旧记录入口为 [VERIFICATION.md](VERIFICATION.md)，当前迭代优先查 Beta 0.5。

## 7. 本地运行方式

本机已核对：Node `24.18.0`、npm `11.16.0`、TypeScript `5.9.3`、Vite `7.3.6`、Three.js `0.183.2`、`@types/three` `0.183.1`、rolling-number `0.4.1`。`package.json` 部分使用版本范围，复现实际依赖以 `package-lock.json` 和 `npm ci` 为准。

在 PowerShell 中：

```powershell
cd D:\Codex\Codex_Design_B\rine-webui-ixd
npm ci
npm run dev
```

打开终端显示的本地地址，通常为 `http://127.0.0.1:5173/`。端口被占用时以 Vite 输出为准。首次动画结束即可用第 3 节的固定账号登录。

生产构建及预览在另一个终端运行：

```powershell
npm run check:auth
npm run build
npm run preview
```

构建链为 TypeScript 检查 → Vite → PWA 生成，输出 `dist/`；预览默认 `http://127.0.0.1:4173/`。不要直接双击 dist 的 HTML。生产 PWA 需 localhost 或 HTTPS，开发模式不注册该 service worker。

可用的补充检查：`npm run check:content`、`npm run check:palette`、`npm run check:viewport`。尾流数值检查为 `node --experimental-strip-types scripts/check-beta04-flow.mjs`；当前主题/星体专项为 `node scripts/check-beta05-browser.mjs`，需要 Playwright 与可启动的浏览器，支持 `PLAYWRIGHT_MODULE`、`BROWSER_CHANNEL`、`IXD_TEST_URL`、`IXD_TEST_OUTPUT`。完整命令与视觉复核步骤见 Beta 0.5 报告，避免覆盖要保留的历史输出目录。

注意：`predev` / `prebuild` 会修补 rolling-number 依赖并重新导出档案，`prebuild` 还准备字体。这些命令不是纯文档检查。独立许可的 Novecento 字体不进 Git；缺少时保留现有回退，不能把本机授权字体随意加入仓库。`build:cloudflare` / `build:wallpaper` 是保留的打包脚本，不证明当前 IXD Fork 已上线或获得部署授权。

## 8. Git 与远程仓库状态

| 项目 | 本次核对值 |
| --- | --- |
| origin（工作 Fork，fetch/push） | `https://github.com/Jc-augenstern/rine-webui-ixd.git` |
| upstream（原合作仓库，仅读取/同步） | fetch：`https://github.com/zwh087383/rine-webui-ixd.git` |
| upstream 写入保护 | push URL：`https://upstream-read-only.invalid/DO-NOT-PUSH` |
| 当前开发分支 | `feat/ixd-star-map-redesign` |
| 本地保护 | `remote.pushDefault=origin`；`core.hooksPath=.githooks`；pre-push 校验远程名及仓库所有者 |

本次通过只读 `ls-remote` 查询，origin 同名分支为 `ea2374e3eb7eb0093f4ffef79bd7ff2a84f463cb`，与本地 HEAD 一致。新文档尚未提交，所以此一致性只描述已提交历史。

未来开发分支或 HEAD 变化后应更新本文快照；工作前仍须自行检查。upstream 不接受本项目的默认 push、PR 或 Settings 操作，旧文档授权不能继承。新的 clone 不会继承本地 Git 配置，可先审阅并运行 [scripts/setup-safe-remotes.mjs](../scripts/setup-safe-remotes.mjs) 恢复远程和 hook 保护，再核对结果。

本轮用户明确要求：不 commit、不 push、不合并 main、不部署，文档整理完成后等待确认。这是本次操作范围，不是要求未来所有任务永远禁止提交。

## 9. 新会话接手指南

### START HERE

1. 完整阅读根目录 [AGENTS.md](../AGENTS.md)。
2. 阅读 [IXD_SPEC.md](IXD_SPEC.md)。
3. 阅读本文，注意快照日期和验证边界。
4. 按当前任务选择下表中的专项资料。
5. 检查 `git status`、当前分支、最近提交和远程。
6. 检查相关源码与实际行为，再在用户授权范围内修改。

### 文档职责与历史差异索引

原文均保留，不为了统一口径重写历史。本表的 **Historical / Snapshot** 表示只能在原迭代范围内引用；其中仍适用的方法需结合当前代码判断。

| 资料 | 职责与适用范围 |
| --- | --- |
| AGENTS / IXD_SPEC / CURRENT_STATE | 分别负责工作规则、长期原则、实际状态。新会话的最小上下文集合。 |
| [BETA05-VERIFICATION.md](BETA05-VERIFICATION.md) | 最新已提交功能轮的专项验收快照；解释当前六项修订，具体结果仍有日期与环境限制。 |
| [BETA04-VERIFICATION.md](BETA04-VERIFICATION.md)、[BETA03-VERIFICATION.md](BETA03-VERIFICATION.md) | Historical / Snapshot。尾流基础等仍有参考价值；早期快速揭字、无前景淡出和简化 Welcome 显隐已被 Beta 0.5 修改。 |
| [GALAXY-EXPLORATION.md](GALAXY-EXPLORATION.md)、[GALAXY-UPGRADE.md](GALAXY-UPGRADE.md) | 银河专项历史与技术探索。旧 5 draw calls / 1 texture、池化拖尾或径向折射、复制 SVG / 途经中心的星体方案不是当前实现；当前为有历史流场、4 draw calls / 2 textures、同一星体直接往返。 |
| [VERIFICATION.md](VERIFICATION.md) | 验证方法和早期测试记录索引。其“最新 Beta 0.4”提示已过期；本轮最新功能记录是 Beta 0.5，不能把旧条目当作重新通过。 |
| [DELIVERY.md](DELIVERY.md) | 历史交付记录，保留仓库交付和早期流程证据。正文中的早期开屏时长、提交及测试数量不是当前快照。 |
| [README.md](../README.md)、[DESIGN.md](../DESIGN.md) | 使用总览与原工程设计/时间轴资料。DESIGN 的默认浅色、早期暖色基线和旧档案布局规则不可覆盖当前 IXD_SPEC。README 也须结合本文及实际代码读取。 |
| [PWA.md](PWA.md)、[CLOUDFLARE-DEPLOYMENT.md](CLOUDFLARE-DEPLOYMENT.md) | PWA 与原站部署专项历史；其中域名、Vercel/Cloudflare 连接及推送 main 的授权不等于当前 Fork 的部署状态或授权。当前 PWA 实现仍见代码。 |
| [WALLPAPER-ENGINE.md](WALLPAPER-ENGINE.md)、[DESKTOP-FOLDERS.md](DESKTOP-FOLDERS.md)、[WORKSHOP-PUBLISH.md](WORKSHOP-PUBLISH.md)、[WORKSHOP-DESCRIPTION.txt](WORKSHOP-DESCRIPTION.txt) | 保留的壁纸、桌面与创意工坊专项记录，不是当前星图网站的上线状态或必做清单。 |
| [UPSTREAM-README.md](UPSTREAM-README.md)、[docs/media/README.md](media/README.md) | 原工程说明与历史演示素材说明，保留来源和署名。 |
| [verification/](../verification/)、[content/README.md](../content/README.md) | 更早的品牌、动效、性能等专项记录，以及原档案内容维护说明；已解决的旧性能问题不自动成为当前 TODO。 |

发生冲突时，先区分“已确认原则”与“某次实现快照”，再以当前代码、运行结果和 Git 核实 CURRENT_STATE。不要据此静默更改长期原则，也不要删除不再适用的历史记录。
