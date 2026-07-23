# 当前开发里程碑

> [文档索引](../README.md) · 分类：交付管理

| 项目 | 内容 |
| --- | --- |
| 当前里程碑 | M7：稳定性、安全与发布 |
| 状态 | In Progress（仓库代码收口；等待 Linux/CI 候选产物及外部预发布/正式发布门槛） |
| 负责人模式 | Lead Agent 统一发布候选、迁移、验证证据与外部发布协调 |
| 更新日期 | 2026-07-23 |

## 1. 上一阶段结论

M6 已完成：

- 管理员导出任务、持久幂等、单活动任务和小时限流已实现。
- worker 条件领取、续租、崩溃恢复、最多 3 次重试、7 天过期和对象清理已实现。
- ZIP 同时提供规范 JSON、UTF-8 BOM/RFC 4180 CSV，并安全处理公式注入和路径。
- `includeMedia=true` 只包含目标宝宝 ready 图片；`false` 不读取或写入照片文件，但保留安全媒体清单。
- 导出归档保持私有，通用媒体接口不可读取；下载地址只由独立接口短期签发并写低敏审计。
- 客户端创建、列表、轮询、失败/过期状态和用户触发下载闭环已完成。
- 空数据库 M1–M7 连续迁移及真实 PostgreSQL/MinIO M2–M7 集成脚本已通过。

## 2. 当前阶段目标

仓库代码目标已经收口。当前先要由 Linux/CI 从同一 commit 重新生成并验证正式 H5/微信候选产物，
随后把该候选接入真实预发布环境并取得不可由仓库伪造的发布证据：

```text
锁定发布候选 commit 与 CI/Security 结果
→ Linux 重新构建正式 H5/微信产物并执行语义门禁
→ 注入正式平台/云密钥
→ 建立 staging/production 隔离资源
→ 配置 HTTPS request/upload/download 域名
→ 云备份、监控、告警与回滚演练
→ 微信体验版双账号与 iOS/Android 真机验收
→ 目标家庭验收
→ production 发布、观察与必要回滚
```

## 3. 仓库内已完成范围

### 稳定性

- 核心 H5 MVP 旅程覆盖登录、图文记录、时间轴、成长趋势、邀请、真实 ZIP 下载、数据权利和退出家庭。
- 韧性旅程覆盖 GET 短暂 503 后恢复、快速重复点击只创建一条记录、会话失效清空宝宝上下文、图片 PUT 中断后保留草稿并提供重试。
- 修复 Taro H5 压缩后临时 Blob URL 不可读导致图片无法上传的问题；压缩结果不可读时安全回退原始本地 Blob，仍执行 20 MiB 上限、尺寸校验和私有直传。
- H5 E2E 与 release 构建使用独立缓存键和编译期 mock-login 边界，测试入口不会进入 H5/微信正式产物。

### 安全与隐私

- 所有宝宝域资源由服务端实时查询成员关系；不信任客户端角色或归属声明。
- 完成删除宝宝、退出家庭、数据访问/更正/账号注销申请及受控状态流转；软删除、人工处理和物理删除证据在文案中严格区分。
- 安全头、请求体上限、低敏规范路由日志、5xx 脱敏、内部 metrics token、单实例限流和生产环境启动校验已实现。
- `fast-uri` 固定为已修复的 `3.1.4`，Webpack 升级并固定为 `5.104.1`；npm 官方源生产依赖审计为 0 个已知漏洞，Security workflow 对 low 及以上公告失败。
- 微信 AppID 统一为 `wx433aecb90d44e9fe`；AppSecret 只允许由部署 secret store 注入。

### 运维与发布

- 提供生产 Dockerfile、API/worker runtime Compose、环境矩阵、发布/回滚、监控告警、备份恢复和对象存储运行手册。
- PostgreSQL 备份脚本生成 custom-format 备份与 SHA-256；恢复脚本执行 checksum、空目标、显式确认和生产二次保护。
- 本地隔离备份恢复演练验证 schema、迁移表、逐表精确行数和 ready media 引用字段。
- 本地 MinIO 验证 7 天 `exports/` 生命周期、禁用版本保留、私有桶以及匿名列举/读取拒绝。
- 正式 H5/微信产物门禁检查包体、AppID、`urlCheck`、API origin 和 mock-login 字符串；
  E2E 使用独立 `dist/h5-e2e`，不会覆盖 `dist/h5`，失败附件不进入 Git 或 Docker build context。
- CI production-mode 证据产物生成 manifest，绑定完整 commit、版本、精确 API origin、正式 AppID 与 H5/微信全部文件 SHA-256；独立复验拒绝修改、缺失、多出、source map、符号链接或元数据失配。
- Runtime Compose 对 API、worker、cleanup 和 migration 统一启用只读根文件系统、临时 `/tmp`、`no-new-privileges`、删除全部 capabilities、PID 上限和有界日志轮转；CI 校验渲染结果并以相同限制验证镜像入口。
- 导出 worker 使用实例专属活性文件、连续失败抑制和 2 小时默认迭代 watchdog；
  多实例聚合指标不会由一个健康实例掩盖另一个失败实例。

## 4. 最新验证证据

2026-07-23 对当前工作树实际执行：

