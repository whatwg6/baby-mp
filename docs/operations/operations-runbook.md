# 运维运行手册

> [文档索引](../README.md) · 分类：运维发布

本文提供可执行的 PostgreSQL 备份恢复、对象存储生命周期和故障处置基线。所有命令先在 staging 演练；没有真实命令输出、时间戳和执行人记录，不得声称演练通过。

## PostgreSQL 备份

### 基线

- production 初始目标为 RPO 24 小时、RTO 4 小时；上线前由业务所有者确认，若不满足业务需求必须提高频率。
- 每日至少一次完整备份，发布或迁移前额外备份。建议保留每日备份 30 天、每周备份 12 周；最终期限须结合隐私政策和成本批准。
- staging 与 production 备份必须使用 `age` 公钥加密，并存入启用静态加密、版本控制和访问审计的独立备份位置。
- 数据库账号只授予备份所需权限；恢复使用独立临时目标和受控账号。
- 备份文件及 `.sha256` sidecar 必须一起保存。私钥不得和备份共置。

脚本只从环境或凭据提供器读取密码，不接受密码参数，也不会输出连接串。示例中的值均为占位符：

使用 `PGPASSFILE` 代替 `PGPASSWORD` 时，文件必须是非符号链接的普通文件，且 Unix 权限不得宽于
`0600`（推荐 `chmod 600 "$PGPASSFILE"`）。脚本会同时兼容 GNU/BSD `stat`；若运行平台无法可靠读取权限，
会 fail closed，拒绝备份或恢复。

```bash
export APP_ENV=staging
export PGHOST='<staging-db-host>'
export PGPORT='5432'
export PGDATABASE='<staging-db-name>'
export PGUSER='<backup-role>'
export PGPASSWORD='<inject-from-secret-store>'
export BACKUP_DIR='/protected/backups/postgresql'
export BACKUP_AGE_RECIPIENT='age1...'
scripts/postgres-backup.sh
```

定时任务应检查退出码、备份大小非零、checksum sidecar 存在，并将“成功时间、文件 ID、大小、密钥版本”发送到监控；不得记录数据库 URL 或密码。连续两次失败或距最后成功超过 26 小时触发告警。

## 恢复与演练

恢复脚本有四层保护：checksum、显式目标确认、只允许空目标库、production 额外确认。它不会清理或覆盖现有表。

1. 创建与源 PostgreSQL 主版本一致的空目标数据库。
2. 取回备份和 checksum；从密钥管理服务临时挂载 age identity 文件。
   `AGE_IDENTITY_FILE` 同样必须是非符号链接的普通文件且权限不得宽于 `0600`，挂载后先执行
   `chmod 600 "$AGE_IDENTITY_FILE"`。不得把 identity 复制到备份目录。
3. 将 `PG*` 指向空目标，人工核对主机、端口和库名。
4. 执行恢复：

```bash
export APP_ENV=staging
export PGHOST='<restore-host>'
export PGPORT='5432'
export PGDATABASE='<empty-restore-database>'
export PGUSER='<restore-role>'
export PGPASSWORD='<inject-from-secret-store>'
export AGE_IDENTITY_FILE='/protected/run/backup-age-identity'
export RESTORE_CONFIRM='<restore-host>:5432/<empty-restore-database>'
scripts/postgres-restore.sh '/protected/backups/postgresql/<backup>.dump.age'
```

5. 在隔离网络启动与备份版本相同的 API，执行 `pnpm db:deploy`（应无待应用迁移），再运行 API 验证脚本。
6. 比较宝宝、成员、记录、媒体、导出任务的精确行数；抽样对 `media.bucket` + `media.object_key` 执行有权限的 `HeadObject`，确认对象仍存在且桶不公开。
7. 记录备份时间、开始/完成时间、恢复耗时、校验结果和问题；销毁临时恢复库及临时密钥挂载。

本地或 staging 可用以下脚本创建并自动删除一个随机命名的恢复库。它拒绝 production；操作者账号需要 `CREATEDB`，源库在快照与计数期间必须暂停写入。staging 沿用上文的 `BACKUP_AGE_RECIPIENT` 和 `AGE_IDENTITY_FILE`，因此演练也覆盖加密/解密。脚本检查 checksum、迁移表、所有应用表的精确行数和 ready media 引用字段，但对象存在性仍需单独验证：

```bash
export REHEARSAL_CONFIRM=CREATE_AND_DROP_DISPOSABLE_DATABASE
export REHEARSAL_SOURCE_QUIESCED=YES
scripts/verify-postgres-backup-restore.sh
```

在 production-only API 镜像内执行同一演练时，额外设置
`RESTORE_RUNTIME_LAYOUT=runtime`；脚本会使用镜像内的 `prisma:deploy` 与
`dist/main.js`，而不是 workspace 命令和路径。两种布局执行相同的 checksum、
空目标、逐表行数、前进迁移和 readiness 校验。

### 迁移失败恢复

Prisma migration 不提供通用自动 down migration。若 `pnpm db:deploy` 失败：

1. 停止新版本 API/worker，保持旧版本不写入不兼容结构。
2. 保存迁移错误、request ID 和 migration 名称，禁止手工修改 production 表来“修绿”。
3. 若迁移是事务内失败且数据库未改变，修正 forward migration，在 staging 从同一备份重演。
4. 若已有不可兼容变更或数据被改写，创建新空数据库并按上述流程恢复发布前备份；不要在原库上执行破坏性清理。
5. 将连接切回已验证数据库，部署兼容的旧版本，验证 health 和核心读写。
6. 由事故负责人确认后恢复流量，并形成复盘。

