# 宝宝成长记 API 契约（MVP 草案）

> [文档索引](../README.md) · 分类：系统架构

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 基础路径 | `/api/v1` |
| 传输格式 | HTTPS + JSON |
| 字段命名 | camelCase |
| 更新日期 | 2026-07-16 |

## 1. 契约定位

本文是在代码生成 OpenAPI 文件之前的设计基线。服务端实现后，应由 NestJS 生成 OpenAPI 3 文件并纳入版本控制；若生成结果与本文不同，开发 agent 必须先说明差异并同步文档，不能静默改变业务语义。

本文只列 MVP 所需接口。管理后台、公开分享页、AI 和提醒接口不在范围内。

## 2. 通用约定

### 2.1 认证

除登录、刷新会话、健康检查和邀请安全预览外，接口要求：

```http
Authorization: Bearer <accessToken>
```

访问令牌短期有效，刷新令牌支持轮换。具体有效期通过服务端配置管理，不由客户端写死。

### 2.2 响应包装

单资源成功响应：

```json
{
  "data": {}
}
```

列表成功响应：

```json
{
  "data": [],
  "meta": {
    "nextCursor": null
  }
}
```

无响应体的删除操作返回 `204 No Content`。

### 2.3 错误响应

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "提交内容有误",
    "requestId": "req_01...",
    "details": [
      {
        "field": "name",
        "reason": "昵称不能为空"
      }
    ]
  }
}
```

客户端根据 `code` 决定行为，不能依赖 `message` 文本进行程序判断。

### 2.4 HTTP 状态码

| 状态码 | 用途 |
| --- | --- |
| 200 | 查询或更新成功 |
| 201 | 创建成功 |
| 204 | 删除、撤销或退出成功 |
| 400 | 参数格式或业务校验失败 |
| 401 | 未登录、令牌失效 |
| 403 | 已登录但无操作权限 |
| 404 | 资源不存在或对用户不可见 |
| 409 | 幂等冲突、版本冲突、重复成员等 |
| 413 | 上传文件或请求体过大 |
| 422 | 文件状态不完整等无法处理的实体 |
| 429 | 操作过于频繁 |
| 500 | 未预期服务端错误 |

为了避免泄漏资源是否存在，无权访问他人宝宝资源时可统一返回 404；角色明确但操作被禁止时返回 403。

### 2.5 时间、数值和 ID

- ID 使用 UUID 字符串。
- 时间点使用 ISO 8601，并包含时区，例如 `2026-07-16T12:30:00+08:00`。
- 服务端内部统一转换为 UTC。
- `birthDate` 使用 `YYYY-MM-DD`。
- `birthTime` 使用 `HH:mm`。
- 身高和体重在 JSON 中使用十进制 number，服务端按数据库精度校验。

### 2.6 分页

- 请求参数：`cursor`、`limit`。
- 默认 `limit=20`，最大 `limit=50`。
- 游标是不透明字符串，客户端不能解析或拼接。
- `nextCursor=null` 表示没有下一页。

### 2.7 幂等

以下写接口必须携带：

```http
Idempotency-Key: <uuid>
```

- 创建宝宝。
- 创建成长记录。
- 创建邀请。
- 接受邀请。
- 创建导出任务。

同一用户、操作和幂等键提交相同请求时返回首次结果；同键不同请求返回 `409 IDEMPOTENCY_CONFLICT`。

### 2.8 乐观并发

宝宝、成员和成长记录响应包含 `version`。更新请求必须提交当前 `version`；版本不匹配返回：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "内容已被其他成员更新，请刷新后重试",
    "requestId": "req_01..."
  }
}
```

## 3. 核心资源结构

### 3.1 UserSummary

```json
{
  "id": "uuid",
  "displayName": "妈妈",
  "avatarUrl": "https://temporary-signed-url"
}
```

`avatarUrl` 可以为空，且仅为短期访问地址。

### 3.2 Baby

