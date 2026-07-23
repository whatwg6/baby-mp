# 实现状态

> [文档索引](../README.md) · 分类：交付管理

| 项目 | 内容 |
| --- | --- |
| 当前状态 | M0–M6 Complete；M7 代码收口，当前候选产物重建与外部发布工作待执行 |
| 当前里程碑 | M7：稳定性、安全与发布（In Progress） |
| 当前阻塞 | Linux/CI 候选产物尚未重建；正式凭据/域名、云资源、监控渠道、运营信息、体验版账号与真机均未提供 |
| 更新日期 | 2026-07-23 |

## 1. 已完成的产品能力

- 微信平台适配登录、本地/测试 mock 登录隔离、访问/刷新会话轮换与退出。
- 宝宝档案创建、编辑、切换、头像私有媒体、管理员实时授权和乐观版本。
- 图文、测量、里程碑三类记录，私有图片上传、失败重试、详情、编辑、软删除和稳定游标时间轴。
- 身高/体重趋势、历史列表、500 点抽样和非医疗说明。
- 家庭邀请创建/预览/接受/撤销、登录后继续、角色管理、移除成员、退出家庭和最后管理员保护。
- 管理员异步数据导出、流式 ZIP、JSON/CSV、可选照片、私有归档、短签名下载、限流、幂等、重试和清理。
- 隐私政策、用户协议、数据访问/更正/账号注销申请、申请取消/受控处理、宝宝软删除和立即失权。
- API liveness/readiness/内部低敏 metrics、安全头、请求体上限、规范化日志、限流和生产环境配置拒绝策略。

## 2. 工程与发布能力

- pnpm workspace、Taro 4 + React + TypeScript、NestJS、Prisma/PostgreSQL、S3/MinIO 和共享 contracts。
- M1–M7 共 9 条只前进 Prisma migration；OpenAPI、共享契约、客户端和服务端保持同步。
- H5 和微信生产构建要求显式 HTTPS API origin；微信 AppID 固定为 `wx433aecb90d44e9fe`。
- mock login 使用编译期 alias 分离；E2E/release Webpack 缓存键隔离，正式产物同时检查 H5 和微信包。
- H5 toast、下载宿主和导航时序稳定；记录保存按钮保持 DOM 文本稳定，消除已知 Stencil `insertBefore` 错误。
- H5 图片压缩临时 URL 不可读时安全回退原始本地 Blob，继续执行 20 MiB 上限、尺寸校验、私有预签名上传和失败重试。
- Dockerfile、只读 API/worker runtime Compose、CI、Security workflow、备份/恢复、对象存储、监控、发布和回滚脚本/手册齐备。
- `e2e/output/` 与 `.playwright-cli/` 同时从 Git 和 Docker context 排除；CI 失败附件路径已指向真实 Playwright 输出目录。
- H5 E2E 固定输出到 `dist/h5-e2e`，不再覆盖 production `dist/h5`；正式产物门禁同时校验包体、mock login、AppID、微信 `urlCheck` 和精确 API origin。
- production-mode H5/微信证据使用 manifest 绑定完整 commit、版本、精确 API origin、正式 AppID 和逐文件 SHA-256；生成后的独立复验会拒绝篡改、缺失、多出、source map、符号链接及元数据失配。
- Runtime Compose 的四个服务统一使用只读根文件系统、临时 `/tmp`、`no-new-privileges`、删除全部 capabilities、256 PID 上限和 10 MiB × 3 日志轮转；CI 校验渲染后的配置并以同等限制验证镜像入口。
- 导出 worker 使用实例专属容器心跳、连续失败抑制和可配置 hard ceiling；数据库指标返回 active/unhealthy 实例数。
- 文档已整理到 product、architecture、delivery、quality、operations 五类目录，索引和内部链接已更新。

## 3. 最新自动化与真实验收

### 当前工作树验证（2026-07-23）

| 范围 | 结果 |
| --- | --- |
| contracts | 11 tests passed |
| client | 125 tests passed |
| API | 183 tests passed |
| 合计 | **319 tests passed** |
| 其他 | lint、全仓 typecheck、API build、runtime preflight、Prisma validate、shell/Node 语法与 diff check 通过 |

- P0/P1 traceability：94/94 covered（P0=44、P1=50、partial=0、gap=0）。
- OpenAPI 重新生成无漂移，SHA-256：
  `3ff2a484fa8204ad60fda43bb33c85ec8305bc652ddebff1633d0ef51997f440`。
