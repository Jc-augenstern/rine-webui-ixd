# IXD 全站冷色统一 · 2026-09-19

按用户确认方案完成本地源码修改。默认亮色，继续支持暗色；未提交、推送或发布线上。

## 配色与覆盖

`src/palette.ts` 为界面和 Three.js 共用色板。背景、面板、文字、分隔线与强调色使用用户指定的亮暗端点。CSS 中分散的米黄、棕金和橄榄色改用主题变量，包含加载、开场、档案、详情、检索、收藏、设置和独立模型查看器。独立 IXD 预览同步色板；浏览器主题色随主题更新，manifest 与独立更新恢复页使用冷白默认值。

GLB 材质名保留以保持资源兼容，在加载时覆盖颜色。黄色索引改为蓝紫，琥珀内构改为青蓝；阵列、选中、归位与拆解模型共用材质颜色。地面、雾、灯光颜色、标签画布、玻璃的高度着色和衰减色一起调整。没有改动模型文件、光照强度、曝光、透明度、粗糙度、相机、动作或画质设置。开场退出保留模糊与缩放，删除导致偏色的 sepia/invert/hue-rotate。

## 验证

- `npm run check:palette`：亮暗模式主要／次要／强调文字与 paper/panel/field 的组合全部 ≥4.5:1，最低 4.71:1；强调按钮文字对比度通过；两个 GLB 全部材质有冷色映射；PWA 静态颜色与共用色板一致。
- `npm --ignore-scripts run build`：TypeScript、Vite 生产构建及 PWA 打包通过。跳过自动导出档案的 prebuild，保留工作区已有档案改动。
- `playwright-cli -s=ixd run-code --filename=verification/ixd-palette-check.cjs`：检查明暗切换、档案切列、检索、收藏弹窗、详情解密、收藏按钮、详情页签、模型清晰／磨砂、拆解／重组、入口、跳过和重播，无运行错误。
- `verification/ixd-preview-check.cjs`：独立预览暂停、拖动、重播、明暗切换、减少动态效果通过。
- 补充检查暗色开场与欢迎页、主题持久化、悬停、键盘焦点、蓝紫选档刻度和文本式分类筛选。
- Chromium 1440×900 和 390×844 视口检查，无横向溢出。手机视口模拟不代替 iPhone 实机验收。

现有 Three.js 的 PCFSoftShadowMap 弃用提示和 Vite 大体积 bundle 提示仍存在，本轮没有新增页面错误。色板对比度是固定颜色组合的测量，动态三维背景、运动中的透明度和装饰图形不属于该数值声明。

## 截图

`ixd-cool-entry.png`、`ixd-cool-auth.png`、`ixd-cool-scan.png`、`ixd-cool-welcome.png`、`ixd-cool-exit.png` 为开场检查。

`ixd-cool-archive-{light,dark}.png`、`ixd-cool-settings-{light,dark}.png`、`ixd-cool-search-{light,dark}.png`、`ixd-cool-saved-{light,dark}.png`、`ixd-cool-detail-{light,dark}.png`、`ixd-cool-viewer-{light,dark}.png`、`ixd-cool-viewer-exploded-{light,dark}.png`、`ixd-cool-mobile-{light,dark}.png` 为实际页面检查。

本地入口：`http://127.0.0.1:5173/`；直接查看档案：`http://127.0.0.1:5173/?scene=archive`。
