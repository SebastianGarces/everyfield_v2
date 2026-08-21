// ============================================================================
// The Plant Intelligence Rubric — versioned, in-context (PE-006 / AC-PE-4).
//
// This is the moat artifact: the editable evaluation framework the LLM-as-judge
// reasons against. It is loaded WHOLE into the prompt (it is intentionally NOT
// in the RAG store — the RAG store holds methodology passages, this holds the
// judge's scoring rules). Transcribed from
// `product-docs/features/phase-engine/rubric-v0.md`.
//
// Every assessment records `ACTIVE_RUBRIC.version`; changing the active version
// changes the recorded version (AC-PE-4). Shipping a version is a two-step:
// register it in `RUBRICS` (v1 is registered and DRAFT today), then flip
// `ACTIVE_RUBRIC_VERSION` — a one-line swap, no pipeline edit. `rubric.test.ts`
// holds v1 down until #538 does the flip.
// ============================================================================

export interface Rubric {
  /** Version string recorded alongside every assessment (e.g. "v0"). */
  version: string;
  /** The full rubric text, embedded verbatim into the judge prompt. */
  body: string;
}

/**
 * Rubric v0 — mined from the launch playbook + 96-article wiki corpus.
 * Part A = the 8 cross-phase CSF lenses; Part B = per-phase focus + gates.
 */
const RUBRIC_V0_BODY = `# Plant Intelligence Rubric — v0

This rubric has two parts:
- Part A — The 8 CSF Lenses: cross-phase health dimensions, always evaluated.
- Part B — Phase Focus: what matters most right now given the plant's current phase, plus the readiness gates for advancing.

Combine both: score the CSF lenses against the supplied fact snapshot (facts are
deterministic — you never count or compute a number yourself), prioritize through
the lens of the current phase, then phrase output for the audience (planter vs. network).

## Part A — The 8 Critical Success Factor Lenses

### CSF-1 · Vision Casting
- Signals: vision-meeting cadence (target: >=1 every 2 weeks), attendance trend, new-contact inflow, attendee -> core-group conversion.
- Healthy: meetings on cadence; a steady stream of NEW attendees, not the same faces.
- Insight types: cadence slipping; attendance plateauing; strong conversion worth reinforcing.
- Wiki: "What is a Vision Meeting?", "8 Critical Success Factors for Vision Meetings", "Planning Your Vision Meeting".

### CSF-2 · Shared Ownership
- Signals: breadth of who is inviting/following up; distribution of follow-up across people.
- Healthy: invitations and follow-up spread across the core group, not carried solely by the planter.
- Insight types: "you're carrying all the follow-up yourself — start handing invitations to committed members."
- Wiki: "Growing Your Core Group", "The Core Group Funnel".

### CSF-3 · Critical Mass
- Signals: committed core-group adult count, growth delta, distance to the 50 (min) / 100 (target) goal, projected trajectory vs. launch date.
- Healthy: trending toward >=50 committed adults on a trajectory that reaches target before launch.
- Insight types: trajectory vs. launch; growth stalled N weeks.
- Wiki: "What is a Core Group?", "Building Your Core Group", "8 Critical Success Factors Overview".

### CSF-4 · Unity
- Signals: core-group meeting cadence, attendance consistency, engagement breadth.
- Healthy: regular core-group gatherings with consistent attendance.
- Insight types: core-group meetings lapsing; a cluster of members disengaging at once.
- Wiki: "Core Group Meeting Format", "Core Group Commitments Explained".

### CSF-5 · Prayer
- Signals: Prayer Leader role assigned? (manual-attestation today — weak system representation).
- Healthy: prayer leadership identified; prayer rhythms established.
- Insight types: "no Prayer Leader identified yet — Prayer is CSF #5 and one of the 8 launch roles."
- Wiki: "The Prayer Leader Role".

### CSF-6 · Generosity
- Signals: financial base established (manual attestation today); giving data later.
- Healthy: sacrificial giving evident; first-year budget viable.
- Insight types: "financial base not yet confirmed — Generosity (CSF #6) and 'Finances in place' are launch gates."
- Wiki: "First Year Budget Planning", "Principles of Financial Accountability".

### CSF-7 · Emerging Leadership
- Signals: how many of the 8 ministry roles are filled (Worship, Children's, Assimilation, Small Groups, Admin/Finance, Facilities, Promotion, Technology); per-person readiness (sustained attendance + volunteering + tenure); coverage gaps near launch.
- Healthy: leaders emerging from within the core group; no critical role unfilled close to launch.
- Insight types: individual pipeline ("Sara hasn't missed a meeting or volunteer slot in 2 months — emerging leader"); coverage gap ("no Worship Leader and 3 months from launch — this is the priority").
- Wiki: "Key Leadership Roles Overview" + the 8 role articles, "The 5 Interview Criteria".

### CSF-8 · Comprehensive Training
- Signals: training programs created/assigned, completion across team members, distance to launch.
- Healthy: ministry-model and role training underway, on track to complete before launch.
- Insight types: "0 of 6 team members have completed Boot Camp and training must finish before pre-launch."
- Wiki: "Training Programs Overview", "Boot Camp Overview", "Ministry-Specific Training".

## Part B — Phase Focus

### Phase 0 · Discovery
- Objective: discern calling, define foundations (values / 4 Pillars), find a coach.
- Priority lens: foundations documented? coach assigned? ready to begin vision meetings?
- Readiness for 0->1: foundational modules complete, values documented, coach assigned.

### Phase 1 · Core Group Development
- Objective: build to 50–100 committed adults through vision meetings + follow-up.
- Priority lens: CSF-1 (vision-meeting cadence), CSF-3 (core-group growth), CSF-2 (shared ownership of follow-up), follow-up health (no warm contacts going cold).
- Readiness for 1->2: 30–40 committed adults, financial base, worship leader identified, geographic area set.

### Phase 2 · Launch Team Formation
- Objective: transition core group -> launch team; set launch date; fill leadership.
- Priority lens: CSF-7 (all 8 team leaders), launch date set, launch-date countdown drives everything.
- Readiness for 2->3: all 8 team leaders assigned, launch date set.

### Phase 3 · Training & Preparation
- Objective: comprehensively train all ministry teams.
- Priority lens: CSF-8 (training completion vs. time-to-launch), systems readiness.
- Readiness for 3->4: team training complete, systems tested, 3–4 weeks to launch.

### Phase 4 · Pre-Launch (final 3–4 weeks)
- Objective: integration, testing, promotion executed.
- Priority lens: pre-launch services done, promotion plan executed, final checklist, countdown urgency high.
- Readiness for 4->5: pre-launch services done, promotion executed.

### Phase 5 · Launch Sunday
- Objective: execute a high-impact first service.
- Priority lens: the 5 priority details; guest-capture readiness.
- Readiness for 5->6: first service complete, guest data entered, debrief done.

### Phase 6 · Post-Launch
- Objective: sustainable weekly rhythms while sustaining growth.
- Priority lens: 48-hour guest follow-up rate, assimilation journey, financial sustainability, growth metrics.
- Readiness: terminal phase — focus shifts to sustained-health monitoring.

## Audience framing
- Planter insights: direct, actionable coaching — the next concrete step.
- Network insights: conservative, observational health reads (observation, not verdict; the planter sees it first). Never expose individual person records to the network audience; speak in aggregate.
`;

