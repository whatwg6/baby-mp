# 宝宝成长记多 Agent 开发分工

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 适用范围 | MVP 多 agent 开发 |
| 推荐并发 | M1 共享基线后前后端并行；业务阶段最多 3 个开发 agent + 1 个测试/审查 agent |
| 更新日期 | 2026-07-16 |

## 1. 开始入口

所有开发 agent 首先阅读：

1. `developer-handoff.md`
2. 本文

随后按任务类型阅读：

| Agent 类型 | 必读文档 |
| --- | --- |
| 工程基础 | 全部文档，重点是 `technical-architecture.md`、`development-plan.md` |
| 服务端 | `technical-architecture.md`、`data-model.md`、`api-specification.md`、ADR |
| 客户端 | `information-architecture.md`、`ui-specification.md`、`api-specification.md` |
| 测试/审查 | `test-plan.md`、`api-specification.md`、权限相关 ADR |

PRD 用于判断范围，但不包含足够的实现细节。开发 agent 不应只读 `product-requirements.md` 就开始编码。

## 2. 总体依赖关系

```text
阶段 A：工程基础
  ├── Lead：共享基线 / contracts / Docker / CI
  ├── 前端：client 骨架与 health 调用
  └── 后端：api 骨架与 health endpoint
                         │
                         ▼
阶段 B：第一条纵向链路
  ├── 服务端：模拟登录、用户、宝宝、成员权限
  ├── 客户端：登录、创建宝宝、首页空状态
  └── 测试：认证、宝宝、越权、幂等
                         │
                         ▼
阶段 C：成长记录
  ├── 服务端：媒体、记录、时间轴
  ├── 客户端：记录表单、上传、时间轴、详情
  └── 测试：记录、媒体、分页、弱网
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
阶段 D1：成长数据              阶段 D2：家庭协作
  └── 查询与图表                  └── 邀请与权限
            └────────────┬────────────┘
                         ▼
阶段 E：数据导出
                         │
                         ▼
阶段 F：集成、真机、安全与发布
```

阶段 D1 和 D2 可以完全并行。阶段 E 依赖成长记录、媒体和家庭权限，不应提前实现完整导出。

## 3. 阶段 A：工程基础

### 并行策略

该阶段由一个 Lead Agent 负责，但不要求全部串行。Lead 先建立根 workspace、共享 contract 和文件边界，然后可同时委派前端和后端骨架。Lead 保留根配置、lockfile、contracts、Docker 和 CI 的所有权。

### 原因

以下文件高度耦合，容易产生冲突：

