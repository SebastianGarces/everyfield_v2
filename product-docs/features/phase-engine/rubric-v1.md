# Plant Intelligence Rubric — v1 (DRAFT)

**Not in force.** The engine still runs on v0. This document is the v1 draft that
Bryan's review of v0 produced. `RUBRIC_V1_BODY` is registered in
`src/lib/phase-engine/rubric.ts` but `ACTIVE_RUBRIC_VERSION` stays `"v0"` until the
activation issue ([#538](https://github.com/SebastianGarces/everyfield_v2/issues/538))
flips it, after every [#469](https://github.com/SebastianGarces/everyfield_v2/issues/469)
sub-issue has landed. Nothing here reaches a planter yet.

---

## How to read this document

v1 starts as a copy of v0 and accumulates one ruled change at a time. Each sub-issue of
#469 edits the section it owns and adds its row to the change log below, so the whole v1
delta is auditable from this file. A section with no change-log row is still the v0 text.

The classification v0 used stays: ✅ means the number comes from the Launch Playbook or
the wiki; ⚠️ means it was a placeholder awaiting a practitioner ruling. A ⚠️ that has
since been ruled on is re-marked ✅ with the ruling recorded in the change log.

The source review is `bryan-comments-review.md` — Bryan's comments (C01–C26), the
recorded rulings, and the recommended v1 delta.

### Change log

| Change | Comments | Issue | What changed |
|---|---|---|---|
| Lens 2 stops inferring the planter is the bottleneck | C01, C13 | [#470](https://github.com/SebastianGarces/everyfield_v2/issues/470) | Lens 2 may claim who carries follow-up only from measured task ownership. Appendix B's "Delegate Follow-Up Responsibilities" sample replaced. |
| Stalled growth is 28 days, and any +1 resets it | C02, C22 | [#471](https://github.com/SebastianGarces/everyfield_v2/issues/471) | Lens 3's single "3 weeks flat" ⚠️ becomes two ruled levels: slowed at 21 days, stalled at 28. The 28-day comparison window is kept. |
| 50/100 are methodology benchmarks, not universal health | C03 | [#472](https://github.com/SebastianGarces/everyfield_v2/issues/472) | The numbers stay; the grammar around them changes, in Lens 3, in Phase 1, in the app copy and across the global wiki corpus. Undershoot is never an unhealthy verdict. |
| Lens 4 is Cohesion, not Unity | C04 | [#473](https://github.com/SebastianGarces/everyfield_v2/issues/473) | Renamed heading, slug (`cohesion`) and scorecard label. Signals unchanged. Unity is named as a relational judgment the engine does not attempt; the "unity is fragile" sample is deleted. |

---

## 1. How the engine works

Once a day, for each plant that has had activity, the system:

1. **Counts what is countable.** It queries the database for facts — how many people
   have signed a core-group commitment, when the last vision meeting was held, how
   many of the eight ministry roles have a leader, how many days until the launch date.
2. **Looks up the relevant methodology.** It retrieves the passages from the Launch
   Playbook and the wiki that relate to this plant's current phase and situation.
3. **Applies this rubric.** A language model receives the facts, the methodology
   passages, and this document, and writes the observations.
4. **Saves the result.** Planters and network staff read the saved result instantly.
   Nothing is generated while someone is waiting on a page.

A plant with no activity since its last assessment is not re-assessed. Time itself
counts as activity — a launch countdown moves whether or not anyone logs in.

## 2. The one rule I will not break: facts versus judgment

**The software counts. The language model interprets. These never mix.**

Every number that appears in an observation — every count, date, percentage, and
countdown — is computed by database query, never by the model. The model is given
those numbers and is forbidden from producing its own. Each observation must name
the specific facts that produced it, and I store those alongside it.

This matters for one reason: **a single invented number destroys a planter's trust in
everything else the system says.** A planter who reads "your core group has been at 18
for three weeks" and knows it is actually 24 will never trust the tool again. So the
model is never in a position to get a number wrong — it can only interpret numbers it
was handed.

What the model *does* contribute is judgment: which of twelve true observations
matters most this week, how to say it without being discouraging, and which part of
the methodology speaks to it.

## 3. What the system can actually see today

This bounds what any rule in this document can rely on. If a rule needs something not
on this list, I either add the data capture or the rule waits.

| Area | What is measured |
|---|---|
| **Core group** | Number of people with a signed core-group commitment; number with a launch-team commitment; net change over the last 28 days versus the 28 days before |
| **Vision meetings** | Total completed; date of the most recent; days since; average gap between recent meetings; attendance at the last two and the direction between them |
| **Follow-up** | How many contacts are in an active follow-up stage; how many days since the most neglected one was touched; how many are past the staleness threshold; **who owns each open follow-up task** — how many have no live owner, how many stale ones have no live owner, how many distinct people own one, and how many the planter owns |
| **Ministry roles** | Which of the eight roles (Worship, Children's, Assimilation, Small Groups, Admin/Finance, Facilities, Promotion, Technology) have a leader assigned |
| **Individuals** | Per person: how long they have been in the system, how many vision meetings attended, how many teams they serve on, whether they hold a commitment, whether they lead a team |
| **Training** | Programs defined, how many are required, completion rate across committed people |
| **Launch** | Target launch date and days remaining (or days elapsed if past) |
| **Planter attestations** | Things software cannot observe, which the planter confirms with a toggle: values documented, financial base in place, systems tested, and similar |

**Known weak spots.** Prayer and Generosity (lenses 5 and 6) have almost no
measurable representation today — they rest almost entirely on planter self-attestation.
See Appendix C, question 2.

---

## 4. Part A — The eight Critical Success Factor lenses

These are evaluated for every plant in every phase. Each lens defines what feeds it,
what healthy looks like, and what the engine should say when it is not.

**Legend:** ✅ from the Playbook or wiki · ⚠️ my placeholder, needs your ruling

### Lens 1 · Vision Casting

- **What feeds it:** vision-meeting cadence, attendance trend between the last two
  meetings, inflow of new contacts, conversion of attendees into core-group members.
- **Cadence target:** at least one vision meeting every **two weeks** ✅
- **Flag a slip at:** **21 days** with no meeting ⚠️
- **Healthy:** meetings happening on cadence, with a steady stream of *new* attendees
  rather than the same faces returning.
- **What it says:** cadence slipping ("no vision meeting in three weeks — the vision
  meeting is the engine of the whole launch"); attendance plateauing; strong conversion
  worth reinforcing.

### Lens 2 · Shared Ownership

- **What feeds it:** **measured ownership of follow-up.** Every follow-up task carries an
  assignee, and only members holding a committed status (core group, launch team, or
  leader) may hold one. From those assignments the engine counts: follow-ups with no live
  owner, stale follow-ups with no live owner, how many distinct people own follow-ups, and
  how many the planter owns.
- **Healthy:** invitations and follow-up spread across the core group — several distinct
  owners, and few follow-ups sitting without one.
- **What it says, when ownership is measured:** "You own 6 of the 9 open follow-ups.
  Handing some to committed members spreads ownership of growth — the second Critical
  Success Factor."
- **What it says, when ownership is not measured:** "8 follow-ups are currently stale. Make
  sure each one has a clear owner and reconnect with them this week." Staleness alone is
  the finding; it names no cause.
- **The rule this lens exists to enforce:** stale follow-ups do not prove the planter is
  carrying them. They may mean ownership was distributed badly, or that people did not do
  what they agreed to. **The engine may claim who carries follow-up only from the owner
  facts.** The v0 line "you are carrying all the follow-up yourself" is deleted from v1 and
  may not be reconstructed from volume or staleness.
- **Network wording:** "Several follow-ups have been waiting longer than the follow-up
  window. This may be worth a coaching conversation." Never an owner's name, never a cause.

**Ownership is task ownership, not relationship ownership.** The assignee owns the open
follow-up task, not the relationship with the contact; the person record is untouched. A
task assigned to somebody who has since been removed or demoted out of the committed set
counts as unowned, so an owner who leaves surfaces the follow-up again instead of hiding it.

### Lens 3 · Critical Mass

- **What feeds it:** committed core-group adult count, growth over the trailing 28 days,
  distance to goal, projected trajectory against the launch date.
- **These are this methodology's benchmarks, not a definition of a healthy plant.** ✅
  50 committed adults is the lower end of the benchmark range and 100 is the target,
  both drawn from the Launch Playbook. Different contexts and models reasonably launch
  at very different sizes — Bryan's own plant launched at 25. The engine reports
  distance and trajectory **relative to the benchmark**. It may not call a plant
  unhealthy, or its size a failure, for being under 50, and insight copy says "the
  Playbook benchmark", never "the requirement" or "needed for a healthy launch".
  *(Network-level configurability of these numbers is a later product decision, not a
  v1 change.)*
- **Growth comparison window:** **28 days** versus the prior 28 ✅ *(kept — weekly is
  noisy.)*
- **Flat growth is two levels, not one** ✅
  - **Momentum has slowed** at **21 days** since the last new committed adult.
  - **Growth has stalled** only at **28 days**. The engine may not use the word
    *stalled* for any shorter streak — one vision-meeting cycle can change the whole
    picture inside three weeks.
  - **Any new committed adult resets both clocks.** The engine measures days since the
    most recent person's *first* core-group commitment, so one new adult puts the
    streak back to zero. Somebody's second commitment — a launch-team card, a re-signed
    core-group card — is not a new adult and resets nothing.
  - This is a different measurement from the comparison window above. `growthDelta` can
    read flat while somebody joined yesterday; the streak is the fact the word *stalled*
    rests on.
- **Healthy:** trending toward at least 50 committed adults on a trajectory that
  reaches target before launch.
- **What it says:** "you are at 22 committed adults with four months to launch — at
  your current pace of two per week you will reach about 54, just over the minimum;
  consider increasing vision-meeting frequency."

### Lens 4 · Core Group Cohesion

- **What feeds it:** core-group meeting cadence, attendance consistency, breadth of
  engagement. *(Unchanged — the signals were never the problem.)*
- **Healthy:** regular core-group gatherings with consistent attendance.
- **This lens is not about unity, and used to be called that.** ✅ Attendance can tell
  you whether the group is holding together. It cannot tell you whether the group is
  *unified*: four people missing could be conflict, vacation, sickness, or work
  schedules, and the data does not say which. **Actual unity stays a relational
  judgment for the planter and their coach**, and the engine does not attempt it.
- **What it says:** the measured pattern and nothing past it — core-group meetings
  lapsing, or attendance dropping across several members this month. Never a spiritual
  state. The v0 line "unity is fragile in this season" is deleted from v1.
- **Flag cluster disengagement at:** **4 or more** members' attendance dropping within
  a month ⚠️

### Lens 5 · Prayer

- **What feeds it:** whether a Prayer Leader has been identified; prayer rhythms, if
  attested by the planter.
- **Healthy:** prayer leadership identified and rhythms established.
- **What it says:** "no Prayer Leader identified yet — Prayer is the fifth Critical
  Success Factor and one of the eight roles to fill before launch."
- **⚠️ This lens is nearly blind.** Almost nothing about prayer is observable in
  software. I would rather say little than say something hollow — but if prayer health
  is genuinely central to your assessment of a plant, tell me what a planter could
  reasonably record that would make it visible.

### Lens 6 · Generosity

- **What feeds it:** whether a financial base has been established (planter attestation
  today; giving data when financial tracking ships).
- **Healthy:** sacrificial giving evident among the core group; first-year budget viable.
- **What it says:** "financial base not yet confirmed — Generosity and 'finances in
  place' are both launch gates."

### Lens 7 · Emerging Leadership

- **What feeds it:** how many of the eight ministry roles are filled; per-person
  readiness signals (sustained attendance, volunteering, tenure); coverage gaps as
  launch approaches.
- **Healthy:** leaders emerging from within the core group to own the eight
  responsibilities; no critical role unfilled close to launch.
- **What it says — two distinct kinds:**
  - *Individual pipeline:* "Sara has not missed a core-group meeting or volunteer slot
    in two months — that is the profile of an emerging leader; worth a leadership
    conversation."
  - *Coverage gap:* "you added five core members last week but still have no Worship
    Leader with launch three months out — of the eight roles, this is the one to focus
    on now."
- **⚠️ Individual-readiness threshold:** I currently treat roughly **60 days** of
  unbroken attendance and volunteering as the signal. This is a guess.

### Lens 8 · Comprehensive Training

- **What feeds it:** training programs defined and assigned, completion rate across
  team members, distance to launch.
- **Healthy:** ministry-model and role training underway and on track to finish before
  launch.
- **What it says:** "Phase 3 is about training; you are six weeks in and none of your
  six team members have completed Boot Camp — training must finish before pre-launch."

---

## 5. Part B — What matters most in each phase

The eight lenses are always evaluated. Phase determines which ones get prioritized,
and what "ready to move on" looks like.

**Readiness marks are advisory.** The engine never blocks a planter from advancing.
If a planter says they are in Phase 3, they are in Phase 3, and the engine adjusts.
The readiness marks only shape what the engine *says*.

### Phase 0 · Discovery
- **Objective:** discern calling, define foundations (values, the Four Pillars), find a coach.
- **Priority:** Are foundations documented? Is a coach assigned? Ready to begin vision meetings?
- **Ready to advance when:** foundational modules complete, values documented, coach assigned. ✅

### Phase 1 · Core Group Development
- **Objective:** build toward this methodology's benchmark of 50–100 committed adults
  through vision meetings and follow-up. The benchmark is what this model plans around,
  not a universal definition of a healthy plant — see Lens 3.
- **Priority:** vision-meeting cadence, core-group growth, shared ownership of follow-up,
  and no warm contacts going cold.
- **Ready to advance when:** 30–40 committed adults, financial base in place, worship
  leader identified, geographic area set. ✅ *(Is 30–40 right, given the 50 minimum for
  launch? This is the gate I am least sure of.)*

### Phase 2 · Launch Team Formation
- **Objective:** transition core group into launch team; set the launch date; fill leadership.
- **Priority:** all eight team leaders; launch date set. Once the date exists, the
  countdown starts driving everything.
- **Ready to advance when:** all eight team leaders assigned, launch date set. ✅

### Phase 3 · Training & Preparation
- **Objective:** comprehensively train all ministry teams.
- **Priority:** training completion measured against time remaining; systems readiness.
- **Ready to advance when:** team training complete, systems tested, three to four weeks
  to launch. ✅

### Phase 4 · Pre-Launch (final three to four weeks)
- **Objective:** integration, testing, promotion executed.
- **Priority:** pre-launch services held, promotion plan executed, final checklist;
  countdown urgency is high.
- **Ready to advance when:** pre-launch services done, promotion executed. ✅

### Phase 5 · Launch Sunday
- **Objective:** execute a high-impact first service.
- **Priority:** the five priority details; readiness to capture guest information.
- **Ready to advance when:** first service complete, guest data entered, debrief done. ✅

### Phase 6 · Post-Launch
- **Objective:** sustainable weekly rhythms while sustaining growth.
- **Priority:** 48-hour guest follow-up rate ✅, assimilation journey, financial
  sustainability, growth.
- **Terminal phase** — focus shifts to ongoing health rather than advancement.

---

## 6. How observations are labeled

Every observation carries an urgency and an audience.

**Urgency** — four levels: **positive** (reinforcing something going well),
**info** (worth knowing), **watch** (needs attention soon), **urgent** (needs attention now).

I deliberately kept *positive* as a first-class level. A tool that only ever reports
problems becomes something planters avoid opening.

**⚠️ Open question:** I have no rule for how many observations one assessment should
contain. Today a plant typically receives four to seven. My instinct is that more than
five stops being a priority list. See Appendix C, question 1.

**Audience** — every observation is written for either the **planter** or the
**network**, never both. The same underlying fact produces differently-worded output
for each, and often produces output for only one.

## 7. What the sending network sees

This is the most sensitive design area in the feature, and the part most likely to
affect whether planters trust the platform at all.

Three rules govern it:

1. **The planter sees it first.** Network staff can never see an assessment the planter
   has not been able to see. No planter is surprised by something their overseer was
   told.
2. **Observations, never verdicts.** Network-facing language is deliberately
   conservative: "may be worth a coaching touchpoint," not "this plant is failing."
   The network view is a prompt for a conversation, not a score.
3. **The planter controls what is shared, and it is off by default.** Each plant
   chooses which categories of data to share with oversight. Nothing is shared unless
   the planter turns it on. When a category is off, the corresponding observations
   disappear from the network view entirely.

**Individual people are never named to the network.** A planter may see "Sara looks
like an emerging leader." The network sees, at most, that leadership development is
progressing. Person-level observations are structurally excluded — not filtered by
policy, but never generated for that audience in the first place.

The network also receives a coarse per-plant posture for portfolio views:
**on track** · **worth a look** · **readiness focus**.

**⚠️ The engine escalates to "readiness focus" when launch is within 30 days** — a
placeholder.
And a plant that shares nothing shows only its phase, which means a healthy private
plant and a struggling private plant look identical to a network director. I think
that is the correct trade. Please confirm.

---

## Appendix A — Target observations

These are the outputs I am aiming for, written as: *situation → what the engine says.*
They double as my test cases.

**Growth and core group**
1. *Momentum slowed* — 21 days since the last new committed adult, Phase 1 → "No new
   committed adults in three weeks. The vision meeting is the engine of growth — when
   did you last hold one?"
1b. *Stalled growth* — 28 days since the last new committed adult → "Your core group has
   held at 18 for four weeks."
2. *Trajectory against launch* — 22 committed, growing by two per week, launch in 16
   weeks → "At your current pace you will reach about 54 by launch, just over the 50
   minimum. To hit the 100 target you would need roughly five per week."

**Vision meetings**
3. *Cadence slip* — no meeting in 21 days, Phase 1 → "It has been three weeks since
   your last vision meeting. The cadence is at least every two weeks — this is the
   single most load-bearing habit of the launch."
4. *Attendance plateau* — last three meetings roughly equal, few new contacts → "Attendance
   is steady but few *new* people are coming. Are your core members inviting?"

**Leadership**
5. *Individual readiness* — 60+ days of unbroken attendance and volunteering, not yet a
   leader → "Sara has not missed a core-group meeting or volunteer slot in two months.
   That is the profile of an emerging leader — worth a leadership conversation."
6. *Coverage gap near launch* — Worship Leader unfilled, launch in 90 days → "You added
   five core members last week — good — but still no Worship Leader with launch about
   three months out. Of the eight roles, this is the one to focus on now."
7. *Role progress* — six of eight filled in Phase 2 → "Six of eight launch roles are
   filled. Remaining: Children's Ministry, Promotion."

**Follow-up**
8. *Cold contacts* — vision-meeting attendees with no contact in 14 days → "Seven people
   who came to a vision meeting have not been followed up with in two weeks. Warm
   contacts go cold fast."
8b. *Follow-ups without an owner* — 8 stale, no owner recorded on any → "8 follow-ups are
   currently stale. Make sure each one has a clear owner and reconnect with them this week."
8c. *Ownership concentrated* — 9 open follow-ups, 6 assigned to the planter → "You own 6 of
   the 9 open follow-ups. Handing some to committed members spreads ownership of growth —
   the second Critical Success Factor."

**Launch readiness**
9. *Gates open, clock running* — launch date set, two of eight roles filled, training not
   started, ten weeks out → "Launch is ten weeks away. Training has not started and six
   roles are unfilled — at this distance both should be in motion."
10. *Ready to advance* — Phase 1, 38 committed, finances attested, worship leader
    identified → "You have hit the marks for Launch Team Formation: 38 adults, finances
    confirmed, worship leader identified. Ready to advance when you are."

**Cohesion, prayer, generosity**
11. *Cluster disengagement* — four or more members' attendance dropped this month →
    "Several core members' attendance has dropped this month — worth checking in."
    *(v0 continued "Unity is fragile in this season". The engine does not know that;
    it knows attendance dropped.)*
12. *Missing role* — no Prayer Leader by mid-Phase 2 → "No Prayer Leader identified.
    Prayer is the fifth Critical Success Factor and one of the eight launch roles."

**Network-facing** (conservative framing)
13. *On track* — "Plant is tracking to plan — core group growing steadily, launch date
    set, six of eight roles filled."
14. *Stalling* — "Core-group growth has been flat for about four weeks and no vision
    meeting was held in that window. May be worth a coaching touchpoint."
15. *Readiness* — "Approaching Launch Team Formation readiness — core-group size and
    worship leadership in place; financial base still unconfirmed."

---

## Appendix B — Real output, unedited

Below is genuine output from the working system. **The plant is fictional** — one of
twelve test plants I built to cover the range from cold-start to thriving. The plant
below is deliberately a struggling one: an early-phase plant that has stalled.

This is the tone question. Read it as if you were the planter.

> **Situation as measured:** Phase 1 · 7 committed adults · no growth in 28 days ·
> last vision meeting 30 days ago · attendance fell from 20 to 11 · 8 follow-ups
> untouched, oldest 37 days · 0 of 8 ministry roles filled

**Shown to the planter:**

> ⚠️ **Increase Vision Meeting Frequency and Attendee Engagement**
> Your vision meeting attendance has decreased from 20 to 11, with an average cadence
> of 30 days between meetings. Increase the frequency of vision meetings to at least
> bi-weekly to improve engagement and momentum.

> ⚠️ **Give Every Stale Follow-Up a Clear Owner**
> 8 follow-ups are currently stale. Make sure each one has a clear owner and reconnect
> with them this week.

*(v0 said "Delegate Follow-Up Responsibilities to Core Group Members — you have 8 stale
follow-ups… start empowering core group members to take ownership." That told the planter
why the follow-ups were stale, which the system did not know. This plant has no follow-up
owners recorded, so v1 reports the staleness and stops. Once owners are assigned, the same
situation produces the measured line instead: "You own 6 of the 9 open follow-ups…")*

**Shown to the sending network** (same plant, same moment):

> **Core Group Growth Stagnation**
> The core group has been static at 7 committed adults for the last 28 days, well below
> the target needed for healthy phase progression. Intervention to boost growth is
> needed to reach the critical mass target of at least 50 adults.

> **No Ministry Roles Filled Yet**
> None of the 8 key ministry roles are filled, indicating a lack of emerging leadership.
> This is critical for future readiness and indicates that leadership development needs
> attention.

Every number above was computed from the database, not written by the model. Each
observation links back to the relevant wiki articles — in this case "What is a Core
Group?", "Growing Your Core Group", and "Your First Vision Meeting."

**Questions worth asking of this sample:** Is the planter language direct enough, or
too soft? Is "Intervention to boost growth is needed" the right register for a network
director, or does it read as a verdict? Is it correct that the network sees the growth
stall while the planter is instead told about meeting cadence — or should both audiences
see the same headline?

---

## Appendix C — Decisions I need from you

1. **How many observations per assessment?** Today a plant gets four to seven. Is there
   a number past which a planter stops reading? Should urgent items crowd out everything
   else, or should there always be at least one positive?

2. **Prayer and Generosity.** These two lenses are nearly invisible to software. Options:
   accept thin coverage; lean on planter self-attestation; or add data capture. What
   would a planter plausibly record that would make prayer health visible without
   turning it into a compliance exercise?

3. **Every ⚠️ threshold in this document.** Collected: 21 days for a cadence slip ·
   28-day growth comparison window · ~~3 weeks flat to call growth stalled~~ *(ruled:
   21 days slowed / 28 days stalled — #471)* · 4+ members
   for cluster disengagement · 60 days for individual leadership readiness · 14 days
   before a follow-up is stale · 30 days out for network readiness escalation ·
   30–40 committed adults for the Phase 1 gate. Which are wrong?

4. **Network conservatism.** Is the Appendix B network wording appropriately restrained?
   Where is the line between useful oversight and a planter feeling surveilled?

5. **Anything absent.** The eight lenses came from the Playbook's Critical Success
   Factors. If there is something you assess in a plant that has no lens here, that is
   the most valuable thing you can tell me.

---

## Glossary

| Term | Meaning here |
|---|---|
| **Assessment** | One dated set of observations for one plant. A new one is produced when the plant has activity, at most about once a day. |
| **Observation / insight** | A single finding: a title, a short explanation, an urgency, an audience, and the facts that produced it. |
| **Fact snapshot** | The complete set of counted facts at the moment of assessment. Stored permanently, so any observation can be explained later. |
| **Signal** | One measured fact (e.g. days since last vision meeting). |
| **Attestation** | Something the planter confirms by hand because software cannot see it. |
| **Phase** | Which of the seven stages (0–6) the plant is in. Planter-controlled; never changed automatically. |
| **Readiness marks** | What "ready for the next phase" looks like. Advisory only — never blocking. |
| **Rubric version** | Which version of this document produced a given assessment. This document is v1, and it is not yet in force. |
| **Follow-up owner** | The assignee of an open follow-up task. Task ownership only — it says nothing about who owns the relationship with the contact. |
