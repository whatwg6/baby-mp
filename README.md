# 宝宝成长记

宝宝成长记是一个本地优先、云厂商中立的 pnpm workspace。M1 提供 Taro 4 客户端、NestJS API、共享接口契约、PostgreSQL、私有 MinIO bucket，以及统一的校验命令。

当前打通的最小链路：

```text
Taro H5 / 微信小程序
  → GET http://localhost:3000/api/v1/health
  → { "data": { "status": "ok", "version": "0.1.0" } }
```

## 环境要求

- Node.js `22.12.0`（见 `.nvmrc`）
- pnpm `10.33.4`（由根 `package.json` 固定）
- Docker Engine 与 Docker Compose

建议通过 Corepack 准备 pnpm：

```bash
corepack enable
corepack prepare pnpm@10.33.4 --activate
```

## 第一次启动

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:generate
pnpm dev
```

如果本机安装的是独立 Compose 命令，使用 `docker-compose up -d`；其余步骤不变。

`pnpm dev` 同时启动 API 与 Taro H5。打开 `http://localhost:10086`，首页会显示健康检查的加载、成功或错误重试状态。同一局域网设备也可以使用开发机地址访问，例如 `http://192.168.0.140:10086`；本地 H5 开发模式会自动使用当前页面主机名连接 `3000` 端口的 API。也可以单独启动：

```bash
pnpm dev:api
pnpm dev:client
```

微信开发者工具联调使用开发构建，不要直接使用生产构建代替：

```bash
# API 尚未运行时，先在一个终端启动它
pnpm dev:api

# 另一个终端持续生成小程序开发产物
pnpm dev:weapp
```

然后在微信开发者工具导入 `apps/client/dist/weapp`。开发构建未显式设置 `TARO_APP_API_BASE_URL` 时，会优先从 `en0`、`en1`、`wlan0`、`eth0` 自动选择 RFC1918 局域网 IPv4 并连接 `:3000`；产物也会关闭开发者工具的合法域名校验，以允许本地 HTTP 联调。若机器有多个网卡或 VPN 导致自动选择不正确，可显式运行：

```bash
TARO_APP_API_BASE_URL=http://<开发机局域网IP>:3000 pnpm dev:weapp
```

常用地址：

- H5：`http://localhost:10086`
- API health：`http://localhost:3000/api/v1/health`
- OpenAPI UI：`http://localhost:3000/api/docs`
- MinIO Console：`http://localhost:9001`

## 本地基础设施

Compose 会启动：

- PostgreSQL 16，默认端口 `5432`；
- MinIO，API 默认端口 `9000`、Console 默认端口 `9001`；
- 一次性 `minio-init`，创建 `baby-mp-local` bucket 并明确关闭匿名访问。

检查状态：

```bash
docker compose ps
docker compose logs minio-init
```

停止容器时保留本地数据：

```bash
docker compose down
```

不要在包含真实数据的环境执行带 `--volumes` 的清理命令。

## 数据库与 OpenAPI

M1 只建立 Prisma 入口和空基线迁移，不创建用户、宝宝或记录表；业务模型从 M2 开始按里程碑加入。

```bash
pnpm db:generate
pnpm db:migrate       # 本地创建/迭代迁移
pnpm db:deploy        # 应用已提交迁移
pnpm openapi:generate
```

## 构建与验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

根 `build` 同时构建共享契约、NestJS API、Taro H5 和微信小程序产物。CI 在全新安装后执行同一个 `pnpm verify`。

单独构建客户端目标：

```bash
pnpm --filter @baby-mp/client build:h5
pnpm --filter @baby-mp/client build:weapp
```

微信构建产物生成到 `apps/client/dist/weapp`。`pnpm dev:weapp` 用于本地联调；`build:weapp` 是生产模式构建，仍要求显式提供正式 API 地址。没有正式 AppID 时使用测试号或开发者工具的本地调试能力。

## 环境与安全

- `.env.example` 只包含本地示例值，不应复制到 staging 或 production。
- `MOCK_AUTH_ENABLED` 默认是 `false`。M1 不实现模拟登录；后续即使实现，staging/production 配置为 `true` 时 API 也必须拒绝启动。
- 对象存储 bucket 保持私有；业务层后续只通过短时签名地址访问对象。
- 客户端 API 地址优先由 `TARO_APP_API_BASE_URL` 在构建时注入。该值为空时，H5 开发模式使用当前页面主机名，小程序开发模式使用开发机的私网 IPv4，二者均连接 `:3000`。生产构建始终要求显式配置。
- `APP_ENV=local` 时 API 除显式 `CORS_ORIGINS` 外，还接受 loopback 与 RFC1918 局域网 H5 来源；staging/production 始终只接受显式来源，不允许通配 CORS。
- 日志只记录请求元数据和 request ID，不记录令牌、请求体、宝宝内容或签名 URL。

## 常见问题

- `docker: unknown command: docker compose`：安装 Compose 插件，或使用独立的 `docker-compose` 命令。
- `5432`、`9000`、`9001` 被占用：在 `.env` 中覆盖 `POSTGRES_PORT`、`MINIO_API_PORT`、`MINIO_CONSOLE_PORT`，并同步调整 API 连接配置。
- H5 显示 health 错误：确认 API 已启动；若显式设置了 `TARO_APP_API_BASE_URL`，确认其端口与 `API_PORT` 一致，并检查浏览器网络面板中的 request ID。局域网访问还需确认开发机防火墙允许 `10086` 和 `3000` 端口。
- 小程序显示连接错误：确认使用 `pnpm dev:weapp` 而不是空配置的生产构建，并重新编译/重新打开 `apps/client/dist/weapp`。真机必须和开发机处于同一局域网且能够访问开发机 `3000` 端口；正式发布必须改用已登记的 HTTPS API 域名。
- 修改共享契约后开发进程未更新：重新运行 `pnpm dev`，根命令会先构建 `@baby-mp/contracts`。

产品范围、工程约束和当前验收条件见 `docs/current-milestone.md`。
