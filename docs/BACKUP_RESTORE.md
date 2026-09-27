# IXD 数据备份与独立恢复

代码归档不能替代数据备份。必须同时保护 PostgreSQL 与上传目录；会话密钥、SMTP 密码和 TLS 私钥单独安全保存。数据库备份包含个人资料、密码哈希及可能尚未过期的会话/邮件记录，应视为私密数据，离机副本需加密和限制访问，不提交 Git。

## 当前 Windows 本地环境

为取得数据库与文件的一致快照，先停止 API/任务写入，保留 PostgreSQL 运行。前后台可以保持打开，但维护期间写操作会报服务不可用。由总控制器启动的 API 可使用 `pause-api`，只停止经 PID、创建时间与命令校验的本项目 API；未被控制器启动的 API 请在原终端按 Ctrl+C 停止。不要停止未知 PID，不要清空数据库。

在仓库根目录：

```powershell
node scripts/platform-services.mjs pause-api
node scripts/platform-backup.mjs backup
node scripts/platform-services.mjs start
```

脚本检测 API 3000 仍在监听时会拒绝备份，避免误把活跃写入当成一致快照。输出 `backups/ixd-时间-随机值/`，包含：

- `database.dump`：PostgreSQL 自定义格式备份。
- `uploads/`：实际上传文件副本。
- `manifest.json`：创建时间、参考代码提交、22 张表记录数量与整行内容摘要、文件 SHA256、数据库 SHA256。备份开始与结束还会比较数据摘要，检测其他写入进程造成的不一致。

只有完整生成 manifest 的目录可恢复；失败后的目录留待检查，不自动删除。服务器配置秘密不复制进备份，数据库本身仍是敏感数据。备份完成后重新启动 API。

独立恢复演练：

```powershell
node scripts/platform-backup.mjs restore backups/ixd-实际备份目录
```

脚本先核对备份摘要，再创建全新的 `ixd_restore_时间_随机值_test` 数据库和 `.local/restores/对应库名/uploads` 目录，绝不覆盖开发库或测试库。恢复后比较表记录数量与整行内容摘要、复制后附件的实际字节和 SHA256，以及数据库中的附件路径与大小。报告在恢复目录的 `verification.json`，隔离连接串仅写 `connection.private.json`，不输出密码。演练后不会自动删除数据库或目录，避免意外清理错误目标。

正式替换开发库/生产库不是此演练脚本的职责。确需切换时，先做当前数据备份、停写、确认目标、核对恢复结果，再人工修改环境变量；不要把脚本改成 `DROP DATABASE` 或 `--clean` 来“简化”恢复。

## 本次实际验证（2026-09-27）

已通过真实普通用户登录 API 收藏一项开发示例学习资源，取得非空收藏后暂停本项目 API，备份到 `backups/ixd-20260927060956218-a038db`，恢复到独立数据库 `ixd_restore_1790489403795_7d26a4_test` 与同名 `.local/restores/` 目录。22 张表数量和整行内容摘要全部一致，其中用户 5、内容 27、内容版本 31、收藏 1、申请 1、项目成员 1、报名 1、媒体 5、媒体版本引用 7。5 个实际附件的字节数、SHA256 与数据库引用均通过。

随后实际停止并重新启动 PostgreSQL 和邮件捕获服务，原开发库同样通过上述 22 表和 5 文件比较。源码 API 3000 已恢复；构建验收 API 3001 使用另一个独立恢复库。非空收藏演练的证据文件为：

- `.local/restores/ixd_restore_1790489403795_7d26a4_test/verification.json`：独立恢复结果。
- `.local/restart-verification.json`：原库重启后比较结果。
- `.local/favorite-backup-fixture.json`：真实收藏的用户/内容关联。

这些报告与备份保留在本地忽略目录，不能把其中的数据库内容或凭据发布到 Git。上述是 Windows 原生 PostgreSQL 实跑结果；不代表 Docker、正式域名或远程 SMTP 已上线验证。

## 未来 Linux 生产 Compose

在已经配置好的服务器上，以下命令显式进入维护窗口：

```sh
sh deploy/backup.sh /secure/production.env --maintenance
```

它记录 API/Web 之前的运行状态，短暂停止写入，导出数据库并复制上传卷，生成 SHA256 和 `COMPLETE` 标记，最后恢复此前运行的服务。数据库始终运行，卷不删除。输出在 `backups/production-时间/`。

恢复到新的测试库和新目录：

```sh
sh deploy/restore-check.sh /secure/production.env /absolute/path/backups/production-时间
```

此脚本使用同一 PostgreSQL 集群中的独立新库，恢复上传文件到 `.local/restores/`，不切换线上应用，也不启动连接恢复库的 API/任务。恢复成功仍需按业务抽查内容、权限、媒体引用和迁移版本。生产容器路径目前待在有 Docker 的目标服务器执行，不能把本地原生恢复结果描述为 Docker 演练通过。

备份建议保留多个时间点并放置加密异机副本；定期重做独立恢复检查。删除过期备份属于单独维护操作，当前脚本不自动删除任何数据库、数据卷或备份。
