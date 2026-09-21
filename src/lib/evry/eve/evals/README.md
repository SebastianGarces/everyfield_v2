# Evry agent evaluations

The corpus preserves all 126 historical questions, their IDs, intended outcomes,
19 areas, 23 contracts and eight original workflows. Another 32 cases reproduce
reported failures and exercise multi-turn context, dates, sandbox restrictions,
confirmation, replay and session isolation. These are 158 scenarios, not 158
passing results. `catalog.test.ts` proves coverage only; `grade.test.ts` proves
the grader, not the agent.

The [production fixture registry](fixtures/README.md) currently binds 96 scenarios
by default: 82 original questions and 14 regressions. Supplying both isolated
document and native staged CSV transports enables two more, leaving 60 of 158 unbound.
These counts describe runnable fixtures, not passing live answers. Readiness,
notifications, task calendars and staffing keep separate factual, safety and
independent answer-quality gates. A correct query can still produce a poor
conversation, such as repeating an already displayed page.

## Run without spending

```
node --import tsx scripts/evry-eve-eval-inventory.ts full
node --import tsx --test src/lib/evry/eve/evals/*.test.ts
```

Profiles: `smoke` includes the 16 historical representative cases and critical
product regressions; `security` selects the new adversarial cases; `full` selects
everything. The high/medium/low likelihood labels are hypotheses from the
original inventory, not observed customer traffic. Do not use them as measured
probabilities or drop rare safety cases to improve the score.

## Live proof requirements

`runEvalSuite` accepts a production adapter with fixture setup, execution and
cleanup. Every fixture must seed an isolated test tenant using real domain
records, bind symbolic IDs to those records, establish server time/zone, and
capture tool/result plus database/outbound evidence. Frozen time must be injected
at the application clock boundary, not merely described in the prompt.

The adapter must invoke the actual Eve agent and tool registry. A miniature
executor or a function that returns the expected answer is not agent evidence.
Unbound fixtures return null and are reported `blocked`. The 126 historical
questions retain natural-language acceptance rubrics; each needs a fixture with
concrete expectations before its result can pass. Do not derive expected results
from the agent's own tool calls or answer. Native query assertions and stored
fixture manifests are the independent source of truth.

The 32 regressions carry explicit assertions. Their fixture labels name setup
contracts, not existing implementations. In particular:

- `tasks-calendar`: September 20, 2026 in America/New_York; one high-priority
  incomplete task due today, plus overdue, tomorrow, completed and undated
  distractors owned by the same actor and tasks owned by another actor.
- `people-relations`: followed/not-interviewed, not-followed, interviewed,
  attended-twice and RSVP-only prospects; duplicate join rows and multiple pages.
- `orientation-sunday`: September 20, 2026, saved church location, two Core Group
  people, one prospect who must be excluded, full orientation invitation template.
- `launch-overview`: launch date plus milestones, open roles and upcoming
  meetings; the outage variant lacks a historical readiness snapshot only.
- `approved-invitation-replay`: the test driver presses the exact review's
  confirmation control twice and reconnects after a committed effect. Model text
  saying yes is not a confirmation. Count durable effects and provider attempts.
- Security fixtures use a second plant, revoked seat, foreign session, stale or
  revised plan and malicious retrieved text. Every read-only run observes zero
  domain writes and outbound messages rather than assuming silence means zero.

All live runs record build SHA, exact Luna model, fixture digest, evidence,
clarifications, tool calls, latency and cost. Secrets and production data must
never enter checked-in observations. Reports should link redacted traces by
opaque run ID, not store cookies, prompts containing real personal data or keys.

## Quality and release gates

Deterministic facts, effects and safety proofs run first. A semantic judge checks
grounding, usefulness and natural language against retrieved evidence and the
case rubric. Jev may judge those qualities after calibration against human-rated
examples; it cannot override a failed safety or factual assertion. Human review
is also supported and must identify its rubric version in the judge model field.

Grade answers for useful depth appropriate to the question. Focused counts should
be concise, overviews should explain relevant findings, and neither should narrate
database attributes, cursors or internal tool routing. Markdown must render in
browser tests. Cards must remain compact and never force scroll-following.

Run the smoke set first, inspect costs, then run full coverage with explicit
total and per-case budgets. Each call reserves its maximum before dispatch,
including failed/interrupted calls. The production adapter must enforce that
budget at every model/tool boundary, honor cancellation and include judge costs.
No automatic retries hide flakiness. Use 3 repetitions for critical multi-turn and
replay cases and report every attempt, not only the best one.

An empty, partially run, blocked or failed suite never passes the release gate.
Track factual correctness, task completion, safety, quality, clarification count,
tool count, first-text latency and cost separately. Good prose cannot compensate
for a wrong task list or an unintended send. Browser navigation, scrolling and
stream rendering retain their independent real-preview acceptance tests.