- `pnpm lint`、`pnpm typecheck`、API build：通过。
- contracts：11 项；client：125 项；API：183 项；合计 **319 项全部通过**。
- `pnpm verify:traceability`：94/94 个 P0/P1 用例 covered（P0=44、P1=50、gap=0）。
- runtime preflight：安全 staging/production 配置通过，mock auth、示例密钥、本地端点和不安全生产配置均被拒绝。
- Prisma schema validate：通过；当前 M1–M7 共 **9 条**只前进 migration。9 条 migration 此前已在全新 PostgreSQL 连续应用通过，本轮未改变迁移内容。
- `pnpm openapi:generate`：无漂移；SHA-256 为
  `3ff2a484fa8204ad60fda43bb33c85ec8305bc652ddebff1633d0ef51997f440`。
- shell/Node 语法、manifest 生成/复验篡改测试、Runtime Compose 合成结构校验、`git diff --check`：通过。
- `pnpm run dev:client` 已在本机真实监听 `127.0.0.1:10086` 并无警告编译成功；开发缓存键现在绑定 Node 版本与 lockfile，避免 pnpm 依赖路径变化后反复恢复旧缓存；旧 URL 依赖已通过仓库补丁停止调用 Node 内置 `punycode`，未使用 `NODE_OPTIONS` 隐藏提示。客户端 typecheck 与 128 项测试通过。
- 删除宝宝现在原子解除活动导出归档引用；M7 真实链路脚本会生成实际私有 ZIP，删除宝宝后执行清理并要求旧签名 URL 返回 404。
- Playwright 的上一轮 Linux 证据为 9/9；本轮补强了多宝宝缓存隔离和真实归档/超时场景，调整后的 9 项仍需在 Linux/CI 重跑。
- 上一轮本地包体预算通过（H5 raw 8,515,814；H5 JS gzip 2,265,940；最大 chunk 137,193；微信 631,930 bytes），
  但当前本地 H5 production 目录为空，微信目录是含 source map 的旧产物，新门禁会正确拒绝。当前 commit 的 production H5/微信产物必须由 Linux/CI 重新生成，旧镜像也不能作为候选证据。
- 2026-07-22 的既有环境证据仍包括：9 条 migration、真实 PostgreSQL/MinIO M2–M7、
  PostgreSQL 备份隔离恢复、MinIO 私有桶/生命周期以及生产依赖审计 0 个已知漏洞；
  本轮新增脚本和 E2E 调整需要 CI 再执行，不能用旧输出冒充当前候选。

## 5. 验收清单

- [x] PRD 的仓库内 MVP 功能已实现并通过自动化测试。
- [x] 空数据库前进迁移和真实 API/对象存储集成通过。
- [x] 弱网恢复、重复点击、上传中断和会话失效有自动化证据。
- [x] 所有高风险资源访问保持服务端实时授权和低敏日志。
- [x] 生产依赖无已知漏洞。
- [x] 本地备份恢复、私有桶和生命周期基线可执行。
- [ ] 当前 commit 的 H5/微信正式产物由 Linux/CI 重新生成，且不包含 mock login、origin 匹配、包体在项目门限内。
- [x] 用户协议、隐私政策、数据处理申请、退出家庭和删除宝宝路径可达。
- [ ] staging/production 数据库、私有对象存储、区域、静态加密和 secret store 已创建并记录。
- [ ] 正式 HTTPS request/upload/download 域名已配置并在微信后台生效。
- [ ] 云端备份恢复、对象 `HeadObject`、第 8 天生命周期删除取得真实证据。
- [ ] 生产监控看板、Critical/Warning 测试告警、责任人和升级链已验证。
- [ ] 小程序主体、类目、隐私保护指引、联系方式和最终保留期限已确认。
- [ ] 微信体验版由两个真实账号在 iOS/Android 真机完成登录、邀请、相册/拍照、分享和下载验收。
- [ ] 目标家庭验收、production migration、回滚演练和发布后 30 分钟观察完成。

## 6. 当前外部阻塞

以下事项缺少用户/平台/云环境提供的事实或权限，仓库无法自行完成：

- 微信 AppSecret 和合法域名配置权限。
- staging/production 云数据库、S3 兼容存储、加密、备份位置和部署身份。
- 真实监控通知渠道、当班责任人及告警确认。
- 运营主体、服务类目、隐私联系方式和最终数据/备份/审计保留期限。
- 微信体验版上传权限、两个真实微信账号、iOS/Android 真机和目标家庭。
- production 发布窗口、迁移/回滚决策人和发布后观察权限。

因此当前准确结论是“仓库内 MVP 完成并具备预发布条件”，不是“正式发布完成”。

## 7. 下一步

先由 Linux/CI 对当前 commit 重建 production H5/微信产物，执行 9 项 Playwright、
`pnpm verify:artifacts`、manifest 生成/复验、镜像验证和 Security workflow。普通 CI 中绑定
`https://api.example.invalid` 的上传件仅是 production-mode 证据；随后项目所有者提供真实 API origin、上述外部事实和账号权限，发布负责人按
[发布检查清单](../operations/release-checklist.md) 与
[发布运行手册](../operations/release-runbook.md) 建立 staging，重新使用真实域名构建微信产物并执行真机/体验版/云端演练。完成所有未勾选项后，才可把 M7 改为 Complete。
