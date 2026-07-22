# M7 发布检查清单

> [文档索引](../README.md) · 分类：运维发布

每次发布复制一份到受控发布记录系统，填写版本、commit、环境、执行人、复核人、时间和证据链接。仓库中的空框不是通过证据。

## 候选版本

- [ ] 范围仅含批准的 MVP；版本说明与 migration 列表完成
- [ ] `TARO_APP_API_BASE_URL=https://<release-api-origin> pnpm verify`、OpenAPI 生成及里程碑 API 验证通过；微信包体预算统一使用 `WEAPP_BUNDLE_BUDGET_BYTES`（旧 `WEAPP_ARTIFACT_BUDGET_BYTES` 仅兼容迁移，不得配置冲突值）
- [ ] P0 全部通过，P1 核心用例通过率 100%，无未关闭 S0/S1
- [ ] 所有宝宝域接口权限矩阵与多宝宝隔离通过
- [ ] 弱网、超时、重复点击、上传中断、会话过期通过
- [ ] 生产依赖扫描无已知漏洞；secret 扫描无有效泄漏
- [ ] 日志抽查无 token、平台密钥、邀请 token、宝宝姓名/正文、对象 key、签名 URL

## 数据与基础设施

- [ ] staging / production 数据库、桶、secret 和部署身份独立
- [ ] bucket 禁止匿名 list/read，静态加密开启
- [ ] bucket versioning 未启用；`exports/` 7 天、noncurrent 1 天和 multipart 1 天规则已读取验证
- [ ] 生命周期真实删除已观察，或明确记录仍待 7 天观察（未观察不得标通过）
- [ ] 发布前加密备份及 checksum 成功
- [ ] 隔离恢复演练通过，媒体引用抽样 `HeadObject` 成功
- [ ] migration 前进演练、失败恢复路径和应用回滚演练通过

## 可观测性

- [ ] health、外部 HTTPS 探针、worker 和 backup freshness 检查已配置
- [ ] API P95/5xx、登录、上传、导出、DB、S3、证书和容量看板可见
- [ ] Critical/Warning 测试告警送达真实渠道并获确认
- [ ] 告警和日志字段经过敏感信息抽查
- [ ] 值班、升级、事故和回滚负责人明确

## 微信与合规

- [ ] 正式 AppID 为 `wx433aecb90d44e9fe`，AppSecret 仅在 secret store
- [ ] request/upload/download HTTPS 合法域名与证书有效
- [ ] 主体、服务类目、隐私类目由所有者确认
- [ ] 隐私保护指引、隐私政策、用户协议与实际采集/SDK 一致
- [ ] 数据处理、导出和删除申请路径可达
- [ ] 数据权利申请受控状态推进演练通过，终态审计与 active key 释放正确
- [ ] 微信开发者工具、iOS 真机、Android 真机核心链路通过
- [ ] 目标家庭体验版验收完成，证据含设备、基础库、版本、时间和结果

## 放量与观察

- [ ] production 配置检查通过：mock auth 关闭、CORS 精确、无示例 secret/local 地址
- [ ] 迁移、API、worker 按顺序部署，烟测通过
- [ ] 30 分钟观察无 Critical 指标或新 S0/S1
- [ ] 审核材料和版本说明已复核
- [ ] 回滚版本、恢复点、操作者与决策人仍在线可用
