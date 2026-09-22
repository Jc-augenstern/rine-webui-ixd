# IXD 银河交互、星门与节点结构升级

本轮在 `feat/ixd-star-map-redesign` 当前工作树上继续修改，保留上一轮未提交成果。未重新 Clone、未切换 main、未推送或部署。

## 参考来源与实际读取

- TARGET：`reference/bongocat-target.mp4`。Edge 完整解码播放至 ended，11.2333 秒、1364×686、5,366,160 bytes，337 帧、0 丢帧。SHA256：`16d34e6645931ba84d42ccb27a8891dafa2a0fc218dddc2da0342cdfde92e197`。
- 全片按 0.25 秒抽帧；1.7–2.8、4.4–5.5、6.8–8.5、9.4–11.1 秒按 0.1 秒复查。约 1.9–2.3 秒快速左移，局部网格向外弯曲；2.4–2.8 秒近停留，弯曲保持；6.8–7.5 秒先左移后转右上。片尾光标不清晰，不推断 pointerleave 或精确恢复时长。
- CURRENT：`.tools/galaxy-demo/galaxy-flight.webm`，10.68 秒、1280×720。全片每秒 3 帧检查，前约 4.3 秒云带轮廓主要整体移动，未显示清晰的云带局部拨动；后半段是旧 AI 节点推进与返回。这段仅作旧版本基准。
- 风格：实际查看 `reference/galaxy-style-01.png` 和 `galaxy-style-02.png`，保留现有蓝青云带、深色暗缝、紫色尘埃和局部暖色；未替换上一轮程序化银河纹理。
- 实际参考网页：<https://bongocat.pet/> 的 `section.glass-showcase` / `#cta-quantum-canvas`，浏览器操作尺寸 1440×1080、DPR 1。已取得实际加载的 [Canvas 关联脚本](https://bongocat.pet/bundles/cta-runtime-D9MoQDJU.js)。
- 原站是 Canvas2D 双层网格；共享变形后的点坐标绘制连线，220 CSS px 局部排斥范围。局部中心与整体角度分别平滑，静止仍撑开，离开关闭排斥。原站没有速度拖曳记忆；本项目的方向拖曳和衰减为独立实现。没有使用桌宠仓库代替网页脚本，没有复制整段实现或品牌素材。
- 证据保存在 `.tools/reference-verified/`、`.tools/reference-video/`、`.tools/reference-canvas/`，不纳入产品构建或提交。

## 银河局部作用场

`galaxy-interaction.ts` 维护独立输入、速度和强度，统一帧循环计算；事件处理只记录坐标与时间。每帧根据实际渲染 host 的 `getBoundingClientRect()` 转换成 CSS 像素、Y 向下的坐标。

- 220 CSS px 紧支撑半径，静态径向位移峰值 24 px，定向拖曳向量上限 36 px。远于作用范围的位移精确为零，不累积粒子位置。
- 作用中心直接跟随记录的真实坐标；原相机仍使用独立的慢阻尼。速度响应采用每秒 34 的指数平滑，停留按每秒 5.8 衰减；离开仅衰减强度，中心留在最后位置。
- 星点在投影后应用正向位移；银河片元以同一个 GLSL 场做六次固定点逆采样，随后才转换 UV cover 裁切。云带、暗尘边缘、纹理内远星和独立星点同向变形。
- 详情、设置、门户期间关闭强交互；隐藏页面清除瞬态输入。低画质保留形变，沿用 DPR、像素预算和固定粒子缓冲；reduced-motion 与无 WebGL 使用明确简化。
- 开发版 `window.rhine.debugGalaxy({freezeCamera:true,freezeTime:true})` 可隔离相机、自然漂移和拖尾，仅保留局部场。生产版不暴露该调试入口，无正式主页测试控件。

## 星门时间轴

保留 Logo、认证、授权与 2× Welcome 主体，只把 Welcome 最后收束接入独立 `bridge` 状态。提前创建并渲染唯一银河场景，关闭的裁切遮罩内已有真实首帧。

