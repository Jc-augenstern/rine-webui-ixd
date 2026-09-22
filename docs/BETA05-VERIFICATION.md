# Beta 0.5 六项定向修订与验收

日期：2026-09-23。工作区：`D:\Codex\Codex_Design_B\rine-webui-ixd`。

基于现有分支 `feat/ixd-star-map-redesign` 增量修改。修改前工作区干净，基准为 `5f44adca7ef43a18b006524256ef4dbfd30798dd`，相关源码归档保存在 `.tools/beta05-baseline/source.zip`；未重建、重新克隆或回退工程。

## 1. 默认深色与偏好保留

- `index.html` 的初始属性、背景回退值、主题 meta、同步主题脚本，以及 `main.ts` 的应用默认值统一为深色。系统浅色也不改变首次访问的默认值。
- 已保存 `colorTheme: "light"` 仍采用浅色。旧版保存声音等设置时也会保存整个偏好对象，无法判断旧的浅色是自动默认还是手动选择，因此不做覆盖迁移。
- 设置仍可选择亮色/暗色；新增配色组内“恢复默认”，只把配色恢复为深色，保留音量、画质等其他设置。
- 浏览器验证了无偏好+系统浅色、无偏好+系统深色、保存浅色、保存深色、恢复默认。测试暂缓主模块加载，直接核对初始 HTML 的背景和主题属性，再检查实际启动帧，没有观察到页面浅色闪帧。

老用户可能因保留已有偏好继续看到浅色，可在“画质与设置 → 界面配色”中选择暗色或恢复默认。

## 2. 开屏：1500 ms 同步推进 + 500 ms 前景淡出

当前原始填充时长为 `--ixd-preparation-duration: 1500ms`，保持不变。取消原先只占填充时长 24% 的快速文字揭示，文字和进度条读取同一阶段时钟。未显示的字格保留占位，完整短语始终居中。

达到 1500 ms 后，完整文字和满格进度条共同降低不透明度；500 ms 后才发出完成信号并进入 Logo。共享背景、圆弧和环境层始终保留。没有退出定时器或第二个 Logo 回调队列。

| 测量 | 开发版专项 | 生产版专项 |
| --- | ---: | ---: |
| 文字完整、进度条填满 | 1504.1 ms | 1505.8 ms |
| 淡出后完成 | 2004.2 ms | 2005.3 ms |
| 实际淡出 | 500.1 ms | 499.5 ms |

这是本机 rAF 采样结果，允许一帧取样误差。Logo 原 2.84 秒绘制、0.72 秒左移/登录框进入保持不变。冷启动、热重载、重新登录及模块加载失败后的恢复均已检查。

## 3. Welcome：恢复原动作并按目标视频校准

实际存在并能完整解码的参考文件：

| 用途 | 相对路径 | 时长 | 原生视频 |
| --- | --- | ---: | --- |
| CURRENT | `reference/ixd-bate0.4.mp4` | 31.07 s | H.264，1680×1256，60 fps |
| TARGET，仅 Welcome | `reference/ixd-bate0.2.mp4` | 36.11 s | H.264，2560×1272，60 fps |

以上路径均位于本工作区，未改动或删除参考文件。旧 Welcome 19.8–21.8 秒与当前 Welcome 9–11 秒各提取 121 张真实连续帧；当前星体 21–30 秒保留 541 张原生帧。关键帧间隔约 16.7 ms，索引保存源帧编号与 PTS，没有插帧。

实际根因是 `BootSequence.renderWelcome()` 在调用原时间轴之后，又用通用 smooth reveal 覆盖 company/database opacity，并移除了 highlight clip。修复复用原 `companyTrack` 展开曲线，恢复局部底条及覆盖前后的文字反差。显隐切点按 TARGET 原生帧校准：

| TARGET 源帧/时间 | 观察与实现 |
| --- | --- |
| 1236 / 20.600 s | IXD CLUB 与左侧小块出现 |
| 1238–1239 / 20.633–20.650 s | 公司文字/色块短暂消隐，Logo 保留 |
| 1240–1241 / 20.667–20.683 s | 横向底条展开，覆盖部分文字反色 |
| 1242–1243 / 20.700–20.717 s | 文字/底条短暂弱化 |
| 1244 起 / 20.733 s | 恢复反差并完成底条展开 |
| 1280–1281 / 21.333–21.350 s | INTERNAL DATABASE 首次显现 |
| 1282–1283 / 21.367–21.383 s | 第一次消隐 |
| 1284–1287 / 21.400–21.450 s | 再显现 |
| 1288–1289 / 21.467–21.483 s | 第二次消隐 |
| 1290 起 / 21.500 s | 稳定显示 |

保留模块的更早档案时间轴包含额外一次 database 消隐，最终没有照搬它；`welcomeTextState()` 只校准 B 段的实测切点，不改变原档案模式。这里的时间是参考视频定位，网页仍由登录结果和实际阶段完成事件驱动。

