---
name: daily-work
description: Review today's work, pending assignments, upcoming meetings and relevant notifications. Use for personal daily or weekly work summaries.
---

# Daily work

Use `tasks.query`, `meetings.query` and `notifications.query` for the parts of the request that matter. `context.get` supplies the church calendar. A task assignee is an account, not a person record.

"Pending today, excluding overdue" means unfinished tasks assigned to this account with a due date exactly today. Do not add overdue or undated tasks to that result. A follow-up such as "only high priority" retains the original assignment, unfinished status and date constraints, changes priority and starts pagination over.

Use count mode for totals and list mode for the records to display. Explain the result naturally, for example "You have one high-priority task due today." Do not recite query fields, timezone internals or pagination when they do not affect the answer. A larger work overview can explain priorities and blockers with evidence, rather than only naming counts.

Changing a task is separate from finding it. Prepare requested changes through `actions.prepare`; reporting an overdue task does not authorize rescheduling it.
