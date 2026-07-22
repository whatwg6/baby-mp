# 实现状态

> [文档索引](../README.md) · 分类：交付管理

| 项目 | 内容 |
| --- | --- |
| 当前状态 | M0–M6 Complete；M7 仓库实现与本地验收完成，外部发布工作待执行 |
| 当前里程碑 | M7：稳定性、安全与发布（In Progress） |
| 当前阻塞 | 正式凭据/域名、云资源、监控渠道、运营信息、体验版账号与真机均未提供 |
| 更新日期 | 2026-07-22 |

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
- M1–M7 共 7 条只前进 Prisma migration；OpenAPI、共享契约、客户端和服务端保持同步。
- H5 和微信生产构建要求显式 HTTPS API origin；微信 AppID 固定为 `wx433aecb90d44e9fe`。
- mock login 使用编译期 alias 分离；E2E/release Webpack 缓存键隔离，正式产物同时检查 H5 和微信包。
- H5 toast、下载宿主和导航时序稳定；记录保存按钮保持 DOM 文本稳定，消除已知 Stencil `insertBefore` 错误。
- H5 图片压缩临时 URL 不可读时安全回退原始本地 Blob，继续执行 20 MiB 上限、尺寸校验、私有预签名上传和失败重试。
- Dockerfile、只读 API/worker runtime Compose、CI、Security workflow、备份/恢复、对象存储、监控、发布和回滚脚本/手册齐备。
- `e2e/output/` 与 `.playwright-cli/` 同时从 Git 和 Docker context 排除；CI 失败附件路径已指向真实 Playwright 输出目录。
- 文档已整理到 product、architecture、delivery、quality、operations 五类目录，索引和内部链接已更新。

## 3. 最新自动化与真实验收

### 全量验证

`TARO_APP_API_BASE_URL=https://api.example.invalid pnpm verify`：通过。

| 范围 | 结果 |
| --- | --- |
| contracts | 9 tests passed |
| client | 67 tests passed |
| API | 161 tests passed |
| 合计 | 237 tests passed |
| 其他 | lint、全部 typecheck、contracts/API build、production H5、production 微信构建通过 |

### 数据库、API 与对象存储

- 全新 PostgreSQL 数据库按顺序应用 M1–M7 全部 7 条 migration：通过。
- `scripts/verify-ci-integration.sh`：M2–M7 真实 API/MinIO 全部通过。
- M6 真实导出同时验证：
  - `includeMedia=true` 的 JSON/CSV/图片内容和归属。
  - `includeMedia=false` 无照片 entry、仍有安全媒体清单、不泄露 bucket/object key/签名 URL。
  - 通用媒体接口不可访问导出归档，下载审计保持低敏，过期对象清理生效。
- M7 真实隐私链路同时验证：
  - 数据权利 `pending → processing → completed/rejected` 受控 CLI 流转。
  - active key、`resolvedAt`、取消冲突和低敏审计一致。
  - 删除宝宝原子撤销 pending 邀请、终止 active export、移除全部成员并让旧 token 立即失权。
- PostgreSQL custom-format 备份、checksum、隔离恢复、迁移表、逐表行数和 media 引用：通过。
- MinIO `exports/` 7 天生命周期、unversioned 私有桶、匿名 list/read 403：通过。

### H5 端到端与韧性

Playwright 5 项通过（11.6 秒）：

1. 登录、图文记录、时间轴、测量/成长、邀请、导出 ZIP、数据权利和退出家庭完整旅程。
2. GET 首次 503 后有界重试并恢复页面。
3. 快速重复点击保存只创建一条记录且使用同一幂等键。
4. 受保护请求与 refresh 同时 401 后清空会话/宝宝缓存并返回登录。
5. 图片预签名 PUT 连接重置后保留文字/图片草稿并显示重试入口。

### 安全、产物与镜像

- npm 官方源生产依赖审计：2 low，0 high/critical；`fast-uri` 已固定为 `3.1.4`。
- H5 raw：8,292,411 / 10,485,760 bytes。
- H5 JS gzip：2,174,019 / 2,621,440 bytes；最大 chunk 132,319 / 163,840 bytes。
- 微信包：631,921 / 2,097,152 bytes。
- H5/微信产物均不包含“以测试用户登录”、`/auth/mock-login` 或测试身份字符串。
- `docker build --tag baby-mp:pre-release .`：通过，构建上下文约 4.9 MiB。
- `pnpm openapi:generate`：通过。

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
| M7 稳定性与发布 | In Progress | 仓库实现/本地验收完成；等待外部 staging、微信和正式发布证据 |

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

## 6. 发布结论与下一步

当前可以准确声明：**仓库内 MVP 已完成并具备预发布条件**。

当前不能声明：**正式发布已完成**。

项目所有者提供外部凭据、域名、云资源、运营信息和验收账号后，发布负责人按
[当前里程碑](./current-milestone.md)、
[发布检查清单](../operations/release-checklist.md) 和
[发布运行手册](../operations/release-runbook.md) 执行剩余发布工作。全部外部证据完成后再将 M7 标记为 Complete。
