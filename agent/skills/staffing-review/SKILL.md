---
name: staffing-review
description: Review ministry staffing, open roles, assigned people, leadership and recorded training requirements; prepare requested roster or role changes.
---

# Staffing review

Use `teams.query`, `teams.get_many`, `people.get_many` and `training.query` for roles, members and qualifications. Complete relevant pages. Identify teams by IDs/template keys, not display names.

Open roles, empty teams, memberships, role assignments and explicit leader appointments are distinct. Ministry roles are not account seats; exclude seat/authentication changes from staffing.

Ground suggestions in recorded skills, commitments, assessments and training. Missing completion does not mean incapability. Background-check requirements belong to the team.

## Compare requirements before counting

For filled roles missing requirements, query `vacant: false`, then read `roster` and `requirements` together. Verify pages and related totals before claiming completeness. Batch-read assigned people with `background_check`; do not fetch contact details, notes or activity history unless needed.

Match each active assignment to its team's requirements. Use `Background check required`, never the team name: `No` means no check gap; `Yes` requires `Cleared`, not `Not started`, `In progress` or `Flagged`. Report status without judging the person. A missing or inaccessible person record is unknown, not unmet.

`training.query` resource `requirements` filters by role/person/program IDs and returns completed or `No completion recorded`; avoid a redundant completions query. Require an authorized, complete read before reporting no completion, which does not prove training never happened. Missing pages, inaccessible records, or omitted fields are unknown. Do not invent pass/fail thresholds for desired skills or free-text descriptions; unrecorded criteria remain unknown.

Use code mode to join role/person/requirement IDs. Keep evidence and a `state` (`met`, `unmet`, `unrecorded`, `unknown`, `not_applicable`) for each active assignment and requirement. Derive the list and distinct role count from the same `unmet`/`unrecorded` set, not from all required-check roles, people or training rows.

This helper counts distinct roles/people, retains unknowns and rejects conflicting classifications. Supply authorized evidence, not the desired answer.

```js
function summarizeRequirementComparisons(rows) {
  const states = new Set(["met", "unmet", "unrecorded", "unknown", "not_applicable"]);
  const comparisons = new Map();
  for (const row of rows) {
    if (!row.roleId || !row.personId || !row.requirementId || !states.has(row.state)) {
      throw new Error("Each comparison needs role, person, requirement and evidence state");
    }
    const key = JSON.stringify([row.roleId, row.personId, row.requirementId]);
    const previous = comparisons.get(key);
    if (previous && previous.state !== row.state) {
      throw new Error("Conflicting requirement evidence; inspect the records before counting");
    }
    comparisons.set(key, row);
  }
  const compared = [...comparisons.values()];
  const affected = compared.filter((row) => row.state === "unmet" || row.state === "unrecorded");
  const unknown = compared.filter((row) => row.state === "unknown");
  const unique = (records, key) => [...new Set(records.map((row) => row[key]))].sort();
  const affectedRoleIds = unique(affected, "roleId");
  return {
    affectedRoleIds,
    affectedRoleCount: affectedRoleIds.length,
    affectedPersonIds: unique(affected, "personId"),
    affected,
    unknown,
    comparedRoleCount: unique(compared, "roleId").length,
  };
}
```

For "which ones are missing", show affected IDs only, using an authorized filtered read for any card. The headline count must equal `affectedRoleIds.length`; each listed role needs an unmet/unrecorded requirement. Keep satisfied roles out. Explain unknowns separately, not as confirmed gaps.

Filter `people.query` by skills or exact case-insensitive tags. Batch-read `people.get_many` fields `tags`/`skills` for names, proficiency and notes before recommending candidates.

Use `actions.prepare` for requested changes; execution owns eligibility and leadership concurrency checks. A recommendation or prepared review is not a completed assignment.
