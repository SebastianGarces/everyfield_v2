# Marketing church seed — design

**Status: BUILT 2026-07-31 — `scripts/seed-marketing-church.ts`.** Rulings below
answered; see the Accounts section for the canonical logins.

## Accounts (the marketing accounts — 2026-07-31 ruling)

Identities are realistic on purpose: they appear in screenshots (user menu,
activity feed, oversight), so no `@everyfield.dev`-style placeholders — and
`everyfield.dev` itself is being retired repo-wide for the real domain
`everyfield.app` (#245). Password for all: `password123` (seed-dev convention).

| Role | Name | Email |
| --- | --- | --- |
| Planter, Redemption Hill Church | Daniel Reyes | `daniel@redemptionhill.org` |
| Planter, Trinity Grove Church (the "Beyond" plant) | Marcus Bell | `marcus@trinitygrove.org` |
| Network admin (oversight side) | Ray Delgado | `ray@ntxplanting.org` |

Hierarchy: sending network **North Texas Church Planting Network** → sending
church **Grace Fellowship Denton** → both plants. The network row's exact NAME
is the seed's cleanup namespace (`--clean` scopes to it; renames must be added
to `LEGACY_NETWORK_NAMES` in the script or prior runs are orphaned).

**Status: RULED 2026-07-31 (all five open questions answered) — ready to build.**
Purpose: real dashboard screenshots for the landing page (replacing the CSS
mocks per the catalog's standing rule: "real screenshots replace the mocks
when the app ships"). Shots must be the genuine product on marketing-quality
data — no `Core dayspring-1` names, no empty states, no lorem.

Sequencing: the sharp app theme (PR #239) must merge first; shots of the lime
theme would be stale on arrival.

## The church

- **Name:** Redemption Hill Church *(approved)*
- **Planter account:** Daniel Reyes, `daniel@redemptionhill.org` (see Accounts
  above; revised 2026-07-31 from the original `planter-marketing@everyfield.dev`
  — screenshot-visible identities must look real)
- **Sending network:** "North Texas Church Planting Network" — a dedicated
  network row is the cleanup namespace, mirroring the eval seed's child-first
  `--clean`. (Originally "EveryField Marketing"; renamed for realism, old name
  kept in `LEGACY_NETWORK_NAMES`.)
- **Phase: 4 · Pre-launch, ~4 weeks to launch Sunday.** This is the phase that
  lights the most surface at once: a mature pipeline, a meetings trend, teams
  staffed with training mid-flight, a busy kanban, a countdown checklist, and
  a rich Plant Intelligence read. It also matches the landing copy's center of
  gravity ("the momentum that gets you to launch Sunday").
- **Dates are relative to seed-run time** (launch Sunday = +4 weeks), so
  re-running the seed keeps every "in 21 days" string fresh for re-shoots.

## Per-feature data inventory

The named cast comes from the catalog mocks (already crafted and ruled on);
filler people get realistic, diverse names — never patterned placeholders.

| Feature | What gets seeded | The screenshot it feeds |
| --- | --- | --- |
| **People** | 142 people across the pipeline (Contacted 38 · Attended 21 · Committed 34 — the 50-adult floor arc). Named cast: the Rivera family, Dana Whitfield, the Okafor family, Sam Torres, Grace Lin, J. P. Holloway. Households, tags, pastoral notes, next-step activities ("Dinner Thu · 7pm", "Invite to Vision Night"). | `/people` list; pipeline stats |
| **Meetings** | Vision Nights #1–#4 with finalized attendance 18 → 21 → 24 → 28 (the trend chart), an upcoming Worship team night and Orientation #2, and a planned Launch Sunday service with logistics/run-sheet detail. Finalization runs the real events (follow-up tasks, phase-engine dirty-marking) — the seeded world is causally consistent. | `/meetings` |
| **Teams & tasks** | All 8 ministry teams, rosters + leaders (auto-advance events fire for real), training programs with completions (Worship 4/5, Kids 3/6, Hospitality 5/5, Production 2/4, Prayer 3/3). Kanban tasks straight from the catalog cards: Print connect cards, Recruit 2 greeters, Book sound check, Kids check-in kit, Launch-day run sheet, Website go-live; done: Reserve school gym, Order signage, Insurance filed. | `/tasks` kanban; `/teams` training bars |
| **Wiki** | Planter progress: first 3 chapters read, "Building a core group" in flight. | Discovery phase shot |
| **Plant Intelligence** | Signals + self-attestations tuned so the **real assessment pipeline** (same as eval) produces: CSFs mostly **Going well** with a couple of **Noted**; "Your focus" mixing one **Needs attention** with two **Worth a look**. See the fork below. | `/phase` — CSF scorecard + focus panel |
| **Communication** | A few sent messages + 2 templates so history isn't empty. | secondary |
| **Notifications** | A handful of unread rows (bell badge reads real). | ambient in every shot |
| **Giving / Financial** | **Skipped — not built.** Nothing seeded, nothing shown. | — |
| **Facility / Documents** | Skipped. | — |

### The assessment approach (RULED)

**Real engine, reviewed output:** seed signals + attestations, run the actual
LLM assessment, Sebastian reviews the generated copy; re-run or tune signals
if it underwhelms. Screenshots show what the product truly says. Hand-seeded
rows were rejected — staged copy isn't a real scenario.

## Landing shot map

| Landing slot | Route captured | Note |
| --- | --- | --- |
| Hero | `/dashboard` | Replaces the CSS dashboard frame |
| Switcher · People | `/people` | |
| Switcher · Meetings | `/meetings` | |
| Switcher · Teams & tasks | `/tasks` (kanban) | |
| Switcher · Wiki (replaces Giving) | `/wiki` | RULED: "the whole methodology, readable in order" — switcher copy to be written with the swap |
| Phase tab · Discovery | `/wiki` (progress visible) | |
| Phase tab · Core group | `/people` pipeline stats | |
| Phase tab · Launch team | committed-filtered people / commitments view | closest real screen TBD during build |
| Phase tab · Training | `/teams` training readiness | |
| Phase tab · Pre-launch | checklist view (launch-prep tasks) | |
| Phase tab · Launch Sunday | run-sheet / meeting logistics | |
| Phase tab · Beyond | health dashboard | RULED: a small second "graduated" church is seeded just for this shot (weekly attendance/giving/serving, ~6 weeks post-launch) |

Capture mechanics: Playwright against the preview at 1440×900, device-scale 2
(retina), sidebar expanded, window cropped; output optimized to WebP in
`public/marketing/shots/`. The shots keep the current panel treatment — image
standing on the painting with the lift shadow and corner marks.

## Mechanics

- `scripts/seed-marketing-church.ts`, idempotent with `--clean`, child-first
  deletes scoped to the marketing network — the exact shape of the eval seed's
  cleanup, different namespace.
- Writes to the shared dev DB (same as eval churches). One church (+ possibly
  the small "Beyond" church), clearly owned by the marketing network row.
- Events fire for real during seeding (attendance finalization, team
  assignment) so derived state (statuses, follow-up tasks, dirty flags) is
  consistent rather than painted on.

## Rulings (Sebastian, 2026-07-31)

1. **Switcher 4th item: Wiki** replaces Giving.
2. **Beyond tab:** seed the small second graduated church — all seven phase
   shots are real product.
3. **Assessment copy:** real engine, Sebastian reviews the output.
4. **Church name & cast approved:** Redemption Hill Church, planter Daniel
   Reyes, the catalog cast.
5. **Networks section:** stays stat-only for now; a multi-plant oversight
   portfolio seed is a separate later pass, done when that story is worth
   selling visually.
