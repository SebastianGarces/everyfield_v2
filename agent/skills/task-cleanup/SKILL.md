---
name: task-cleanup
description: Review overdue, duplicate, blocked, unassigned or outdated tasks and prepare specific cleanup changes while preserving dependencies and recurrence.
---

# Task cleanup

Use `tasks.query` for the cohort, `tasks.get_many` when dependency and checklist details are needed, and `tasks.assignees.search` to resolve eligible accounts. Apply requested relationship exclusions in the initial query, such as excluding launch-linked tasks through the launchMilestone filter rather than task-title words. Do not fetch the excluded group solely to repeat that it was excluded. Read additional relationships when they affect the proposed change. Identical titles do not establish duplicates.

This skill loads `calendar.resolve` and the `tasks.bulk.reschedule` preparation schema. Resolve a relative target date and retrieve the filtered cohort together when independent, then prepare those tasks for review. A separate context lookup is not needed solely to repeat the resolved calendar information. Read every necessary page before preparing a bulk change. Load another preparation operation only when the requested change needs it.

Keep each requested filter across follow-ups. "Only high priority" narrows the existing date and assignment scope. Undated, overdue and due-today work are separate groups.

Recommend concrete changes with brief reasons. Prepare only requested changes through `actions.prepare`. For a broad "clean this up" request, show a review rather than silently completing or deleting tasks. A blocked task may require a prerequisite to be addressed, not a status edit.

Recurring task completion can create a successor. Let the domain service own that consequence; do not manually add another copy. Bulk changes may include per-task refusals, which must remain visible in the final result.
