---
description: Morning status — what's pending, what's in flight, and which PRs need your review.
---

Invoke the `standup` skill to produce the status board. Read-only: report, don't start work.

Pull GitHub issues grouped by `agent:*` status label, the open-PR review queue (flag `risk:high`
first), and any running build loops (TaskList / workflows). For blocked issues, include the failing
gate + what's needed to unblock. Lead with what needs me (review queue + blocked), then in-flight,
then queued.

$ARGUMENTS
