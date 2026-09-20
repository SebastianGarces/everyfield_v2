---
name: prospect-outreach
description: Find a prospect cohort from recorded follow-up or interview evidence and prepare an appropriate message or follow-up task for review.
---

# Prospect outreach

Use `people.query` and `people.history.query` to resolve the requested audience, adding `attendance.query` when attendance matters. Retain each criterion rather than broadening to all prospects when a relational query is needed.

Distinguish completed follow-up, planned follow-up and no recorded follow-up. Current stage does not prove interview history. Finish pagination before treating a cohort as the whole invitation or outreach audience.

Use `communication.query` and `communication.get_many` to read suitable full templates. Draft one reusable message with supported placeholders and factual context, not a separate wall of text for every recipient. Do not invent personal facts, interview findings or pastoral counsel.

When a template needs church, pastor or launch-date fields, use `communication.query` with `query: { resource: "merge_context" }`. Missing values remain missing; do not substitute a recipient name for the pastor or guess the launch date.

Prepare the requested communication and/or follow-up tasks through `actions.prepare`, retaining resolved people and any chosen template version. Missing email addresses should be visible as exclusions, not silently replaced with other people. A request for a list alone does not authorize outreach.
