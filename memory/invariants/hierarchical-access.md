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

The launch target is a `yyyy-mm-dd` day parsed at UTC midnight; `asOf` is an instant. Subtracting one from the other leaves a fraction of the current day in the numerator, which flooring throws away — the answer is a full day short from 00:00:01 UTC onward, so a plant reads "Launched 1 day ago" on the morning of its own launch.

The canon is `daysUntilTarget` (`src/lib/launch/countdown.ts`; `countdown.test.ts` pins launch day, ±1 day, several times of day — a midnight-only assertion passes under BOTH implementations, which is how this shipped twice). `buildLaunchSignals` calls it (closed **#338**), and the byte-for-byte copy `daysUntilLaunch` in `oversight/presentation.ts` was DELETED. The sibling `diffInDays` call sites in the fact-snapshot file compare two genuine instants (days since last meeting, idle days, tenure) where flooring IS correct — the bug is the date/instant mix, not the flooring. The date itself no longer lives on `churches`: see `contracts/db.md` → launches.

## One guard for six routes, and it is not the only guard (#411, 2026-08-13)

Every route under `src/app/(dashboard)/oversight/` opened with the same nine lines: read the session, `redirect("/login")` with no user, then `if (user.role !== "sending_church_admin" && user.role !== "network_admin") redirect("/dashboard")`. Six copies of one authority rule — and the rule is not cosmetic, it is the only thing between a planter and a portfolio read. A rule written six times can be weakened in one of them, and adding a seventh oversight route meant *remembering* to write it again rather than failing to compile without it.

It is now `requireOversightUser()` in `src/lib/oversight/session.ts`. Three properties of that module are load-bearing and each has a test:

- **No `"use server"` directive.** An export of a `"use server"` module is a POSTable endpoint (`../invariants.md` → Authentication). This is a helper the pages call, not one of them.
- **The `@/lib/auth` import is deferred into the call**, the same seam `read.ts` uses, so the guard's behaviour can be asserted with no `DATABASE_URL`.
- **The role pair is imported, not declared.** It used to be a second `as const` tuple here, reconciled by a regex over `access.ts`'s source. See "One role policy" below.

**The 404 did not get consolidated with it, on purpose.** `/oversight/sending-churches` answers a `sending_church_admin` with `notFound()`, not the shared redirect, because on that route the ROUTE's existence is itself the disclosure — a sending church admin learning that a network roster page exists learns something about the hierarchy above them. Every other refusal is a redirect the user can act on. That rule belongs to that page and stays there; the shared guard runs first and the 404 runs after it.

**And the shared guard is explicitly NOT the only guard** — its own header says so. Each read behind these routes refuses independently: `listOversightPlants` and `getOversightPlantDetail` through `resolveCallerOrg` (which resolves no org for a church-level role), `listNetworkSendingChurches` by role directly, and `getOversightPortfolio` — which did *not*, until this pass. Its docblock claimed non-oversight roles got `[]` "because `getAccessibleChurchIds` decides". They do not: that function returns `[user.churchId]` for `planter` and `team_member`, and the coach's assignments for a `coach`. Those are real ids and they would have reached the `in (...)`, so a planter who got past the route guard by any route at all would have been handed a one-plant portfolio. The refusal is now `if (!isOversightRole(user.role)) return []` as the function's first line, before the `@/lib/auth/access` import — which is why `read.test.ts` can assert it with no database: remove the line and the next statement opens `@/db` and the test errors instead of silently returning rows.

## The index read left the RSC (#411, 2026-08-13)

`src/app/(dashboard)/oversight/page.tsx` was the one surface in the domain that reached the database from a React Server Component. Its tenant scope and its #241 projection were "pinned" by a regex over the page's own source text — which cannot see a `WHERE` clause at all, so the guard was reading for the *shape of an import list* while the thing it was protecting was a SQL predicate.

The read is now `getOversightPortfolio` in `src/lib/oversight/read.ts`, split into a pure statement builder (`portfolioPlantsStatement(database, churchIds)`, typed as the `select` of any `PgDatabase`) and the exported read that resolves ids and calls it. The builder is the TEST SEAM: `read.test.ts` renders it against an offline `drizzle()` proxy and asserts both properties off `.toSQL()` — the projection is exactly `id, name, current_phase`, and the `WHERE` is the accessible-id list and *nothing else* (a second clause would mean the scope is being decided somewhere the assertion cannot see). No connection string, and the real statement rather than a description of it.

The builder is **not an authority boundary** and its header says so: the ids must already have come from `getAccessibleChurchIds`. The page holds no data-layer import at all, and that is asserted too — with the shared static-import scanner, not a hand-rolled regex, since the copy that stood there saw one of the five ways to put the read back.
