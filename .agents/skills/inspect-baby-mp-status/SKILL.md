---
name: inspect-baby-mp-status
description: Inspect and report the verified Baby MP project delivery status without modifying the repository. Use when the user asks what is complete, what is active, what is blocked, what remains, or what the project should do next. Do not use for bug reports, code review, implementation requests, isolated fixes, or general repository questions that do not ask about delivery progress.
---

# Inspect Baby MP Status

Keep the task read-only.

1. Inspect `git status --short` and the relevant repository structure.
2. Read `docs/delivery/current-milestone.md` and `docs/delivery/implementation-status.md`.
3. Check material claims against the implementation, migrations, tests, generated artifacts, and available verification evidence. Do not treat status documents as self-validating.
4. Distinguish current evidence from historical evidence and repository-completable work from external dependencies.
5. Report:
   - completed scope;
   - active scope;
   - blockers, limitations, or stale evidence;
   - one concrete recommended next step.

Do not edit files, create implementation tasks, start milestone work, or ask the user to coordinate agents. If verification would require a mutating or expensive command, describe the missing evidence instead of running it unless the user separately authorizes that verification.
