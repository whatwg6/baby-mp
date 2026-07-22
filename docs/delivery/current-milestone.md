# 当前开发里程碑

> [文档索引](../README.md) · 分类：交付管理

| 项目 | 内容 |
| --- | --- |
| 当前里程碑 | M7：稳定性、安全与发布 |
| 状态 | In Progress（仓库实现与本地验收完成，等待外部预发布/正式发布门槛） |
| 负责人模式 | Lead Agent 统一发布候选、迁移、验证证据与外部发布协调 |
| 更新日期 | 2026-07-22 |

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

仓库内目标已经完成，当前剩余目标是把发布候选接入真实预发布环境并取得不可由仓库伪造的发布证据：

```text
锁定发布候选 commit
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
- 正式 H5/微信产物门禁检查包体、AppID、`urlCheck` 和 mock-login 字符串；E2E 失败附件不进入 Git 或 Docker build context。

## 4. 最新验证证据

2026-07-22 实际执行：

- `pnpm verify`（显式注入 CI 用 HTTPS API origin）：通过。
  - contracts：9 项。
  - client：67 项。
  - API：161 项。
  - 合计 237 项；lint、全部 typecheck、API build、production H5 和 production 微信构建通过。
- 全新 PostgreSQL 数据库连续应用 M1–M7 共 7 条 migration：通过。
- `scripts/verify-ci-integration.sh`：真实 PostgreSQL/MinIO M2–M7 全部通过；包含带/不带照片导出、数据权利 CLI 状态流转、删除宝宝联动撤销邀请/导出和立即失权。
- Playwright：核心旅程 + 4 条韧性旅程，`5 passed (11.6s)`。
- PostgreSQL 备份与隔离恢复：通过；逐表行数、迁移和媒体引用一致。
- MinIO：7 天导出生命周期、未启用 versioning、匿名 list/read 403：通过。
- `pnpm verify:artifacts` 与客户端发布产物检查：通过。
  - H5 raw：8,292,410 / 10,485,760 bytes。
  - H5 JS gzip：2,202,116 / 2,621,440 bytes。
  - 最大 H5 chunk gzip：134,192 / 163,840 bytes。
  - 微信包：631,930 / 2,097,152 bytes。
- `pnpm --registry=https://registry.npmjs.org audit --prod --audit-level low`：通过；0 个已知漏洞。
- `pnpm openapi:generate`：通过。
- `docker build --tag baby-mp:pre-release .`：通过；构建上下文约 4.9 MiB。

## 5. 验收清单

- [x] PRD 的仓库内 MVP 功能已实现并通过自动化测试。
- [x] 空数据库前进迁移和真实 API/对象存储集成通过。
- [x] 弱网恢复、重复点击、上传中断和会话失效有自动化证据。
- [x] 所有高风险资源访问保持服务端实时授权和低敏日志。
- [x] 生产依赖无已知漏洞。
- [x] 本地备份恢复、私有桶和生命周期基线可执行。
- [x] H5/微信正式产物不包含 mock login，且包体在项目门限内。
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

项目所有者提供上述外部事实和账号权限后，发布负责人按
[发布检查清单](../operations/release-checklist.md) 与
[发布运行手册](../operations/release-runbook.md) 建立 staging，重新使用真实域名构建微信产物并执行真机/体验版/云端演练。完成所有未勾选项后，才可把 M7 改为 Complete。
