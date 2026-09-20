---
name: staffing-review
description: Review ministry staffing, open roles, assigned people, leadership and recorded training requirements; prepare requested roster or role changes.
---

# Staffing review

Use `teams.query`, `teams.get_many`, `people.get_many` and `training.query` to relate open roles to current members and recorded qualifications. Lists and totals should include all relevant pages. Team names are display labels; IDs and template keys identify the actual teams.

An open role is not necessarily an empty team. An active membership, role assignment and explicit team-leader appointment are distinct. A ministry role is not an account seat. Do not propose seat or authentication changes as part of ordinary staffing.

Ground candidate suggestions in recorded skills, commitments, assessments and training as relevant. Missing training completion is unknown or incomplete, not evidence the person is incapable. Background-check requirements belong to the team.

Use `people.query` to filter by recorded skills or exact case-insensitive tag names. Request `tags` and `skills` fields from `people.get_many` for the whole candidate batch to inspect names, proficiency and notes before explaining a recommendation.

Prepare requested assignments, role changes, responsibilities or training updates through `actions.prepare`. The execution service owns eligibility and leadership concurrency checks. Never claim an assignment succeeded from a candidate recommendation or prepared review.