| 时间 | 行为 |
| --- | --- |
| 0–0.45s | 原 Welcome 尾端继续收束，辅助定位线汇合为菱形边界。 |
| 0.45–1.2s | 菱形裁切逐渐打开；真实银河与外围原终端同时可见。 |
| 1.2–1.95s | 边界越过视野，镜头轻推，固定少量边界星尘辅助穿越。 |
| 1.95–2.4s | 中心 IXD 光核移向社团介绍实际位置，方向星与功能星错峰显现，恢复交互。 |

完成与跳过使用同一收尾方法。整个过程复用 renderer、纹理与种子；移除旧 galaxy-arrive 和主页第二套入场动画。reduced-motion 使用 0.28 秒静止裁切揭示。调试 `portalSeek` 参数单位是秒，传 null 恢复时间轴。

## 节点视觉身份

| 节点 | 结构与展开 |
| --- | --- |
| AI | 多核心稀疏网络，连接光脉冲，分支伸展。 |
| 机器人 | 双核心分段机械轨道、关节与伴星，上下层分开。 |
| 交互设计 | 单核交错回声弧，波前舒展为引导线。 |
| 视觉设计 | 三条不对称星尘旋臂，疏密不同，轻柔舒展。 |
| XR | 不同方向的多层空间环，错位打开形成纵深。 |
| 智能硬件 | 几何晶格卫星与折线信号路径，模块分支打开。 |
| 社团介绍 | 原 IXD Logo 路径比例融入中央核心。 |
| 项目孵化 | 不规则两层星云壳包裹原恒星，壳层张开。 |
| 竞赛 | 彗核、上升轨迹和阶段刻度。 |
| 沙龙 | 三星之间往返光脉冲，核心轻展开。 |
| 作品集 | 多片棱镜星片错位、扇形展开。 |
| 加入我们 | 带缺口的开放引航弧与接入路径。 |

显式 `visualPreset`、`motionPreset`、`visualSeed` 只将随机种子用于细小星尘组织。SVG 不使用实例间冲突的 ID；细线使用 non-scaling-stroke。主页结构原样复制给飞行和详情，退出时收回同一节点。六颗暗星使用三类休眠结构，仍不可进入、无虚构内容。

## 实际行为验收（2026-09-21）

开发版与最终构建的生产预览均已实际启动，并通过 Edge 浏览器操作。三段录屏已生成并检查全片连续抽帧；门户结束处另逐帧加密检查。自动化结果与画面检查分别留存。

| 检查 | 结果 | 本地证据 |
| --- | --- | --- |
| 原认证检查 `npm run check:auth` | 10/10 通过 | 原有认证测试未修改 |
| `npm run build` | TypeScript、Vite、PWA 全部通过 | 最终 JS `index-CaOuDi98.js`；PWA `0a3fe46a10e42ef5` |
| 新增开发版行为检查 | 111/111 通过 | `.tools/galaxy-upgrade/results.json` |
| 最终生产预览检查 | 64/64 通过 | `.tools/upgrade-production-final/results.json` |
| 原登录、内容与响应式回归 | 70/70 通过 | `.tools/upgrade-browser-regression/results.json` |
| 原飞行、回退与移动端回归 | 34/34 通过 | `.tools/upgrade-journey-regression/results.json` |
| 生命周期与故障补查 | 21/21 通过 | `.tools/reference-canvas/lifecycle-results.json` |
| 十二类矢量、Hover、展开与提前收回 | 12 类全部检查 | `.tools/node-artwork/results.json`、`motion.json`、结构图册 |

正常产品页面没有未捕获异常或控制台错误。强制禁用 WebGL 用例产生的预期 Three.js 错误单独记录；隔离模块测试页的三条 Vite HMR WebSocket / Local Network Access 环境诊断也独立保留，没有屏蔽产品错误。构建仍有 Vite 大于 500 kB chunk 的体积提示；未更换或升级依赖。

### 相机冻结与连续输入

同时冻结相机和自然时间、隐藏导航装饰后比较真实 WebGL 像素。1920×1080 / DPR 1、1366×768 / DPR 1.25、390×844 / DPR 2 三组测试中，作用区平均像素差分别为 6.50、8.17、9.90，远区差均为 0。桌面作用区约 38.5% 像素发生变化，云带边缘和暗缝清晰改变，证明形变不依赖相机或额外发光。

