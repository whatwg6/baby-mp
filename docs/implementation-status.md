# 实现状态

| 项目 | 内容 |
| --- | --- |
| 当前状态 | M3 成长记录、私有媒体与时间轴完整闭环已完成 |
| 当前里程碑 | M3：成长记录、媒体与时间轴（Complete） |
| 当前阻塞 | 无 |
| 更新日期 | 2026-07-17 |

## 1. 已完成

- 项目级 pnpm registry 已通过根目录 `.npmrc` 固定为 `https://registry.npmmirror.com/`。
- MVP 产品需求。
- 信息架构和核心用户流程。
- 页面交互规格和表单规则。
- 技术架构与本地优先策略。
- 核心数据模型。
- API 契约草案。
- 测试计划和高风险测试矩阵。
- 开发计划、开发交接和多 Agent 分工。
- 架构决策记录：本地优先、统一记录模型、服务端资源级授权。
- pnpm workspace、统一 Node/pnpm/TypeScript/ESLint/Vitest 工具链和 lockfile。
- Taro 4 + React 客户端骨架，包含四个 tab 页面、语义样式、页面状态组件和平台适配边界。
- 客户端 API 层、标准错误映射和基于共享 Zod contract 的 health 响应校验。
- NestJS API 骨架、`GET /api/v1/health`、请求 ID、低敏结构化日志和统一异常响应。
- 认证守卫与宝宝资源成员守卫接口骨架；守卫从服务端解析资源并查询实时成员关系，不信任客户端角色声明。
- 环境配置校验；staging/production 禁止 mock auth、localhost 依赖、示例密钥和通配 CORS。
- Swagger UI、版本化 OpenAPI JSON 和生成命令。
- Prisma 空基线 schema 与迁移；M1 未提前创建 M2 业务表。
- PostgreSQL、MinIO 和私有 bucket 的 Docker Compose 配置。
- GitHub Actions CI、根 README 和无真实密钥的 `.env.example`。
- H5 与微信小程序构建，以及浏览器端真实 health 调用。
- 修复本地 H5 未配置 `TARO_APP_API_BASE_URL` 时在传输前失败的问题：开发模式会从页面主机名推导局域网 API 地址，并配套 local-only 的 loopback/RFC1918 CORS 策略；生产构建仍要求显式配置。
- 修复小程序开发构建的空 API 地址及本地域名校验问题：`pnpm dev:weapp` 自动选择开发机私网 IPv4，并把仅供本地开发者工具使用的 `urlCheck: false` 项目配置复制到产物；生产构建仍不推导地址。
- 清理 TypeScript 7 兼容性告警：API 类型检查改用 `Preserve`/`Bundler`、Nest 构建使用 `Node16`，contracts 使用 `Node16`，客户端移除未使用且已弃用的 `baseUrl`；未使用 `ignoreDeprecations` 掩盖问题。

## 2. 实际验证

- `pnpm install`：通过，生成 `pnpm-lock.yaml`。
- `pnpm db:generate`：通过，Prisma Client 6.11.1 生成成功。
- `pnpm db:deploy`：通过，`20260716000000_m1_baseline` 已应用到本地 PostgreSQL。
- `pnpm verify`：通过；lint、三包 typecheck、22 个测试、NestJS 构建、Taro H5 构建和微信小程序构建全部成功。
- `pnpm openapi:generate`：通过。
- Docker Compose：PostgreSQL 与 MinIO 均为 healthy，`minio-init` 退出码为 0。
- API 真实请求：`GET /api/v1/health` 返回 200、request ID 和 `{ "data": { "status": "ok", "version": "0.1.0" } }`。
- Playwright H5 验收：首页显示“服务已连接”“工程基础运行正常”“API 版本 0.1.0”；浏览器控制台无错误。
- 局域网 H5 回归：未设置 `TARO_APP_API_BASE_URL` 时访问 `http://192.168.0.140:10086/#/pages/home/index`，浏览器实际发出 `GET http://192.168.0.140:3000/api/v1/health` 并收到 200；模拟 503 后点击“重新连接”会发起第二次请求并恢复成功状态。
- 微信开发者工具回归：普通 `pnpm dev:weapp` 产物注入 `http://192.168.0.140:3000`，项目配置关闭本地域名校验；模拟器首页实际显示“服务已连接”“工程基础运行正常”“API 版本 0.1.0”。
- TypeScript 配置回归：API、客户端、contracts 及 API build 四份配置均可展开；contracts build、客户端/API typecheck 和 Nest API build 全部通过。

### M2 登录与宝宝档案

- 新增用户、平台身份、刷新会话、宝宝、宝宝成员和持久幂等模型及前进迁移。
- 完成本地模拟登录、微信 `code2session` 适配器、短期访问 JWT、刷新轮换/重放家族撤销、退出和当前用户接口；服务端每次请求重新确认用户状态。
- 完成宝宝列表、创建、详情和管理员更新；宝宝与创建者 admin 成员在 Serializable 事务内原子写入，创建支持持久幂等，更新支持乐观版本。
- 完成登录、隐私确认、会话恢复、单飞刷新、失效回登录、宝宝创建/编辑/管理、多宝宝选择与首页空状态；刷新和恢复竞态不会覆盖新登录。
- 生成包含 16 个 schema 的 OpenAPI；认证和宝宝请求体、路径参数、`Idempotency-Key`、成功与错误响应均有契约回归测试。
- `pnpm verify`：通过；contracts 3、client 25、API 32，共 60 项测试，NestJS、H5 和微信小程序构建全部成功。
- `pnpm verify:m2:api`：通过；真实 PostgreSQL/API 覆盖身份复用、刷新轮换与重放、退出、宝宝幂等、版本冲突和 outsider 隔离。
- 数据库：M1/M2 两条迁移已应用；宝宝缺少有效 admin 和未完成幂等响应的检查结果均为 0。
- Playwright H5：通过登录、首个宝宝、首页空状态、第二宝宝、切换与恢复、退出；服务端停用合成用户后，旧会话重新打开受保护页直接返回登录且不显示宝宝数据。
- 微信开发者工具：M2 登录页、隐私确认、平台适配调用和显式本地 API 配置产物已验证；真实 `code2session` 端到端因正式 AppID/secret 与合法域名未配置，保留为预发布/真机外部验收条件。

