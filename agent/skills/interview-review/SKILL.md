---
name: interview-review
description: Review recorded interviews, individual 4C assessments, commitments and notes, or identify interview candidates using follow-up and attendance evidence. Includes complete history-note retrieval.
---

# Interview review

Use `people.query` relational filters, `people.history.query` and `attendance.query`. Use `people.get_many` to enrich a cohort, not one tool call per person. When the user supplies several conditions, combine evidence across tools if no single filter expresses the question.

Current People stage is not interview history. A completed person-linked follow-up task is recorded follow-up; an open task is planned follow-up. Attendance is not RSVP. An absent interview record means no interview is recorded, not proof that no conversation happened.

For "prospects who completed follow-up but have no interview recorded", query the actual history and stage conditions. Do not ask the user to choose a simpler filter merely because the question crosses domains. For "who should be interviewed", use relevant recorded evidence to suggest candidates and briefly explain the criteria. Distinguish recommendations from facts.

Keep the requested cohort intact across follow-ups. If the user asks for both completed-follow-up and no-follow-up groups, label those groups separately. Verify complete pagination before claiming every eligible person is included.

## Complete recorded notes

When the answer needs full history notes, use one bounded `code_mode` program: `return await history.collect({resource: {kind: "assessments"}})`, with the requested resource, cohort, date basis, dates, author filters and latest-record policy. The helper accepts the structured `people.history.query` fields except `text`, `result` and `contentOffset`. It follows both record pages and Unicode note continuations through the normal authorized tools, preserving unchanged base filters, entry timestamps, source links and exact result references. It returns each record once with its assembled `notes` and a `contentComplete` flag.

Check the collection's `status` before an exhaustive answer. Do not add a keyword filter to replace reading the notes or repeat a search after the complete evidence is already available. The direct tool's `text` filter matches literal wording, not meaning: use it for a requested wording search, not to identify every concern or recommendation. Interpret the recorded evidence yourself; the helper does no semantic classification.

Stay within code mode's existing call, time and output limits. If a read fails or evidence changes, report the evidence as partial rather than complete. Hard sandbox limits may fail the whole program rather than return a partial collection. Separate reads are not an atomic snapshot. Use a focused query or count instead when the question does not require full notes.

Explain what a 4C assessment measures using authorized wiki or application knowledge if requested; do not infer an individual's scores or interview outcome. Offer useful evidence without spiritual or pastoral judgments.
