---
name: meeting-invite
description: Prepare a meeting, guest list and invitation together, including orientations, relative dates, saved locations and editable invitation templates.
---

# Meeting and invitation

Keep one draft containing the requested meeting type, date, time, duration, location, audience and message. Preserve each supplied value through clarification, edits and context compaction. "Yes" answers the pending question; it is not a reason to discard the rest of the draft.

Look up information that EveryField can supply before asking the user. Use `calendar.resolve` for relative dates, `locations.query` and `locations.get` for saved venues, `people.query` for the audience and `templates.for_meeting` for the full invitation. Independent reads can run together in code mode.

- Interpret "next Sunday" as the upcoming Sunday strictly after today unless context says otherwise. Resolve in the church timezone, show the absolute date in the review and retain it in the draft. A missing year is usually inferable. A DST gap or repeated hour genuinely needs a choice.
- Orientation remains `orientation`, not a Vision Meeting. Keep the user's chosen type throughout preparation.
- "Core team" means the requested Core Group cohort, not prospects too. Gather the whole cohort and preserve the selected person IDs. Account seat membership is not this audience.
- Use a saved church venue when it uniquely matches. If a search for "church" finds nothing, list saved active venues without that search before declaring the location missing. Offer a plausible saved venue by name and address for confirmation, rather than asking the user to remember its address. Do not assume an unrelated venue is the church. Preparing a new location and meeting together must retain the meeting details already given.
- Use the applicable full template, including the church's override. Keep placeholders such as `{{first_name}}` intact. If a template lacks necessary content, draft it from the supplied meeting facts. Do not ask the user to author a subject and body they asked you to write.

Ask one focused question containing only unresolved details that matter. Do not invent a duration if neither the user nor an approved default supplies it. Do not ask again for time, audience or venue already retained in the draft.

Load `actions.prepare` with `preparationOperations: ["recipe.meeting-invite"]`. Prepare one review including the meeting, guest count and one editable subject/body preview. Once the review is prepared, finish the response and let the user review it; do not prepare it again or repeat the audience and template reads. Edits create a revised review. Use future tense until execution receipts establish what happened. A conversational "yes" to gathering details is not confirmation of an unseen execution plan.
