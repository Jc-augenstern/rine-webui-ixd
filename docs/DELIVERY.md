# IXD 星图网站交付报告

日期：2026-09-21

本次在原 IXD 的 TypeScript、Three.js、Vite 工程上继续开发，交付可运行源码、独立开发分支、生产构建目录和维护说明。原 Logo、HUD、授权与欢迎动画，以及原档案相关源码、模型和历史记录均予保留。

## 1. 仓库、分支与原始版本保护

| 项目 | 交付位置或状态 |
| --- | --- |
| 你的 GitHub 账号 | `Jc-augenstern` |
| 你的仓库 | [Jc-augenstern/rine-webui-ixd](https://github.com/Jc-augenstern/rine-webui-ixd)；已创建并确认是原仓库的 Fork |
| 本次开发分支 | `feat/ixd-star-map-redesign` |
| 本次分支页面 | [查看开发分支](https://github.com/Jc-augenstern/rine-webui-ixd/tree/feat/ixd-star-map-redesign)；远端内容以最终推送结果为准 |
| 本地完整项目 | `D:\Codex\Codex_Design_B\rine-webui-ixd` |
| 原始代码基准 | `2038d69f5ccbb18c4ebc0e18223e8961b6f9a65b` |
| 原始源码压缩备份 | `D:\Codex\Codex_Design_B\research\upstream-baseline.zip`，位于项目外，不会随本次源码覆盖 |
| 开发入口 | `npm run dev`，通常为 `http://127.0.0.1:5173/` |
| 生产构建目录 | `D:\Codex\Codex_Design_B\rine-webui-ixd\dist`，已生成，可重新构建，不追踪到 Git |

舍友仓库只作为下载和同步来源。本次没有向 `zwh087383/rine-webui-ixd` 推送、创建分支、提交修改或创建 PR，也没有修改其设置。所有开发修改均位于本地独立副本的本次开发分支。

当前远程配置：

| 远程名称 | 用途 | 地址 |
| --- | --- | --- |
| `origin` | 下载、推送你自己的 Fork | `https://github.com/Jc-augenstern/rine-webui-ixd.git` |
| `upstream` 的 fetch 地址 | 只读同步舍友代码 | `https://github.com/zwh087383/rine-webui-ixd.git` |
| `upstream` 的 push 地址 | 故意设置为不可用地址 | `https://upstream-read-only.invalid/DO-NOT-PUSH` |

本地同时启用了 `.githooks/pre-push`：仅允许通过 `origin` 推送到你的仓库。`git fetch upstream` 仍可正常读取原仓库。换电脑重新克隆后，运行 `node scripts/setup-safe-remotes.mjs` 恢复这套保护。

本报告不预先声称最终推送成功。最终任务回复会单独说明提交和推送结果；也可在项目目录输入以下命令查看实际版本：

```powershell
git branch --show-current
git log -1 --format="%h %s"
git status --short
git remote -v
```

## 2. 网站主要变化与已完成功能

首页现在按以下顺序运行：

```text
原 IXD 开场（约 6 秒）
→ 身份接入，停留等待用户输入
→ ACCESS SYSTEM
→ AUTHENTICATING
→ IDENTITY CONFIRMED
→ PERMISSION AUTHORIZED
→ 约 2 倍速度播放原 WELCOME TO IXD CLUB 动画
→ IXD 星图主页：让灵感漫步于星辰大海
```

登录没有倒计时，不要求用户在固定时间内输入。开场可点击“前往登录”，使用减少动态效果设置时直接进入登录等待。

星图已实现：

- 六颗方向主星：AI 与智能系统、具身智能与机器人、新媒体与交互设计、文创与视觉设计、XR 与交互娱乐、智能硬件。
- 六颗功能星：社团介绍、项目孵化、竞赛、沙龙、作品集、加入我们；另有六颗不可进入的预留暗星。
- Three.js 多层星空、轻微鼠标视差、靠近时微亮和少量星尘尾迹；控制像素密度与渲染预算。
- 星星悬停提示、点击后镜头靠近与终端详情、返回星图；支持键盘、触摸和详情焦点循环。
- 六方向的定位、学习关键词与典型项目示例，以及成长星轨和竞赛轨道。
- 保留声音、音乐和画质设置；支持减少动态效果、响应式布局及 WebGL 不可用时的静态回退。

内容依据用户 Word 整理。文档属于社团筹建规划，页面已区分“典型项目示例”“竞赛辅导方向”和真实成果，没有把规划写成已完成项目、获奖记录、成员名单或实际招生渠道。原工程版权与字体许可说明继续保留。

## 3. 如何测试登录

1. 按下一节启动网站，在浏览器打开首页。
2. 等待约 6 秒开场结束，或点击右上角“前往登录”。
3. 在“身份接入”填写以下固定凭证，点击 **ACCESS SYSTEM**；也可以在密码输入框按 Enter。

| 字段 | 固定测试值 |
| --- | --- |
| 账号 | `ixd-demo` |
| 密码 | `ixd2026` |

输入错误账号或密码会显示 `ACCESS DENIED / INVALID IDENTITY`，可修改后重试。密码大小写和前后空格有区别。成功后按上述确认、授权和欢迎流程进入星图。星图底部的“重新登录”可重播流程；刷新页面也需要重新登录。

**这是公开的前端 Demo 账号，仅用于开发测试，不是真实安全认证。** 账号密码集中在 `src/auth/dev-auth-config.ts`，验证适配器位于 `src/auth/auth-service.ts`，接口定义位于 `src/auth/auth-types.ts`，没有散落在界面组件中，也不向浏览器存储写入登录凭证或会话。页面设置可以保存在本机，这是显示偏好，不是登录授权。

## 4. 本地启动与生产构建

需要 Node.js 22.12 或更高版本；本次使用 Node.js 24。打开 PowerShell，逐行输入：

```powershell
cd D:\Codex\Codex_Design_B\rine-webui-ixd
npm ci
npm run dev
```

`npm ci` 按现有锁文件安装依赖。等待终端出现地址后，用浏览器打开该地址，通常是 [本地开发版](http://127.0.0.1:5173/)。保持该终端运行；停止服务按 Ctrl+C。以后依赖没有变化时，只需进入项目目录后运行 `npm run dev`。

生产构建与预览：

```powershell
npm run check:auth
npm run build
npm run preview
```

本次 `npm run build` 已成功，输出完整 `dist` 目录。预览通常位于 [本地生产预览](http://127.0.0.1:4173/)，实际地址以终端输出为准。请通过预览服务访问，不要双击 `dist/index.html`。

`dist` 是可重新生成的发布文件；源码、依赖锁文件和构建脚本才是后续开发基础。按原工程规则，`dist`、`node_modules`、本机测试截图、缓存和 GitHub 凭证均不应提交到 Git。

## 5. 已执行的验证

- 开发服务器和生产预览均已实际运行，生产构建成功。
- 认证契约测试 **10 项通过**；覆盖固定凭证、错误或空输入、密码精确比较、取消请求以及不持久化凭证和会话。
- 主要浏览器验收 **70 项通过**；覆盖开场、登录与授权、欢迎转场、星图内容与交互、响应式、短横屏滚动及生产版本，页面异常与控制台错误均为零。
- 独立边界验收 **5 项通过**：生产旧参数不能绕过登录；减少动态效果仍需登录；390×844 手机从初始页面完成登录；详情 Tab 循环和连续 Esc 正常；开发首页与原档案调试入口可运行。该组页面异常与控制台错误均为零。

重点桌面视口为 1920×1080、2560×1440、1366×768，另验证手机视口。测试命令与验证范围见同目录的 `VERIFICATION.md`。浏览器实际验收与截图保存在本机 `.tools` 下；独立边界报告为 `.tools/edgecases/report.json`，手机登录截图为 `.tools/edgecases/mobile-login.png`。这些本机验证产物不作为网站源码提交。

原档案界面仍可在开发服务器通过 `/?experience=archive&scene=archive` 打开做回归；生产版忽略该开发旁路并继续要求登录。

## 6. 以后如何继续开发

先进入本地项目目录，并切换到本次分支：

```powershell
cd D:\Codex\Codex_Design_B\rine-webui-ixd
git switch feat/ixd-star-map-redesign
npm run dev
```

修改入口：

| 想修改的内容 | 对应文件或目录 |
| --- | --- |
| 社团文字、方向介绍、关键词和项目示例 | `src/data/club-content.ts` |
| 添加一颗星、位置、类型、亮度、启用状态与关联内容 | `src/data/star-map.ts` |
| 星空背景、粒子和镜头 | `src/galaxy/` |
| 星图及详情布局 | `src/ui/star-map-ui.ts`、`src/ui/star-map.css` |
| 开场接入、登录状态与欢迎流程 | `src/ixd-experience.ts` |
| 登录界面与视觉 | `src/auth/login-panel.ts`、`src/ixd-experience.css` |
| 开发登录配置与未来 API 接口 | `src/auth/` |

添加星星时，优先在统一数据结构中新增一条数据，并填写内容与位置；不用再把导航散落写进主页面。浏览器会随开发文件变化更新。

保存下一次修改的步骤：

1. 运行 `npm run check:auth` 和 `npm run build`，并实际检查登录、星图详情和手机布局。
2. 运行 `git status`、`git diff` 查看这次改了什么。
3. 用 `git add <本次需要保存的文件>` 选择文件，再用 `git commit -m "本次修改说明"` 保存一个本地版本。将尖括号部分替换为实际文件路径。
4. 运行 `git remote -v`，确认 `origin` 仍是 `Jc-augenstern/rine-webui-ixd`。
5. 运行 `git push origin feat/ixd-star-map-redesign`，把版本同步到你自己的仓库。

若需要开始下一项独立功能，可先运行 `git switch -c feat/你的新功能名` 创建新分支。同步舍友代码时，先 `git fetch upstream` 下载更新，再在单独分支审阅和合并，不要向 `upstream` 推送。

## 7. 接入真实后端时要替换的部分

以调用后端 API 的适配器替换 `src/auth/auth-service.ts` 中导出的 `authService`，遵守 `AuthService` 的异步返回与取消请求接口，然后删除开发凭证及 Demo 验证模块。登录界面和正常成功转场可继续复用。

真实账号注册、密码验证、服务端会话、权限校验、退出登录、请求限流和受保护数据必须由后端实现。社团报名、作品发布、成员管理和真实项目数据也需要后端及有效数据来源。当前前端的“身份确认”“权限授权”是演示流程，不代表服务端已经授予访问权限。

源码和构建目录已提供；网站线上托管与域名不是本次交付中的已发布结果。最终 Git 提交与远端推送状态请查看本次任务最终回复和开发分支页面。