三组均执行慢速横移、快速左右反向、小圆、停留约一秒和离开。作用中心误差小于 0.001 CSS px；定向位移随反向变号，停留后拖曳趋零但保留 24 px 附近的轻弯曲；离开强度归零，中心仍在最后位置。另验证 host 偏移以及同一页面 resize、DPR 1→1.75 后坐标重合。

### 门户、节点及清理

真实账号登录依次经过认证、确认、授权、Welcome、bridge、银河。门内持续使用最终主页的同一 Canvas；抽帧可同时看见白色终端和菱形内的真实云带。最后亮核沿途接到社团介绍，节点逐个出现。检查完成、跳过、重播、门户中 resize、reduced-motion、WebGL 不可用、真实 context loss / restore 和纹理分配失败，均能进入可用导航状态。

修复了完成回调触发 resize 后可能清空画布一帧的问题：在回调完成后同步渲染。隔离同步 GPU 检查中 renderedFrames 从 4 增至 5，下一 rAF 前中心 128×128 的 RGB 总和为 2,284,948、最高通道值 255，glError=0；最终录屏末端也没有发现黑帧。

全部十二类结构经过单色小尺寸图册检查，区分不依赖颜色。AI、机器人、XR、作品集、加入我们的主页、飞行与详情 SVG 身份相同；返回恢复原结构和键盘焦点。提前 Esc、重复返回、触摸滚动、暗星不可进入均通过。

模拟 document.hidden / visibilitychange 时暂停过渡及绘制，恢复后不补隐藏时长。门户中取消清除遮罩和 inert；重播复用原 Canvas，GPU geometry / texture 不增长；销毁后 Canvas、动画、geometry、texture 均为零，实际 WebGL context 已释放。设置与详情抑制强交互，reduced-motion 的鼠标移动不触发静态天空重绘。生产环境已验证没有 `debugGalaxy` 入口。

## 实际录屏与复看

以下均为 1920×1080 的实际浏览器录屏，显示跟随自动化真实指针事件的光标及短轨迹。光标标记、阶段字幕只由录制脚本注入，不进入产品。每段完整原始录像同时保存在同目录的 `*-full.webm`；剪辑仅截取对应演示时间段。

| 录像 | 实际媒体时长 | 内容 |
| --- | --- | --- |
| [01-login-portal.webm](../.tools/galaxy-upgrade-recordings/01-login-portal.webm) | 10.84 秒 | 登录、授权、Welcome、星门、节点建立；末端 8.15–9.23 秒另按 25 fps 检查。 |
| [02-local-field-frozen-camera.webm](../.tools/galaxy-upgrade-recordings/02-local-field-frozen-camera.webm) | 10.00 秒 | 冻结相机与自然漂移；慢移、快速左右反向、小圆、停留与离开恢复。 |
| [03-node-identities.webm](../.tools/galaxy-upgrade-recordings/03-node-identities.webm) | 24.80 秒 | AI、机器人、XR、作品集、加入我们各自进入、展开及返回。 |

已实际读取三段全片每 0.25 秒的连续画面，共 17 张抽帧表，并检查门户末端另外三张逐帧表。局部交互可见亮带及暗缝围绕移动指针弯曲，远方大构图不动；快速反向后方向及时改变，停留时短拖曳消散。节点录屏中网络、机械双核、空间环、棱镜片群、开放引航弧在放大和收回期间保持各自轮廓。参考 TARGET 的网格主要提供输入与局部变形关系，当前银河保留自身材质和配色；速度拖曳为本项目额外的独立实现。

索引：`.tools/galaxy-upgrade-recordings/recordings.json`、`review-index.json`、`review-detail-index.json`。门户定时高清图另在 `.tools/portal-inspection/`。这些验证素材不进入正式构建。

## 设备、性能与验证边界

