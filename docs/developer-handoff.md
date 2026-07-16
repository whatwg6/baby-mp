# 宝宝成长记开发交接说明

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 面向对象 | 接手实现 MVP 的开发 agent |
| 当前状态 | M2 登录与宝宝档案完成，M3 成长记录、媒体与时间轴实施中 |
| 更新日期 | 2026-07-17 |

## 1. 交接结论

项目可以进入开发阶段。开发应采用“本地优先、云厂商中立”的方式，不需要等待云服务商、生产域名或真实微信 AppID 才初始化工程。

M1 已完成并验证以下技术链路：

```text
Taro 客户端
→ 本地 NestJS API
→ GET /api/v1/health
→ 展示标准成功响应
```

M2 已完成以下第一条业务链路：

```text
本地模拟登录
→ 创建宝宝
→ 自动建立管理员关系
→ 进入首页空状态
→ 重新启动后恢复当前宝宝
```

M3 当前实施私有媒体、三类成长记录和游标时间轴；成长图表、邀请和导出仍按依赖顺序留在 M4–M6。

多人或多 agent 协作时，任务依赖、并行边界和文件所有权以 `agent-workstreams.md` 为准。

## 2. 必读文档顺序

1. `product-requirements.md`：MVP 做什么、不做什么。
2. `information-architecture.md`：页面关系和用户流程。
3. `ui-specification.md`：页面行为、字段和状态。
4. `technical-architecture.md`：工程边界和安全要求。
5. `data-model.md`：数据库实体、约束和索引。
6. `api-specification.md`：HTTP 契约和错误码。
7. `test-plan.md`：必须覆盖的高风险路径。
8. `development-plan.md`：里程碑和完成标准。
9. `agent-workstreams.md`：多人并行开发时的拆分与合并顺序。

## 3. 已确定的工程决策

这些决策可直接作为初始化默认值：

| 领域 | 决策 |
| --- | --- |
| 仓库 | pnpm workspace 单仓库 |
| 客户端 | Taro 4 + React + TypeScript |
| API | NestJS 单体应用 |
| 数据库 | PostgreSQL |
| ORM | Prisma |
| 对象存储 | S3 兼容接口；本地使用 MinIO |
| 全局客户端状态 | 当前使用 `useSyncExternalStore` 轻量 store；M3 不再引入第二套状态容器 |
| 接口契约 | OpenAPI 3，代码实现后由 NestJS 生成 |
| 共享契约 | `packages/contracts`，不向客户端暴露 Prisma 类型 |
| 记录模型 | `records` 主表 + 类型详情表 |
| 权限 | admin/editor/viewer，服务端资源级校验 |
| 删除 | 业务资源优先软删除，媒体延迟物理清理 |
| ID | UUID |
| 时间 | API 使用带时区 ISO 8601，数据库 `timestamptz` |
| 图片访问 | 私有对象 + 短期签名 URL |
| 本地登录 | 仅 local/test 可用的 mock login |

若实际工具链存在兼容问题，可以调整具体小版本，但不得无说明更换架构边界。

## 4. 暂不阻塞开发的事项

以下问题尚未最终确认，但不影响 M3 的本地实现：

- 具体云服务商和部署区域。
- CDN 产品。
- H5 正式登录方式。
- 最终品牌名、Logo、颜色和插画。
- 图片内容安全产品。
- 导出 zip 内的最终数据格式。
- 宝宝物理删除和账号注销的最终保留期限。
- 正式微信 AppID/secret 与合法域名；本地使用模拟登录，适配器已实现。

实现时应提供接口或配置扩展点，不要为这些事项猜测最终业务答案。

## 5. 不可妥协的约束

- 任何宝宝数据接口都必须从当前用户重新校验 `baby_members`，不能只信客户端 babyId 或角色。
- 详情接口必须从资源反查 babyId 后授权。
- 不得在日志中写入令牌、平台 code/session_key、原始邀请 token、宝宝正文、姓名或签名 URL。
- 模拟登录在 staging/production 必须不可用；配置错误时服务应拒绝启动。
- 对象存储默认私有，不得为了本地省事把生产设计成公共桶。
- 邀请 token 不放入 API URL，预览和接受时使用 JSON 请求体，并对客户端、服务端和代理日志脱敏。
- 创建宝宝、记录、邀请、接受邀请和导出使用幂等机制。
- 宝宝创建与 admin 成员关系、邀请接受与成员创建均使用事务。
- 客户端业务代码不得直接调用 `wx.*`，统一经平台适配层。
- 不实现 PRD 明确排除的社区、医疗判断、AI 和复杂育儿记录。

## 6. 建议的初始目录