### M3 成长记录、媒体与时间轴

- 新增 `media`、`records`、`measurement_records`、`record_media` 模型和 `20260717010000_m3_records_media` 前进迁移；迁移已在 M2 数据库和空数据库连续应用通过。
- 完成私有媒体上传凭证、隔离临时对象、服务端图片真实解码校验、完成确认、短期访问地址及未关联媒体清理；ready 对象不能被旧上传地址覆盖。
- 完成图文、测量、里程碑三类记录的创建、详情、编辑、媒体重排和软删除；事务、持久幂等、乐观版本及资源级实时授权均已覆盖。
- 完成混合时间轴、类型筛选、稳定双字段游标分页，以及首页最近记录；新增、编辑、删除和宝宝切换后客户端数据会刷新或隔离。
- 完成三类客户端表单、选图压缩、私有上传进度、排序、失败保留与重试、重复提交锁、详情和删除确认；H5 使用安全原生 toast，微信端仍通过平台适配调用 Taro API。
- `pnpm verify`：contracts 6、client 31、API 69，共 106 项测试通过；lint、类型检查、NestJS、H5 和微信小程序生产构建通过。
- `pnpm openapi:generate` 与 `pnpm verify:m3:api` 通过；真实 PostgreSQL/MinIO 覆盖私有桶、签名 PUT/GET、图片解码、不可覆盖 ready 对象、三类记录、幂等冲突、分页筛选、版本冲突、软删除、outsider 和跨宝宝隔离。
- `pnpm media:cleanup` 在真实 PostgreSQL/MinIO 上运行通过；无误删已关联媒体。
- Playwright H5 完成三类创建、首页即时刷新、时间轴筛选、详情、编辑、删除确认和删除后刷新闭环。
- 微信开发者工具重新编译 M3 生产产物后 Errors 为 0，记录页面均进入产物与 `app.json`；项目已配置 AppID `wx433aecb90d44e9fe`。

## 3. 已知限制与环境说明

- 本机已有服务占用默认 `5432`、`9000` 和 `9001`，本次 Compose 验证使用 `55432`、`19000` 和 `19001`；端口覆盖能力工作正常，项目默认值未改变。
- H5 生产构建成功，但 webpack 提示当前入口约 312 KiB，超过其 244 KiB 建议阈值；M1 页面很少，暂不为该非阻塞警告引入额外拆包复杂度。
- Taro 4.1.5 watch 模式关闭可选 dependency prebundle，以规避其与当前 `enhanced-resolve` 的兼容问题；只影响首次开发编译速度，不影响产物。
- 微信小程序已在微信开发者工具模拟器完成 health 链路验证；尚未在 iOS/Android 真机运行，正式 AppID、HTTPS 合法域名和真机验证属于后续里程碑/发布验收。
- H5 生产入口约 316 KiB，仍高于 webpack 244 KiB 建议阈值；不阻塞 M2，M7 做包体与性能收口。
- Taro H5 开发态在新记录插入列表时偶发 Stencil `insertBefore` 控制台错误，功能闭环正常且微信小程序编译无错误；作为 M7 框架兼容性风险跟踪。
- AUTH-007 的邀请 token 跨登录保留属于 M5 邀请流程，未虚假计入 M2；M2 已提供会话恢复所需安全基础。
- 客户端全局状态当前以轻量 `useSyncExternalStore` store 实现，而早期架构文档写为 Zustand；功能与隔离测试已覆盖，M3 开始前应统一文档或迁移方案，避免继续扩大差异。
- 宝宝删除/账号注销、微信 AppSecret、HTTPS 合法域名、云部署、真实双账号与真机流程按后续里程碑处理；AppSecret 不进入仓库或日志。

## 4. 当前执行工作

M3 已完成并具备 M4/M5 开工条件。用户已授权继续整个 MVP；下一步并行实施 M4 成长数据和 M5 家庭协作。

## 5. 里程碑状态

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| M0 文档与方案基线 | Complete | 第一版开发文档已齐备 |
| M1 工程基础 | Complete | 本地工程、基础设施、CI 和 health 纵向链路已验证 |
| M2 登录与宝宝档案 | Complete | 本地 API、H5 与适用微信开发者工具验收完成；正式平台凭证留待预发布 |
| M3 成长记录与时间轴 | Complete | 私有媒体、三类记录、时间轴、真实 API 与 H5/微信开发者工具适用验收通过 |
| M4 成长数据 | Ready | M3 测量记录依赖已满足 |
| M5 家庭协作 | Ready | M2/M3 身份、成员和记录授权依赖已满足，可与 M4 并行 |
| M6 数据导出 | Pending | 依赖 M3/M5 |
| M7 稳定性与发布 | Pending | 依赖全部 MVP 功能 |

## 6. Agent 更新要求

完成或部分完成开发工作后，Lead Agent 必须在本文件记录：

- 修改范围和用户可见结果。
- 实际执行的验证命令及结果。
- 数据库迁移和 API 契约变化。
- 未完成项、已知限制和真实阻塞。
- 下一里程碑是否具备开工条件。

只记录事实，不使用“应该可以”“理论上通过”等未经验证的表述。
