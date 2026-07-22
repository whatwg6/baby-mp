# 宝宝成长记文档

“宝宝成长记”是一款以微信小程序为首发平台、兼顾其他小程序平台和 H5 的家庭成长记录产品。

## 文档目录

### 交付管理

- [当前开发里程碑](./delivery/current-milestone.md)
- [实现状态](./delivery/implementation-status.md)
- [开发计划](./delivery/development-plan.md)
- [开发交接说明](./delivery/developer-handoff.md)
- [多 Agent 开发分工](./delivery/agent-workstreams.md)

### 产品设计

- [产品需求文档（MVP）](./product/product-requirements.md)
- [信息架构与核心流程](./product/information-architecture.md)
- [页面交互规格](./product/ui-specification.md)

### 系统架构

- [技术架构](./architecture/technical-architecture.md)
- [数据模型](./architecture/data-model.md)
- [API 契约](./architecture/api-specification.md)
- [架构决策记录（ADR）](./architecture/adr/README.md)

### 质量保障

- [测试计划](./quality/test-plan.md)

### 运维发布

- [环境矩阵](./operations/environment-matrix.md)
- [运维运行手册](./operations/operations-runbook.md)
- [监控与告警基线](./operations/monitoring-alerting.md)
- [发布、迁移与回滚手册](./operations/release-runbook.md)
- [M7 发布检查清单](./operations/release-checklist.md)

## 当前阶段

项目已完成 MVP 开发前的第一版文档基线，可以交由开发 agent 初始化工程和实现首条业务链路。文档仍会随实现同步演进。后续上线前还需补充：

1. 可视化高保真设计与最终视觉规范
2. 由服务端实现生成的 OpenAPI 3 文件
3. 隐私政策、用户协议和数据保留政策正文
4. 部署手册、运维手册和发布检查清单

## 与开发 Agent 的使用方式

用户不需要手工指定文档、里程碑或子 Agent 分工。根目录 `AGENTS.md` 约定了对话式项目控制：

- 说“项目现在的状态”：Agent 检查实际仓库并汇报进度、风险和一个明确的下一步，不开始修改。
- 接着说“你去做吧”：Agent 自动执行刚才建议的下一步，自行规划、并行分工、集成和验证。
- 说“继续”：Agent 继续未完成里程碑；当前里程碑完成时，进入已经建议的下一里程碑。
- 说“先别做，只看看”：Agent 保持只读。

开发 Agent 完成工作后必须更新 `delivery/implementation-status.md`，因此新的任务也能恢复项目上下文。

## 文档约定

- 所有文档以 MVP 范围为基准，新增范围应先更新产品需求文档。
- 文档中的“必须”属于 MVP 验收要求，“建议”可在实现阶段按成本调整。
- 尚未确定的产品或技术选择统一标记为“待确认”，不得静默假设为最终决定。
- 数据库字段使用 `snake_case`，TypeScript 属性和接口参数使用 `camelCase`。
- 本地开发不依赖具体云服务商；开发环境使用 PostgreSQL、MinIO 和模拟登录。
- 开发交接时优先阅读 `delivery/developer-handoff.md`，再按其中的顺序阅读其他文档。
- 开发 Agent 会自动读取根目录 `AGENTS.md`；用户只需询问状态并批准下一步，不需要手工编排子任务。
