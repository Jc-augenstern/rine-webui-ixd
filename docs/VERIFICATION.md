# IXD 星图验收记录

最新 1.5 秒预备屏、持续背景、原片闪烁转场与银河路径尾流的实现及验收见 [beta 0.4 记录](BETA04-VERIFICATION.md)。[beta 0.3 记录](BETA03-VERIFICATION.md) 和以下内容保留为此前各轮的历史基线，不将旧测试结果当作新版行为证明。

## 银河探索增强复验（2026-09-21）

四层银河、分层视差、矢量星系进入/退出已在原分支完成增量修改。认证 10/10、完整浏览器回归 70/70、新增旅程与性能检查 34/34 通过，页面异常与控制台错误均为 0；`npm run build` 成功，`npm run dev` 运行正常。实现、性能测量边界及新增复测命令见 [银河探索说明](GALAXY-EXPLORATION.md)。以下保留首轮交付记录。

验收日期：2026-09-21（中国标准时间）。Windows、Node.js 24.18.0、npm 11.16.0、Edge / Playwright；以生产预览 `http://127.0.0.1:4173/` 完成主流程检查。

## 已通过

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 成功，沿用原 npm 锁文件 |
| `npm run dev` | 成功启动；默认开场、登录及旧工程开发对照入口可访问 |
| `npm run check:auth` | 10/10：正确凭证、错误账号/密码、空输入、大小写/空白、请求取消、无认证持久化 |
| `npm run build` | TypeScript 与 Vite 成功；完整 dist 829 文件约 41.8 MiB；PWA 预缓存 release `bba6e9eb354cf31a`，818 文件约 33.8 MiB |
| 生产版真实浏览器脚本 | 70/70，通过；页面异常和 console.error 均为 0 |
| 独立边界复查 | 5/5，通过；生产旧查询参数、减少动态效果、手机完整登录、键盘焦点/连续 Esc、开发旧档案入口 |

主流程包括：原 Logo 开场、登录停留超过 8 秒、错误凭证拒绝及重试、AUTHENTICATING → IDENTITY CONFIRMED → PERMISSION AUTHORIZED → WELCOME → 星图。授权和 Welcome 使用原时间轴以 2 倍速播放，保留原圆环与字形轨道。

星图检查覆盖全部六个方向与六个功能节点的悬停、详情、关闭与焦点恢复；六颗预留星不能进入详情；竞赛六个轨道节点；成长星轨；鼠标移动影响镜头；性能模式、减少动态效果和重新登录。

布局检查覆盖 1920×1080、2560×1440、1366×768、390×844、844×390。已目视检查开场、登录、授权、Welcome、星图、详情；小屏没有横向溢出，短横屏可以真实滚动到下方节点和工具栏。测试中修正了中等高度的文字重叠、详情背景透字、连续 Esc 和设置开关命中区域问题。

独立 GalaxyScene 检查覆盖 WebGL 上下文丢失后的静态背景、恢复、减少动态效果时停止无必要重绘，以及 dispose 后释放画布和几何资源。默认桌面天空为 2,192 个粒子、6 个绘制调用；DPR 上限为 2，另设总像素预算。以上是实现和浏览器观测，不等于所有设备的帧率保证。

## 再次运行

```powershell
npm run check:auth
npm run build
npm run preview
```

保持预览终端运行。如需重复完整浏览器脚本，在另一终端进入项目目录，先准备 Playwright（只用于开发验收，应用运行不依赖它）：

```powershell
npm install --no-save --package-lock=false playwright
$env:IXD_TEST_URL='http://127.0.0.1:4173'
node scripts/check-ixd-browser.mjs
```

脚本默认调用已安装的 Microsoft Edge。用 Chrome 时可先设置 `$env:BROWSER_CHANNEL='chrome'`。如果复用外部 Playwright 安装，可将 `$env:PLAYWRIGHT_MODULE` 设为其绝对模块路径，不需要上面的临时安装。报告与截图默认写入 `.tools/ixd-browser/`，不提交 Git。运行 `npm ci` 可恢复锁文件定义的依赖环境。

本次最后一轮的原始报告与截图在本地 `.tools/ixd-production-final/`；独立边界复查在 `.tools/edgecases/`。原版基线、视频取帧与 Word 提取在项目外 `../research/`。

## 已知边界

银河局部形变、Welcome 星门及十二种节点结构的后续验收，见 [GALAXY-UPGRADE.md](GALAXY-UPGRADE.md)。下方原交付记录保留为历史基线；本轮录像和测试结果使用独立目录。

- 当前登录是公开前端 Demo，不提供安全隔离。不会保存密码、认证令牌或登录会话，刷新后重新登录。
- 页面不连接报名、成员管理、作品投稿或项目数据库；缺失的真实资料显示为待补充。
- 移动端用模拟视口和触摸上下文验收，尚未在每种实体手机上测试。
- Vite 提示保留的 Three.js / 原工程单个 JS 包超过 500 kB，这是构建提示而非失败。原档案素材保留，因此完整 dist 约 41.8 MiB；进入星图不会初始化旧档案场景。
- 这次没有公开部署网站；GitHub 分支提供源码，本地 dev / preview 提供可运行网页。
