# 当前开发里程碑

| 项目 | 内容 |
| --- | --- |
| 当前里程碑 | M1：工程基础 |
| 状态 | Complete |
| 负责人模式 | 一个 Lead Agent，建立共享基线后协调前后端并行 |
| 更新日期 | 2026-07-16 |

## 1. 本阶段目标

建立可重复启动、可验证的本地工程基础，让后续业务开发可以围绕稳定的客户端、API、共享契约、数据库和对象存储进行。

本阶段完成后必须打通：

```text
Taro 客户端
→ 本地 NestJS API
→ GET /api/v1/health
→ 返回标准成功响应
```

## 2. Lead Agent 职责

Lead Agent 负责：

- 阅读根目录 `AGENTS.md` 和必读文档。
- 检查现有文件及未提交改动。
- 制定并维护实施计划。
- 决定是否使用子 Agent，并为其划定互不重叠的文件范围。
- 统一集成、解决冲突和执行验证。
- 更新实现状态和里程碑状态。

用户不负责给子 Agent 分配模块或同步上下文。

## 3. 推荐并行执行方式

M1 可以并行，但必须先由 Lead Agent 完成一个很小的共享基线。

### 3.1 步骤 A：共享基线（短暂串行）

Lead Agent 先完成：

- 根 `package.json` 和 `pnpm-workspace.yaml`。
- Node、pnpm 和 TypeScript 基础版本。
- `apps/client`、`apps/api`、`packages/contracts` 空目录或脚手架边界。
- health contract 和通用响应结构。
- 子 Agent 的文件所有权。

这一步只建立边界，不应把整个 M1 都实现完。

### 3.2 步骤 B：前后端并行

共享基线稳定后，Lead Agent 可以同时启动：

| 工作流 | 文件范围 | 交付结果 |
| --- | --- | --- |
| 前端 Agent | `apps/client/**` | Taro 页面壳、API client、health 调用及界面状态 |
| 后端 Agent | `apps/api/**` | NestJS、health endpoint、配置、日志、错误处理及 OpenAPI 基础 |
| Lead/基础设施 | 根配置、`packages/contracts/**`、Docker、CI | PostgreSQL、MinIO、共享配置和验证命令 |

前端可以根据已经固定的 health contract 开发，不必等待后端完成。后端不得修改客户端目录，前端不得自行改变 API contract。

### 3.3 步骤 C：集成（串行收口）

子 Agent 完成后，由 Lead Agent：

1. 审查并合并前后端结果。
2. 解决依赖和配置差异。
3. 启动本地 API 和客户端，执行真实 health 调用。
4. 运行全部验证命令。
5. 更新实现状态和里程碑状态。

子 Agent 各自完成不等于 M1 完成，集成验证必须由 Lead Agent 负责。

## 4. 本阶段范围

### 4.1 仓库与工具链

- 初始化 pnpm workspace。
- 项目级 pnpm registry 使用国内镜像 `https://registry.npmmirror.com/`。
- 记录并固定支持的 Node.js 和 pnpm 版本。
- 创建根级 `dev`、`build`、`lint`、`typecheck`、`test`、`verify` 命令。
- 配置共享 TypeScript、ESLint 和测试基础。
- 提供根目录项目 README 和 `.env.example`。

### 4.2 客户端骨架

- 创建 `apps/client`：Taro 4、React、TypeScript。
- 配置微信小程序和 H5 的基础构建。
- 建立 `pages`、`features`、`services`、`platform`、`stores`、`styles` 目录边界。
- 建立四个主页面的路由壳：首页、时间轴、成长、我的。
- 建立 API client 基础和标准错误映射。
- 从客户端调用本地健康检查并展示成功、加载和错误状态。

### 4.3 API 骨架

- 创建 `apps/api`：NestJS、TypeScript。
- 建立 `/api/v1/health`。
- 建立请求 ID、结构化日志、配置校验和统一错误响应。
- 建立认证守卫和宝宝成员守卫的接口/骨架，不实现完整认证业务。
- 配置 OpenAPI 生成基础。

### 4.4 共享契约

- 创建 `packages/contracts`。
- 定义标准成功响应、错误响应、错误码基础和 health contract。
- 客户端不得直接引用 Prisma 类型。

### 4.5 本地基础设施

- 使用 Docker Compose 提供 PostgreSQL。
- 使用 Docker Compose 提供 MinIO 和私有本地 bucket。
- 初始化 Prisma 配置、基础 schema 位置和迁移命令。
- 数据库和 MinIO 配置只通过环境变量提供。
- 暂不创建完整业务表；M2 按 `data-model.md` 实现用户、宝宝和成员模型。

### 4.6 质量与 CI

- 配置单元测试基础。
- 至少测试 health contract 和 API health endpoint。
- 配置 CI 执行 lint、typecheck、test 和 build。
- 提供从全新环境启动本地依赖和工程的说明。

## 5. 明确不在本阶段

- 真实微信登录和模拟登录业务。
- 用户、宝宝和家庭成员完整模型。
- 成长记录、媒体上传和时间轴。
- 成长图表。
- 家庭邀请。
- 数据导出。
- 云服务商资源、生产域名和正式部署。
- 最终品牌视觉。

如脚手架需要占位页面或接口，只能提供无业务逻辑的壳，不得提前扩展范围。

## 6. 文件所有权

本阶段由 Lead Agent 统一拥有以下共享区域：

- 根 `package.json`、workspace 和 lockfile。
- 根级 TypeScript、ESLint、测试和 CI 配置。
- `docker-compose.yml` 和 `.env.example`。
- Prisma schema 入口和初始迁移策略。
- Taro app 配置和全局路由。
- `packages/contracts` 公共出口。

前端 Agent 只修改 `apps/client/**`，后端 Agent 只修改 `apps/api/**`。所有共享文件由 Lead Agent 修改或统一合并。

## 7. 验证命令

实现 Agent 应以最终创建的实际命令为准，并保持以下用户体验：

```bash
pnpm install
docker compose up -d
pnpm dev
pnpm verify
```

至少验证：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm verify`
- Docker Compose 服务健康状态。
- 客户端到 `/api/v1/health` 的真实调用。

若环境无法执行 Docker 或微信构建，必须记录具体原因，同时完成所有可执行验证；不能用未经验证的声明代替结果。

## 8. 验收清单

- [x] 全新环境可按 README 安装依赖。
- [x] PostgreSQL 和 MinIO 可由 Docker Compose 启动。
- [x] API 可以启动并返回标准 health 响应。
- [x] Taro H5 构建成功。
- [x] 微信小程序构建成功，或记录明确的外部环境阻塞。
- [x] 客户端真实调用本地 health API。
- [x] lint、typecheck、test、build、verify 通过。
- [x] `.env.example` 不含真实密钥。
- [x] staging/production 的配置结构不会默认启用 mock auth。
- [x] 根 README 包含本地启动、验证和常见问题。
- [x] `implementation-status.md` 已更新。

## 9. 完成后的下一阶段

M2 的第一条纵向业务链路：

```text
本地模拟登录
→ 创建用户
→ 创建宝宝和 admin 成员关系
→ 进入首页空状态
→ 重启后恢复会话与当前宝宝
```

M1 完成后，Lead Agent 应报告 M2 已具备开工条件，但除非用户要求继续开发，否则不自动开始 M2。
