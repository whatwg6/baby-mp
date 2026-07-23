# Baby MP Repository Guidance

## Repository map

- This is a pnpm monorepo using Node.js 22 and pnpm 10.
- `apps/api` contains the NestJS API, Prisma schema and migrations, workers, and API tests.
- `apps/client` contains the Taro 4 React client for WeChat Mini Program and H5.
- `packages/contracts` contains shared transport contracts. Do not expose Prisma types to the client.
- `docs/README.md` indexes the product, architecture, quality, delivery, and operations documents.
- `scripts` contains repository verification, integration, release, and operations tooling.

## Understanding the repository

Before editing, inspect the working tree and read the nearest implementation and tests. Read only the documents relevant to the requested change:

- Product scope and business rules: `docs/product/product-requirements.md`.
- Page structure and behavior: `docs/product/information-architecture.md` and `docs/product/ui-specification.md`.
- HTTP behavior: `docs/architecture/api-specification.md`.
- Persistence rules: `docs/architecture/data-model.md`.
- Engineering boundaries: `docs/architecture/technical-architecture.md` and accepted ADRs.
- Verification coverage: `docs/quality/test-plan.md`.
- Delivery state and milestone acceptance: `docs/delivery/current-milestone.md` and `docs/delivery/implementation-status.md`.

When documents conflict, prefer product requirements for product behavior, API specification for HTTP behavior, data model for persistence, and accepted ADRs for engineering boundaries. Do not treat delivery-state documents as requirements for an unrelated code change.

## Product and architecture boundaries

- Keep changes within the requested scope. Do not add community, medical diagnosis, AI summaries, feeding, sleep, diaper, vaccine, or video features.
- Local development uses PostgreSQL, MinIO, and mock authentication. Cloud provider selection does not block local work.
- Never enable mock authentication in staging or production.
- Keep platform-specific APIs behind the platform adapter; client business code must not call `wx.*` directly.
- Keep server state and client caches scoped by `babyId`; isolate in-flight requests when the active baby changes.

## Security and data integrity

- Authorize every baby resource on the server from the authenticated user and current membership. Never trust a client-provided role or ownership claim.
- Resolve a resource's `babyId` on the server before authorizing detail or mutation requests.
- Keep object storage private and expose only short-lived signed access.
- Use transactions, idempotency, optimistic versions, and soft deletion where required by the product and architecture documents.
- Never log secrets, tokens, platform codes or session keys, raw invite tokens, baby names or content, or signed URLs.
- Use stable API error codes; do not expose database error text to clients.

## Change consistency

- Add forward-only migrations for data-model changes; never rewrite applied migration history.
- Keep API implementation, generated OpenAPI, shared contracts, runtime validation, and client calls consistent.
- Update product or architecture documents when their facts, contracts, or decisions change.
- Treat delivery documents as factual records. Update them only when the represented delivery state, evidence, limitation, or milestone readiness actually changes.
- Preserve unrelated user changes and avoid destructive Git commands.

## Verification

- Start with the narrowest relevant lint, typecheck, and tests for the changed area.
- Run broader verification when a change crosses packages, contracts, migrations, build configuration, security boundaries, or release behavior.
- Common root commands are `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm verify`.
- Use the milestone-specific and release verification commands documented in `package.json` and the relevant operations documents when those surfaces change.
- Report exactly which checks ran and distinguish new evidence from earlier evidence.
