# P0/P1 自动化测试追踪

> 来源：[`test-plan.md`](./test-plan.md) 第 7 节。本文只记录仓库中可搜索、可复核的自动化证据，不把人工验收或待补断言记为已覆盖。

## 状态定义

- `covered`：现有自动化测试或验证脚本直接断言用例的关键行为和预期。
- `partial`：有可执行证据，但没有覆盖用例的全部条件或结果。
- `gap`：只能定位到相邻自动化证据，用例的核心断言尚未自动化。

证据格式为 `仓库相对路径::文件内字面标记`；多个证据以 `;;` 分隔。`partial` 和 `gap` 行仍指向最近的现有证据，但状态和说明明确表示它们不是完整覆盖。

## 当前汇总

| 范围 | 总数 | covered | partial | gap |
| --- | ---: | ---: | ---: | ---: |
| P0 | 44 | 44 | 0 | 0 |
| P1 | 50 | 50 | 0 | 0 |
| 合计 | 94 | 94 | 0 | 0 |

## 机器可读映射

`scripts/verify-test-traceability.mjs` 会从测试计划重新解析 P0/P1 ID，并校验下列 TSV 中的全集、唯一性、优先级、证据路径和字面标记。

```traceability-tsv
AUTH-001	P0	covered	scripts/verify-m2-api.sh::unauthenticated babies list	真实 API 断言 401 和 AUTH_REQUIRED。
AUTH-002	P0	covered	apps/client/src/services/api-client.test.ts::refreshes once after a 401 and retries with the rotated access token	客户端刷新、旋转并重放原请求。
AUTH-003	P0	covered	apps/api/test/auth.service.test.ts::rotates refresh tokens and revokes the entire family on old-token replay	服务端旧刷新令牌重放及会话族撤销。
AUTH-004	P1	covered	scripts/verify-m2-api.sh::repeated mock login	重复平台身份登录复用同一用户。
AUTH-005	P0	covered	apps/api/test/environment.test.ts::rejects mock authentication in staging and production	非本地环境拒绝 mock auth。
AUTH-006	P1	covered	scripts/verify-m2-api.sh::logged-out refresh rejection	退出后刷新令牌返回 401。
AUTH-007	P1	covered	apps/client/src/features/family/invite-context.test.ts::keeps the pending invite token retryable after login fails	登录失败后原邀请 token 仍保留且可重试，不被清除。
AUTH-008	P1	covered	apps/api/test/users.controller.test.ts::authenticates the route and derives ownership only from request context;;apps/api/test/users.controller.test.ts::counts display-name length by Unicode code point;;apps/client/src/features/auth/store.test.ts::updates the current display name while preserving the latest tokens	仅认证用户可修改自己的显示名；服务端 trim 并按 Unicode 字符执行 1–80 边界，客户端保留最新会话令牌。
BABY-001	P0	covered	apps/api/test/babies.service.consistency.test.ts::keeps baby, membership, and idempotency response uncommitted when the transaction fails	事务失败时宝宝和 admin 关系均不提交。
BABY-002	P0	covered	apps/api/test/babies.service.consistency.test.ts::creates only one baby for concurrent requests with the same idempotency key	并发同幂等键仅产生一个宝宝。
BABY-003	P1	covered	apps/client/src/features/babies/validation.test.ts::rejects empty names, future dates and out-of-range measurements	空昵称和未来日期校验。
BABY-004	P0	covered	apps/api/test/baby-member.guard.test.ts::forbids an editor from patching an admin-only baby resource	服务端实时角色校验拒绝 editor。
BABY-005	P0	covered	scripts/verify-m2-api.sh::outsider baby read	真实 API 返回不泄漏的 404。
BABY-006	P1	covered	scripts/verify-m2-api.sh::baby version conflict	真实 API 断言 VERSION_CONFLICT。
BABY-007	P1	covered	apps/client/src/features/babies/store.test.ts::publishes a baby switch before slow persistence finishes;;apps/client/src/features/babies/BabySwitcher.test.ts::is reused by all three baby-scoped main pages	store 立即发布宝宝切换，首页、时间轴和成长页复用同一切换器。
ACL-001	P0	covered	apps/api/test/m3-records.service.test.ts::rejects a viewer before creating an idempotency row or record	viewer 在任何写入前被拒绝。
ACL-002	P0	covered	apps/api/test/m3-records.service.test.ts::rejects an editor changing another member record, while admin can update without changing creator	editor 不能修改他人记录。
ACL-003	P0	covered	apps/api/test/m3-records.service.test.ts::rejects an editor changing another member record, while admin can update without changing creator	admin 可修改且保留创建者。
ACL-004	P0	covered	apps/api/test/baby-member.guard.test.ts::checks current membership on every request so removal blocks an existing access token immediately	旧 access token 仍重查实时成员关系。
ACL-005	P0	covered	scripts/verify-m5-api.sh::Cross-baby member isolation	修改 URL babyId 时返回非披露 404。
ACL-006	P0	covered	apps/api/test/m3-records.service.test.ts::rejects cross-baby, non-ready, and editor-owned-by-another media with the same 404	跨宝宝 mediaId 不能关联。
ACL-007	P0	covered	apps/api/test/m6-exports.service.test.ts::uses live membership: outsider gets a non-disclosing 404 and known editor gets 403	非 admin 无法访问导出域。
ACL-008	P0	covered	apps/api/test/m5-families.service.test.ts::protects the last admin and writes audit in the same successful role-change transaction	最后 admin 保护及稳定错误码。
REC-001	P1	covered	e2e/h5-core.spec.cjs::parent completes the H5 MVP core journey	H5 端到端创建纯文字图文记录并读取详情。
REC-002	P1	covered	apps/client/src/features/records/validation.test.ts::creates a pure-image note input without inventing text content;;e2e/h5-resilience.spec.cjs::a selected PNG creates a pure-image record and appears on the record detail	空正文 PNG 经私有上传和真实 API 创建，直接断言 content 为 null、图片关联及详情展示。
REC-003	P1	covered	apps/api/test/m3-records.service.test.ts::rejects invalid type-specific create payloads before persistence	正文和图片均空时持久化前失败。
REC-004	P1	covered	scripts/verify-m4-api.sh::height-only measurement creation	真实 API 创建仅身高测量。
REC-005	P1	covered	scripts/verify-m4-api.sh::weight-only measurement creation	真实 API 创建仅体重测量。
REC-006	P1	covered	apps/api/test/m3-records.service.test.ts::rejects invalid type-specific create payloads before persistence	测量两项均空时失败。
REC-007	P1	covered	apps/api/test/m3-records.service.test.ts::rejects invalid type-specific create payloads before persistence	里程碑无标题时失败。
REC-008	P0	covered	apps/api/test/m3-records.service.test.ts::serializes concurrent same-key creates so exactly one record is produced	Serializable 事务下并发同键仅一条记录。
REC-009	P1	covered	apps/api/test/m3-records.service.test.ts::returns VERSION_CONFLICT and does not rewrite media on stale update	旧 version 不覆盖记录或媒体关联。
REC-010	P1	covered	scripts/verify-m4-api.sh::measurement removed from timeline and growth	真实 API 删除后同时断言时间轴和身高/体重趋势不再返回该记录。
REC-011	P1	covered	scripts/verify-m3-api.sh::timeline reordered after occurredAt update	真实 API 修改 occurredAt 后断言记录移至时间轴首位。
REC-012	P1	covered	apps/api/test/m3-records.service.test.ts::preserves the submitted media order with contiguous sortOrder values	断言重排后连续 sortOrder。
REC-013	P1	covered	scripts/verify-m3-api.sh::measurement with photo association	真实 API 断言测量数值、备注、图片 ID 和 sortOrder 的完整关联。
TIME-001	P1	covered	apps/api/test/m3-records.service.test.ts::orders by immutable tuple and emits a cursor bound to baby/filter/range	断言 occurredAt/id 稳定倒序。
TIME-002	P1	covered	scripts/verify-m3-api.sh::timeline type filter	真实 API 只返回目标类型。
TIME-003	P1	covered	scripts/verify-m3-api.sh::timeline insertion caused a duplicate or missed old record	真实 API 在两页之间插入新记录，断言原数据不重复不遗漏且新记录不进旧游标。
TIME-004	P1	covered	scripts/verify-m3-api.sh::cursor remains valid after current item deletion	删除当前页记录后刷新消失，原游标仍可返回后续记录。
TIME-006	P1	covered	apps/api/test/m3-records.service.test.ts::rejects invalid limits and inverted date ranges without querying records	limit 超限在查库前校验失败。
MEDIA-001	P0	covered	e2e/h5-resilience.spec.cjs::a selected PNG creates a pure-image record and appears on the record detail	真实私有上传、complete 和记录详情闭环。
MEDIA-002	P0	covered	apps/api/test/m3-media.service.test.ts::returns UPLOAD_INCOMPLETE without mutation when the temporary object is absent	对象缺失时无状态突变。
MEDIA-003	P0	covered	apps/api/test/media.service.test.ts::maps an unsupported MIME type to a stable business error	不支持 MIME 返回稳定错误。
MEDIA-004	P1	covered	packages/contracts/test/m3-contracts.test.ts::allows only JPEG/PNG and enforces the 20 MiB server limit	20 MiB 服务端契约边界。
MEDIA-005	P0	covered	apps/api/test/m3-media.service.test.ts::uses identical non-disclosing 404s for missing, deleted, outsider, and removed-member reads without signing	outsider 无签名 URL 且不泄漏存在性。
MEDIA-006	P0	covered	scripts/verify-s3-operations.mjs::Expired signed object URL was not rejected	运维验证脚本实际等待并断言签名 URL 过期。
MEDIA-007	P1	covered	apps/api/test/m3-media.service.test.ts::selects only old unlinked candidates, marks successful deletes, and retries failures later	过期孤儿媒体选取、删除和失败重试。
MEDIA-008	P1	covered	e2e/h5-resilience.spec.cjs::an interrupted image upload preserves the draft and exposes retry	连接中断后保留草稿和重试入口。
GROW-001	P1	covered	scripts/verify-m4-api.sh::height growth query	仅返回非空身高点并稳定升序。
GROW-002	P1	covered	scripts/verify-m4-api.sh::weight growth query	仅返回非空体重点。
GROW-003	P1	covered	scripts/verify-m4-api.sh::second same-time dual measurement creation	同时刻多测量点均保留并按 ID 稳定排序。
GROW-004	P1	covered	scripts/verify-m4-api.sh::measurement update	更新后重查身高、体重序列。
GROW-005	P1	covered	scripts/verify-m4-api.sh::measurement deletion	删除后重查身高、体重序列。
GROW-007	P0	covered	apps/client/src/features/growth/request-scope.test.ts::clears cached growth series and ignores a stale response after switching baby	切换宝宝时清空趋势/历史视图，并抑制旧宝宝响应回写。
INV-001	P1	covered	apps/api/test/m5-families.service.test.ts::stores only a token hash and keeps the raw token out of idempotency/audit rows	admin 创建 editor 邀请并仅返回一次原始 token。
INV-002	P0	covered	apps/api/test/m5-families.service.test.ts::rejects editor/viewer creation before persisting an invite	非 admin 在持久化前被拒绝。
INV-003	P0	covered	scripts/verify-m5-api.sh::Concurrent invite acceptance did not produce exactly one 200 and one 409	真实并发接受只一人成功。
INV-004	P1	covered	apps/api/test/m5-families.service.test.ts::returns ALREADY_A_MEMBER without consuming a pending invite	既有成员不重复建立关系。
INV-005	P1	covered	apps/api/test/m5-families.service.test.ts::rejects %s invitations with %s	参数化用例覆盖 INVITE_EXPIRED。
INV-006	P1	covered	apps/api/test/m5-families.service.test.ts::rejects %s invitations with %s	参数化用例覆盖 INVITE_REVOKED。
INV-007	P0	covered	apps/api/test/m5-families.service.test.ts::stores only a token hash and keeps the raw token out of idempotency/audit rows	断言 hash 入库且原 token 不进幂等/审计数据。
INV-008	P0	covered	apps/api/test/m5-families.service.test.ts::previews only the safe baby/inviter summary and effective status	预览仅安全摘要。
INV-009	P1	covered	scripts/verify-m5-api.sh::Viewer real-time write denial	角色改为 viewer 后立即禁止写入。
INV-010	P0	covered	scripts/verify-m5-api.sh::Removed-member token invalidation	移除后旧 token 立即失权。
INV-011	P0	covered	apps/api/test/m5-openapi.contract.test.ts::keeps raw invite tokens in JSON bodies, never API URL parameters;;apps/api/test/request-logging.interceptor.test.ts::logs only low-sensitivity request metadata on success	token 仅在 JSON body，请求日志不记录 body/结果密文。
EXP-001	P1	covered	apps/api/test/m6-exports.service.test.ts::creates one pending job with a versioned fixed scope and low-sensitivity audit atomically	admin 创建 pending 导出与审计同事务。
EXP-002	P0	covered	apps/api/test/m6-export-worker.test.ts::materializes only the target baby and its non-deleted records in a repeatable-read snapshot	快照仅包含目标宝宝和未删除数据。
EXP-003	P1	covered	apps/api/test/m6-export-worker.test.ts::streams a complete archive without reading photo bytes when includeMedia is false	不读写照片字节仍生成完整清单。
EXP-004	P1	covered	apps/api/test/m6-exports.service.test.ts::only returns a short URL from the dedicated endpoint after writing its audit row	列表/详情无 URL，仅独立端点签发。
EXP-005	P0	covered	apps/api/test/m6-exports.service.test.ts::does not disclose export existence when an outsider requests its download URL	outsider 请求下载 URL 获得非披露 404。
EXP-006	P1	covered	scripts/verify-s3-operations.mjs::Expired signed object URL was not rejected	对象存储实际断言签名 URL 过期。
EXP-007	P1	covered	apps/api/test/m6-export-worker.test.ts::returns transient failures to pending but permanently fails the third attempt	失败重试与最终 failed 状态。
EXP-008	P0	covered	apps/api/test/m6-exports.service.test.ts::only returns a short URL from the dedicated endpoint after writing its audit row	下载签发审计不包含 URL/对象键/正文。
SEC-001	P0	covered	apps/api/test/rate-limit.guard.test.ts::covers every high-risk login, invite, and upload authorization route;;apps/api/test/rate-limit.guard.test.ts::returns 429, RATE_LIMITED, and Retry-After after the configured endpoint limit	高风险路由和超限响应直接断言 429、RATE_LIMITED 与 Retry-After。
SEC-002	P0	covered	apps/api/test/security-http.test.ts::logs a route template and stable code for 5xx without UUID or error message	日志仅规范化路由，不含 UUID。
SEC-003	P0	covered	apps/api/test/security-http.test.ts::logs a route template and stable code for 5xx without UUID or error message	5xx 响应/日志不包含异常消息。
SEC-004	P1	covered	apps/api/test/health.integration.test.ts::rejects JSON bodies above the configured limit before business handling	超限 body 返回 413 和标准错误形状。
SEC-005	P0	covered	apps/api/test/environment.test.ts::requires WeChat credentials, HTTPS dependencies, and database SSL	production 缺密钥、HTTPS 或 DB SSL 时拒绝配置。
SEC-006	P1	covered	apps/api/test/internal-access.integration.test.ts::keeps Swagger at 404 by default in staging;;apps/api/test/internal-access.integration.test.ts::requires the internal token when Swagger is explicitly enabled in staging	预发布配置下默认 404；显式开启后无/错 token 仍 404，正确 token 获得 OpenAPI。
OPS-001	P1	covered	apps/api/test/health.integration.test.ts::provides a liveness alias with restrictive API headers;;apps/api/test/health.service.test.ts::returns a generic unavailable response when a dependency fails	liveness 与依赖失败 readiness 分别断言。
OPS-002	P1	covered	apps/api/test/health.service.test.ts::reports ready only when database and private bucket are reachable	DB/私有 bucket 可达时仅返回低敏 ready。
OPS-003	P0	covered	apps/api/test/internal-access.integration.test.ts::returns 404 for absent and incorrect internal metrics tokens without reading metrics	已配置内部 token 时，无 token 和错误 token 均为 404 且不读指标。
OPS-004	P1	covered	apps/api/test/internal-access.integration.test.ts::returns only low-sensitivity aggregate metrics for the correct internal token	正确内部 token 走 HTTP 路径并仅返回低敏聚合指标。
PRIV-001	P0	covered	apps/api/test/babies.service.consistency.test.ts::soft deletes a baby and immediately revokes access and active work atomically	软删除、成员失权、邀请撤销、导出终止和审计原子执行。
PRIV-002	P0	covered	scripts/verify-m7-api.sh::Outsider baby deletion	outsider 删除返回非披露 404。
PRIV-003	P0	covered	apps/api/test/m5-families.service.test.ts::immediately denies the departed member when the same access token reads the family again	自助退出后旧 token 立即失权。
PRIV-004	P0	covered	apps/api/test/m5-families.service.test.ts::prevents the last admin from leaving but allows an admin when another admin remains	最后 admin 不能退出，关系保留。
PRIV-005	P1	covered	apps/api/test/m7-data-rights.service.test.ts::creates a baby-scoped request only after live membership verification and writes low-sensitivity audit	只记录申请，实时校验成员并写低敏审计。
PRIV-006	P0	covered	apps/api/test/m7-data-rights.service.test.ts::checks live membership before replaying an active baby-scoped request	active 申请重放仍实时重查权限。
PRIV-007	P0	covered	apps/api/test/m7-data-rights.service.test.ts::does not reveal another user request and refuses to cancel processing requests	他人申请读取/取消均不泄漏。
PRIV-008	P1	covered	apps/api/test/m7-data-rights.service.test.ts::cancels only the owner pending request, clears the active key, and audits without content	cancelled、active key、resolvedAt 和审计均断言。
PRIV-009	P1	covered	apps/api/test/m7-data-rights.service.test.ts::moves an operator-verified request to a terminal state, releases its active key, and audits;;scripts/verify-m7-api.sh::Processing data-rights request list	受控处理、终态、active key 释放及审计链路。
PRIV-010	P0	covered	apps/client/src/pages/legal/content.test.ts::does not overstate automatic erasure or undecided retention periods	法律文本明确软删除、人工处理和未定物理保留期。
```

## 明确缺口

当前 94 项 P0/P1 用例均有直接自动化证据，`partial` 和 `gap` 均为 0。

默认验证与发布门禁均应成功：`node scripts/verify-test-traceability.mjs --require-covered`。
