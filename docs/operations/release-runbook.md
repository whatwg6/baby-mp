# 发布、迁移与回滚手册

> [文档索引](../README.md) · 分类：运维发布

## 发布原则

- 只发布不可变的已审查 commit/镜像，API、worker 和客户端记录同一 `APP_VERSION`。
- staging 和 production 使用独立 secret、数据库、桶与部署身份。
- production 禁止 mock auth、通配 CORS、本地地址、示例 secret 和手工改表。
- 迁移只运行已提交的 Prisma migration；禁止 `prisma db push`。
- 任何 P0/P1、安全高风险、备份/回滚不可用或微信核心链路未通过都阻断发布。

## 部署顺序

1. 冻结候选 commit，记录版本、变更范围和 migration 列表。
2. CI 通过 lint、typecheck、tests、API/客户端构建、依赖高危扫描和 secret 扫描；生成并复验绑定完整 commit、API origin、正式 AppID 和逐文件 SHA-256 的客户端 manifest。
3. 在 staging 注入配置，验证 API 配置启动保护；构建微信体验版。
4. 执行加密备份并验证 checksum。
5. 在 staging 从备份创建隔离恢复库，完成恢复和 migration 演练。
6. 对 staging 执行 `pnpm db:deploy`，部署 API，再部署 export worker；检查 health、日志和队列。
7. 运行 P0/P1、权限矩阵、多宝宝隔离、弱网/重复点击/会话过期、上传中断和导出验收。
8. 完成微信开发者工具及 iOS/Android 真机目标家庭验收，记录真实设备、版本、时间与结果。
9. 变更审批后进入 production：再次备份、迁移、API/worker 滚动发布、烟测和 30 分钟观察。
10. 提交微信审核；审核通过后按批准时间发布，持续观察关键指标。

数据库 migration 必须先与旧版本应用兼容。若不能做到 expand/contract，则安排写入维护窗口，并将明确的停机步骤和回退数据库写入本次发布计划。

## 客户端候选产物

普通 CI 使用 `https://api.example.invalid` 构建并上传名称含
`production-mode-evidence` 和完整 `${{ github.sha }}` 的 H5/微信证据。它用于证明生产模式构建、安全边界、包体和 manifest 链路，**不是可直接部署的正式产物**；PR 事件中的 SHA 还可能是 GitHub 生成的合并 commit。

正式候选必须从已批准的 main/tag commit，在受控发布环境中设置真实
`TARO_APP_API_BASE_URL`、`EXPECTED_RELEASE_API_ORIGIN`、完整 `RELEASE_COMMIT_SHA` 和不可变
`RELEASE_VERSION`，重新执行构建、`pnpm verify:artifacts`、`pnpm release:manifest` 与
`pnpm release:manifest:verify`。下载/转交后必须再次以相同元数据运行复验；任何文件被修改、缺失、多出，出现 source map/符号链接，或 commit、origin、AppID、版本不一致均拒绝发布。

Runtime Compose 对 API、export worker、media cleanup 和 migration 统一启用只读根文件系统、临时
`/tmp`、`no-new-privileges`、删除全部 Linux capabilities、256 PID 上限及 10 MiB × 3 的
`json-file` 日志轮转。CI 会对渲染后的 Compose JSON 逐服务断言，并在相同安全参数下验证 Node 入口与 Prisma migration CLI。若生产平台不是 Docker Compose，发布记录必须提供平台侧等效控制和日志驱动证据。

## 烟测

- HTTPS health、request ID、错误响应不泄露 stack/SQL/配置。
- 微信登录/刷新/退出；production 确认 mock login 404。
- 创建/切换宝宝；outsider 与跨宝宝访问返回安全错误。
- 三类记录的创建、查看、编辑、软删除；图片私有上传/访问。
- 成长查询与编辑后刷新。
- 邀请、角色实时生效、移除、最后管理员保护。
- admin 创建无照片导出，worker 完成，用户动作后取得 5 分钟内 URL；普通 media endpoint 不得访问导出。
- 观察 API 5xx、P95、DB 连接、上传/导出失败、worker backlog。

测试只能使用获准的虚构/脱敏数据，不得上传真实宝宝照片到 test。

## 应用回滚

触发条件包括：核心流程不可用、数据越权/泄漏、持续 S1、5xx/P95 超 Critical 阈值、迁移异常或错误数据写入。

1. 发布负责人宣布回滚并停止继续放量。
2. 安全事件先隔离/撤销凭据；不要为恢复服务而放开桶或权限。
3. 若数据库结构仍向后兼容，回滚 API 和 worker 到上个已知良好不可变版本。
4. 完成烟测，观察至少 30 分钟并记录指标。
5. 若数据库不兼容或数据被破坏，停止写入，按 `docs/operations/operations-runbook.md` 恢复到新空库，然后切换连接；不得在原库盲目执行 down SQL。
6. 客户端已发布且无法即时撤回时，服务端维持向后兼容；必要时使用微信版本管理的合规回退能力，并记录影响。

回滚不是“部署成功”的替代证据。发布记录需写清数据丢失窗口、受影响请求、恢复点和后续修复。

## 审核材料

上线负责人准备并核验：

- 版本说明、功能截图、测试账号/路径（不得提供生产 secret）
- 用户协议、隐私政策、微信隐私保护指引及实际采集行为映射
- 正式 AppID `wx433aecb90d44e9fe`、小程序主体和服务类目
- HTTPS request/upload/download 域名及微信后台配置
- 数据导出、数据处理/删除申请路径说明
- 体验版目标家庭验收记录和已知限制
- 监控、备份、回滚负责人及链接

云资源、域名、主体、类目、真机验收和审核结果属于外部证据，仓库文档不得预先写成“已完成”。