```text
baby-mp/
├── apps/
│   ├── client/
│   └── api/
├── packages/
│   ├── contracts/
│   └── config/
├── docs/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

`packages/ui` 可以等出现两个以上真实复用场景后再创建，避免先抽象空组件库。

## 7. M1 建议任务顺序

### 7.1 工程初始化

1. 创建 pnpm workspace。
2. 创建 Taro client 和 NestJS api。
3. 建立共享 TypeScript、ESLint 和测试配置。
4. 配置 `pnpm dev`、`pnpm build`、`pnpm test`、`pnpm typecheck`、`pnpm lint` 和 `pnpm verify`。
5. 创建 `.env.example`，不提交真实密钥。

### 7.2 本地依赖

1. Docker Compose 启动 PostgreSQL。
2. Docker Compose 启动 MinIO 并建立私有 bucket。
3. API 启动时校验数据库和存储配置。
4. 提供数据库迁移、重建测试数据库和初始化虚构测试用户的命令。

### 7.3 服务端基础

1. 请求 ID、结构化日志和统一异常格式。
2. Zod/class-validator 取舍应统一；共享 DTO 优先使用可被客户端复用的 schema。
3. 认证守卫和宝宝成员守卫的接口骨架，不实现完整认证业务。
4. `/api/v1/health` 接口和 OpenAPI 生成基础。

### 7.4 客户端基础

1. API client 和标准错误映射。
2. 平台适配层骨架。
3. 首页、时间轴、成长和“我的”页面路由壳。
4. 客户端调用 `/api/v1/health` 并展示成功、加载和错误状态。
5. loading、empty、error 和确认弹窗基础组件骨架。

### 7.5 M1 链路验收

- PostgreSQL 和 MinIO 可由 Docker Compose 启动。
- API 返回符合共享 contract 的 health 响应。
- 客户端真实调用本地 health API，并具有加载和错误状态。
- CI 通过 lint、类型检查、测试和构建。

## 8. 推荐的本地环境变量类别

只约定类别，不在文档提供任何真实密钥：

```text
APP_ENV=local
API_PORT=3000
DATABASE_URL=postgresql://...
JWT_ACCESS_SECRET=local-only-secret
JWT_REFRESH_SECRET=local-only-secret
MOCK_AUTH_ENABLED=false
S3_ENDPOINT=http://localhost:9000
S3_REGION=local
S3_BUCKET=baby-mp-local
S3_ACCESS_KEY=local-only-key
S3_SECRET_KEY=local-only-secret
S3_FORCE_PATH_STYLE=true
```

生产启动校验至少要求：

- `APP_ENV=production` 时 `MOCK_AUTH_ENABLED` 不能为 true。
- JWT 和 S3 密钥不能等于示例值。
- 数据库和对象存储不能指向 localhost。
- CORS、合法来源和代理信任配置明确。

## 9. API 实现注意事项

- 以 `api-specification.md` 为首版设计，代码完成后生成 OpenAPI 3 文件。
- 所有 DTO 使用 camelCase；Prisma 映射到 snake_case 数据库字段。
- 更新宝宝、成员和记录时检查 `version` 并原子递增。
- 列表游标应封装发生时间和 ID，不接受客户端自定义排序字段。
- 错误返回稳定 `code`，不要让客户端解析数据库错误文本。
- 写操作先做权限与输入校验，再在事务中写入。
- 测试必须覆盖跨宝宝 mediaId、recordId 和 memberId 越权。

## 10. 客户端实现注意事项

- 页面路由和 tab 结构遵循 `information-architecture.md`。
- 首版视觉使用语义 token，不在业务组件散落硬编码品牌色。
- 服务端状态缓存键始终包含 babyId。
- 切换宝宝时取消或隔离前一个宝宝的在途请求。
- 图片上传失败不清空表单，保存按钮需要幂等键和提交锁。
- 权限隐藏只改善体验，不能替代服务端校验。
- H5 可用于快速自动化测试，微信开发者工具和真机仍是首发验收端。

## 11. 文档变更协议

开发 agent 发现文档无法实现、相互冲突或需要改变时：

1. 指出涉及的文件和具体规则。
2. 说明技术事实、风险和推荐修改。
3. 先更新相关文档或在 PR 中同时更新。
4. 数据模型变更必须附迁移。
5. API 变更必须同步 OpenAPI 和客户端契约。
6. 范围新增必须先判断是否进入 MVP，默认放入后续候选。

不得通过临时代码默默创造新的产品规则。

## 12. 每个开发里程碑的交付物

- 可运行代码和必要迁移。
- 更新后的 OpenAPI 文件。
- 对应自动化测试。
- 文档差异更新。
- 本地启动或验证命令。
- 已知限制和未解决风险。
- 微信端验证记录（适用时）。

## 13. M3 开工检查清单

- [x] M2 登录、会话、宝宝上下文和实时成员守卫已验证。
- [x] PostgreSQL、私有 MinIO 和前进迁移可用。
- [x] OpenAPI、共享 contracts、客户端运行时校验保持同步。
- [x] 写操作已有幂等、乐观版本和低敏日志基线。
- [x] M3 媒体/记录/时间轴契约和高风险测试矩阵已定义。

## 14. 当前建议

以 `current-milestone.md` 中的 M3 为唯一当前验收基线，完成私有媒体上传、三类记录 CRUD、跨宝宝媒体授权、软删除、游标时间轴和客户端完整闭环。M4/M5 不得提前侵入 M3 的共享迁移和路由。