```json
{
  "id": "uuid",
  "name": "小满",
  "gender": "unspecified",
  "birthDate": "2025-12-01",
  "birthTime": "08:30",
  "birthHeightCm": 50.2,
  "birthWeightKg": 3.42,
  "avatarUrl": null,
  "role": "admin",
  "version": 1,
  "createdAt": "2026-07-16T12:30:00Z",
  "updatedAt": "2026-07-16T12:30:00Z"
}
```

`role` 是当前登录用户在该宝宝空间的角色，仅在授权后的宝宝响应中返回。

### 3.3 Media

```json
{
  "id": "uuid",
  "mimeType": "image/jpeg",
  "width": 1600,
  "height": 1200,
  "sizeBytes": 456789,
  "status": "ready",
  "accessUrl": "https://temporary-signed-url",
  "sortOrder": 0
}
```

### 3.4 Record

```json
{
  "id": "uuid",
  "babyId": "uuid",
  "type": "measurement",
  "title": null,
  "content": "体检记录",
  "occurredAt": "2026-07-16T09:30:00+08:00",
  "measurement": {
    "heightCm": 68.2,
    "weightKg": 7.85
  },
  "media": [],
  "createdBy": {
    "id": "uuid",
    "displayName": "妈妈",
    "avatarUrl": null
  },
  "permissions": {
    "canEdit": true,
    "canDelete": true
  },
  "version": 1,
  "createdAt": "2026-07-16T09:35:00+08:00",
  "updatedAt": "2026-07-16T09:35:00+08:00"
}
```

`measurement` 仅在 `type=measurement` 时非空。

## 4. 系统接口

### 4.1 健康检查

`GET /health` 或 `GET /health/live`

无需认证，仅返回服务进程可用状态。详细数据库和存储状态仅供内部监控，不在公网响应暴露配置。

```json
{
  "data": {
    "status": "ok",
    "version": "0.1.0"
  }
}
```

### 4.2 就绪检查

`GET /health/ready`

供部署平台判断实例是否可接收流量。服务端以 2 秒边界检查 PostgreSQL 与配置的
私有 S3 bucket；全部可达时返回 `{"data":{"status":"ready"}}`，任一失败则
返回通用 503，不返回主机、bucket、对象 key、凭据或底层异常。

### 4.3 内部运行指标

`GET /health/metrics`

必须携带 `x-internal-monitoring-token`。未配置或 token 不匹配时表现为 404。
响应只包含进程运行时间、按规范化路由聚合的请求/5xx/平均耗时、限流次数及
导出 pending/processing/failed 数与最老 pending 年龄；不包含宝宝、用户、
任务、对象或 token 标识。

### 4.4 HTTP 安全边界

- JSON body 默认最大 256 KiB，超限返回 413。
- 登录、邀请和媒体上传授权接口按配置返回 `RateLimit-*` 响应头，超限返回
  429、`Retry-After` 与 `RATE_LIMITED`。
- staging/production 默认不发布 Swagger；受控开启时必须使用内部监控 token。
- 请求日志使用 `/babies/:babyId/...` 一类路由模板，不记录实际 path/query。

## 5. 认证与当前用户

### 5.1 平台登录

`POST /auth/platform-login`

```json
{
  "platform": "wechat_mini",
  "code": "platform-temporary-code"
}
```

响应：

```json
{
  "data": {
    "accessToken": "token",
    "accessTokenExpiresAt": "2026-07-16T13:00:00Z",
    "refreshToken": "refresh-token",
    "refreshTokenExpiresAt": "2026-08-15T12:30:00Z",
    "user": {
      "id": "uuid",
      "displayName": null,
      "avatarUrl": null
    }
  }
}
```

平台值：`wechat_mini`、`alipay_mini`、`douyin_mini`、`h5`。MVP 正式环境只要求 `wechat_mini`。

### 5.2 本地模拟登录

`POST /auth/mock-login`

仅 `local` 和自动化测试环境可启用。

```json
{
  "mockUserKey": "parent-a",
  "displayName": "测试妈妈"
}
```

