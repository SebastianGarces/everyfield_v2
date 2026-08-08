# Hierarchical Access Control

Why and how, for the Hierarchical Access Control rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/auth/access.ts`, `src/db/schema/church-privacy-settings.ts`, `src/lib/oversight/`, `src/lib/notifications/`

## Pull and push are two different questions

**Pull** (dashboard reads) is gated by the six per-feature toggles in `church_privacy_settings`: `share_people`, `share_meetings`, `share_tasks`, `share_financials`, `share_ministry_teams`, `share_facilities`.

**Push** is much narrower, ruled 2026-07-27 (FRD N-025/N-026, #224): a daily activity digest (counts, only on a day with activity) plus three milestones — invitation accepted, phase/stage advanced, launch date set or changed. `enqueue` refuses `tasks`/`meetings`/`communication`/`teams`/`phase` for an oversight recipient unconditionally, sharing on or off. The single gate is `share_activity_with_oversight` (migration 0029, default false; it replaced 0026's `share_phase`/`share_digest`), read at enqueue time so a flip takes effect at the next enqueue. A recipient who fails it is skipped and reported, never thrown over.

## The portfolio listing is deliberately ungated

`getOversightPlantHealth()` (`src/lib/phase-engine/oversight/read.ts`) is what the oversight dashboard is *for*; the six `share_*` columns gate the feature data inside a plant, not the listing of plants. So "they see nothing unless you turn sharing on" is false — `OVERSIGHT_SHARING_TOGGLE.detail` states the real limit and `oversight.test.ts` pins it, so changing either the exposure or the copy means changing both.

## Naming the orgs behind a plant (#303, 2026-08-07)

`getAccessibleChurchIds` answers "which plants", and it is tempting to treat every column on an accessible plant row as readable. But the two oversight FKs are independent, so an accessible plant can name a sending church in a **different network entirely**. `/oversight/plants` resolved that id unscoped and rendered "Joined \<network\> · through \<sending church\>", which both disclosed a third org's name to a caller not party to that relationship and asserted a causal path the data model does not have. The lookup now carries the caller's own `sending_network_id` (`sendingChurchesInNetwork` in `src/lib/oversight/read.ts`, exported so the predicate is asserted rather than described).

## Launch countdowns (#303, 2026-08-07)

`churches.launch_date` is a `yyyy-mm-dd` day parsed at UTC midnight; `asOf` is an instant. Subtracting one from the other leaves a fraction of the current day in the numerator, which flooring throws away — the answer is a full day short from 00:00:01 UTC onward, so a plant reads "Launched 1 day ago" on the morning of its own launch.

The same flaw is still live in `buildLaunchSignals` (`src/lib/phase-engine/signals/build-fact-snapshot.ts:397`, filed as **#338**), so until that lands `/oversight/health` and `/oversight/plants` disagree by a day about the same plant. The sibling `diffInDays` call sites there compare two genuine instants (days since last meeting, idle days, tenure) where flooring IS correct — the bug is the date/instant mix, not the flooring.
