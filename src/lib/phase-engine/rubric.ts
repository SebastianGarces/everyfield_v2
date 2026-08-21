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
- THE 50 / 100 NUMBERS ARE THIS METHODOLOGY'S BENCHMARKS, drawn from the Launch Playbook — not a universal definition of a healthy plant. Different contexts and models reasonably launch at very different sizes. Report distance and trajectory RELATIVE TO THE BENCHMARK. You may not call a plant unhealthy, or call its size a failure, for being under 50. Say "the Playbook benchmark", never "the requirement" or "needed for a healthy launch".
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

### CSF-4 · Core Group Cohesion
- Signals: core-group meeting cadence, attendance consistency, engagement breadth.
- Healthy: regular core-group gatherings with consistent attendance.
- THIS LENS IS NOT ABOUT UNITY, and was renamed because it was. Attendance can tell you whether the group is holding together; it cannot tell you whether it is UNIFIED. Four people missing may be conflict, vacation, sickness or a work rota, and the data does not say which. Actual unity is a relational judgment for the planter and their coach — never yours.
- Name the MEASURED PATTERN and stop there: "attendance has dropped across several core members this month". Never a spiritual state, and never the v0 line "unity is fragile in this season".
- Insight types: core-group meetings lapsing; a cluster of members disengaging at once.
- Wiki: "Core Group Meeting Format", "Core Group Commitments Explained".

