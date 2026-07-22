# 环境矩阵

> [文档索引](../README.md) · 分类：运维发布

本文定义 Baby MP 的环境隔离和发布配置基线。它不代表云资源已经创建；资源 ID、域名和责任人必须在发布记录中填写真实值，禁止用示例值冒充验收证据。

## 隔离矩阵

| 项目 | local | test | staging | production |
| --- | --- | --- | --- | --- |
| 用途 | 本机开发 | CI、自动化、联调 | 微信体验版与发布演练 | 正式用户 |
| 数据 | 仅虚构测试数据 | 仅虚构测试数据，允许清空 | 脱敏或虚构验收数据 | 正式数据 |
| PostgreSQL | Docker PostgreSQL | 独立临时库 | 独立实例/数据库 | 独立实例/数据库 |
| 对象存储 | MinIO 私有桶 | 独立私有桶/前缀 | 独立私有桶 | 独立私有桶 |
| 微信 AppID | 可用测试能力 | 测试能力 | 正式 AppID 的体验版 | 正式 AppID |
| 模拟登录 | 可显式开启 | 可显式开启 | 强制关闭 | 强制关闭 |
| HTTPS / 合法域名 | 非必需 | 按联调需要 | 必需并在微信后台登记 | 必需并在微信后台登记 |
| 密钥来源 | 未提交的本地 `.env` | CI secret | 密钥管理服务 | 密钥管理服务 |
| 备份 | 可选 | 可选 | 每次发布前 + 定时加密备份 | 定时加密备份 |
| 日志数据 | 禁止真实宝宝数据 | 禁止真实宝宝数据 | 生产同等脱敏规则 | 严格脱敏、审计分流 |

staging 和 production 必须使用不同的数据库、桶、微信配置、JWT 密钥、对象存储凭据和部署身份。不得以不同前缀代替 production 与 staging 的凭据隔离。

## 配置清单

API 的运行配置以 `.env.example` 和 `apps/api/src/config/environment.ts` 为准。发布平台至少注入：

- `APP_ENV`、不可变的 `APP_VERSION`、`API_HOST`、`API_PORT`、`BUSINESS_TIME_ZONE`
- `TRUST_PROXY`（默认 `false`；只填写网关真实地址/CIDR 或经审核的
  `loopback`）、`JSON_BODY_LIMIT_BYTES`
- `SWAGGER_ENABLED=false`、独立且高熵的 `INTERNAL_MONITORING_TOKEN`
- 精确的 `CORS_ORIGINS`
- `DATABASE_URL`
- 独立且高熵的 `JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`
- `MOCK_AUTH_ENABLED=false`
- `WECHAT_APP_ID=wx433aecb90d44e9fe`
- 通过密钥管理服务注入的 `WECHAT_APP_SECRET`
- `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、`S3_FORCE_PATH_STYLE`
- 登录、邀请、上传的限流窗口与阈值；多实例同时在可信网关配置共享限流
- 客户端构建时的 HTTPS `TARO_APP_API_BASE_URL`

AppSecret、数据库密码、JWT 密钥和对象存储密钥不得出现在 Git、构建日志、命令行参数、发布说明或聊天记录中。部署系统应从 secret store 注入环境变量；轮换后重新部署，并撤销旧凭据。

## 发布前必须由项目所有者提供的外部事实

以下内容无法由仓库代码替代，未取得真实证据时保持“未完成”：

- staging、production 资源标识、区域、数据驻留和加密配置
- HTTPS API、上传、下载域名及证书
- 微信后台的 request/upload/download 合法域名和业务类目
- 小程序主体、隐私保护指引及审核所需联系信息
- 监控通知渠道和当班责任人
- 备份保留期限、成本预算和恢复目标的业务批准

配置变更必须经过双人复核。发布记录只记录 secret 的版本或引用，不记录 secret 值。

production 的 `DATABASE_URL` 必须包含 `sslmode=require`、`verify-ca` 或
`verify-full`；S3 与微信 code2session 端点必须为 HTTPS。staging/production
缺少微信凭据或内部监控 token 时 API 会拒绝启动。