响应与平台登录相同。预发布或生产环境访问必须返回 404，服务启动时若错误启用应直接失败。

### 5.3 刷新会话

`POST /auth/refresh`

```json
{
  "refreshToken": "refresh-token"
}
```

返回新的访问令牌和轮换后的刷新令牌。旧刷新令牌立即失效。

### 5.4 退出登录

`POST /auth/logout`

```json
{
  "refreshToken": "refresh-token"
}
```

成功返回 204。

### 5.5 当前用户

`GET /me`

返回当前用户基础信息和账号状态，不内嵌完整宝宝列表。

### 5.6 数据权利申请列表

`GET /me/data-rights-requests`

仅返回当前登录用户本人提交的申请，按 `createdAt desc, id desc` 稳定排序。申请可为
`account_deletion`、`data_access` 或 `correction`；状态为 `pending`、`processing`、
`completed`、`rejected` 或 `cancelled`。响应不得包含内部去重键、处理备注或其他用户信息。

### 5.7 创建数据权利申请

`POST /me/data-rights-requests`

```json
{
  "type": "data_access",
  "babyId": "optional-baby-uuid"
}
```

- `account_deletion` 固定为账号范围，不能携带 `babyId`。
- `data_access` 和 `correction` 可为账号范围，也可指向当前用户仍是有效成员且宝宝未删除的空间。
- 宝宝范围的每次提交（包括已有待处理申请的重放）都必须先实时校验成员关系。
- 同一用户、类型和范围同时只保留一个 active 申请；相同 active 请求返回原申请，不重复写入或审计。
- 创建只表示登记并等待人工核验，不表示数据已经更正、注销或物理删除。

### 5.8 取消数据权利申请

`DELETE /me/data-rights-requests/{requestId}`

只有申请本人可取消 `pending` 状态；成功返回 204。取消、完成或拒绝会释放 active 去重键并写入
低敏审计。`processing/completed/rejected/cancelled` 不能通过用户接口取消。

处理人员不使用公网管理接口；受控运维命令按 `pending → processing → completed/rejected`
推进状态。状态完成只表示相应人工流程已核验完成，不自动证明所有备份和审计数据已物理清除。

## 6. 宝宝档案

### 6.1 可访问宝宝列表

`GET /babies`

返回全部有效成员关系对应的宝宝，数据量较小，MVP 不分页。

### 6.2 创建宝宝

`POST /babies`

需要 `Idempotency-Key`。

```json
{
  "name": "小满",
  "gender": "unspecified",
  "birthDate": "2025-12-01",
  "birthTime": "08:30",
  "birthHeightCm": 50.2,
  "birthWeightKg": 3.42
}
```

服务端在同一事务中创建宝宝和当前用户的 `admin` 成员关系。成功返回 201 和 Baby。

宝宝创建前没有可授权的 `babyId`，因此首版不接受 `avatarMediaId`。客户端先创建宝宝，再通过宝宝域媒体接口上传头像并调用更新宝宝接口关联。

### 6.3 宝宝详情

`GET /babies/{babyId}`

任意有效成员可访问。

### 6.4 更新宝宝

`PATCH /babies/{babyId}`

仅 admin。

```json
{
  "version": 1,
  "name": "小满满",
  "avatarMediaId": "uuid"
}
```

未提交的字段保持不变，显式 `null` 表示清空可空字段。

### 6.5 申请删除宝宝

`DELETE /babies/{babyId}`

仅 admin。MVP 使用事务化软删除，立即移除全部有效成员、撤销待接受邀请、终止活动导出并写入
`baby.deleted` 审计，成功返回 204。物理清理、恢复期限和备份处置仍须在正式发布前由运营与法律规则确定；
接口成功不得表述为所有副本已即时物理删除。

## 7. 媒体上传

### 7.1 创建上传

`POST /babies/{babyId}/media/uploads`

editor 或 admin。

