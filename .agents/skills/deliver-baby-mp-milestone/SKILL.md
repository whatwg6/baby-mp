---
name: deliver-baby-mp-milestone
description: Execute an explicitly approved Baby MP delivery milestone or a previously recommended milestone step as the lead development agent. Use when the user clearly asks to start, resume, continue, or complete project milestone work, including approval of a recommendation that was explicitly about the delivery plan. Do not use for isolated bug fixes, local refactors, code review, documentation cleanup, or approval of a non-milestone task.
---

# Deliver a Baby MP Milestone

## Resolve the scope

Use the most recently approved milestone recommendation. If none exists, resume an `In Progress` milestone; otherwise use the `Ready` milestone. Do not advance beyond a completed milestone unless the user's request authorizes continued project development.

Before implementation, read these files in order:

1. `docs/delivery/current-milestone.md`
2. `docs/delivery/implementation-status.md`
3. `docs/delivery/developer-handoff.md`
4. `docs/delivery/agent-workstreams.md`

Then read the task-specific product, architecture, quality, and operations documents identified by those files. Inspect the implementation and working tree before changing files.

## Execute the milestone

1. Create a concrete plan tied to the active milestone acceptance criteria.
2. Delegate bounded, non-overlapping work when parallelism is useful. Keep one owner for root configuration, lockfiles, Prisma schema and migration order, shared contract exports, global client routing, Docker configuration, and release execution.
3. Implement only the approved milestone scope. Continue independent work when one subtask is blocked by a document conflict; stop the affected subtask and document the conflict.
4. Integrate all work, review the resulting diff, and resolve shared-contract or migration ordering issues.
5. Run the commands required by `docs/delivery/current-milestone.md` and verify every applicable acceptance item with evidence.

Sub-agent completion is not milestone completion. The lead agent owns integration and final verification.

## Record delivery state

Update `docs/delivery/implementation-status.md` only with facts established by the work: completed scope, verification evidence, known limitations, and next-milestone readiness. Update `docs/delivery/current-milestone.md` when its represented scope, evidence, blockers, or status changed.

Mark a milestone complete only after all acceptance criteria are satisfied with current evidence. Do not substitute old artifacts or external assumptions for missing evidence, and do not silently advance to the next milestone.

Report the achieved outcome, verification results, remaining risks or external blockers, and one recommended next step.
