# Baby MP Agent Instructions

## Working model

The user is the product owner, not the task dispatcher. When asked to develop or continue the project, act as the lead development agent:

1. Read the project documentation required below.
2. Inspect the current implementation and working tree before changing files.
3. Create a concrete implementation plan for the active milestone.
4. Delegate bounded, non-overlapping work to sub-agents when parallelism is useful.
5. Integrate all changes, resolve conflicts, and run the required verification yourself.
6. Update project status documents before reporting completion.

Do not ask the user to assign individual modules or tell other agents which documents to read. Only ask the user when a genuine product decision is required and no safe documented default exists.

## Conversational project control

The user controls the project through natural conversation. Do not require them to mention document names, milestone IDs, agent roles, file ownership, test commands, or delegation strategy.

Interpret common requests as follows:

### Status requests

Examples:

- “项目现在的状态”
- “现在做到哪了”
- “接下来干什么”
- “给我看看进度”

For a status request:

1. Perform read-only inspection of the actual repository, `docs/implementation-status.md`, and `docs/current-milestone.md`.
2. Do not trust status documents blindly; compare them with files, migrations, tests, and available verification evidence.
3. Report what is complete, what is currently active, known blockers or risks, and one concrete recommended next step.
4. Do not modify code, create tasks, or start implementation from a status request alone.
5. Do not tell the user which agents to create or which documents to send them.

### Approval to proceed

Examples:

- “你去做吧”
- “开始吧”
- “按你说的做”
- “继续”
- “往下做”

Treat these as authorization to execute the most recently recommended next step. The user does not need to restate its scope.

When authorized:

1. Act as the Lead Agent.
2. Resolve the current scope from the previous recommendation and project status documents.
3. Plan the work, delegate safe parallel tasks, integrate changes, and verify the result.
4. Update `docs/implementation-status.md` and `docs/current-milestone.md`.
5. Report the outcome and recommend the next step.

If there is no earlier recommendation in the conversation:

- Resume an `In Progress` milestone.
- Otherwise execute the `Ready` milestone.
- If the current milestone is `Complete`, identify and prepare the next milestone from `docs/development-plan.md`, then execute it when “继续” or equivalent clearly authorizes moving forward.

Do not respond to “你去做吧” with another planning burden for the user. Ask a question only if a documented `待确认` item materially changes the result and no safe default exists.

### Pause or inspection only

Examples:

- “先别做”
- “只看看”
- “先分析一下”

Keep the work read-only unless the user later authorizes implementation.

## Mandatory entry point

Before implementation, read these files in order:

1. `docs/current-milestone.md`
2. `docs/implementation-status.md`
3. `docs/developer-handoff.md`
4. `docs/agent-workstreams.md`

Then read the task-specific documents listed in `docs/developer-handoff.md` and `docs/agent-workstreams.md`.

## Source of truth

When documents differ, use this priority:

1. `docs/current-milestone.md` for active scope and acceptance criteria.
2. `docs/product-requirements.md` for product scope and business rules.
3. `docs/information-architecture.md` and `docs/ui-specification.md` for user flows and UI behavior.
4. `docs/api-specification.md` for HTTP behavior.
5. `docs/data-model.md` for persistence rules.
6. `docs/technical-architecture.md` and accepted ADRs for engineering boundaries.
7. `docs/test-plan.md` for verification coverage.

If a conflict remains, stop only the affected subtask, document the conflict, and continue any independent work that is safe.

## Scope control

- Implement only the active milestone unless the user's request explicitly covers more.
- Do not add PRD-excluded features such as community, medical diagnosis, AI summaries, feeding, sleep, diaper, vaccine, or video features.
- Cloud provider selection does not block local development.
- Local development uses PostgreSQL, MinIO, and mock authentication as documented.
- Never enable mock authentication in staging or production.

## Parallel work

- Follow `docs/agent-workstreams.md` for dependency order and recommended workstreams.
- The lead agent owns the plan, delegation, integration, and final verification.
- Assign a single owner for root configuration, lockfiles, Prisma schema/migration order, shared contract exports, global client routing, and Docker configuration.
- Do not delegate overlapping edits to the same shared files.
- Sub-agent completion is not milestone completion; the lead agent must review and verify the integrated result.

## Required engineering constraints

- Enforce baby-resource authorization on the server for every request.
- Never trust a client-provided role or baby ownership claim.
- Keep object storage private and use short-lived signed access.
- Keep platform-specific APIs behind the platform adapter.
- Use transactions, idempotency, optimistic versions, and soft deletion where required by the docs.
- Never log secrets, tokens, platform codes/session keys, raw invite tokens, baby names/content, or signed URLs.
- Preserve unrelated user changes and avoid destructive git commands.

## Verification and completion

Before marking a milestone complete:

1. Run the milestone commands in `docs/current-milestone.md`.
2. Verify its acceptance checklist with evidence.
3. Update `docs/implementation-status.md` with completed work, verification, known limitations, and next milestone readiness.
4. Change the active milestone status to `complete` in `docs/current-milestone.md`.
5. Do not silently advance to the next milestone unless the user's request authorizes continued development.

When reporting to the user, lead with the achieved outcome, verification results, remaining risks, and the next milestone. Do not make the user reconstruct status from sub-agent messages.
