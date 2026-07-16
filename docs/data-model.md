# 宝宝成长记数据模型

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 数据库 | PostgreSQL |
| 标识策略 | UUID |
| 更新日期 | 2026-07-16 |

## 1. 设计原则

- 用户、平台身份、宝宝和家庭成员关系相互独立，支持多平台账号绑定和多宝宝家庭。
- 所有宝宝域数据必须能够追溯到 `baby_id`，便于权限校验、导出和删除。
- 成长记录使用统一主表与类型详情表，兼顾时间轴查询和类型扩展。
- 核心字段使用数据库类型与约束，不依赖无约束 JSON 保存关键数据。
- 记录创建、修改、删除和敏感操作保留必要审计信息。
- 数据库时间统一存储为 `timestamptz`。

## 2. 实体关系概览

```text
users 1 ── N platform_identities
users 1 ── N baby_members N ── 1 babies
babies 1 ── N records
users 1 ── N records (created_by)
records 1 ── 0..1 measurement_records
records 1 ── N record_media N ── 1 media
babies 1 ── N family_invites
babies 1 ── N export_jobs
users 1 ── N audit_logs
```

## 3. 枚举

### 3.1 平台类型 `platform_type`

- `wechat_mini`
- `alipay_mini`
- `douyin_mini`
- `h5`

### 3.2 成员角色 `member_role`

- `admin`
- `editor`
- `viewer`

### 3.3 成员状态 `member_status`

- `active`
- `removed`

### 3.4 记录类型 `record_type`

- `note`
- `measurement`
- `milestone`

### 3.5 媒体状态 `media_status`

- `pending`
- `uploaded`
- `ready`
- `failed`
- `deleted`

### 3.6 邀请状态 `invite_status`

- `pending`
- `accepted`
- `revoked`
- `expired`

### 3.7 导出状态 `export_status`

- `pending`
- `processing`
- `completed`
- `failed`
- `expired`

## 4. 核心表

### 4.1 用户 `users`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 业务用户 ID |
| `display_name` | varchar(80) | nullable | 用户显示名称 |
| `avatar_media_id` | uuid | nullable, FK media | 用户头像 |
| `status` | varchar(20) | not null | `active`、`disabled`、`deleted` |
| `last_login_at` | timestamptz | nullable | 最近登录时间 |
| `created_at` | timestamptz | not null | 创建时间 |
| `updated_at` | timestamptz | not null | 更新时间 |
| `deleted_at` | timestamptz | nullable | 注销/软删除时间 |

用户表不保存 `openid` 等平台专属标识。

### 4.2 平台身份 `platform_identities`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 身份记录 ID |
| `user_id` | uuid | FK users, not null | 所属用户 |
| `platform` | platform_type | not null | 登录平台 |
| `app_id` | varchar(128) | not null | 平台应用标识 |
| `subject` | varchar(255) | not null | openid/user_id 等平台主体标识 |
| `union_subject` | varchar(255) | nullable | unionid 等跨应用标识 |
| `created_at` | timestamptz | not null | 创建时间 |
| `updated_at` | timestamptz | not null | 更新时间 |

约束与索引：

- 唯一键：`(platform, app_id, subject)`。
- `union_subject` 仅用于辅助绑定，不作为对外业务 ID。
- 平台会话密钥不长期明文保存在该表。

### 4.3 宝宝 `babies`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 宝宝 ID |
| `name` | varchar(80) | not null | 姓名或昵称 |
| `gender` | varchar(20) | not null | `male`、`female`、`unspecified` |
| `birth_date` | date | not null | 出生日期 |
| `birth_time` | time | nullable | 出生时间 |
| `birth_height_cm` | numeric(5,2) | nullable | 出生身高 |
| `birth_weight_kg` | numeric(6,3) | nullable | 出生体重；需容纳产品规则允许的 300 kg 上界 |
| `avatar_media_id` | uuid | nullable, FK media | 宝宝头像 |
| `created_by` | uuid | FK users, not null | 创建者 |
| `version` | integer | not null, default 1 | 乐观并发版本号 |
| `created_at` | timestamptz | not null | 创建时间 |
| `updated_at` | timestamptz | not null | 更新时间 |
| `deleted_at` | timestamptz | nullable | 软删除时间 |

建议校验：

- `birth_date` 不晚于当前业务日期。
- 身高和体重范围由应用层按产品规则校验，数据库额外确保大于 0。

### 4.4 家庭成员 `baby_members`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 成员关系 ID |
| `baby_id` | uuid | FK babies, not null | 宝宝 |
| `user_id` | uuid | FK users, not null | 成员用户 |
| `role` | member_role | not null | 成员角色 |
| `status` | member_status | not null | 当前状态 |
| `joined_at` | timestamptz | not null | 加入时间 |
| `invited_by` | uuid | nullable, FK users | 邀请者；创建者可为空 |
| `removed_at` | timestamptz | nullable | 移除时间 |
| `removed_by` | uuid | nullable, FK users | 操作者 |
| `version` | integer | not null, default 1 | 乐观并发版本号 |
| `created_at` | timestamptz | not null | 创建时间 |
| `updated_at` | timestamptz | not null | 更新时间 |

