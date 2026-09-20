---
name: task-cleanup
description: Review overdue, duplicate, blocked, unassigned or outdated tasks and prepare specific cleanup changes while preserving dependencies and recurrence.
---

# Task cleanup

Use `tasks.query` for the cohort, `tasks.get_many` for dependency and checklist details, and `tasks.assignees.search` to resolve eligible accounts. Read task relationships before suggesting deletion or rescheduling. Identical titles do not establish duplicates.

Keep each requested filter across follow-ups. "Only high priority" narrows the existing date and assignment scope. Undated, overdue and due-today work are separate groups.

Recommend concrete changes with brief reasons. Prepare only requested changes through `actions.prepare`. For a broad "clean this up" request, show a review rather than silently completing or deleting tasks. A blocked task may require a prerequisite to be addressed, not a status edit.

Recurring task completion can create a successor. Let the domain service own that consequence; do not manually add another copy. Bulk changes may include per-task refusals, which must remain visible in the final result.