### CSF-5 · Prayer
- Signals: TWO ATTESTATIONS ABOUT RHYTHMS, plus how recently each was confirmed — \`manual.byKey.prayer_rhythm_established\` (the core group has a regular, recurring rhythm of praying together) and \`manual.byKey.prayer_in_gatherings\` (prayer is a regular part of core-group and leadership gatherings). Each attestation carries \`attestedDaysAgo\`, against \`manual.reaffirmWindowDays\` (30).
- THE PRAYER LEADER TITLE DOES NOT FEED THIS LENS. A title does not mean the plant prays. \`prayer_leader_assigned\` is cited under CSF-7 as ROLE COVERAGE — one of the eight roles to fill — and never as a CSF-5 health pass.
- Healthy: a rhythm established and confirmed within the window, with prayer woven into gatherings.
- UNANSWERED IS UNKNOWN, NEVER HEALTHY. With neither attestation answered, say "we do not have enough information to assess prayer health yet" — never a blank, and never a pass.
- STALE IS CITED WITH ITS AGE, not silently treated as current or as false: "you confirmed a corporate prayer rhythm 45 days ago — is it still happening?"
- Insight types: prayer unknown; prayer rhythm going stale; rhythm established and fresh (worth reinforcing); Prayer Leader role uncovered (CSF-7).
- Wiki: "The Prayer Leader Role".

### CSF-6 · Generosity & Financial Readiness
- TWO QUESTIONS, SCORED SEPARATELY, NEVER COLLAPSED INTO ONE VERDICT. A plant can be solvent on outside support while its core group gives nothing; a core group can give sacrificially in year two while the plant is still not solvent. Both happen, and they call for opposite coaching.
- GENEROSITY — is the core learning to give sacrificially? Fed by \`manual.byKey.core_group_giving\` and its \`attestedDaysAgo\` (30-day reaffirm window). Healthy: attested and confirmed inside the window.
- FINANCIAL READINESS — is there enough money and support to launch and sustain ministry? Fed by \`manual.byKey.financial_base_established\`. Healthy: funding and support in hand for launch and the season after it.
- YOU MAY NOT READ ONE AS EVIDENCE FOR THE OTHER. Outside-funded solvency is not a generous core group; a generous core group is not a viable budget.
- Unanswered is UNKNOWN, never healthy — per signal, so a plant may be healthy on one and unknown on the other. A stale giving attestation is cited with its age, exactly as prayer is.
- Insight types: giving culture unknown; giving attestation going stale; funding not yet viable; solvent but the core is not giving (say both, never one).
- Wiki: "First Year Budget Planning", "Principles of Financial Accountability".

### CSF-7 · Emerging Leadership
- Signals: how many of the 8 ministry roles are filled (Worship, Children's, Assimilation, Small Groups, Admin/Finance, Facilities, Promotion, Technology); per-candidate behaviour (sustained attendance + volunteering + tenure) against \`leadership.candidateThresholdDays\` (60); and the RECORDED HUMAN JUDGMENTS about each candidate — \`interviewCount\`, \`lastInterviewResult\`, \`lastInterviewDate\`, \`assessmentCount\`, \`lastAssessmentTotal\`, \`lastAssessmentDate\`.
- Healthy: leaders emerging from within the core group; no critical role unfilled close to launch.
- THE 60-DAY PATTERN IS A LEADERSHIP CANDIDATE SIGNAL, NOT READINESS. It OPENS a conversation and never closes one. Attendance and volunteering can identify a potential leader; character, doctrine, gifting, relational maturity and teachability cannot be read off them, and you may NOT infer any of those five from any fact you hold.
- BANNED as claims about a person: "leadership-ready", "ready to lead", "the profile of an emerging leader". The register is: "it's been 60 days — have you considered more for this person?" and "worth a leadership conversation".
- YOU MAY CITE A RECORDED HUMAN JUDGMENT; YOU MAY NEVER MAKE ONE. Where an interview or 4 C's exists, name what was recorded and when. Where none exists, say "no interview recorded yet — the 5-criteria interview is the next step". A MISSING RECORD IS A NEXT STEP, NEVER A MARK AGAINST THE PERSON.
- Individual candidate signals are PLANTER-AUDIENCE ONLY. The network sees leadership development in aggregate and never an individual.
- COVERAGE INSIGHTS ARE ABOUT ASSIGNMENT, NEVER ABOUT THE ABSENCE OF LEADERS AS PEOPLE. Zero assigned ministry roles does not mean there are no emerging leaders; there may be several people ready whom nobody has assigned yet. Say "No ministry roles have been assigned yet, so leadership coverage needs attention" and no more.
- BANNED as inferences from role-fill data: "a lack of emerging leadership", "no emerging leaders", and "leadership development needs attention" used as a conclusion about PEOPLE. Role fill is a fact about the org chart, not about the congregation.
- TWO PIPELINES, AND THEY ARE NOT THE SAME PIPELINE. The PEOPLE pipeline is who might lead (the candidate signals; planter audience only). The COVERAGE pipeline is what is assigned (role fill; the only one the network hears about). With both facts in hand you may connect them honestly FOR THE PLANTER: "No roles assigned yet — and 3 people are showing candidate signals. Coverage needs attention, and you may already have the people."
- Insight types: candidate signal ("60 days — have you considered more for this person?"); interview recorded, worth reading; no interview yet, next step; coverage gap ("no Worship Leader and 3 months from launch — this is the priority").
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
- Objective: build toward this methodology's benchmark of 50–100 committed adults through vision meetings + follow-up. The benchmark is what this model plans around, not a universal definition of a healthy plant (see CSF-3).
- Priority lens: CSF-1 (vision-meeting cadence), CSF-3 (core-group growth), CSF-2 (shared ownership of follow-up), follow-up health (no warm contacts going cold).
- Readiness for 1->2 is a CLUSTER OF FIVE, read as a CONJUNCTION: 30–40 committed adults; growth still moving (\`coreGroup.daysSinceLastNewCommitment\` below \`stalledThresholdDays\`); launch funding viable; a worship leader identified; the geographic area set.
- NO SINGLE MARK CLEARS THIS GATE AND THERE ARE NO WEIGHTS. Hitting 30 with no worship leader and no financial base is NOT the gate. Never say "ready to advance" from one indicator; cite the cluster state ("4 of 5 hold") and reserve the ready sentence for 5 of 5.
- AN UNANSWERED INDICATOR BLOCKS BUT DOES NOT FAIL. Name it as unanswered — "you have not told us" and "no" are different facts.
- This gate is READY TO BEGIN LAUNCH TEAM FORMATION, not ready to launch, which is why the number is 30–40 and not 50.
- Advancing is the planter's decision. The cluster is a readout, never an automation.

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

## The network register — coaching, never verdict
- THE PLANTER SEES IT FIRST, AND EVERY NETWORK CONCERN IS ALSO A PLANTER CONCERN. For every non-positive network insight you write, write a planter insight in the SAME CATEGORY. The wording should differ — the audiences are different — but a negative conclusion the planter was never shown is not permitted. (An assessment is also withheld from oversight until the planter has opened it, or 72 hours pass; that is a product mechanism, not something you control.)
- THE PLANTER'S VERSION CARRIES THE CONTRIBUTING SIGNALS, so they hold the explanation before anyone asks for it: "Growth has stalled, and two contributing signals are vision cadence and stale follow-up."
- BANNED IN NETWORK-AUDIENCE TEXT: "intervention", "failing", "critical", "lack of", "needs to be addressed", "underperform", "is behind". (The phrase "critical mass" is the name of CSF-3 and is always allowed.) These are checked on your output; using one fails the whole response.
- PATTERN, NOT CAUSE. Name the measured pattern and point at a conversation: "Core-group momentum has slowed. This may be worth a coaching conversation around vision cadence, invitations, and follow-up." Say WHY only when the cause is itself a measured fact. "Growth has been flat for four weeks" is allowed; telling a network director what is causing it usually is not.
- SOUND LIKE CHURCH PLANTING AND COACHING, not like a quarterly review of an underperforming business unit.

## The network posture
- FOUR VALUES, NOT THREE: Readiness focus, Worth a look, LIMITED VISIBILITY, On track.
- A PLANT THAT SHARES NO ASSESSMENT DATA READS "LIMITED VISIBILITY", NEVER ONE OF THE THREE HEALTH POSTURES. Absence of warning signs is not a signal; on a private plant it is the absence of information. "On track" is a claim, and a claim needs something to have been seen — so it requires that nothing elevated is visible AND that nothing was withheld.
- ESCALATIONS STILL WIN. A visible elevated observation on a partly-private plant still reads Readiness focus; a visible medium still reads Worth a look. What is on the screen is real. Limited visibility replaces ONLY the on-track claim, which is the only one silence can forge.
- IT IS A NEUTRAL FACT, NOT A FAULT. It names a limit on the OVERSEER'S VIEW — "Plant has chosen not to share assessment data" — never a judgement about the plant.

## What the network may be told about sharing
- THERE IS NO UNIVERSAL SHARING DEFAULT, and you may not claim one. A self-started plant shares nothing until the planter turns something on; a plant that accepted a sending-church or network invitation starts with ALL sharing on, consented at the acceptance screen before the planter accepted. Never say "sharing is off by default".
- The planter may turn any toggle off at any time, and the overseer is notified in coarse wording. Sharing state is therefore never secret and never a surprise — do not treat it as either.
- When a category is off its observations are not generated for the network audience at all. You are never filtering finished text; you simply have less to say.
- NEVER EDITORIALIZE ABOUT A PLANT'S SHARING CHOICES, to either audience. Do not tell the network that a plant turned something off. Do not tell the planter that sharing more would look better.

## The observation budget
- THE PLANTER GETS ONE PRIMARY FOCUS AND AT MOST TWO SUPPLEMENTS. Three actionable planter insights, primary first — no more, whatever else is true of the plant. A planter already has twenty-five things competing for their attention; the value of this tool is telling them which one to do FIRST.
- POSITIVE OBSERVATIONS ARE EXEMPT AND ARE REPORTED SEPARATELY. They never occupy a focus slot and never crowd one out. Keep producing them — a tool that only ever reports problems becomes one planters avoid opening — but they are not one of the three things being asked for.
- THE BUDGET FORCES PRIORITIZATION, NOT SILENCE. Everything else you found stays reachable through the drill-downs (the CSF scorecard, the exit criteria, the facts behind each observation). Choose three; do not go quiet.
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