## 对象存储

### 必需规则

- 桶禁止匿名列举和读取；业务对象只能通过服务端签发的短时 URL 访问。
- staging/production 开启服务端静态加密、传输 HTTPS、访问日志或等价审计。
- `exports/` 仅保存导出归档，生命周期固定 7 天，并在 1 天后终止未完成 multipart upload。
- 当前应用删除对象时不枚举 version ID，因此 bucket versioning 必须保持 Disabled/Suspended；生命周期仍在 1 天内清理历史 noncurrent export version。若未来启用 versioning，必须先实现并验证按 version ID 的彻底清除。
- 不得给 `media/` 或上传临时前缀套用 `exports/` 的 7 天删除规则；业务媒体由应用清理逻辑控制。
- 应用清理任务仍是主路径，bucket lifecycle 是泄漏兜底，二者告警独立。

仓库模板为 `scripts/s3-export-lifecycle.json`。云厂商支持标准 S3 API 时：

```bash
aws --endpoint-url "$S3_ENDPOINT" --region "$S3_REGION" \
  s3api put-bucket-lifecycle-configuration \
  --bucket "$S3_BUCKET" \
  --lifecycle-configuration file://scripts/s3-export-lifecycle.json
```

凭据通过标准 AWS credential provider 或环境 secret 注入，不写在参数中。应用规则后，准备一个无敏感内容且确实存在的私有探针对象：

```bash
export AWS_ACCESS_KEY_ID='<inject-from-secret-store>'
export AWS_SECRET_ACCESS_KEY='<inject-from-secret-store>'
export S3_PRIVATE_PROBE_KEY='operations/private-probe.txt'
scripts/verify-s3-operations.sh
```

若 provider 使用 virtual-host bucket URL，额外设置
`S3_ANONYMOUS_BUCKET_URL=https://<bucket-public-host>`；它只能包含 bucket 根地址，不能包含签名参数。

脚本验证 operator 可访问、bucket versioning 未启用、`exports/` 7 天规则、noncurrent export 1 天清理、multipart 1 天规则、匿名 list/read 被拒绝；staging/production 还验证服务端加密。生命周期的真实删除需额外记录：测试对象创建时间、过期时间、provider 删除事件或第 8 天 `HeadObject=404`。不能用“规则已配置”冒充“实际删除已发生”。

## 数据权利申请处理

用户可以在客户端登记数据访问、更正或账号注销申请，并查看/取消待核验申请。处理人员不得直接修改
`data_rights_requests` 表，也不得通过聊天索取访问令牌、平台 code、邀请 token 或家庭正文。

1. 在受控系统中核验申请人、申请范围和必要的成员/管理员关系；把证据链接放在受控工单，不写入业务数据库。
2. 使用只具备所需数据库权限的运维身份，将申请推进到 `processing`：

```bash
export DATA_RIGHTS_REQUEST_ID='<request-uuid>'
export DATA_RIGHTS_TARGET_STATUS='processing'
export DATA_RIGHTS_OPERATOR_CONFIRM='<request-uuid>:processing'
pnpm data-rights:transition
```

3. 完成依法需要的数据访问、更正或注销处置。宝宝软删除、账号状态、备份和审计保留必须遵循已批准的
   隐私规则；当前未批准最终期限时，不得把申请状态冒充物理删除证据。
4. 复核后将 `DATA_RIGHTS_TARGET_STATUS` 改为 `completed` 或 `rejected`，同时把确认值改为
   `<request-uuid>:<target-status>` 再运行命令。
5. 命令通过事务写入状态和低敏审计；终态释放 active 去重键并填写 `resolved_at`。终端输出不包含申请 ID
   或家庭数据。保存工单、执行时间、版本和复核人。

允许的状态转换为 `pending → processing/completed/rejected` 和
`processing → completed/rejected`。`cancelled/completed/rejected` 不能再次推进；需要重新处理时由用户重新申请。

## 宝宝软删除处置

管理员删除宝宝后，服务会立即软删除档案、移除有效成员、撤销待接受邀请、终止活动导出并写入审计。
该结果证明业务访问已停止，不证明记录、媒体、备份和审计已物理清除。正式物理清理前必须先在发布记录中
确定恢复期、法定保留、备份处置、通知和失败重试规则；没有批准规则时保持软删除，不运行临时破坏性脚本。

## 常见故障

| 现象 | 第一动作 | 安全处置 |
| --- | --- | --- |
| API 5xx 升高 | 按版本、路由和 request ID 定位，不查请求体 | 停止发布，必要时回滚应用 |
| 数据库连接耗尽 | 查看连接数、慢查询和部署副本变化 | 限流/降副本并保留诊断，不重启数据库掩盖原因 |
| 上传失败升高 | 检查 S3 可用性、签名时间偏差、容量 | 暂停上传入口，禁止改成公开桶 |
| 导出队列积压 | 检查 worker、租约、重试与存储 | 扩 worker 前确认 DB/S3 容量；不延长公开 URL |
| 备份失败 | 保留上次有效备份，检查容量和凭据版本 | 立即重试一次，连续失败升级告警 |
| 疑似密钥泄漏 | 撤销/轮换、冻结相关发布、保全审计 | 不在工单粘贴 secret；按安全事件处理 |

任何告警和事故记录都不得携带宝宝姓名、正文、token、邀请 token、平台 code/session key、对象 key 或签名 URL。
