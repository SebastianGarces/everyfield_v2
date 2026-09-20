---
name: interview-review
description: Identify people who may need interviews or review interview readiness using recorded follow-up, attendance, assessments and commitments.
---

# Interview review

Use `people.query` relational filters, `people.history.query` and `attendance.query`. Use `people.get_many` to enrich a cohort, not one tool call per person. When the user supplies several conditions, combine evidence across tools if no single filter expresses the question.

Current People stage is not interview history. A completed person-linked follow-up task is recorded follow-up; an open task is planned follow-up. Attendance is not RSVP. An absent interview record means no interview is recorded, not proof that no conversation happened.

For "prospects who completed follow-up but have no interview recorded", query the actual history and stage conditions. Do not ask the user to choose a simpler filter merely because the question crosses domains. For "who should be interviewed", use relevant recorded evidence to suggest candidates and briefly explain the criteria. Distinguish recommendations from facts.

Keep the requested cohort intact across follow-ups. If the user asks for both completed-follow-up and no-follow-up groups, label those groups separately. Verify complete pagination before claiming every eligible person is included.

Explain what a 4C assessment measures using authorized wiki or application knowledge if requested; do not infer an individual's scores or interview outcome. Offer useful evidence without spiritual or pastoral judgments.