const RUBRIC_V0: Rubric = {
  version: "v0",
  body: RUBRIC_V0_BODY,
};

/**
 * Rubric v1 — DRAFT, registered but NOT active. Bryan's review of v0 (C01–C26)
 * is landing one ruled change at a time; each sub-issue of #469 edits the lens
 * it owns here and in `product-docs/features/phase-engine/rubric-v1.md`, which
 * carries the change log. #538 flips `ACTIVE_RUBRIC_VERSION` to "v1" once the
 * series is complete. Until then this text reaches no judge prompt and no
 * planter — it is registered so `getRubric("v1")` resolves and the delta is
 * reviewable in one place.
 *
 * v1 starts as v0 and diverges section by section. A section identical to v0
 * has not been ruled on yet.
 */
const RUBRIC_V1_BODY = `# Plant Intelligence Rubric — v1

This rubric has two parts:
- Part A — The 8 CSF Lenses: cross-phase health dimensions, always evaluated.
- Part B — Phase Focus: what matters most right now given the plant's current phase, plus the readiness gates for advancing.

Combine both: score the CSF lenses against the supplied fact snapshot (facts are
deterministic — you never count or compute a number yourself), prioritize through
the lens of the current phase, then phrase output for the audience (planter vs. network).

## Part A — The 8 Critical Success Factor Lenses

### CSF-1 · Vision Casting
- Signals: vision-meeting cadence (target: >=1 every 2 weeks), attendance trend, new-contact inflow, attendee -> core-group conversion.
- Healthy: meetings on cadence; a steady stream of NEW attendees, not the same faces.
- Insight types: cadence slipping; attendance plateauing; strong conversion worth reinforcing.
- Wiki: "What is a Vision Meeting?", "8 Critical Success Factors for Vision Meetings", "Planning Your Vision Meeting".

### CSF-2 · Shared Ownership
- Signals: MEASURED follow-up ownership. Every open follow-up task carries an assignee, and only members holding a committed status (core group, launch team, leader) may hold one. The facts: \`unownedCount\` (open follow-ups with no live owner), \`staleUnownedCount\` (stale ones with no live owner), \`distinctOwnerCount\`, \`planterOwnedCount\`.
- Healthy: follow-up spread across several distinct committed owners, with few follow-ups sitting unowned.
- HARD RULE: stale follow-ups do NOT prove the planter is carrying them — they may equally mean ownership was distributed badly, or that people did not do what they agreed. You may state who carries follow-up ONLY from the four owner facts above. Never infer it from follow-up volume or staleness.
- Insight types:
  - Ownership measured (\`distinctOwnerCount\` > 0): "You own 6 of the 9 open follow-ups. Handing some to committed members spreads ownership of growth — the second Critical Success Factor."
  - Ownership not measured (no owners recorded): "8 follow-ups are currently stale. Make sure each one has a clear owner and reconnect with them this week." Report the staleness; name no cause.
  - Network audience: "Several follow-ups have been waiting longer than the follow-up window. This may be worth a coaching conversation." Never an owner's name, never a cause.
- Ownership is TASK ownership, not ownership of the relationship with the contact. A task assigned to somebody since removed or demoted out of the committed set counts as unowned.
- Wiki: "Growing Your Core Group", "The Core Group Funnel".

### CSF-3 · Critical Mass
- Signals: committed core-group adult count, \`growthDelta\` over the 28-day comparison window vs. the prior 28, distance to the 50 (min) / 100 (target) goal, projected trajectory vs. launch date, and \`daysSinceLastNewCommitment\` — the flat streak.
- Healthy: trending toward >=50 committed adults on a trajectory that reaches target before launch.
- FLAT GROWTH HAS TWO LEVELS, and the words are not interchangeable:
  - \`daysSinceLastNewCommitment\` >= \`slowedThresholdDays\` (21): you may say MOMENTUM HAS SLOWED.
  - \`daysSinceLastNewCommitment\` >= \`stalledThresholdDays\` (28): only now may you say growth has STALLED.
  - Below 21 days, neither word. One vision-meeting cycle can change the picture inside three weeks, so a confident "stalled" at 3 weeks is a claim the data does not support.
- ANY NEW COMMITTED ADULT RESETS BOTH CLOCKS. The fact is days since the most recent person's FIRST core-group commitment, so a new adult makes it 0. Somebody's second commitment — a launch-team card, a re-signed core-group card — is not a new adult and resets nothing.
- \`growthDelta\` IS A DIFFERENT MEASUREMENT: it compares two 28-day windows and can read flat while somebody joined yesterday. Never call growth stalled from \`growthDelta\` alone.
- Insight types: trajectory vs. launch; momentum slowed; growth stalled.
- Wiki: "What is a Core Group?", "Building Your Core Group", "8 Critical Success Factors Overview".

### CSF-4 · Unity
- Signals: core-group meeting cadence, attendance consistency, engagement breadth.
- Healthy: regular core-group gatherings with consistent attendance.
- Insight types: core-group meetings lapsing; a cluster of members disengaging at once.
- Wiki: "Core Group Meeting Format", "Core Group Commitments Explained".

### CSF-5 · Prayer
- Signals: Prayer Leader role assigned? (manual-attestation today — weak system representation).
- Healthy: prayer leadership identified; prayer rhythms established.
- Insight types: "no Prayer Leader identified yet — Prayer is CSF #5 and one of the 8 launch roles."
- Wiki: "The Prayer Leader Role".

### CSF-6 · Generosity
- Signals: financial base established (manual attestation today); giving data later.
- Healthy: sacrificial giving evident; first-year budget viable.
- Insight types: "financial base not yet confirmed — Generosity (CSF #6) and 'Finances in place' are launch gates."
- Wiki: "First Year Budget Planning", "Principles of Financial Accountability".

### CSF-7 · Emerging Leadership
- Signals: how many of the 8 ministry roles are filled (Worship, Children's, Assimilation, Small Groups, Admin/Finance, Facilities, Promotion, Technology); per-person readiness (sustained attendance + volunteering + tenure); coverage gaps near launch.
- Healthy: leaders emerging from within the core group; no critical role unfilled close to launch.
- Insight types: individual pipeline ("Sara hasn't missed a meeting or volunteer slot in 2 months — emerging leader"); coverage gap ("no Worship Leader and 3 months from launch — this is the priority").
- Wiki: "Key Leadership Roles Overview" + the 8 role articles, "The 5 Interview Criteria".

### CSF-8 · Comprehensive Training
- Signals: training programs created/assigned, completion across team members, distance to launch.
- Healthy: ministry-model and role training underway, on track to complete before launch.
- Insight types: "0 of 6 team members have completed Boot Camp and training must finish before pre-launch."
- Wiki: "Training Programs Overview", "Boot Camp Overview", "Ministry-Specific Training".

## Part B — Phase Focus

### Phase 0 · Discovery
- Objective: discern calling, define foundations (values / 4 Pillars), find a coach.
- Priority lens: foundations documented? coach assigned? ready to begin vision meetings?
- Readiness for 0->1: foundational modules complete, values documented, coach assigned.

### Phase 1 · Core Group Development
- Objective: build to 50–100 committed adults through vision meetings + follow-up.
- Priority lens: CSF-1 (vision-meeting cadence), CSF-3 (core-group growth), CSF-2 (shared ownership of follow-up), follow-up health (no warm contacts going cold).
- Readiness for 1->2: 30–40 committed adults, financial base, worship leader identified, geographic area set.

### Phase 2 · Launch Team Formation
- Objective: transition core group -> launch team; set launch date; fill leadership.
- Priority lens: CSF-7 (all 8 team leaders), launch date set, launch-date countdown drives everything.
- Readiness for 2->3: all 8 team leaders assigned, launch date set.

### Phase 3 · Training & Preparation
- Objective: comprehensively train all ministry teams.
- Priority lens: CSF-8 (training completion vs. time-to-launch), systems readiness.
- Readiness for 3->4: team training complete, systems tested, 3–4 weeks to launch.

### Phase 4 · Pre-Launch (final 3–4 weeks)
- Objective: integration, testing, promotion executed.
- Priority lens: pre-launch services done, promotion plan executed, final checklist, countdown urgency high.
- Readiness for 4->5: pre-launch services done, promotion executed.

### Phase 5 · Launch Sunday
- Objective: execute a high-impact first service.
- Priority lens: the 5 priority details; guest-capture readiness.
- Readiness for 5->6: first service complete, guest data entered, debrief done.

### Phase 6 · Post-Launch
- Objective: sustainable weekly rhythms while sustaining growth.
- Priority lens: 48-hour guest follow-up rate, assimilation journey, financial sustainability, growth metrics.
- Readiness: terminal phase — focus shifts to sustained-health monitoring.

## Audience framing
- Planter insights: direct, actionable coaching — the next concrete step.
- Network insights: conservative, observational health reads (observation, not verdict; the planter sees it first). Never expose individual person records to the network audience; speak in aggregate. Never name a cause the facts do not establish.
`;

const RUBRIC_V1: Rubric = {
  version: "v1",
  body: RUBRIC_V1_BODY,
};

/** All known rubric versions, keyed by version string. */
export const RUBRICS: Record<string, Rubric> = {
  [RUBRIC_V0.version]: RUBRIC_V0,
  [RUBRIC_V1.version]: RUBRIC_V1,
};

/** The version currently in force. Flip this to ship a new rubric (AC-PE-4). */
export const ACTIVE_RUBRIC_VERSION = "v0";

/**
 * The active rubric, loaded whole. The judge pipeline reads this; its `version`
 * is recorded alongside every assessment so a change here changes the audit
 * record (PE-006 / AC-PE-4).
 */
export const ACTIVE_RUBRIC: Rubric = RUBRICS[ACTIVE_RUBRIC_VERSION];

/** Look up a specific rubric version (e.g. to re-explain a historical assessment). */
export function getRubric(version: string): Rubric | undefined {
  return RUBRICS[version];
}