M3 仅接受 `image/jpeg` 与 `image/png`，单文件最大 20 MiB，上传签名有效 10 分钟；客户端压缩目标不超过 2 MiB/张。对象键由服务端随机生成，不使用原文件名或业务字段。

```json
{
  "fileName": "photo.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 456789,
  "sha256": "optional-hex-digest"
}
```

响应：

```json
{
  "data": {
    "mediaId": "uuid",
    "upload": {
      "method": "PUT",
      "url": "https://signed-upload-url",
      "headers": {
        "Content-Type": "image/jpeg"
      },
      "expiresAt": "2026-07-16T12:45:00Z"
    }
  }
}
```

### 7.2 确认上传完成

`POST /media/{mediaId}/complete`

```json
{
  "width": 1600,
  "height": 1200
}
```

仅上传者或当前 admin 可确认。M3 采用同步确认：服务端校验临时对象的大小、真实 JPEG/PNG 内容和图片尺寸，将其固化为不可覆盖的 ready 对象后返回 Media；失败时保持不可关联状态并允许重试。未来若引入异步内容处理，再通过版本化契约增加 `202/uploaded` 轮询状态，M3 客户端不依赖该分支。

### 7.3 媒体详情

`GET /media/{mediaId}`

仅对所属宝宝的有效成员返回，包含有效 5 分钟的 `accessUrl`。不得提供按 object key 读取接口或独立返回 object key；签名 URL 中不可避免的路径必须使用随机值，不得包含用户、宝宝或正文信息，也不得写入日志。

### 7.4 放弃未关联媒体

`DELETE /media/{mediaId}`

仅上传者或 admin。成功返回 204；后台仍负责清理超时孤儿媒体。

## 8. 成长记录

### 8.1 时间轴列表

`GET /babies/{babyId}/records`

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `type` | enum | 可选：`note`、`measurement`、`milestone` |
| `cursor` | string | 不透明游标 |
| `limit` | integer | 默认 20，最大 50 |
| `startAt` | datetime | 可选发生时间下界 |
| `endAt` | datetime | 可选发生时间上界 |

按 `occurredAt desc, id desc` 排序。

`limit` 默认 20、最大 50，超过上限返回 400；无效或错查询上下文的游标返回 400，不做静默截断。

### 8.2 创建记录

`POST /babies/{babyId}/records`

editor 或 admin，需要 `Idempotency-Key`。

图文示例：

```json
{
  "type": "note",
  "content": "今天第一次自己站起来。",
  "occurredAt": "2026-07-16T10:00:00+08:00",
  "mediaIds": ["uuid-1", "uuid-2"]
}
```

测量示例：

```json
{
  "type": "measurement",
  "content": "体检记录",
  "occurredAt": "2026-07-16T09:30:00+08:00",
  "measurement": {
    "heightCm": 68.2,
    "weightKg": 7.85
  },
  "mediaIds": []
}
```

里程碑示例：

```json
{
  "type": "milestone",
  "title": "第一次独立行走",
  "content": "从沙发走到了妈妈身边。",
  "occurredAt": "2026-07-16T18:20:00+08:00",
  "mediaIds": ["uuid-1"]
}
```

服务端按类型校验必填项，并验证全部 media 为 `ready`、属于同一宝宝且当前用户有权关联。每条记录最多 9 张且 ID 不重复；editor 只能关联自己上传的媒体，admin 可关联宝宝内 ready 媒体。

### 8.3 记录详情

`GET /records/{recordId}`

返回 Record。服务端从记录反查 `babyId` 再校验成员关系。

### 8.4 更新记录

`PATCH /records/{recordId}`

admin 可更新全部记录；editor 只能更新自己创建的记录。

```json
{
  "version": 1,
  "content": "更新后的内容",
  "occurredAt": "2026-07-16T10:05:00+08:00",
  "mediaIds": ["uuid-2", "uuid-1"]
}
```

- `type` 和 `babyId` 不允许修改。
- `mediaIds` 的顺序即展示顺序。
- 测量记录可提交完整 `measurement` 对象更新数值。