- 根 `package.json` 和 `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- TypeScript、ESLint 和测试配置
- `docker-compose.yml`
- Prisma 初始 schema 和迁移
- 客户端路由与 Taro 配置
- 共享 contracts 的导出结构

### 交付边界

Lead 和其前后端子 Agent 只完成 M1，不实现完整业务功能：

- 初始化 workspace、client、api、contracts。
- 配置 PostgreSQL、MinIO 和环境变量。
- 建立 CI、lint、typecheck、test、build、verify。
- 建立统一错误结构、请求 ID 和健康检查。
- 创建 Prisma 初始框架和迁移命令。
- 创建客户端页面壳、API client 和平台适配层壳。
- 提供清晰的本地启动说明。

### 退出条件

- `pnpm verify` 通过。
- 客户端和 API 可以本地启动。
- API 健康检查可从客户端访问。
- PostgreSQL 和 MinIO 可由 Docker Compose 启动。
- 此时再开始阶段 B 并行工作。

## 4. 阶段 B：第一条纵向链路

基础工程稳定后，推荐三个并行工作流。

### B1 服务端 Agent

负责：

- `users`、`platform_identities`、`refresh_sessions`。
- 本地模拟登录、访问令牌、刷新和退出。
- `babies`、`baby_members` 初始模型和迁移。
- 创建宝宝、宝宝列表、详情和更新接口。
- 认证守卫、成员权限守卫、幂等和版本冲突。
- AUTH、BABY、ACL 类 API 测试。

主要文件所有权：

- `apps/api/src/auth/**`
- `apps/api/src/users/**`
- `apps/api/src/babies/**`
- `apps/api/src/families/authorization*`
- 对应 Prisma 迁移

### B2 客户端 Agent

负责：

- 登录页和本地测试用户选择。
- 会话恢复和 token 刷新。
- 创建宝宝表单。
- 当前宝宝 store、宝宝切换基础。
- 首页宝宝信息卡和空状态。
- 页面状态、确认弹窗等基础组件的真实使用。

主要文件所有权：

- `apps/client/src/features/auth/**`
- `apps/client/src/features/babies/**`
- `apps/client/src/pages/auth/**`
- `apps/client/src/pages/babies/**`
- `apps/client/src/pages/home/**`

客户端可先基于 `api-specification.md` 使用 mock handler；真实 API 可用后移除 mock，不能在业务组件内散落假数据。

### B3 测试/审查 Agent

负责：

- 建立隔离测试数据库和 fixtures。
- 实现 AUTH、BABY、ACL 的高优先级测试。
- 审查模拟登录的生产禁用保护。
- 审查日志脱敏、事务和越权路径。
- 建立第一条 H5 端到端流程。

测试 Agent 原则上不修改业务行为；发现契约问题时提交明确反馈，由对应所有者修改。

### 阶段 B 集成顺序

1. 先合并共享 DTO 和数据库迁移。
2. 合并服务端接口。
3. 客户端切换到真实接口。
4. 合并端到端和越权测试。
5. 完成“登录 → 创建宝宝 → 首页”的联合验收。

## 5. 阶段 C：成长记录

同样采用服务端、客户端、测试三条并行线。

### C1 服务端 Agent

- `media` 上传和私有访问。
- `records`、`measurement_records`、`record_media`。
- 三类记录 CRUD。
- 时间轴游标分页和筛选。
- 媒体归属、状态、幂等和软删除。

媒体与记录都涉及 Prisma 和事务，建议由同一个服务端 Agent 负责，避免两个 agent 同时修改 schema 和创建顺序。

### C2 客户端 Agent

- 三类记录表单。
- 图片选择、预览、排序、上传和失败重试。
- 时间轴、筛选、分页、详情、编辑和删除。
- 权限可见性和弱网表单保留。

接口未完成时可使用集中式 mock adapter，但必须与 API 契约完全同形。

### C3 测试/审查 Agent

- REC、TIME、MEDIA、ACL 测试。
- 并发幂等和版本冲突。
- 跨宝宝 mediaId/recordId 越权。
- 上传中断和分页稳定性。
- 图文记录端到端流程。

## 6. 阶段 D：可完全并行的业务域

成长记录稳定后，以下两个纵向切片可以由不同 Agent 同时进行。

### D1 成长数据 Agent

- 测量趋势 API。
- 身高/体重图表和历史列表。
- GROWTH 测试。
- 小程序图表性能验证。

文件范围主要是：

- `apps/api/src/growth/**`
- `apps/client/src/features/growth/**`
- `apps/client/src/pages/growth/**`

### D2 家庭协作 Agent

- 邀请创建、预览、接受和撤销。
- 成员列表、角色修改和移除。
- 原始邀请 token 的哈希保存和日志脱敏。
- 最后一个管理员保护。
- INV、ACL 测试及双账号流程。

文件范围主要是：

- `apps/api/src/families/**`
- `apps/client/src/features/family/**`
- `apps/client/src/pages/family/**`

### 共享冲突点

D1 和 D2 不应同时自行修改：

- 全局 API 错误格式。
- 根路由配置之外的无关页面。
- `packages/contracts` 的公共导出入口。
- Prisma 迁移历史。

新增契约分别放在域内文件，最后由契约所有者合并公共出口。

## 7. 阶段 E：数据导出

导出依赖：

- 记录和媒体模型稳定。
- 家庭 admin 权限稳定。
- 对象存储读写稳定。
- 数据保留和导出格式已有决定。

适合一个纵向 Agent 独立负责 API、worker、对象存储结果、客户端状态页和 EXPORT 测试。若任务较大，可拆为“导出 worker”和“客户端页面”，但 worker Agent 保持导出格式和任务状态的所有权。

## 8. 阶段 F：集成与发布

可并行进行：

- 真机与微信平台能力验证。
- 安全和权限回归。
- 性能与包体优化。
- 隐私政策和发布材料准备。
- 备份恢复、监控和部署演练。

但生产部署、数据库迁移和正式发布必须由单一发布负责人串行执行。

## 9. 共享文件所有权

多人并行时必须为以下文件指定单一所有者：

| 共享区域 | 推荐所有者 |
| --- | --- |
| 根工程配置和 lockfile | 工程基础负责人 |
| Prisma schema 与迁移顺序 | 服务端负责人 |
| `packages/contracts` 公共出口 | 契约负责人，通常是服务端负责人 |
| Taro app 配置和全局路由 | 客户端负责人 |
| Docker Compose 与环境变量模板 | 工程基础负责人 |
| OpenAPI 生成文件 | 服务端负责人 |
| 端到端测试入口和 fixtures | 测试负责人 |
| 产品与架构文档 | 文档负责人；开发 Agent 提交差异说明 |

“单一所有者”不代表只有该人能贡献，而是所有冲突性修改由其统一合并。

## 10. 不适合并行的工作

- 多个 agent 同时初始化脚手架。
- 多个 agent 同时重写 Prisma schema 或首个迁移。
- 客户端和服务端分别发明不同 DTO。
- 在认证和权限策略未确定前同时实现所有业务模块。
- 在记录/媒体未稳定前完成导出。
- 在同一分支并发运行会重写 lockfile 的依赖安装。
- 多个 agent 分别修改同一个全局路由、错误处理或环境配置文件。

## 11. 推荐并发规模

- M1：1 个 Lead Agent；共享基线完成后可并行 1 个前端子 Agent 和 1 个后端子 Agent。
- M2/M3：2 个开发 Agent（服务端、客户端）+ 1 个测试/审查 Agent。
- M4/M5：2 个纵向业务 Agent + 1 个测试/审查 Agent。
- M6：1 个纵向 Agent + 1 个测试/审查 Agent。
- M7：可以并行验证，但保留 1 个发布负责人。

并发数增加并不一定更快。当前项目规模下，同时活跃的开发 Agent 超过 3 个会明显增加共享契约、迁移和集成冲突。

## 12. Agent 任务书模板

给每个开发 Agent 的任务至少包含：

```text
目标：本次必须交付的用户或工程结果。
范围：允许修改的目录和模块。
必读：相关 docs 文件。
契约：必须遵循的 API、数据和权限规则。
禁止：本次不得扩展的功能和共享文件。
验证：必须执行的命令与测试用例。
交付：代码、迁移、测试、OpenAPI/文档差异和已知风险。
```

不要只给出“实现宝宝模块”这类宽泛任务，否则 Agent 容易重复分析范围或修改不属于自己的基础设施。

## 13. 首轮推荐分派

当前仓库还没有业务工程时，只需要把一个目标交给 Lead Agent，由它自行完成共享基线并分派前后端：

```text
Lead Agent：按照 current-milestone.md 执行 M1。先建立 workspace、contracts
和文件所有权，再自行并行委派 Taro client 与 NestJS API；Lead 负责 PostgreSQL、
MinIO、CI、最终集成和验证。不实现成长记录、家庭邀请、图表或导出。
以 pnpm verify、客户端真实调用 /api/v1/health 成功作为交付条件。
```

M1 完成并稳定后，再同时启动 B1、B2、B3。这样既利用前后端并行，又避免根配置和共享契约发生冲突。
