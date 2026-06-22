# Plant Intelligence Rubric — v0 (Draft)

> **Status:** First draft, mined from `launch-playbook.md` and the 96-article wiki corpus.
> **This is the moat artifact.** It is a *versioned, editable* evaluation framework — the rules the LLM-as-judge reasons against. Refine it continuously from planter / coach / network feedback. Every assessment snapshot records the rubric version that produced it (see `frd.md` PE-D4).
> **Not finalized:** thresholds and gate language are pending validation with Brett & Bryan (the only external dependency, per `gap-report-2026-06.md` §3 P1-1).

This rubric has two parts:
- **Part A — The 8 CSF Lenses:** cross-phase health dimensions, always evaluated.
- **Part B — Phase Focus:** what matters *most right now* given the plant's current phase, plus the readiness gates for advancing.

The judge combines both: it scores the CSF lenses against the **fact snapshot** (computed deterministically — the judge never counts), then prioritizes through the lens of the current phase, then phrases the output for the audience (planter vs. network).

---

## Part A — The 8 Critical Success Factor Lenses

The playbook's 8 CSFs are the persistent backbone of plant health. Each lens defines: the signals that feed it, what "healthy" looks like, and the insight types the judge should raise. (Signals are computed facts; see `frd.md` Signal Catalog.)

### CSF-1 · Vision Casting
- **Signals:** vision-meeting cadence (target: ≥1 every 2 weeks), attendance trend per meeting, new-contact inflow from meetings, conversion of attendees → core group.
- **Healthy:** meetings happening on cadence; a steady stream of *new* attendees, not the same faces.
- **Insight types:** cadence slipping ("no vision meeting in 3 weeks — the engine of the whole launch is the vision meeting"); attendance plateauing; strong conversion worth reinforcing.
- **Wiki:** P1 "What is a Vision Meeting?", "8 Critical Success Factors for Vision Meetings", "Planning Your Vision Meeting".

### CSF-2 · Shared Ownership
- **Signals:** breadth of who is inviting/following up (is it only the planter, or are core members bringing people?), distribution of follow-up activity across people.
- **Healthy:** invitations and follow-up are spread across the core group, not carried solely by the planter.
- **Insight types:** "you're carrying all the follow-up yourself — shared ownership of growth is CSF #2; start handing invitations to your committed members."
- **Wiki:** P1 "Growing Your Core Group", "The Core Group Funnel".

### CSF-3 · Critical Mass
- **Signals:** committed core-group adult count, weekly/monthly growth delta, distance to the 50 (min) / 100 (target) goal, projected trajectory vs. launch date.
- **Healthy:** trending toward ≥50 committed adults on a trajectory that reaches target before launch.
- **Insight types:** "you're at 22 committed adults with 4 months to launch — at your current pace of +2/week you'll reach ~54 by then, just over the minimum; consider increasing vision-meeting frequency"; growth stalled N weeks.
- **Wiki:** P1 "What is a Core Group?", "Building Your Core Group", P0 "8 Critical Success Factors Overview".

### CSF-4 · Unity
- **Signals:** core-group meeting cadence, attendance consistency, engagement breadth.
- **Healthy:** regular core-group gatherings with consistent attendance.
- **Insight types:** core-group meetings lapsing; a cluster of members disengaging (attendance dropping across several people at once).
- **Wiki:** P1 "Core Group Meeting Format", "Core Group Commitments Explained".

### CSF-5 · Prayer
- **Signals:** Prayer Leader role assigned? (P2 team role); prayer-related activity if tracked. *(Largely a manual-attestation signal today — flagged: PRAY has weak system representation, see FRD open questions.)*
- **Healthy:** prayer leadership identified; prayer rhythms established.
- **Insight types:** "no Prayer Leader identified yet — Prayer is CSF #5 and one of the 8 ministry roles to fill before launch."
- **Wiki:** P2 "The Prayer Leader Role".