### 8.5 删除记录

`DELETE /records/{recordId}?version=1`

权限与更新相同。执行软删除，成功返回 204。

## 9. 成长数据

### 9.1 查询单项趋势

`GET /babies/{babyId}/growth/measurements`

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `metric` | enum | 必填：`height` 或 `weight` |
| `startAt` | datetime | 可选 |
| `endAt` | datetime | 可选 |

时间范围上下界均为包含边界；`startAt` 不得晚于 `endAt`。

响应：

```json
{
  "data": {
    "metric": "height",
    "unit": "cm",
    "points": [
      {
        "recordId": "uuid",
        "occurredAt": "2026-07-16T09:30:00+08:00",
        "value": 68.2
      }
    ]
  }
}
```

按发生时间升序返回，相同发生时间按记录 ID 升序稳定排序。MVP 不返回百分位、预测或健康结论；出生档案中的身高体重不自动混入测量趋势。

## 10. 家庭成员与邀请

### 10.1 成员列表

`GET /babies/{babyId}/members`

任意有效成员可查看。返回成员用户摘要、角色、状态、加入时间和 `version`。

### 10.2 创建邀请

`POST /babies/{babyId}/invites`

仅 admin，需要 `Idempotency-Key`。

```json
{
  "role": "editor",
  "expiresInHours": 24
}
```

MVP 只允许 `editor` 或 `viewer`。响应包含仅返回一次的原始 `token` 和适合平台分享的 path。

### 10.3 有效邀请列表

`GET /babies/{babyId}/invites?status=pending`

仅 admin。响应不包含原始 token。

### 10.4 邀请安全预览

`POST /invites/preview`

可在登录前访问：

```json
{
  "token": "raw-one-time-token"
}
```

只返回宝宝昵称/头像、邀请者显示名、目标角色和邀请状态。不得返回宝宝 ID 之外的内部信息、记录或成员列表。请求体中的 token 必须在日志中脱敏。

### 10.5 接受邀请

`POST /invites/accept`

必须登录，需要 `Idempotency-Key`。

```json
{
  "token": "raw-one-time-token"
}
```

成功返回 Baby 和新成员角色。客户端页面可以从分享路径读取 token，但不能把 token 放进 API URL。

### 10.6 撤销邀请

`DELETE /babies/{babyId}/invites/{inviteId}`

仅 admin，成功返回 204。

### 10.7 修改成员角色

`PATCH /babies/{babyId}/members/{memberId}`

仅 admin。

```json
{
  "version": 1,
  "role": "viewer"
}
```

必须保护最后一个 admin。MVP 允许将既有成员提升为 admin，但创建邀请时不能直接邀请 admin。

### 10.8 移除成员

`DELETE /babies/{babyId}/members/{memberId}?version=1`

仅 admin。成功后该用户的现有访问令牌仍可用于其他宝宝，但对当前宝宝的所有请求必须立即失效。

### 10.9 退出当前家庭

`DELETE /babies/{babyId}/membership?version=1`

当前成员可软移除自己的成员关系，成功返回 204，并立即失去目标宝宝的全部访问权限；其他宝宝会话不受影响。
必须提交本人当前成员 `version`，过期版本返回 `VERSION_CONFLICT`。最后一个有效管理员不能退出，返回
`LAST_ADMIN_REQUIRED`；服务端在事务中保护该不变量并写入 `family.member.left` 低敏审计。

## 11. 数据导出

### 11.1 创建导出任务

`POST /babies/{babyId}/exports`

仅 admin，需要 `Idempotency-Key`。

```json
{
  "includeMedia": true,
  "format": "zip"
}
```

MVP 固定使用 ZIP，同时包含一份规范 JSON 和 UTF-8 BOM/RFC 4180 CSV；照片默认不勾选，由 `includeMedia` 显式决定。导出范围为当前宝宝的未删除档案与全部未删除成长记录，不包含成员、邀请、审计、内部对象键或签名 URL。

