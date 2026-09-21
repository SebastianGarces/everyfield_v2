---
name: launch-review
description: Answer launch timing and milestone questions, or review overall progress using relevant tasks, staffing, upcoming meetings and recorded Plant Intelligence evidence.
---

# Launch review

For a focused question about launch timing or milestones, gather the evidence needed for that question. `launch.query` status supplies the date, server-calculated days remaining and completed/open/total milestone counts; use milestone records for the requested list or detail. The returned countdown needs no separate clock lookup solely to calculate it. Do not expand into a readiness audit just because other tools are available. Read other modules when the question or a finding needs that context, not as a required checklist for every launch question.

For an overall launch progress or readiness review, gather the launch status, open milestones, relevant task blockers, open ministry roles and upcoming meetings. These independent reads can run together. `tasks.query`, `teams.query` and `meetings.query` provide operational detail; `intelligence.query` can add existing assessment evidence when useful. Code mode can combine independent reads. A launch date alone does not answer an overall progress question.

Match the explanation to the requested scope. For an overview, start with a useful narrative before any cards: the date or time remaining, progress out of the total, the most important open work, and supported implications. Select cards to support that explanation. An open-only query counts remaining milestones, not all tracked milestones. Read task assignees and due dates before suggesting missing owners or dates. Do not repeat opaque readiness scores from assessment data; explain a documented measure in ordinary language only when relevant. Do not replace the whole overview with a one-record launch-status card.

Open tasks need their own status filter. With `tasks.query`, combine `launchMilestone: true` with `status: ["not_started", "in_progress", "blocked"]` before counting or paging. With `launch.query` resource `milestone_tasks`, use the same values in `taskStatuses`. Its `completion` filter refers to the milestone, not the linked task. A completed task can belong to an unfinished milestone. Do not count every linked task as work still to do.

Choose one source for each evidence need. If a task read already supplies the linked milestone, status, owner and due date, do not fetch the same tasks again through another tool unless a needed fact is missing. For upcoming meetings, use `timing: "upcoming"` so an earlier meeting today is not included; choose the relevant date window once rather than reading an entire month and then repeating the search. Group related findings in the answer instead of repeating the same unfinished work under several headings. Supporting cards should add inspectable records, not prompt another summary of text already streamed.

For a future launch, attendance, decisions, outcome notes and "Capture the day" describe what happened on launch day. "Capture the day" is the recorded account or memories of that day, not a capture plan. Missing post-event results before launch are expected, not preparation gaps. Do not list them as missing readiness work. After launch, include recorded outcomes when useful and distinguish an unrecorded value from zero. A missing historical assessment does not erase current milestones, staffing and preparation records. Name missing evidence only where it limits the requested conclusion. Avoid diagnosing overall church health or spiritual readiness.

Include forming teams when reviewing preparation staffing. An `active`-only team search cannot establish that no ministry team or staffing evidence exists. Open roles are concrete vacancies; distinguish those from missing information, and do not call staffing the main gap without comparing it with the other recorded work.

Read further pages or counts before claiming complete staffing and milestone totals. Investigate further when a finding needs it, but do not repeat a lookup that already answered the question or audit unrelated records to finish an overview. Distinguish a milestone blocked by a prerequisite from one merely unfinished. For follow-up action requests, carry the selected evidence into `actions.prepare` rather than silently changing the launch plan.
