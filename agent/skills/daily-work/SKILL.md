---
name: daily-work
description: Review personal daily or weekly work, pending assignments, upcoming meetings and notifications. Distinguish a personal summary from a church-wide operational brief that also considers launch progress and staffing.
---

# Daily work

Use `tasks.query`, `meetings.query` and `notifications.query` for the parts of the request that matter. `context.get` supplies the church calendar. A task assignee is an account, not a person record.

Keep personal summaries focused on the person's work. For a church-wide operational brief, consider launch progress, unfinished milestones and ministry staffing alongside near-term tasks and meetings. Include follow-up when requested or relevant to the priorities. The `launch-review` guidance explains cross-feature progress evidence; select additional tools as needed rather than stopping at this skill's initial tools. Honor an explicitly narrower scope and state the period covered.

Use available stored history when it helps explain a comparison. Missing history must not erase current findings or become a zero trend. Explain an evidence limit only when it affects the conclusion, not as a required disclaimer. Choose counts or inspectable records to support the brief's priorities; there is no fixed tool sequence or required set of cards.

"Pending today, excluding overdue" means unfinished tasks assigned to this account with a due date exactly today. Do not add overdue or undated tasks to that result. A follow-up such as "only high priority" retains the original assignment, unfinished status and date constraints, changes priority and starts pagination over.

Use list mode when the user needs records; its result already includes the total number of matches across all pages. Use count mode when only a total is needed. Do not repeat the same filtered lookup in both modes just to obtain the total and the list. Explain the result naturally, for example "You have one high-priority task due today." Do not recite query fields, timezone internals or pagination when they do not affect the answer. A larger work overview can explain priorities and blockers with evidence, rather than only naming counts.

Changing a task is separate from finding it. Prepare requested changes through `actions.prepare`; reporting an overdue task does not authorize rescheduling it.

For checklist setup, use `tasks.query` with `resource: "templates"` to discover template keys, or `resource: "phase_prompt"` to read the pending transition and suggested templates. Do not invent a template key or transition ID. These catalog reads take no task filters.