### 11.2 导出任务列表

`GET /babies/{babyId}/exports?cursor=&limit=20`

仅 admin，按 `createdAt + id` 稳定倒序游标分页；每次请求实时确认管理员关系。普通列表和详情永不返回对象键、结果媒体 ID 或签名 URL。

### 11.3 导出任务详情

`GET /exports/{exportId}`

响应：

```json
{
  "data": {
    "id": "uuid",
    "babyId": "uuid",
    "status": "completed",
    "includeMedia": true,
    "format": "zip",
    "errorCode": null,
    "createdAt": "2026-07-16T12:30:00Z",
    "completedAt": "2026-07-16T12:31:00Z",
    "expiresAt": "2026-07-23T12:31:00Z",
    "downloadUrl": null
  }
}
```

详情接口默认不返回下载 URL，避免日志或缓存意外暴露。

### 11.4 获取下载地址

`POST /exports/{exportId}/download-url`

仅目标宝宝的当前 admin。任务必须已完成且未过期；返回不超过 5 分钟、且不超过任务剩余有效期的私有签名 URL，并记录 `export.download_url.issued` 审计。导出包完成后保留 7 天，过期任务不可复用。

## 12. 建议错误码

| 错误码 | 场景 |
| --- | --- |
| `AUTH_REQUIRED` | 缺少或无效访问令牌 |
| `REFRESH_TOKEN_INVALID` | 刷新令牌无效、过期或已轮换 |
| `FORBIDDEN` | 角色不允许当前操作 |
| `RESOURCE_NOT_FOUND` | 资源不存在或不可见 |
| `VALIDATION_FAILED` | 输入字段不合法 |
| `VERSION_CONFLICT` | 乐观锁版本冲突 |
| `IDEMPOTENCY_CONFLICT` | 同幂等键对应不同请求 |
| `LAST_ADMIN_REQUIRED` | 不能移除或降级最后一个管理员 |
| `INVITE_INVALID` | 邀请不存在或格式不合法 |
| `INVITE_EXPIRED` | 邀请已过期 |
| `INVITE_REVOKED` | 邀请已撤销 |
| `INVITE_ALREADY_USED` | 单次邀请已接受 |
| `ALREADY_A_MEMBER` | 用户已经是该宝宝成员 |
| `UPLOAD_INCOMPLETE` | 上传对象不存在或未完成 |
| `MEDIA_NOT_READY` | 媒体尚不可关联 |
| `UNSUPPORTED_MEDIA_TYPE` | 文件类型不支持 |
| `EXPORT_NOT_READY` | 导出任务未完成 |
| `EXPORT_EXPIRED` | 导出包已过期 |
| `RATE_LIMITED` | 请求超过限制 |

## 13. 权限核对表

| 资源/操作 | admin | editor | viewer |
| --- | --- | --- | --- |
| 读取宝宝、记录、成长数据 | 是 | 是 | 是 |
| 更新宝宝档案 | 是 | 否 | 否 |
| 创建记录 | 是 | 是 | 否 |
| 更新/删除自己的记录 | 是 | 是 | 否 |
| 更新/删除他人的记录 | 是 | 否 | 否 |
| 上传媒体 | 是 | 是 | 否 |
| 查看成员 | 是 | 是 | 是 |
| 邀请、改角色、移除成员 | 是 | 否 | 否 |
| 创建和下载导出 | 是 | 否 | 否 |
| 退出家庭（非最后管理员） | 是 | 是 | 是 |
| 提交本人数据权利申请 | 是 | 是 | 是 |

## 14. 实现前仍需确认

- 刷新令牌在小程序端的最终安全存储和有效期。
- 图片完成确认是否同步生成缩略图，或由异步处理完成。
- 导出 zip 内使用 JSON、CSV 还是两者都提供。
- 宝宝删除接口在 MVP 是否开放，或仅先保留交互和后台处理。
- 限流的具体阈值。