### CSF-6 · Generosity
- **Signals:** financial base established (manual attestation until F7); giving data when F7 ships.
- **Healthy:** sacrificial giving evident among the core group; first-year budget viable.
- **Insight types:** "financial base not yet confirmed — Generosity (CSF #6) and 'Finances in place' (Objective #4) are launch gates."
- **Wiki:** P0 "First Year Budget Planning", "Principles of Financial Accountability".

### CSF-7 · Emerging Leadership
- **Signals:** how many of the **8 ministry team roles** are filled (Worship, Children's, Assimilation, Small Groups, Admin/Finance, Facilities, Promotion, Technology); per-person leadership-readiness signals (sustained attendance + volunteering + tenure); coverage gaps near launch.
- **Healthy:** leaders emerging from within the core group to own the 8 responsibilities; no critical role unfilled close to launch.
- **Insight types:** **individual pipeline** ("Sara hasn't missed a core-group meeting or volunteer slot in 2 months — she's showing the marks of an emerging leader; consider a leadership conversation"); **coverage gap** ("you added 5 core members last week but still have no Worship Leader, and you're 3 months from launch — this is now the priority").
- **Wiki:** P2 "Key Leadership Roles Overview" + the 8 role articles, P0 "The 5 Interview Criteria".

### CSF-8 · Comprehensive Training
- **Signals:** training programs created / assigned, training completion across team members, distance to launch.
- **Healthy:** ministry-model and role training underway and on track to complete before launch.
- **Insight types:** "Phase 3 is about training, you're 6 weeks in and 0 of 6 team members have completed Boot Camp — training must finish before pre-launch."
- **Wiki:** P3 "Training Programs Overview", "Boot Camp Overview", "Ministry-Specific Training".

---

## Part B — Phase Focus

For each phase: the **primary objective**, the **judge's priority lens**, the **readiness gates** for advancing (from `system-architecture.md`), and the **wiki sections** that anchor advice. The gates are *advisory* — they inform the readiness insight, they do not block transitions.

### Phase 0 · Discovery
- **Objective:** discern calling, define foundations (values / 4 Pillars), find a coach.
- **Priority lens:** Are the foundations documented? Is a coach assigned? Is the planter ready to begin vision meetings?
- **Readiness for 0→1:** foundational modules complete, values documented, coach assigned.
- **Wiki:** P0 Getting Started, Discovery, Frameworks ("The 4 Pillars", "Defining Your Church Values", "Finding a Coach/Mentor", "The 4 C's").

### Phase 1 · Core Group Development
- **Objective:** build to 50–100 committed adults through vision meetings + follow-up.
- **Priority lens:** CSF-1 (vision-meeting cadence), CSF-3 (core-group growth), CSF-2 (shared ownership of follow-up), follow-up health (no warm contacts going cold).
- **Readiness for 1→2:** 30–40 committed adults, financial base, worship leader identified, geographic area set.
- **Wiki:** P1 Vision Meetings, Follow Up, Commitment, Core Group, Building Your Core Group.

### Phase 2 · Launch Team Formation
- **Objective:** transition core group → launch team; set launch date; fill leadership.
- **Priority lens:** CSF-7 (all 8 team leaders), launch date set, the launch-date countdown begins driving everything.
- **Readiness for 2→3:** all 8 team leaders assigned, launch date set.
- **Wiki:** P2 Launch Team, Launch Date, Leadership (8 role articles), Project Management.

### Phase 3 · Training & Preparation
- **Objective:** comprehensively train all ministry teams.
- **Priority lens:** CSF-8 (training completion vs. time-to-launch), systems readiness.
- **Readiness for 3→4:** team training complete, systems tested, 3–4 weeks to launch.
- **Wiki:** P3 Training.

### Phase 4 · Pre-Launch (final 3–4 weeks)
- **Objective:** integration, testing, promotion executed.
- **Priority lens:** pre-launch services done, promotion plan executed, final checklist, countdown urgency high.
- **Readiness for 4→5:** pre-launch services done, promotion executed.
- **Wiki:** P4 Pre Launch.

### Phase 5 · Launch Sunday
- **Objective:** execute a high-impact first service.
- **Priority lens:** the 5 priority details; guest-capture readiness.
- **Readiness for 5→6:** first service complete, guest data entered, debrief done.
- **Wiki:** P5 Launch Sunday.

### Phase 6 · Post-Launch
- **Objective:** sustainable weekly rhythms while sustaining growth.
- **Priority lens:** 48-hour guest follow-up rate, assimilation journey, financial sustainability, growth metrics.
- **Readiness:** (terminal phase — focus shifts to sustained-health monitoring.)
- **Wiki:** P6 Post Launch.

---

## Appendix — Insight Catalog (seed examples)

These are the judge's target outputs and double as **eval cases** for tuning the rubric. Each is: a fact pattern → the insight. Facts are deterministic; the framing/priority is the judge's.

**Growth & core group (CSF-3)**
1. *Stalled growth:* core-group count flat for 3+ weeks in Phase 1 → "Your core group has held at 18 for three weeks. The vision meeting is the engine of growth — when did you last hold one?"
2. *Trajectory vs. launch:* 22 committed, +2/wk, launch in 16 weeks → "At your current pace you'll reach ~54 by launch — just over the 50 minimum. To hit the 100 target, you'd need roughly +5/week."

**Vision meeting cadence (CSF-1)**
3. *Cadence slip:* no vision meeting logged in 21 days, Phase 1 → "It's been 3 weeks since your last vision meeting. Playbook cadence is at least every 2 weeks — this is the single most load-bearing habit of the launch."
4. *Attendance plateau:* last 3 meetings ~same headcount, low new-contact inflow → "Attendance is steady but few *new* people are coming. Shared ownership (CSF #2): are your core members inviting?"

**Leadership pipeline (CSF-7)**
5. *Individual readiness:* a person with 60+ days of unbroken core-group + volunteer attendance, not yet a leader → "Sara hasn't missed a core-group meeting or volunteer slot in 2 months. That's the profile of an emerging leader — worth a leadership conversation."
6. *Coverage gap near launch:* Worship Leader role unfilled, launch in ~90 days → "You added 5 core members last week — great — but still no Worship Leader with launch ~3 months out. Of the 8 roles, this is the one to focus on now."
7. *Role progress:* 6 of 8 ministry roles filled in Phase 2 → "6 of 8 launch roles are filled. Remaining: Children's Ministry, Promotion."

**Follow-up health (CSF-2 / playbook 'Follow Up')**
8. *Cold contacts:* N vision-meeting attendees with no follow-up activity in 14 days → "7 people who came to a vision meeting haven't been followed up with in 2 weeks. 'Great follow-up is vital' — warm contacts go cold fast."

**Launch readiness / countdown**
9. *Date set, gates open:* launch date set, 2 of 8 roles filled, training not started, 10 weeks out → "Launch is 10 weeks away. Training hasn't started and 6 roles are unfilled — at this distance, both should be in motion."
10. *Readiness to advance:* Phase 1, 38 committed adults, financial base attested, worship leader identified → "You've hit the marks for Launch Team Formation (Phase 2): 38 adults, finances confirmed, worship leader identified. Ready to advance when you are."

**Engagement / unity (CSF-4)**
11. *Cluster disengagement:* 4+ core members' attendance dropped in the last month → "Several core members' attendance has dropped this month. Unity (CSF #4) is fragile in this season — worth checking in."

**Prayer & generosity (CSF-5 / CSF-6)**
12. *Missing role:* no Prayer Leader assigned by mid-Phase 2 → "No Prayer Leader identified. Prayer is CSF #5 and one of the 8 launch roles."

**Network-facing (health, conservative framing — see FRD privacy rules)**
13. *On track:* "Plant is tracking to plan — core group growing steadily, launch date set, 6 of 8 roles filled."
14. *Stalling signal:* "Core-group growth has been flat for ~4 weeks and no vision meeting was held in that window. May be worth a coaching touchpoint." *(Observation, not verdict. Planter sees this before the network does.)*
15. *Readiness assessment:* "Approaching Phase 2 readiness — core-group size and worship leadership in place; financial base still unconfirmed."
