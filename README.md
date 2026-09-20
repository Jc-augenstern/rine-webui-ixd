# IXD · STAR MAP / ANALYSIS OS

让灵感漫步于星辰大海。基于原 IXD 工程增量开发，保留 Logo、HUD、授权圆环、Welcome 时间轴、音频和画质系统。

你的仓库：https://github.com/Jc-augenstern/rine-webui-ixd

本次分支：`feat/ixd-star-map-redesign`。原始基准：`2038d69f5ccbb18c4ebc0e18223e8961b6f9a65b`。原工程历史说明和版权资料见 [docs/UPSTREAM-README.md](docs/UPSTREAM-README.md) 与 LICENSE。

完整交付与后续操作见 [交付报告](docs/DELIVERY.md)；运行检查与复测方法见 [验收记录](docs/VERIFICATION.md)。

## 本地启动

需要 Node.js 22.12+，本次使用 Node.js 24。在 PowerShell 输入：

```powershell
cd D:\Codex\Codex_Design_B\rine-webui-ixd
npm ci
npm run dev
```

打开终端显示的地址，通常是 http://127.0.0.1:5173/ 。之后依赖没变化只需运行 `npm run dev`。保持终端运行；关闭服务按 Ctrl+C。

## 测试登录

打开首页自动播放约 6 秒原有开场，再停留在“身份接入”；也可点右上角“前往登录”。

- 账号：`ixd-demo`
- 密码：`ixd2026`
- 点击 ACCESS SYSTEM，或在密码栏按 Enter。
- 正确流程：AUTHENTICATING → IDENTITY CONFIRMED → PERMISSION AUTHORIZED → 2× WELCOME TO IXD CLUB → 星图。
- 错误输入显示 ACCESS DENIED / INVALID IDENTITY，可修改后重试。
- 星图底部“重新登录”重播开场；刷新页面也会重新登录。

这是公开的前端 Demo 凭证，**不是真实安全认证**。没有真实账户、服务端会话或受保护数据。凭证只定义在 `src/auth/dev-auth-config.ts`，不会存入浏览器存储。

## 生产构建

```powershell
npm run check:auth
npm run build
npm run preview
```

完整生产文件在 `dist/`。通过 preview 地址访问（通常 http://127.0.0.1:4173/），不要双击 dist/index.html。dist 可重新生成，按原工程规则不提交 Git。

## 网站功能

- 可等待的登录状态与错误反馈；保留原有授权和 Welcome 动画，播放速度约 2 倍。
- Three.js 多层星空、轻微鼠标视差、邻近微亮与少量星尘尾迹。
- 六颗方向主星、六颗功能星、六颗不可进入的预留暗星。
- 点击星星靠近目标，展开 IXD 数据终端；关闭或 Esc 返回；支持 Tab / Enter 与触摸。
- 六方向定位、关键词、典型项目示例，成长星轨及竞赛轨道节点。
- 保留声音/音乐/画质设置，减少动态效果、DPR/像素预算和 WebGL 静态回退。

内容来自用户 Word《IXD 社团架构方案》初稿，属于筹建规划。典型项目是示例，赛事是辅导方向。无来源的作品、获奖、人员、日期或报名渠道没有编造。

## 后续继续开发

1. 在项目目录运行 `git switch feat/ixd-star-map-redesign`，进入本次分支。
2. 运行 `npm run dev` 后修改代码，浏览器会更新。
3. 改方向详情：`src/data/club-content.ts`；加星星：在 `src/data/star-map.ts` 新增一条数据，填写 id、类型、标题、位置、启用状态与内容。
4. 改界面：`src/ui/star-map.css`、`src/ixd-experience.css`；改星空：`src/galaxy/`；改流程：`src/ixd-experience.ts`。
5. 执行 `npm run check:auth` 和 `npm run build`，实际检查登录、星星详情与手机布局。
6. 执行 `git status` 查看改动，再 `git add <需要保存的文件>`、`git commit -m "描述本次修改"` 保存版本。
7. 确认 `git remote -v` 的 origin 是自己的仓库，再 `git push origin feat/ixd-star-map-redesign`。

接真实后端时，以 API 适配器替换 `src/auth/auth-service.ts` 的 `authService`，遵守 `AuthService` 接口，并删除开发凭证模块。密码验证、会话、权限、速率限制、退出等应由服务器实现；前端成功状态不是服务器授权。报名、作品发布和成员管理还需要真实后端与数据。

## Git 保护

- origin：`https://github.com/Jc-augenstern/rine-webui-ixd.git`，你的 Fork。
- upstream：`https://github.com/zwh087383/rine-webui-ixd.git`，舍友仓库，只读。
- upstream 的 push URL 故意无效，本机还启用了 `.githooks/pre-push` 限制目标。
- 新电脑 Clone 后运行 `node scripts/setup-safe-remotes.mjs` 恢复保护。
- `git fetch upstream` 只下载舍友的新版本，不改任何远端或你的工作文件。需要合并时先建新分支，再审阅合并差异。

原始源码压缩备份和研究材料位于项目之外的 `../research/`。本次不修改舍友仓库、不向原仓库创建 PR。

## 原工程保留

原档案、360° 查看器、建模文件和历史研究完整保留。仅开发服务器可用 `/?experience=archive&scene=archive` 打开旧档案做回归；生产构建不开放此旁路。未取得许可的 Novecento 字体不随 Git 分发，缺少时使用原工程内置字形图稿；MiSans 分包、许可及原 MIT 版权均保留。