A 段 300 ms 局部切换及 C 段共享 Logo → 星门保留，减少动态效果模式直接呈现稳定文字、不闪烁。首次星云构建移到 B 段短显隐结束以后，避免同步纹理初始化打断第三行节奏。

## 4. 银河：仅显示位移 ×1.4

新增共享 shader uniform `uFlowDisplayGain = 1.4`，只用于云图采样位移和已有星尘投影位移。输入强度、模拟速度、半径、密度、透明度、恢复力、速度上限、历史平流/卷动/扩散、相机和蓝紫 atlas 均不修改。

独立本地对照载入修改前源码和当前源码：1920×1080、同画质、同一静止初态、冻结相机/自然时间，沿 `(500,555) → (1100,555)` 分别用 350 ms 和 2500 ms 输入，按相同 60 Hz 步长更新。

- 两版每个被比对时刻的完整模拟纹理数组、粒子状态和求解器统计完全相等。
- 初始静止渲染逐像素相同。
- 相同尾流区域相对静帧的 RGB 差异 RMS 增加约 18%–22%；这是运动造成的图像差异，不是提升整屏曝光。视觉对照显示原有云丝轨迹变得更清楚。
- 原有流场测试 32 项通过：快细慢粗、历史扩散、不同采样率一致性、移出后衰减和禁用输入等。
- 额外 30 秒往返曲线输入后，模拟最大位移约 36.40 px；停止 8 秒后约 0.0276 px，最大速度约 `8.4e-7 px/s`。本轮显示位移为上述模拟值的 1.4 倍；回看恢复画面未见永久空洞或亮斑。

## 5. 星体打开：直接到最终详情位置

删除原 WAAPI 中 `(50% viewport width, 47% viewport height)` 的中央关键帧。开始时读取实际节点矩形和现有响应式详情布局，同一段约 1100 ms 的位移/尺寸变化直接到最终位置；到位信号才触发原终端展开。

桌面仍沿用原左侧布局，移动端仍在上方。终端本身的 clip-path、文字、布局、进出动画没有修改。途中 resize 从当前几何状态重定向，关闭时每帧读取原节点真实位置，适配视差恢复和窗口变化。

## 6. 星体关闭：同一实例连续归位

在 CURRENT 的 24.733 s（文创）和 29.683 s（机器人）看到过渡图形消失，原节点随后重新淡入。对应代码原先复制 SVG 到放大的 420 px 容器，退出时取消过渡层并解除原节点的 opacity=0；原节点还会执行 0.4 秒透明度过渡。两套容器的缩放、线宽和循环动画相位也可能不一致。

修复机制：

- 同一个 `.sm-node-visual` DOM/SVG 往返主页与过渡容器，保留节点、视觉预设、随机种子和结构。
- 支持时使用 `moveBefore`；兼容路径移动原元素并恢复 CSS 循环动画的 currentTime，不重新生成图形。
- 按实际 SVG viewport 尺寸连续缩放，避免缩小 420 px 外层导致 non-scaling-stroke 与主页线宽不匹配。
- 额外细节、线宽和光晕在返回途中收回；循环通过暂停/继续保持相位。
- 选中节点的父容器不再先透明再淡入；同一帧把图形放回原 holder 后才隐藏弹层，没有空白或重叠副本。
- 返回保持 920 ms 及原终端收回节奏。整个旅程仅有一个状态对象，共用应用帧循环，没有过期 timeout 回调重新打开详情。

连续帧检查了两颗参考星归位前后的位置、线条和视觉身份。自动化验证所有 12 个预设，参考两颗各连续三次，鼠标/Esc、重复触发、打开途中关闭、重新打开、详情及返回中 resize、移动端、减少动态效果、焦点与 inert、设置输入隔离和原背景 canvas 持续存在。每帧只有一个连接且可见的图形实例；交接位置/尺寸差小于 1.5 px，计算线宽连续，CSS 循环时间不归零。

## 测试与实际录屏

环境为 Windows、本机 Edge 132.0.2957.115、Node 24.18.0。测试包含 1920×1080、1366×768、1440×900、1280×800、1024×768、390×844，以及原回归中的不同 DPR、静态 WebGL 回退与 reduced motion；没有据此声称所有设备性能相同。

| 检查 | 结果 |
| --- | --- |
| `npm run check:auth` | 10/10，通过；固定凭证与取消认证行为未变 |
| `node --experimental-strip-types scripts/check-beta04-flow.mjs` | 32/32，通过 |
| 现有浏览器回归（更新了本轮要求的时序/显隐预期） | 163 项，通过 |
| 本轮专项开发版 | 162 项，通过 |
| 生产版专项，增加动画相位和详情/退出中 resize | 194 项，通过 |
| 生产版原流程、几何视差和设置隔离 | 83 项，通过 |
| 最终 Welcome 校准后的生产 UI/深色连续性复测 | 107 项，通过，包含目标视频仅两次 database 消隐 |
| `npm run build` | 成功，`dist/` 已生成，离线包 818 文件/33.8 MiB |