约束与规则：

- 唯一键：`(baby_id, user_id)`，被移除后重新加入时复用并恢复关系。
- 每个未删除宝宝至少保留一个有效管理员；最后一个管理员不可直接退出或降级。
- 用户不能修改自己的管理员角色，除非先将另一成员设为管理员。

### 4.5 成长记录 `records`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 记录 ID |
| `baby_id` | uuid | FK babies, not null | 所属宝宝 |
| `type` | record_type | not null | 记录类型 |
| `title` | varchar(120) | nullable | 里程碑标题等 |
| `content` | text | nullable | 正文或备注 |
| `occurred_at` | timestamptz | not null | 事情发生/测量时间 |
| `created_by` | uuid | FK users, not null | 创建者 |
| `updated_by` | uuid | FK users, not null | 最近修改者 |
| `metadata` | jsonb | not null, default `{}` | 非核心扩展信息 |
| `version` | integer | not null, default 1 | 乐观并发版本号 |
| `created_at` | timestamptz | not null | 创建时间 |
| `updated_at` | timestamptz | not null | 更新时间 |
| `deleted_at` | timestamptz | nullable | 软删除时间 |
| `deleted_by` | uuid | nullable, FK users | 删除者 |

类型约束：

- `note`：`content` 非空或至少关联一张可用图片。
- `milestone`：`title` 必填。
- `measurement`：必须存在对应的 `measurement_records` 行。
- 创建测量记录及详情必须处于同一数据库事务。

关键索引：

- `(baby_id, occurred_at desc, id desc)`，条件为 `deleted_at is null`。
- `(baby_id, type, occurred_at desc, id desc)`，用于类型筛选。
- `(created_by, created_at desc)`，用于审计和用户数据处理。

### 4.6 测量详情 `measurement_records`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `record_id` | uuid | PK, FK records | 对应统一记录 |
| `height_cm` | numeric(5,2) | nullable, > 0 | 身高 |
| `weight_kg` | numeric(5,3) | nullable, > 0 | 体重 |
| `created_at` | timestamptz | not null | 创建时间 |
| `updated_at` | timestamptz | not null | 更新时间 |

约束：`height_cm` 与 `weight_kg` 至少一项非空。

成长曲线查询按 `records.baby_id`、`records.occurred_at` 和对应数值完成，排除软删除记录。

### 4.7 媒体 `media`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 媒体 ID |
| `owner_user_id` | uuid | FK users, not null | 上传者 |
| `baby_id` | uuid | FK babies, nullable | 所属宝宝上下文；M3 宝宝域上传强制非空，nullable 仅为后续非宝宝头像预留 |
| `storage_provider` | varchar(32) | not null | 存储提供商 |
| `bucket` | varchar(128) | not null | 存储桶 |
| `object_key` | varchar(512) | not null, unique | 私有对象键 |
| `mime_type` | varchar(100) | not null | MIME 类型 |
| `size_bytes` | bigint | nullable | 文件大小 |
| `width` | integer | nullable | 图片宽度 |
| `height` | integer | nullable | 图片高度 |
| `sha256` | char(64) | nullable | 内容摘要 |
| `status` | media_status | not null | 上传与处理状态 |
| `created_at` | timestamptz | not null | 创建时间 |
| `ready_at` | timestamptz | nullable | 可用时间 |
| `deleted_at` | timestamptz | nullable | 删除时间 |

不在数据库存储永久公开 URL；访问地址按需签名生成。

### 4.8 记录媒体关联 `record_media`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `record_id` | uuid | PK/FK records | 记录 |
| `media_id` | uuid | PK/FK media | 媒体 |
| `sort_order` | smallint | not null | 展示顺序 |
| `created_at` | timestamptz | not null | 关联时间 |

约束：

- 唯一键：`(record_id, media_id)`。
- 同一记录的 `sort_order` 唯一。
- 关联时校验 `media.baby_id`、状态和当前用户权限。

### 4.9 家庭邀请 `family_invites`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 邀请 ID |
| `baby_id` | uuid | FK babies, not null | 目标宝宝 |
| `role` | member_role | not null | 接受后的角色，不允许 `admin`（MVP 默认） |
| `token_hash` | char(64) | not null, unique | 邀请令牌摘要 |
| `status` | invite_status | not null | 邀请状态 |
| `expires_at` | timestamptz | not null | 过期时间 |
| `created_by` | uuid | FK users, not null | 邀请者 |
| `accepted_by` | uuid | nullable, FK users | 接受者 |
| `accepted_at` | timestamptz | nullable | 接受时间 |
| `revoked_at` | timestamptz | nullable | 撤销时间 |
| `created_at` | timestamptz | not null | 创建时间 |

