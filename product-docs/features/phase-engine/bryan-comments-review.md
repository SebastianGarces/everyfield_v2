# Bryan’s comments on the Plant Intelligence Rubric — classified

Source: [plant-intelligence-rubric-v0](https://docs.google.com/document/d/1YS6z8pbSeAl2yL-q3C93VvGuE4pxroh1PTzD2LAeeUk/edit) (Google Doc, `gsgarces1@gmail.com`).
Reviewer: Bryan Nass. Pulled 2026-08-17.

**Closed 2026-08-21.** All 26 comments are dispositioned and rubric v1 is in force — see [Disposition](#disposition-all-26-comments-2026-08-21) at the foot of this file. The rest of this document is the working review as it stood, kept unedited: it is the reasoning the rulings came from.

Duplicate comments are grouped under the unique rubric change they imply; the full inventory is at the bottom.

---

## Recorded rulings (2026-08-18)

Walked in Lavish, comments one by one. Session ended after C26. **C12 (weekly vs biweekly cadence) was skipped — no ruling yet.**

Sebastian’s rulings. `Accept` = take the proposed rubric edit as written. `Accept with tweak` = agree, plus the note.

| ID | Unique change | Ruling | What to do besides the rubric |
|---|---|---|---|
| C01 | Shared ownership / stop inferring the planter is the bottleneck | Tweak | Track **follow-up ownership** so the planter can see who owns what, not only “you are carrying this.” Phrase the network version more carefully than the planter version. File an issue for the data capture. |
| C02 | Stall = 28 days; +1 adult resets | Accept | |
| C03 | 50/100 are methodology benchmarks | Tweak | Soften this number **across the app and wiki**, not only the rubric. Wiki should call it a benchmark, not a strict gate. Parent + sub-issues for the whole review. |
| C04 | Rename Unity → Cohesion / Engagement | Tweak | Agree we may not call it Unity. Search **codebase + EveryField docs** and rename across the board. |
| C05 | Prayer = rhythms, not a title | Tweak | Move to attestation **and ship the UI**. Separate issue: better ways to track prayer health than toggles. |
| C06 | Split Generosity from Financial Readiness | Tweak | Split the scores, but scoring waits on the financial feature (#114, likely post-alpha). Generosity ≈ who gives and how often; readiness ≈ funds available to launch. |
| C07 | 60 days = Leadership Candidate Signal | Tweak | Keep “signal,” not “readiness.” Also feed it from **interviews / Four C’s** once those records exist. |
| C08 | Phase 1 30–40 as a cluster | Tweak | Keep the cluster. Spec a better score than headcount: size + trajectory + finances + leadership. |
| C09 | Observation budget 1+2 | Accept | |
| C10 | Sharing: agreement vs forever-optional | Tweak | Already partly specced: invite from sending org turns some toggles on; turning them off notifies the org. Link that spec to the rubric. Open: maybe planters cannot turn those off. |
| C11 | Private plants must not look on track | Accept | |
| C13 | Same as C01 (Appendix B follow-up sample) | Tweak | Duplicate of C01 — same ruling. |
| C14 | Unfilled roles ≠ lack of emerging leadership | Accept | |
| C15 | Network tone too clinical | Tweak | Audit rubric language for a **coaching** register, not organizational/clinical. |
| C16 | Planter sees the same diagnosis first | Tweak | Same language issue. Consider a **delay** between planter view and network view. |
| C17 | Insufficient-evidence / unknown state | Accept | |
| C18 | Observation budget 1+2 (Appendix C) | Accept | Duplicate of C09. |
| C19 | Planter sustainability | Tweak | Treat as a **feature**: recurring (weekly) planter check-in, similar to Four C’s interviews, maybe an auto-scheduled task. Whether that reaches the sending org is still open. |
| C20 | Launch health vs church health | Tweak | Be explicit that PI is **launch** health. Separate issue to interview Brett/Bryan on church-health later. |
| C21 | Prayer/generosity capture questions | Tweak | Too many attestation questions for the current `/phase` block. Need a **cycle** (weekly/daily vs milestone) that is not cumbersome. |
| C22 | ⚠️ threshold pack | Accept | |
| C23 | 30-day compound trigger; keep 30–40 cluster | Accept | |
| C24 | Network philosophy right, samples too strong | Accept | |
| C25 | Planter never discovers diagnosis via overseer | Tweak | Consider a **planter confirmation** on `/phase` that releases the assessment to the sending org. |
| C26 | Source of growth (transfer vs new believers) | Tweak | People CRM already has origin. Use that as a signal. Professions/baptisms/evangelistic relationships could live on the person profile. Post-alpha; do not gamify. |

**Whole-review instruction:** every GitHub issue should quote Bryan in full, plus about three lines of the Doc before and after the anchored text.

Board (2026-08-18): parent [#469](https://github.com/SebastianGarces/everyfield_v2/issues/469) under #105, with one `needs-spec` sub-issue per unique change. C12 still has no ruling.

---

## What the comments actually require of the rubric

Bryan is not nitpicking numbers. He is drawing four lines the v0 rubric currently blurs:

1. **Say only what the data supports.** Stale follow-ups do not prove the planter is carrying them. Unfilled roles do not prove there are no emerging leaders. Time-to-launch alone does not prove a readiness problem.
2. **Measure the thing the lens is named for.** “Unity” is cohesion. “Prayer” is rhythms, not a title. “Generosity” is giving culture, not solvency. “Leadership readiness” is a candidate signal, not character.
3. **Be a short coaching list, not a report.** One primary focus, two supplements. Network language points at a conversation, never a verdict. The planter sees the same diagnosis first.
4. **Be honest about blindness.** A blank is not “healthy.” Launch metrics are not church health. Transfer growth is not Great Commission fruit. A plant can hit every launch number while the planter falls apart.

Those four lines are the v1 rubric. The threshold table is secondary.

---

## Unique rubric changes

Status key: **Change** = edit the rubric. **Keep, reframe** = number stays, meaning or copy changes. **Product decision** = bigger than rubric wording. **Tension** = Bryan said two things; pick one.

### 1. Observation budget — 1 primary + 2 supplements

- **Status:** Change
- **Comments:** C09, C18
- **Where:** §6 How observations are labeled; Appendix C Q1
- **v0:** 4–7 observations; instinct that more than five stops being a priority list.
- **Bryan:** Even five is too many. “Of everything going on, these are the 1–3 things that matter most right now.” Later: “too many… 1 main 2 supplement.”
- **Rubric edit:** Cap the planter-facing list at **one primary + up to two secondary**. Everything else lives behind a drill-down, not in the main assessment. State whether urgent items crowd out a positive (he did not rule this; still open).

### 2. Shared ownership — stop inferring the planter is the bottleneck

- **Status:** Change (measurement + copy)
- **Comments:** C01, C13
- **Where:** Lens 2; Appendix B “Delegate Follow-Up…”
- **v0:** Infers planter-carries-it-all from stale follow-up volume. Sample copy: “Delegate Follow-Up Responsibilities to Core Group Members.”
- **Bryan:** Eight stale follow-ups could mean the planter is carrying everything, *or* ownership was distributed badly, *or* people did not do what they agreed. Capture an **owner per follow-up**, or only say what is known: “Eight follow-ups are currently stale. Make sure each one has a clear owner and reconnect with them this week.”
- **Rubric edit:** Lens 2 may not claim “you are carrying all the follow-up yourself” until ownership is a measured fact. Until then, the insight is *staleness + missing owners*, not *planter bottleneck*. Flag follow-up-owner capture as the data change that would make this lens real.

### 3. 50 / 100 are methodology benchmarks, not a definition of a healthy plant

- **Status:** Keep, reframe (and note future configurability)
- **Comments:** C03
- **Where:** Lens 3 Critical Mass
- **v0:** Minimum 50, target 100, marked Playbook-derived.
- **Bryan:** Fine *if* the rubric says these are **this planting methodology’s** benchmarks. They must not become universal health. His plant launched at 25 — he wanted to wait, the team wanted to go. Long term, networks should be able to configure this.
- **Rubric edit:** Preface Lens 3 with “for this methodology.” Do not treat undershoot as “unhealthy plant.” Park network-level configurability as a later product decision, not a v1 block.

### 4. Stalled growth — 28 days to say “stalled”; any new adult resets the clock

- **Status:** Tension → recommended Change
- **Comments:** C02, C22
- **Where:** Lens 3 “Flag stalled growth at 3 weeks”; Appendix C Q3
- **v0:** 3 weeks flat.
- **Bryan, first pass (on the 3-week line):** “3 weeks seems ok but even one extra adult should change this.”
- **Bryan, second pass (threshold list):** Change to **28 days**. “Momentum has slowed” can fire sooner; do not confidently label growth *stalled* until about four weeks, because one vision-meeting cycle can change it.
- **Recommended ruling:** Adopt the later, more precise comment. **“Slowed” at ~21 days. “Stalled” at 28 days flat. Any net +1 committed adult resets both.** Write that into Lens 3 so the judge cannot call 3 weeks of zero “stalled.”

### 5. Rename Lens 4 — Unity → Core Group Cohesion / Engagement

- **Status:** Change
- **Comments:** C04
- **Where:** Lens 4
- **v0:** Unity, fed by meeting cadence, attendance consistency, engagement breadth. Flag at 4+ members dropping in a month.
- **Bryan:** Attendance cannot tell you whether the group is *unified*. Four people missing could be conflict, vacation, sickness, or work. Call the lens **Cohesion** or **Engagement**. Actual unity stays a planter/coach relational judgment.
- **Rubric edit:** Rename the lens. Keep the attendance signals. Stop using “unity is fragile” copy. Cluster-drop threshold is replaced in change 15.

### 6. Prayer — attest rhythms, not a Prayer Leader title

- **Status:** Change
- **Comments:** C05, C21
- **Where:** Lens 5; Appendix C Q2
- **v0:** Feeds on “Prayer Leader identified” plus optional rhythm attestation. Nearly blind.
- **Bryan:** A title does not mean the plant prays. Capture:
  - Does the core group have an established **corporate prayer rhythm**?
  - Has that gathering/rhythm **actually happened in the last 30 days**?
  - Is prayer **regularly incorporated** into core-group / leadership gatherings?
- **Rubric edit:** Replace “Prayer Leader identified” as the health signal. Keep the role as coverage (Lens 7), not as Lens 5 health. Add the three attestations as what Lens 5 feeds on. Pair with the insufficient-evidence state (change 14) so an unanswered toggle is “unknown,” not healthy.

### 7. Split Generosity from Financial Readiness

- **Status:** Change
- **Comments:** C06, C21
- **Where:** Lens 6
- **v0:** One lens covering sacrificial giving *and* a viable first-year budget, fed today by a single “financial base” attestation.
- **Bryan:** Two different questions. A plant can be solvent from outside support while the core does not give. The reverse is also true — year 2, people give sacrificially, still not solvent. “We want to grow in plant ownership.”
- **Rubric edit:** Split the lens (or keep one CSF name and two scored signals):
  - **Generosity** — is the core learning to give sacrificially?
  - **Financial readiness** — is there enough money/support to launch and sustain?
  Until giving data exists, both are attestations, scored separately, never collapsed into “finances in place.”

### 8. 60 days is a Leadership Candidate Signal, not readiness

- **Status:** Keep the number, change the name and copy
- **Comments:** C07, C22
- **Where:** Lens 7; Appendix C Q3
- **v0:** ~60 days unbroken attendance + volunteering = “emerging leader” / “leadership readiness.”
- **Bryan:** Keep the signal. Do not call the person leadership-ready. Character, doctrine, gifting, maturity, teachability still need a human. Copy he wants: “It’s been 60 days — have you considered more for this person?”
- **Rubric edit:** Rename to **Leadership Candidate Signal**. Insight type is “worth a conversation,” never “this person is ready to lead.”

### 9. Phase 1 gate — keep 30–40, but only as a cluster

- **Status:** Keep, reframe
- **Comments:** C08, C23
- **Where:** Phase 1 “Ready to advance when”; Appendix C Q3
- **v0:** 30–40 committed adults + finances + worship leader + geography. Author was least sure of 30–40 given the 50 launch minimum.
- **Bryan:** Keep. This is “ready to begin Launch Team Formation,” not “ready to launch.” The engine must treat it as **size + trajectory + finances + leadership**, not a magic headcount.
- **Rubric edit:** Keep 30–40. State explicitly that no single mark fires “ready.” Hitting 30 with no worship leader and no financial base is not the gate.

### 10. Sharing with oversight — maybe an agreement, not forever-optional toggles

- **Status:** Product decision (not a rubric-number edit)
- **Comments:** C10
- **Where:** §7 “The planter controls what is shared, and it is off by default.”
- **Bryan:** Instinct is right for trust. Question: if a sending church is actually responsible for the planter, should oversight data stay optional forever? Maybe the sharing agreement is set up front by planter + sending org, not only as individual toggles.
- **What this means:** Current product ruling is planter-controlled, off by default. Bryan is asking whether a *formal sending relationship* is a different case. Do not silently change the rubric here — this needs a product ruling. If you keep the current rule, say so in the rubric so the judge and the UI stay aligned.

### 11. Private plants must not look “on track”

- **Status:** Change
- **Comments:** C11
- **Where:** §7 placeholder about plants that share nothing
- **v0:** A plant that shares nothing shows only its phase. Healthy-private and struggling-private look identical. Author thinks that is the correct trade.
- **Bryan:** Privacy tradeoff is probably right, **if** the network view explicitly says **“Limited visibility”** / “Plant has chosen not to share assessment data.” Absence of warnings must not read as on-track.
- **Rubric edit:** Confirm the privacy trade. Add a required network posture for unshared plants: **Limited visibility**, never On track / Worth a look / Readiness focus.

### 12. Vision cadence — he practiced weekly; rubric says every two weeks

- **Status:** Confirm (Playbook target can stay; copy can acknowledge consistency)
- **Comments:** C12
- **Where:** Appendix B planter sample (“Increase Vision Meeting Frequency…”)
- **Bryan:** “Yes. We met weekly and consistently. Inconsistency makes it hard for even the most committed team members to know when meetings happen.”
- **Read this as:** He is affirming the *diagnosis* (cadence matters; slipping is real), and reporting that **weekly** was his working rhythm. The Playbook-marked target in v0 is every two weeks. That is not a vote to change 14 days to 7 unless you want to. It *is* a vote that **consistency** belongs in the healthy definition, not only frequency.
- **Rubric edit (minimum):** Add “meetings happen on a predictable rhythm” to Lens 1 healthy. Optional open: should the target be weekly?

### 13. Unfilled roles ≠ “lack of emerging leadership”

- **Status:** Change (copy / inference)
- **Comments:** C14
- **Where:** Appendix B network sample “No Ministry Roles Filled Yet”
- **Bryan:** Zero assigned roles does not mean there are no emerging leaders. There may be several potential leaders who have not been assigned. Say: “No ministry roles have been assigned yet, so **leadership coverage** needs attention.”
- **Rubric edit:** Coverage-gap insights talk about **assignment / coverage**, never about the absence of leaders as people. Pair with change 8 (candidate signal is the people pipeline; role fill is the coverage pipeline).

### 14. Every lens has an evidence quality — including “insufficient evidence”

- **Status:** Change
- **Comments:** C17
- **Where:** Appendix C Q2 (Prayer and Generosity nearly invisible)
- **Bryan:** Prefer “We do not currently have enough information to assess prayer health” over a blank that can be read as healthy. Every lens should know whether its conclusion is **measured, attested, inferred, or unknown**.
- **Rubric edit:** Add an evidence-quality dimension to the rubric (not only to Prayer). A lens with no measured facts and no attestation returns **unknown**, never a quiet pass. Ban inferred conclusions unless the rubric names the inference and its weakness (see Lens 2).

### 15. Remaining ⚠️ thresholds

- **Status:** Mixed — see table
- **Comments:** C22, C23 (and C02, C07, C08 already covered)
- **Where:** Appendix C Q3

| Threshold | v0 | Bryan | Rubric edit |
|---|---|---|---|
| 21 days with no vision meeting | Flag a slip | **Keep, as a watch.** At 28+ days the language can get more direct. | Two-level cadence rule: watch at 21, stronger at 28. Not a crisis at 21. |
| 28-day growth comparison window | 28 vs prior 28 | **Keep.** Weekly is noisy. | None. |
| 3 weeks flat = stalled | 3 weeks | **Change to 28 days.** “Slowed” sooner. | See change 4. |
| 4+ members disengaging | Absolute 4 | **Replace with a percentage.** 20–25% of the active committed group over 28 days, with an absolute **minimum of 3**. Leaders weigh more. | Rewrite Lens 4 flag. Four of 12 is a crisis; four of 70 may not be. |
| 60 days leadership | Readiness | **Keep signal, change name.** | See change 8. |
| 14 days stale follow-up | Universal 14 | **Make it contextual.** Warm / just-came-to-a-vision-meeting: follow up in 48–72 hours; flag at **7 days**; seriously stale at 14. Colder contacts: 14 may be fine. | Split the follow-up stale rule by contact warmth. |
| 30 days → network “readiness focus” | Time alone | **Change the trigger.** 30 days out + significant unresolved gaps (e.g. 3 critical roles unfilled + training incomplete). 30 days out and on track = nothing to escalate. | Compound trigger. Time is never sufficient. |
| 30–40 to leave Phase 1 | Author unsure | **Keep**, as a combination of indicators. | See change 9. |

### 16. Network tone and planter-first diagnosis

- **Status:** Change
- **Comments:** C15, C16, C24, C25
- **Where:** §7; Appendix B network samples; Appendix C Q4
- **v0 rules (already close):** planter sees it first; observations never verdicts; conservative network language.
- **Bryan:** Philosophy is right. Appendix B is still too strong.
  - “Intervention to boost growth is needed” sounds like an underperforming business unit. Prefer: “Core-group momentum has slowed. This may be worth a coaching conversation around vision cadence, invitations, and follow-up.”
  - Network should see **patterns that warrant conversation**, not conclusions about causes. “Growth has been flat for four weeks” is allowed. Telling the director *why* is not, unless the system really knows why.
  - The planter must never discover the diagnosis through the overseer. Different wording is fine; **the same concern** must already have been shown to the planter. He wants the planter to see the contributing signals (“growth stalled, and two contributing signals are vision cadence and stale follow-up”) so that when elders raise it, the planter already has the explanation.
- **Rubric edit:**
  1. Ban verdict verbs for the network: *intervention, failing, critical, lack of*.
  2. Require a planter observation for every network observation (same underlying concern).
  3. Network copy names the measured pattern + “may be worth a coaching conversation.” It does not name a cause unless that cause is a measured fact.
  4. Replace the Appendix B network samples with the coaching register.

### 17. Scope: this product assesses launch health, not church health

- **Status:** Change (scope statement)
- **Comments:** C20
- **Where:** Appendix C Q5
- **Bryan:** The eight factors are good at “are we successfully moving toward launch?” They tell you less about whether a healthy local church is forming: qualified shepherding, discipleship, theological alignment, meaningful membership, pastoral care. That may be out of scope — **be explicit**.
- **Rubric edit:** Open the document with a scope sentence: Plant Intelligence assesses **progress toward a healthy launch under this methodology**, not the full health of a church. Name the out-of-scope list so the judge does not invent church-health verdicts.

### 18. Missing: planter sustainability

- **Status:** Add (attestation set, not a ninth CSF unless you decide it is)
- **Comments:** C19
- **Where:** Appendix C Q5
- **Bryan:** Biggest absence. Is the planter spiritually healthy? Is the marriage/family surviving? Is he financially sustainable? Is he building at a pace he can maintain? Software cannot measure most of it. He wants **periodic planter/coach attestation**, because a plant can hit every launch metric while the planter falls apart.
- **Rubric edit:** Add a “what we cannot see” section (or a planter-care attestation block) that the engine may surface as a prompt to the planter/coach, never as a scored CSF inferred from activity. Do not let launch-green wash planter-red.

### 19. Missing: source of growth (transfer vs. new believers)

- **Status:** Add (light visibility, do not gamify)
- **Comments:** C26
- **Where:** Appendix C Q5 (on “anything you assess that has no lens”)
- **Bryan:** The system measures that people are joining the core. It does not measure where they came from. 20 → 60 entirely from neighboring churches is launch growth and a very different Great Commission story from conversions, baptisms, and new believers being discipled. He wants light visibility — professions of faith, baptisms, evangelistic relationships — and explicitly **do not gamify conversion counts**.
- **Rubric edit:** Add a growth-*composition* note under Lens 3 (or a new weak signal): if the system cannot see source, say so. When capture exists, report mix without ranking plants on conversion count.

---

## Recommended v1 rubric delta (do these)

If you accept Bryan’s comments as the ruling, v1 of the rubric needs:

1. A **scope sentence** (launch health under this methodology, not church health).
2. An **observation budget**: 1 primary + 2 secondary.
3. An **evidence-quality** rule: measured / attested / inferred / unknown. Unknown ≠ healthy. Inferred conclusions are named and constrained.
4. **Lens 2** copy that does not accuse the planter until ownership is measured.
5. **Lens 3** framed as methodology benchmarks; stall = 28 days; +1 adult resets; optional later configurability.
6. **Lens 4** renamed; cluster flag becomes 20–25% over 28 days, min 3, leaders weighted.
7. **Lens 5** fed by prayer *rhythms*, not the Prayer Leader title.
8. **Lens 6** split into generosity vs. financial readiness.
9. **Lens 7** “Leadership Candidate Signal” at 60 days; coverage-gap copy never says “no emerging leaders.”
10. **Phase 1 gate** kept as a cluster, not a headcount.
11. **Cadence**: watch at 21 days, stronger at 28; healthy includes consistency.
12. **Follow-up stale** split by warmth (7 / 14, with 48–72h as the warm ideal).
13. **Network**: compound readiness-focus trigger; Limited visibility posture; planter-first same diagnosis; coaching register; no cause-inference.
14. **New attestations**: planter sustainability; (later) growth source.

Still needs a product ruling, not just a rubric edit *(as written 2026-08-18; three of the four were ruled during the series — see the disposition at the foot of this file)*:

- ~~Sharing: forever-optional toggles vs. an up-front sending agreement (change 10).~~ Ruled — ledger row 187, shipped by #479.
- **Whether the vision-meeting *target* stays biweekly or moves toward weekly (change 12). STILL OPEN** — deferred at the v1 flip.
- ~~Whether planter care is a ninth lens, an attestation block, or a coach prompt.~~ Ruled — none of the three; a private weekly check-in outside the pipeline (#484).
- ~~Whether 50/100 becomes network-configurable in v1 or later.~~ Ruled — later (#472).

---

## Full comment inventory

Anchors are the highlighted Doc text. Comments are quoted in full.

### C01 — Lens 2, inference note
**Anchor:** “I currently infer this indirectly from follow-up volume and staleness…”
**Maps to:** change 2

> I think this is too important to infer. Eight stale follow-ups could mean the planter is carrying everything, or it could mean responsibilities were distributed poorly, or people simply did not do what they agreed to do. I would either capture an owner for each follow-up or change the output so it only says what the system actually knows.

### C02 — Lens 3, “Flag stalled growth at 3 weeks”
**Anchor:** “Flag stalled growth at: 3 weeks flat”
**Maps to:** change 4 (tension with C22)

> ya 3 weeks seems ok but even one extra adult should change this

### C03 — Lens 3, 50 min / 100 target
**Anchor:** “Minimum: 50 committed adults · Target: 100”
**Maps to:** change 3

> I’m okay with these numbers if we are explicitly saying, “These are the benchmarks of this planting methodology.” I would be cautious about letting them become universal definitions of a healthy plant. Different contexts and models could reasonably launch at very different sizes. Long term, these may need to be configurable by a network.
>
> we only had 25 when we launched
> i wanted to wait the team wanted to go

### C04 — Lens 4, “What feeds it”
**Anchor:** “What feeds it: core-group meeting cadence, attendance consistency, breadth of engagement.”
**Maps to:** change 5

> I’m not sure I would call this Unity. Attendance and engagement can tell me something about cohesion, but they cannot really tell me whether the group is unified. Four people missing could be conflict, vacation, sickness, work schedules, etc. Maybe this lens is better called Core Group Cohesion or Engagement, and actual unity remains something assessed relationally by the planter/coach.

### C05 — Lens 5, “Healthy”
**Anchor:** “Healthy: prayer leadership identified and rhythms established.”
**Maps to:** change 6

> I would be careful not to equate having a Prayer Leader with being a praying plant. If prayer really is a critical success factor, I think a simple planter attestation about actual rhythms would tell us more. Something like: “Does the core team have an established rhythm of corporate prayer?” That seems more meaningful than whether somebody has the title

### C06 — Lens 6 Generosity
**Anchor:** the whole Generosity lens
**Maps to:** change 7

> I wonder if Generosity and Financial Readiness need to be separated. A plant could have a healthy financial base because of outside support while the core group is not giving sacrificially. The opposite could also be true. Those feel like related but distinct questions. We want to grow in plant ownership but we are in year 2 and people give sacrificially but we arent solvent yet.

### C07 — Lens 7, 60-day threshold
**Anchor:** “Individual-readiness threshold: I currently treat roughly 60 days…”
**Maps to:** change 8

> Sixty days feels reasonable as a “pay attention to this person” signal, but I would not call it leadership readiness. Attendance and volunteering can identify a potential leader, but character, doctrine, gifting, relational maturity, teachability, etc. still require human judgment. Maybe call this a Leadership Candidate Signal rather than readiness.
> "its been 60 days, have you considered more for this person?"

### C08 — Phase 1, 30–40 adults
**Anchor:** “Ready to advance when: 30–40 committed adults…”
**Maps to:** change 9

> 30–40 feels reasonable to me if this means “ready to begin Launch Team Formation,” not “ready to launch.” I would probably make sure the engine treats this as a cluster of indicators rather than 30–40 being a magic number. Size + trajectory + finances + leadership seems more meaningful than size alone.

### C09 — §6, how many observations
**Anchor:** “Today a plant typically receives four to seven. My instinct is that more than five…”
**Maps to:** change 1

> I think even five may be too many for the main view. As a planter, I already have 25 things competing for my attention. The value of this tool would be telling me, “Of everything going on, these are the 1–3 things that matter most right now.” Maybe show one primary focus and up to two secondary observations, with everything else available if I want to dig deeper.

### C10 — §7, sharing off by default
**Anchor:** “The planter controls what is shared, and it is off by default.”
**Maps to:** change 10

> I like the instinct here, especially for planter trust. One question though: should this work differently when someone has a formal sending/oversight relationship? If my sending church is actually responsible for me, I’m not sure all oversight data should simply be optional forever. Maybe the sharing agreement is established up front by the planter and sending organization rather than handled only as individual toggles.

### C11 — §7, private plants look identical
**Anchor:** “The engine escalates to ‘readiness focus’ when launch is within 30 days… a healthy private plant and a struggling private plant look identical…”
**Maps to:** change 11 (and the 30-day trigger in change 15)

> I think the privacy tradeoff is probably right, but could the network view explicitly say “Limited visibility” or “Plant has chosen not to share assessment data”? I would not want absence of warning signs to accidentally look like an “on track” signal.

### C12 — Appendix B planter sample, vision-meeting frequency
**Anchor:** “Increase Vision Meeting Frequency and Attendee Engagement…”
**Maps to:** change 12

> yes. we met weekly and consistently. inconsistency makes it hard for even the most committed team members to know when meetings happen.

### C13 — Appendix B planter sample, delegate follow-up
**Anchor:** “Delegate Follow-Up Responsibilities to Core Group Members”
**Maps to:** change 2

> This is a good example of the inference issue above. The system knows there are eight stale follow-ups. It does not currently know that the planter is personally responsible for them. I would say something like, “Eight follow-ups are currently stale. Make sure each one has a clear owner and reconnect with them this week.” That stays completely inside what the data can support.

### C14 — Appendix B network sample, “indicating a lack of emerging leadership”
**Anchor:** “indicating a lack of emerging leadership.”
**Maps to:** change 13

> Same issue here. Zero assigned ministry roles does not necessarily mean there is a lack of emerging leadership. There may be several potential leaders who simply have not been assigned yet. I’d say, “No ministry roles have been assigned yet, so leadership coverage needs attention.”

### C15 — Appendix B network sample, “Intervention to boost growth is needed”
**Anchor:** “…well below the target needed for healthy phase progression. Intervention to boost growth is needed…”
**Maps to:** change 16

> This feels too clinical/organizational to me. It sounds like an underperforming business unit. I would prefer something like, “Core-group momentum has slowed. This may be worth a coaching conversation around vision cadence, invitations, and follow-up.” Still direct, but it sounds like church planting and coaching rather than corporate intervention.

### C16 — Appendix B, “should both audiences see the same headline?”
**Anchor:** the question about network seeing the growth stall while the planter is told about meeting cadence
**Maps to:** change 16

> I would want the planter to see the underlying diagnosis before the network does. The audiences can absolutely get different wording, but I would not want the network receiving a negative conclusion that the planter was never shown. Maybe planter: “Growth has stalled, and two contributing signals are vision cadence and stale follow-up.” Network: the same concern, framed more conservatively. I always liked when I had an explanation of why something is happening that the elders are seeing.

### C17 — Appendix C Q2, Prayer and Generosity nearly invisible
**Anchor:** “Prayer and Generosity. These two lenses are nearly invisible to software.”
**Maps to:** change 14

> Could the system have an explicit “insufficient evidence” state? I would rather EveryField say, “We do not currently have enough information to assess prayer health” than leave a blank that could be interpreted as healthy. Maybe every lens internally knows whether its conclusion is measured, attested, inferred, or simply unknown.

### C18 — Appendix C Q1, how many observations
**Anchor:** “How many observations per assessment? Today a plant gets…”
**Maps to:** change 1

> too many... 1 main 2 supplement

### C19 — Appendix C Q5, anything absent
**Anchor:** “Anything absent. The eight lenses came from the Playbook’s Critical Success”
**Maps to:** change 18

> My biggest question about what is absent is planter sustainability. Is the planter spiritually healthy? Is his marriage/family surviving the process? Is he financially sustainable? Is he building at a pace he can actually maintain? I understand that software cannot measure most of that, but I would love some periodic planter/coach attestation because a plant can hit every launch metric while the planter himself is falling apart.

### C20 — Appendix C Q5, nested
**Anchor:** “If there is something you assess in a plant that has no lens here…”
**Maps to:** change 17

> The other thing I keep wondering about is whether we are measuring “launch health” or “church health.” These eight factors seem very good at evaluating whether someone is successfully moving toward launch. They tell us less about whether a healthy local church is actually being formed: qualified shepherding, discipleship, theological alignment, meaningful membership, pastoral care, etc. That may be totally outside the intended scope, but I think the product should be really clear about which of those two things it is claiming to assess.

### C21 — Appendix C Q2, options for making prayer/generosity visible
**Anchor:** “Options: accept thin coverage; lean on planter self-attestation; or add data capture…”
**Maps to:** changes 6 and 7

> For Prayer, I would probably capture things like:
> Does your core group have an established corporate prayer rhythm?
> Has that prayer gathering/rhythm actually happened in the last 30 days?
> Is prayer regularly incorporated into core-group/leadership gatherings?
> I don't think “Do you have a Prayer Leader?” tells you very much about whether prayer is actually central.
> For Generosity, I think there are actually two different things hiding under one lens:
> Generosity = are the people of the plant learning to give sacrificially?
> Financial readiness = does the plant have enough money/support to launch and sustain ministry

### C22 — Appendix C Q3, first half of the ⚠️ list
**Anchor:** “Collected: 21 days for a cadence slip · 28-day growth comparison window · 3 weeks flat… · 4+ members… · 60 days… · 14 days…”
**Maps to:** change 15 (and 4, 8)

> 21 days without a vision meeting: KEEP, but make it a "watch."
> If the intended rhythm is every 14 days, 21 days is a reasonable point for the system to notice that you're off cadence. I wouldn't make it sound like a crisis. At 28+ days, the language can get more direct.
> 28-day growth comparison: KEEP.
> That seems like a useful window. Weekly numbers will be noisy. Comparing rolling four-week periods gives you something meaningful without waiting too long.
> Three weeks flat = stalled: CHANGE TO 28 DAYS.
> Three weeks feels a little aggressive. I'd probably say "momentum has slowed" sooner, but I wouldn't confidently label growth "stalled" until roughly four weeks, especially because one vision-meeting cycle can radically change things.
> Four members disengaging: CHANGE COMPLETELY.
> This should be percentage based. Four people disappearing from a core group of 12 is a crisis. Four people becoming less consistent in a group of 70 may not mean much.
> I'd consider something like 20-25% of the active committed group showing a meaningful attendance decline over 28 days, perhaps with an absolute minimum of three people. And if those people are leaders, that should carry more weight.
> 60 days leadership readiness: KEEP THE SIGNAL, CHANGE THE NAME.
> Sixty days of reliable attendance and serving is enough for the software to say, "This person may be worth a leadership conversation." It is absolutely not enough to say the person is leadership-ready. Call it a leadership candidate signal.
> 14 days stale follow-up: DEPENDS ON THE CONTACT.
> A warm person who just came to a vision meeting shouldn't wait 14 days. Ideally that person is followed up with within 48-72 hours. I might flag it at seven days and call it seriously stale at 14.
> For colder contacts, 14 days may be perfectly reasonable.
> So I would make the threshold contextual rather than universal.

### C23 — Appendix C Q3, 30-day escalation and 30–40 gate
**Anchor:** “30 days out for network readiness escalation · 30–40 committed adults for the Phase 1 gate. Which are wrong?”
**Maps to:** changes 9 and 15

> 30 days for network readiness escalation: CHANGE THE TRIGGER.
> Thirty days out alone should not create a warning. Thirty days out with significant unresolved readiness gaps should.
> For example:
> "30 days from launch + 3 critical roles unfilled + training incomplete" = readiness focus.
> "30 days from launch + everything is on track" = nothing to escalate.
> 30-40 committed adults to leave Phase 1: KEEP.
> I actually think this is reasonable because the next phase is Launch Team Formation, not Launch Sunday. The rubric already combines that number with finances, worship leadership, and geography. I would make sure the system understands that it's the combination of indicators, not simply hitting 30.

### C24 — Appendix C Q4, network conservatism
**Anchor:** “Network conservatism. Is the Appendix B network wording appropriately restrained?”
**Maps to:** change 16

> My answer: the philosophy is right, but the Appendix B network language is still too strong.

### C25 — Appendix C Q4, the surveillance line
**Anchor:** “Where is the line between useful oversight and a planter feeling surveilled?”
**Maps to:** change 16

> The planter should never discover the diagnosis through his overseer. If the network is being told, "Core-group momentum has stalled," the planter should already have been told, "Your core-group momentum has stalled."
> The network should see patterns that warrant conversation, not conclusions about causes. The system can say, "Growth has been flat for four weeks." It should hesitate to tell a network director why unless it really knows why.
> Network language should almost always point toward coaching. Something like:
> "Core-group growth has remained flat for four weeks and vision-meeting cadence has slowed. This may be worth a coaching conversation."

### C26 — Appendix C Q5, nested on missing lenses
**Anchor:** “If there is something you assess in a plant that has no lens here, that is the most valuable thing you can tell me.”
**Maps to:** change 19

> Right now the system measures whether people are joining the core group. But where are those people coming from?
> A plant could grow from 20 to 60 entirely by attracting Christians from neighboring churches. From a launch standpoint, that's growth. From a Great Commission standpoint, that's telling me something very different from conversions, baptisms, and new believers being discipled.
> I would want some light visibility into:
> Are we actually reaching people who were far from Christ?
> Again, don't gamify conversion counts. But professions of faith, baptisms, evangelistic relationships, etc. seem important enough that I would want them somewhere.

---

## Open product questions (not answered by the comments)

1. ~~Accept Bryan’s comments as the v1 ruling, or wait for Brett?~~ *(Accepted as the v1 ruling, 2026-08-18. Brett’s review is a later pass against v1, not a gate on it.)*
2. ~~Sharing: keep planter-controlled off-by-default, or introduce a sending-relationship agreement?~~ *(Ruled: neither, exactly. There is no universal default — a self-started plant shares nothing, an invited plant starts with everything on and consents at the acceptance screen. `decisions.md` ledger row 187; rubric §7 via #479.)*
3. **Vision-meeting target: stay at every two weeks, or move toward weekly given his practice? — STILL OPEN.** Deferred at the v1 flip (#538). See C12 below.
4. ~~Planter sustainability: attestation block, coach prompt, or a named lens?~~ *(Ruled: none of the three. A private weekly planter check-in outside the assessment pipeline, which no model reads — rubric §5c via #484.)*
5. ~~50/100 configurability: later, or in v1?~~ *(Ruled: later. v1 changes the grammar around the numbers, not the numbers, and network-level configurability is a post-alpha product decision — #472.)*
6. ~~Should there always be one positive observation in the 1+2 budget, or can three urgent items crowd it out?~~ *(Ruled: neither — positives are exempt from the budget entirely and get their own surface, so they can neither crowd out a focus slot nor be crowded out — #478.)*

---

## Disposition: all 26 comments (2026-08-21)

Closed by [#538](https://github.com/SebastianGarces/everyfield_v2/issues/538), which assembled the 18 landed sub-issues into rubric v1 and flipped `ACTIVE_RUBRIC_VERSION`. Every comment below reached the shipped rubric or was explicitly deferred; none was silently dropped.

25 comments are ruled and implemented. **One — C12 — is deferred**, and it is deferred as a *question*, not as a gap: the rubric states the vision-meeting target as an open Playbook parameter rather than inventing a ruling for it.

| # | Subject | Ruling | Landed in |
|---|---|---|---|
| C01 | Stop inferring the planter is the bottleneck | Tweak | [#470](https://github.com/SebastianGarces/everyfield_v2/issues/470) |
| C02 | Stall = 28 days; one new adult resets it | Accept | [#471](https://github.com/SebastianGarces/everyfield_v2/issues/471) |
| C03 | 50/100 are methodology benchmarks | Tweak | [#472](https://github.com/SebastianGarces/everyfield_v2/issues/472) |
| C04 | Rename Unity → Core Group Cohesion | Tweak | [#473](https://github.com/SebastianGarces/everyfield_v2/issues/473) |
| C05 | Prayer is rhythms, not a title | Tweak | [#474](https://github.com/SebastianGarces/everyfield_v2/issues/474) |
| C06 | Split Generosity from Financial Readiness | Tweak | [#475](https://github.com/SebastianGarces/everyfield_v2/issues/475) |
| C07 | 60 days is a candidate signal, not readiness | Tweak | [#476](https://github.com/SebastianGarces/everyfield_v2/issues/476) |
| C08 | Phase 1 gate is a cluster, not a headcount | Tweak | [#477](https://github.com/SebastianGarces/everyfield_v2/issues/477) |
| C09 | Observation budget: 1 primary + 2 supplements | Accept | [#478](https://github.com/SebastianGarces/everyfield_v2/issues/478) |
| C10 | Sharing agreement vs forever-optional toggles | Tweak | [#479](https://github.com/SebastianGarces/everyfield_v2/issues/479) |
| C11 | Private plants must not read "on track" | Accept | [#480](https://github.com/SebastianGarces/everyfield_v2/issues/480) |
| **C12** | **Vision cadence — he met weekly and consistently** | **DEFERRED** | **Half shipped ([#486](https://github.com/SebastianGarces/everyfield_v2/issues/486)); target open — see below** |
| C13 | Appendix B follow-up sample (duplicate of C01) | Tweak | [#470](https://github.com/SebastianGarces/everyfield_v2/issues/470) |
| C14 | Unfilled roles are a coverage gap, not absent leaders | Accept | [#481](https://github.com/SebastianGarces/everyfield_v2/issues/481) |
| C15 | Network tone too clinical | Tweak | [#482](https://github.com/SebastianGarces/everyfield_v2/issues/482) |
| C16 | Planter sees the same diagnosis first | Tweak | [#482](https://github.com/SebastianGarces/everyfield_v2/issues/482) |
| C17 | Insufficient-evidence / unknown state | Accept | [#483](https://github.com/SebastianGarces/everyfield_v2/issues/483) |
| C18 | Observation budget, Appendix C (duplicate of C09) | Accept | [#478](https://github.com/SebastianGarces/everyfield_v2/issues/478) |
| C19 | Planter sustainability is the biggest absence | Tweak | [#484](https://github.com/SebastianGarces/everyfield_v2/issues/484) |
| C20 | Launch health, not church health | Tweak | [#485](https://github.com/SebastianGarces/everyfield_v2/issues/485) |
| C21 | Prayer/generosity capture questions | Tweak | [#474](https://github.com/SebastianGarces/everyfield_v2/issues/474) (prayer) + [#475](https://github.com/SebastianGarces/everyfield_v2/issues/475) (generosity) |
| C22 | The ⚠️ threshold pack | Accept | [#486](https://github.com/SebastianGarces/everyfield_v2/issues/486) |
| C23 | 30-day compound trigger; keep the 30–40 cluster | Accept | [#486](https://github.com/SebastianGarces/everyfield_v2/issues/486) |
| C24 | Network philosophy right, samples too strong | Accept | [#482](https://github.com/SebastianGarces/everyfield_v2/issues/482) |
| C25 | Planter never learns the diagnosis via the overseer | Tweak | [#482](https://github.com/SebastianGarces/everyfield_v2/issues/482) |
| C26 | Source of growth — transfer vs new believers | Tweak | [#487](https://github.com/SebastianGarces/everyfield_v2/issues/487) |

### C12, in full

C12 is two claims, and only one of them is a rubric question.

**Shipped:** consistency belongs in the healthy definition. "Inconsistency makes it hard for even the most committed team members to know when meetings happen" is now Lens 1's healthy line — meetings on cadence *and on a predictable rhythm* — and it arrived with the two-level cadence rule (#486).

**Deferred:** whether the *target* moves from every two weeks to weekly. Three reasons it is not ruled here:

1. **It is a Launch Playbook number, not a rubric number.** The rubric assesses against the methodology; changing what the methodology asks for is a decision for the Playbook's authors. Every other number v1 ruled was a threshold the rubric itself invented.
2. **One practitioner's practice is not the evidence for it.** Bryan reported what he did, and read literally he was affirming the diagnosis, not voting on the target. Ruling a methodology parameter off one data point is the failure mode C03 exists to prevent.
3. **Nothing is blocked by leaving it open.** Lens 1 assesses against 14 days and is barred from presenting biweekly as the only defensible rhythm, or from telling a weekly planter they are over-meeting. A wrong ruling would cost more than the open question does.

Recorded in the rubric at Lens 1 and Appendix C question 6, and in `product-docs/decisions.md` (2026-08-21). It is the standing question for Brett's review.
