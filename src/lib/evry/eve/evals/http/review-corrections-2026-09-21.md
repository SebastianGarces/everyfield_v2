# Review corrections, September 21, 2026

Integration remains on hold. These checks do not establish that all 158 questions
pass live or that the preview UI has been revalidated.

## Implemented and verified

- `actions.prepare` loads exact operation schemas instead of the full union.
  Every registered preparation remains discoverable and validates against the
  same authoritative schema. Restored sessions can reload an operation.
- Session caps remain 300,000 cumulative input and 30,000 cumulative output
  tokens. They are not message-count or context-window limits.
- Launch status includes completed, open and total milestones scoped to the
  current launch. Launch task evidence includes recorded assignees and due dates.
- The meeting skill searches all saved active venues when “church” has no match
  and suggests a candidate instead of asking the user to remember its address.
- Isolated paid calls require an active pre-dispatch reservation. Concurrent
  reuse and retries of one reservation fail closed. Unknown usage retains its
  reservation. Per-call token totals are returned with the evidence.

Unpaid checks: 91 Eve tests pass, three opt-in tests skipped in that invocation;
separate PostgreSQL tests pass all three cases, including 4/9 completed, 5 open
and task assignee/due-date assertions. Compiled orientation, explicit usage-limit
Continue/Stop, task follow-up/replay and native clarification tests pass. The
parallel result/notification proof passed earlier in this correction pass.
Typecheck, scoped lint and compiled build pass.

Two stale compiled fixtures attempted tasks.query without loading its definition.
They now exercise load_tools before the real query. The proof also checks that
unselected preparation definitions remain absent. Full registry schema parity
and every individual preparation remain covered separately.

## Isolated live observations

Model: gpt-5.6-luna, medium reasoning. Synthetic tenants in disposable PostgreSQL,
real compiled cookie-authenticated Eve runtime, no shared database, no outbound
email, no Jev or Langfuse exports. The clock was September 20, 2026, noon EDT.

Orientation completed in two user turns with one awaiting-confirmation plan.
It suggested Evry Community Center with its saved address, resolved September 27
at 10 AM EDT, retained the two-hour duration and two Core Group invitees, and used
the saved template. No session pause, repeated plan, domain write or email send.
Provider usage: 162,882 input and 2,146 output tokens across 14 calls. First text
22.6 seconds; both turns completed in 47.9 seconds, excluding fixture setup.

Launch correctly stated 4 of 9 milestones complete, 5 open, 13 open tasks already
assigned to Fixture Owner and due September 25, and one open role. Explanation
preceded cards. Native records store meeting wall-clock time; the fixture's 2 PM
meeting was correctly shown as 2 PM EDT, not a UTC conversion error.

Launch first text took 18.4 seconds, total 29.9 seconds. A second launch run with
stronger no-repeat guidance took 24.5 seconds to first text and 50.8 seconds total.
Both repeated their overview after the cards. The stronger guidance did not fix
it and was removed; Eve rejects empty final responses after tool calls. That
constraint is confirmed in the installed runtime, but the full cause of the
repeated prose is not yet established. Do not claim this issue fixed.

## Cost

Fresh authorization: $1 total. First run estimate: $0.1669005 for orientation and
launch. Second launch estimate: $0.1040225. Combined conservative estimate:
**$0.270923**, leaving **$0.729077** of that authorization. No further live run was
performed in this pass.

These are provider token totals priced at conservative ceilings, not a billing
invoice. Each call reserved the entire 1.05-million-token Luna context plus
framing and 4,096 output tokens at standard long-context/cache-write prices.
Fixture middleware forced standard service tier. Cache discounts were ignored.
The second run's maximum allocation was $0.80, below the $0.8330995 then remaining.
Pricing source checked September 21:
https://developers.openai.com/api/docs/models/gpt-5.6-luna

Local detailed logs: `/private/tmp/evry-corrections-live-1.log` and
`/private/tmp/evry-corrections-live-2.log`. Only synthetic fixture data is included.

## Remaining acceptance work

- Remove repeated closing summaries without dropping useful streamed content or
  imposing an empty response unsupported by Eve. No similarity-based text hiding
  or renderer changes were introduced in this pass.
- Improve first-text latency, measured at 18–24 seconds in these isolated runs.
- Exercise exact-preview paused submission blocking, Edit plan and Continue.
  Their existing scripted proofs are not substitutes for browser evidence.
- The new live fixture has one open role and no opaque readiness score. It does
  not independently verify the prior preview's 32-role total or the 0.75-score case.
- No merge, release, shared migration, real invitation send or all-158 live claim.