运行过程中无页面异常和非预期控制台错误。专门阻断模块/WebGL 的回退测试有预期诊断。Vite 保留已有大 chunk 提醒（主 JS 约 931 kB，gzip 287 kB），构建退出码为 0；本轮未扩大到打包架构重构。

录屏来自浏览器真实合成帧，原帧/时间戳保存在各目录 `frames.json`。MP4 按捕获时间生成 VFR，不插帧；采集和视频播放自身可能漏过显示刷新，不把它当作稳定 60 fps 性能证明。启动录屏只裁去导航前的 about:blank 帧，原始帧保留。原视频/本轮录屏已用正常速度及 0.25 倍速播放，并查看连续真实帧、全局布局和关闭局部放大图。

所有路径均相对本工作区，均未提交 Git：

| 证据 | 本地位置 |
| --- | --- |
| 一页播放索引（服务运行时） | `http://127.0.0.1:5173/.tools/beta05-final/review.html` |
| 开屏 → 登录 | `.tools/beta05-final/videos/startup.mp4` |
| **最终**授权 → Welcome → 星门 | `.tools/beta05-final-calibrated/videos/welcome.mp4` |
| 文创、机器人打开/关闭 | `.tools/beta05-final/videos/nodes.mp4` |
| 实际主页尾流 | `.tools/beta05-final/videos/flow.mp4` |
| 相同输入增强前/后 | `.tools/beta05-flow/videos/before.mp4`、`after.mp4` |
| 同输入 PNG/原始状态/恢复数据 | `.tools/beta05-flow/` |
| 参考原生帧、源 PTS、解码/播放记录 | `.tools/beta05-reference/` |
| 本轮节点原帧/归位局部连续图 | `.tools/beta05-final/nodes/`、`visual-return-*.jpg`、`robotics-return-*.jpg` |
| 最终 Welcome 连续图及播放记录 | `.tools/beta05-final-calibrated/` |
| 最终生产 UI 测试 | `.tools/beta05-production-final/results.json` |
| 生产专项测试完整帧观测 | `.tools/beta05-production-special/results.json` |

## 修改文件与继续开发

- 默认主题与开屏：`index.html`、`src/main.ts`、`src/theme-ui.ts`、`src/startup-preparation.ts`。
- Welcome/阶段衔接：`src/boot.ts`、`src/welcome-transition.ts`、`src/ixd-experience.ts`。
- 银河显示：`src/galaxy/galaxy-atmosphere.ts`、`src/galaxy/galaxy-scene.ts`、`src/galaxy/star-field.ts`。
- 星体旅程：`src/ui/star-map-ui.ts`、`src/ui/star-map.css`、`src/ui/galaxy-glyph.css`。
- 测试：`scripts/check-beta04-browser.mjs`、`scripts/check-beta05-browser.mjs`。
- 文档：`README.md`、`docs/DELIVERY.md`、本文件。

社团内容、导航、12 种节点图形/种子定义、认证模块、密码显示按钮、星门模块和音频系统没有修改。

```powershell
cd D:\Codex\Codex_Design_B\rine-webui-ixd
npm ci          # 新检出或依赖变化时
npm run dev    # 首页等待约 5.6 秒进入登录；Logo 阶段也可点“前往登录”
npm run check:auth
npm run build  # 生成 dist
npm run preview
```

开发测试账号 **`ixd-demo`**，密码 **`ixd2026`**。这是公开前端 Demo 凭证，不是真实安全认证。打开首页进入“身份接入”，点击 ACCESS SYSTEM；星图底部“重新登录”可重播。真实后端接入仍通过 `src/auth/auth-service.ts` 替换，配置集中在 `src/auth/dev-auth-config.ts`。

继续修改时沿用当前分支，或从它新建自己的分支；保持认证、构建和两个浏览器脚本检查。浏览器脚本通过 `PLAYWRIGHT_MODULE` 指定本机 Playwright，`IXD_TEST_URL` 可切换开发/生产地址；`IXD_TEST_OUTPUT` 指定不提交的测试产物目录。

唯一写入远程为 [Jc-augenstern/rine-webui-ixd](https://github.com/Jc-augenstern/rine-webui-ixd)，分支 `feat/ixd-star-map-redesign`。提交前已重新核对 origin，读取自己的远程分支确认未分叉。最终提交编号与推送结果由任务回复提供，亦可用 `git log -1`、`git status -sb` 查看。`dist`、研究视频、抽帧、缓存、临时录屏及凭据不进入提交。