只保存令牌哈希，原始令牌仅在创建时返回。MVP 默认邀请单次使用且具有有效期。

### 4.10 导出任务 `export_jobs`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 任务 ID |
| `baby_id` | uuid | FK babies, not null | 导出目标 |
| `requested_by` | uuid | FK users, not null | 发起管理员 |
| `status` | export_status | not null | 任务状态 |
| `scope` | jsonb | not null | 导出范围和选项 |
| `result_media_id` | uuid | nullable, FK media | 导出包对象 |
| `error_code` | varchar(64) | nullable | 失败原因码 |
| `started_at` | timestamptz | nullable | 开始时间 |
| `completed_at` | timestamptz | nullable | 完成时间 |
| `expires_at` | timestamptz | nullable | 下载过期时间 |
| `created_at` | timestamptz | not null | 创建时间 |
| `updated_at` | timestamptz | not null | 更新时间 |

### 4.11 审计日志 `audit_logs`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | PK | 日志 ID |
| `actor_user_id` | uuid | nullable, FK users | 操作者；系统任务可为空 |
| `baby_id` | uuid | nullable, FK babies | 相关宝宝 |
| `action` | varchar(80) | not null | 操作类型 |
| `resource_type` | varchar(50) | not null | 资源类型 |
| `resource_id` | uuid | nullable | 资源 ID |
| `request_id` | varchar(64) | nullable | 请求追踪 ID |
| `metadata` | jsonb | not null, default `{}` | 不含正文和敏感值的上下文 |
| `created_at` | timestamptz | not null | 创建时间 |

重点记录：角色变更、成员移除、宝宝删除、导出创建与下载、账号注销。

## 5. 可选基础设施表

### 5.1 幂等请求 `idempotency_keys`

用于创建记录、接受邀请和创建导出等关键写操作。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | uuid | 请求用户 |
| `key` | varchar(128) | 客户端生成的幂等键 |
| `operation` | varchar(80) | 操作名 |
| `request_hash` | char(64) | 请求摘要，防止同键不同请求 |
| `response_code` | integer | 首次结果状态码 |
| `response_body` | jsonb | 可重放结果 |
| `expires_at` | timestamptz | 过期时间 |

唯一键：`(user_id, operation, key)`。

### 5.2 刷新会话 `refresh_sessions`

若采用访问令牌加刷新令牌，服务端只保存刷新令牌哈希、设备/平台摘要、过期时间、撤销时间和轮换关系。

## 6. 数据一致性规则

- 创建宝宝和创建者管理员关系必须在同一事务内完成。
- 接受邀请、创建/恢复成员关系和更新邀请状态必须在同一事务内完成。
- 创建或更新测量记录时，统一记录与详情表必须保持一致。
- 删除成长记录后不可继续在时间轴和趋势查询中返回其详情。
- 媒体关联只能指向 `ready` 状态且属于同一宝宝上下文的文件。
- 删除宝宝是异步敏感操作：先停止访问，再执行导出保留期和物理清理策略。

## 7. 时间与月龄

- `birth_date` 使用宝宝出生地的自然日语义，不转换为 UTC 时间点。
- 记录发生时间使用 `timestamptz`，API 传输 ISO 8601 带偏移量的字符串。
- 月龄由显示日期与 `birth_date` 动态计算，不持久化，避免长期失真。
- 用户时区 MVP 默认使用设备时区；服务端审计时间始终以 UTC 处理。

## 8. 数据生命周期建议

- 成长记录软删除后保留 30 天再清理，最终期限需写入隐私政策。
- 未完成或未关联媒体在 24 小时后进入幂等清理；与软删除记录仍有关联的媒体至少保留 30 天，不按孤儿规则提前物理删除。
- 导出包建议 7 天后失效并删除。
- 已撤销或过期邀请可保留最小审计信息，原始令牌从不落库。
- 运行日志、审计日志和业务数据使用不同保留期限。

以上期限均为默认建议，发布前需根据法规、用户承诺和成本最终确认。

## 9. 查询模型

### 9.1 时间轴

输入：`baby_id`、可选 `type`、`cursor`、`limit`。

排序键：`occurred_at desc, id desc`。游标包含两者，保证稳定分页。

### 9.2 成长曲线

连接 `records` 与 `measurement_records`，按 `occurred_at asc` 返回指定时间范围内非空指标。身高和体重可以分别查询，避免补空值造成误导。

### 9.3 可访问宝宝

连接 `baby_members` 与 `babies`，仅返回有效成员关系及未删除宝宝，同时附带当前角色。

## 10. 待确认事项

- 宝宝性别选项和隐私展示文案。
- 身高、体重允许的产品校验范围。
- 管理员是否可以直接邀请另一位管理员；MVP 默认不允许。
- 图片原图、压缩图和缩略图是否分别存储。
- 导出任务的 `scope` 结构和最终文件格式。
- 删除宝宝、账号注销和审计日志的最终保留期限。
