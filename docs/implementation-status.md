# 实现状态

| 项目 | 内容 |
| --- | --- |
| 当前状态 | M1 工程基础完成，客户端到 API 的 health 链路已验证 |
| 当前里程碑 | M1：工程基础（Complete） |
| 当前阻塞 | 无 |
| 更新日期 | 2026-07-16 |

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
- 修复本地 H5 未配置 `TARO_APP_API_BASE_URL` 时在传输前失败的问题：开发模式会从页面主机名推导局域网 API 地址，并配套 local-only 的 loopback/RFC1918 CORS 策略；生产和微信小程序仍要求显式配置。

## 2. 实际验证

- `pnpm install`：通过，生成 `pnpm-lock.yaml`。
- `pnpm db:generate`：通过，Prisma Client 6.11.1 生成成功。
- `pnpm db:deploy`：通过，`20260716000000_m1_baseline` 已应用到本地 PostgreSQL。
- `pnpm verify`：通过；lint、三包 typecheck、19 个测试、NestJS 构建、Taro H5 构建和微信小程序构建全部成功。
- `pnpm openapi:generate`：通过。
- Docker Compose：PostgreSQL 与 MinIO 均为 healthy，`minio-init` 退出码为 0。
- API 真实请求：`GET /api/v1/health` 返回 200、request ID 和 `{ "data": { "status": "ok", "version": "0.1.0" } }`。
- Playwright H5 验收：首页显示“服务已连接”“工程基础运行正常”“API 版本 0.1.0”；浏览器控制台无错误。
- 局域网 H5 回归：未设置 `TARO_APP_API_BASE_URL` 时访问 `http://192.168.0.140:10086/#/pages/home/index`，浏览器实际发出 `GET http://192.168.0.140:3000/api/v1/health` 并收到 200；模拟 503 后点击“重新连接”会发起第二次请求并恢复成功状态。

## 3. 已知限制与环境说明

- 本机已有服务占用默认 `5432`、`9000` 和 `9001`，本次 Compose 验证使用 `55432`、`19000` 和 `19001`；端口覆盖能力工作正常，项目默认值未改变。
- H5 生产构建成功，但 webpack 提示当前入口约 312 KiB，超过其 244 KiB 建议阈值；M1 页面很少，暂不为该非阻塞警告引入额外拆包复杂度。
- Taro 4.1.5 watch 模式关闭可选 dependency prebundle，以规避其与当前 `enhanced-resolve` 的兼容问题；只影响首次开发编译速度，不影响产物。
- 微信小程序产物已构建成功，尚未在微信开发者工具或真机运行；正式 AppID 和真机验证属于后续里程碑/发布验收。
- 所有业务功能仍未开始；M1 只提供安全扩展点和工程骨架。

## 4. 当前可执行工作

M2 可以开始实施第一条业务链路：本地模拟登录、用户、宝宝、admin 成员关系、首页空状态和会话恢复。云服务商、正式微信 AppID、品牌视觉和导出格式仍不阻塞 M2 的本地开发。

## 5. 里程碑状态

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| M0 文档与方案基线 | Complete | 第一版开发文档已齐备 |
| M1 工程基础 | Complete | 本地工程、基础设施、CI 和 health 纵向链路已验证 |
| M2 登录与宝宝档案 | Ready | M1 依赖已满足，等待用户授权继续 |
| M3 成长记录与时间轴 | Pending | 依赖 M2 |
| M4 成长数据 | Pending | 依赖 M3 |
| M5 家庭协作 | Pending | 依赖 M2/M3，可与 M4 并行 |
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
