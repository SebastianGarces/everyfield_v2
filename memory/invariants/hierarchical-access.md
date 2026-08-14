# Hierarchical Access Control

Why and how, for the Hierarchical Access Control rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/auth/access.ts`, `src/lib/oversight/`, `src/lib/notifications/`, `src/db/schema/church-privacy-settings.ts`

## Pull and push are two different questions

**Pull** (dashboard reads) is gated by the six per-feature toggles in `church_privacy_settings`: `share_people`, `share_meetings`, `share_tasks`, `share_financials`, `share_ministry_teams`, `share_facilities`.

**Push** is much narrower: a daily activity digest (counts, only on a day with activity) plus three milestones — invitation accepted, phase/stage advanced, launch date set or changed. `enqueue` refuses `tasks`/`meetings`/`communication`/`teams`/`phase` for an oversight recipient unconditionally, sharing on or off. The single gate is `share_activity_with_oversight`, read at enqueue time so a flip takes effect at the next enqueue; a recipient who fails it is skipped and reported, never thrown over.

## The portfolio listing is deliberately ungated

`getOversightPlantHealth()` is what the oversight dashboard is *for*; the six `share_*` columns gate the feature data inside a plant, not the listing of plants. So "they see nothing unless you turn sharing on" is false — `OVERSIGHT_SHARING_TOGGLE.detail` states the real limit, and changing either the exposure or the copy means changing both.

## Naming the orgs behind a plant

The two oversight FKs are independent, so an accessible plant can name a sending church in a **different network entirely**. Rendering it discloses a third org's name to a caller not party to that relationship, and asserts a causal path the data model does not have. `sendingChurchesInNetwork` (`src/lib/oversight/read.ts`) therefore carries the caller's own `sending_network_id`.

## Launch countdowns

A launch target is a `yyyy-mm-dd` day parsed at UTC midnight; `asOf` is an instant. Subtracting one from the other leaves a fraction of the current day in the numerator, which flooring throws away, so the answer is a full day short from 00:00:01 UTC onward and a plant reads "Launched 1 day ago" on the morning of its own launch. `daysUntilTarget` (`src/lib/launch/countdown.ts`) is the one implementation, and a midnight-only assertion passes under both the right and the wrong one. The sibling `diffInDays` call sites compare two genuine instants (days since last meeting, idle days, tenure), where flooring IS correct — the bug is the date/instant mix, not the flooring.

## One route guard, and it is not the only guard

Every route under `src/app/(dashboard)/oversight/` shares `requireOversightUser()` (`src/lib/oversight/session.ts`) rather than repeating the session read and the role refusal; that rule is the only thing between a planter and a portfolio read, and a rule written six times can be weakened in one of them. Three properties of that module are load-bearing: no `"use server"` directive (it is a helper the pages call, not a POST endpoint — `../invariants.md` → Authentication); the `@/lib/auth` import is deferred into the call, so the guard is assertable with no `DATABASE_URL`; and the role pair is imported from `access.ts`, never re-declared.

`/oversight/sending-churches` answers a `sending_church_admin` with `notFound()` rather than the shared redirect, deliberately: on that route the ROUTE's existence is itself the disclosure, because a sending church admin learning that a network roster page exists learns something about the hierarchy above them.

**The shared guard is explicitly NOT the only guard.** Each read behind these routes refuses independently, and that refusal cannot be delegated to `getAccessibleChurchIds`, which returns `[user.churchId]` for `planter` and `team_member` and a coach's assignments for a `coach` — real ids that would reach the `in (...)`, handing a planter past the route guard a one-plant portfolio. `getOversightPortfolio` therefore opens with `if (!isOversightRole(user.role)) return []`, *before* the `@/lib/auth/access` import, so removing the line makes the next statement open `@/db` and a database-free test errors instead of silently returning rows.

## Oversight reads do not live in the RSC

The index read is `getOversightPortfolio` (`src/lib/oversight/read.ts`), split into a pure statement builder (`portfolioPlantsStatement(database, churchIds)`, typed as the `select` of any `PgDatabase`) and the exported read that resolves ids and calls it. The builder is the test seam: rendered against an offline `drizzle()` proxy, its tenant scope and projection are asserted off real `.toSQL()` — a regex over a page's source cannot see a `WHERE` clause at all. The builder is **not** an authority boundary: its ids must already have come from `getAccessibleChurchIds`.