- 实际设备：Windows 11 Home Chinese 10.0.26100，Intel Core Ultra 9 275HX（24 核/24 线程），约 31.4 GiB 内存；系统枚举 NVIDIA GeForce RTX 5070 Ti Laptop GPU 和 Intel Graphics。未以系统 GPU 列表推定浏览器具体选择哪一颗 GPU。
- 浏览器：Microsoft Edge 153.0.4234.48。主测 1920×1080 / DPR 1；局部场还测 1366×768 / DPR 1.25、390×844 / DPR 2；旧回归覆盖 2560×1440、1366×768、390×844、844×390。
- 本机桌面静止及鼠标移动采样的 rAF 间隔中位数约 4.2 ms、p95 约 4.3 ms。它是帧调度间隔，不是 GPU 耗时，也不证明其他设备稳定帧率。场景沿用最多 2600 星点、5 次绘制、1 张云图预算。
- 移动端、DPR 和低硬件等级是 Chromium 仿真，未宣称实体手机或原生浏览器缩放验证。页面隐藏采用明确模拟的 document 状态与事件，未宣称验证操作系统切页挂起。

## 修改文件与同步状态

| 模块 | 本轮文件 |
| --- | --- |
| 共享局部场 | 新增 `src/galaxy/galaxy-interaction.ts`；修改 `galaxy-atmosphere.ts`、`star-field.ts`、`galaxy-camera.ts`、`galaxy-scene.ts` |
| 星门与流程 | 新增 `src/ui/ixd-portal.ts`、`ixd-portal.css`；修改 `src/ixd-experience.ts`、`ixd-experience.css`、`src/main.ts` 的 DEV 调试接线 |
| 十二类结构 | 修改 `src/data/star-map.ts`、`src/ui/galaxy-glyph.ts`、`star-map-ui.ts`、`star-map.css`；新增 `galaxy-glyph.css` |
| 检查与文档 | 新增 `scripts/check-galaxy-upgrade.mjs`、本文；更新 `check-ixd-browser.mjs`、`check-galaxy-journey.mjs`、README 和 VERIFICATION 链接 |

上一轮已有的 `nebula-texture.ts`、`docs/GALAXY-EXPLORATION.md`、Vite 工具目录忽略配置及其他工作树成果均保留。认证、真实社团内容、音频开关、12 节点原有路由与定义、package / lockfile 和 Git 安全保护未改变。参考文件为用户提供，本轮未把研究资料加入 Git 暂存区。

- 本地唯一项目：`D:\Codex\Codex_IXD\rine-webui-ixd`。
- 分支：`feat/ixd-star-map-redesign`。
- 当前提交：`2afc8b63927de19f66f32437d510c42fce776166`；本轮只读查询 origin 同名分支，返回同一提交。此处表示基准提交一致，工作树新增成果仍未提交、未推送。
- origin：`https://github.com/Jc-augenstern/rine-webui-ixd.git`。
- upstream fetch：`https://github.com/zwh087383/rine-webui-ixd.git`；push：`https://upstream-read-only.invalid/DO-NOT-PUSH`。现有 pre-push 钩子与 origin 默认推送配置保留，未向合作仓库写入、未创建 PR、未公开部署。
- 运行环境：Node v24.18.0、npm 11.16.0、Git 2.55.0。

本机启动命令：`npm run dev -- --port 5173 --strictPort`；生产预览：`npm run preview -- --port 4173 --strictPort`。公开 Demo 账号仍为 `ixd-demo` / `ixd2026`。

浏览器检查沿用本地隔离的 Playwright 工具目录，不改项目依赖。在项目根目录的 PowerShell 中可复测：

```powershell
$env:PLAYWRIGHT_MODULE = "$PWD\.tools\browser-runtime\node_modules\playwright"
$env:IXD_TEST_URL = 'http://127.0.0.1:5173'
$env:IXD_TEST_MODE = 'development'
$env:IXD_TEST_OUTPUT = '.tools\galaxy-upgrade-recheck'
node scripts/check-galaxy-upgrade.mjs
```

生产复测将 URL 改为 `http://127.0.0.1:4173`、MODE 改为 `production`、OUTPUT 改为独立目录。相机冻结检查仅在开发版执行。
