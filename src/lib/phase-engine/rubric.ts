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
// changes the recorded version (AC-PE-4). To ship a v1, add a new entry to
// `RUBRICS` and flip `ACTIVE_RUBRIC_VERSION` — a one-line swap, no pipeline edit.
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

/** All known rubric versions, keyed by version string. */
export const RUBRICS: Record<string, Rubric> = {
  [RUBRIC_V0.version]: RUBRIC_V0,
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