- API HTTP 集成测试需监听临时端口，获本地权限后 34 个文件、183 项全部通过。
- 客户端修复了数据权利深链恢复、多宝宝首页/时间轴/成长旧数据回显和时间轴分页 loading 跨 scope 残留。
- 删除宝宝会在同一事务中把 active export 置失败并解除 `resultMediaId`；真实 M7 脚本现在要求实际 ZIP 在清理后无法通过原签名 URL 读取。
- worker 长任务活性、连续失败 fail-closed、超时 watchdog、abort 停止心跳和多实例失败聚合均有定向测试。
- manifest 的逐目标非空、稳定排序、实际微信产物 AppID、source map/符号链接、篡改、缺失、多出和 commit 失配均有定向测试。

### 既有环境证据与本轮待重跑项

- 9 条 migration 此前已在全新 PostgreSQL 顺序应用通过；真实 PostgreSQL/MinIO M2–M7、
  备份隔离恢复、私有桶和生命周期基线也已通过。本轮未修改 migration，但修改了 M7 清理验证脚本，需由 CI 在真实服务上重跑。
- 上一轮 Linux Playwright 为 9/9；本轮进一步覆盖多宝宝 A 缓存后切 B，调整后的 9 项需在 Linux/CI 重跑。
- 生产依赖审计的最近证据为 0 个已知漏洞；本轮未增加依赖，Security workflow 仍需绑定当前 commit 重新执行。
- 上一轮本地包体预算通过：H5 raw 8,515,814 / 10,485,760；H5 JS gzip 2,265,940 / 2,621,440；
  最大 chunk 137,193 / 163,840；微信 631,930 / 2,097,152 bytes。
- 当前本地 H5 production 目录为空，微信目录是含 source map 的旧构建，新门禁正确拒绝；这不是当前发布产物通过证据。
  需要 Linux/CI 从当前 commit 重建 production H5/微信产物并运行 `pnpm verify:artifacts`。
- 旧本地 runtime 镜像早于本轮源码修复，不能作为当前候选；镜像构建、扫描、runtime smoke 仍需重新执行。

## 4. 里程碑状态

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| M0 文档与方案基线 | Complete | 产品、架构、质量、交付和运维文档已分类并建立索引 |
| M1 工程基础 | Complete | workspace、CI、本地基础设施、health 与双端构建完成 |
| M2 登录与宝宝档案 | Complete | 会话、平台适配、宝宝档案、幂等/版本和实时授权完成 |
| M3 成长记录与时间轴 | Complete | 私有媒体、三类记录、时间轴和失败恢复完成 |
| M4 成长数据 | Complete | 身高/体重趋势、历史列表、抽样与非医疗说明完成 |
| M5 家庭协作 | Complete | 邀请、成员角色、最后管理员和立即失权完成 |
| M6 数据导出 | Complete | 流式 ZIP、私有归档、短下载、worker、客户端闭环和真实验收完成 |
| M7 稳定性与发布 | In Progress | 代码与本地自动化收口；等待当前候选产物、CI/Security、外部 staging、微信和正式发布证据 |

## 5. 已知限制与外部发布门槛

仓库无法自行提供或伪造以下证据：

- 微信 AppSecret 注入及正式 request/upload/download HTTPS 合法域名。
- staging/production 云 PostgreSQL、S3、区域、静态加密、secret store 和部署身份。
- 云端加密备份、对象引用 `HeadObject`、第 8 天生命周期删除和 production 恢复演练。
- 真实监控采集器/看板、Critical/Warning 通知渠道、当班责任人和升级链确认。
- 运营主体、服务类目、隐私联系方式、适用地区及数据/备份/审计最终保留期限。
- 微信体验版上传、两个真实账号、邀请分享、相册/拍照、下载，以及 iOS/Android 真机验收。
- 目标家庭签字、production migration/回滚窗口和发布后 30 分钟观察。

H5 production 构建仍有 Webpack 244 KiB 建议阈值警告，但项目自己的 gzip chunk/总包门禁均通过；微信包约 0.60 MiB，未接近 2 MiB 上限。正式性能 P95 和真机触摸/安全区表现仍需 staging/真机测量。

此外，当前 commit 的 production H5/微信产物、Linux Playwright、runtime 镜像与 CI/Security
结果尚未重新生成；这些属于可执行但当前缺少运行权限/环境的候选形成步骤，不得沿用旧产物冒充。

## 6. 发布结论与下一步

当前可以准确声明：**仓库内 MVP 代码已收口，可以进入当前 commit 的 Linux/CI 候选重建**。

当前不能声明：**正式发布已完成**。

Linux/CI 先生成并验证绑定 commit 的 production-mode 证据；其中使用 `https://api.example.invalid` 的普通 CI 上传件不可直接部署。
项目所有者再提供真实 API origin、外部凭据、域名、云资源、运营信息和验收账号，发布负责人按
[当前里程碑](./current-milestone.md)、
[发布检查清单](../operations/release-checklist.md) 和
[发布运行手册](../operations/release-runbook.md) 执行剩余发布工作。全部外部证据完成后再将 M7 标记为 Complete。
