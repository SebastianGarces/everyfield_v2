# Invariants

**Every rule is stated below, one line each — these lines ARE the rules**, not a table of contents for them. Read only this file and you have still seen every rule.

Audited 2026-08-19: rules the source, schema, or tests already answer were removed — read the code first.

Rules bind at two strengths (`ops/process.md` → The loop, step 3):

- An **untagged line is an invariant** — a mechanical or security fact. Never break it; a change that needs to is wrong.
- A line tagged **⚖ is a ruling** — a dated product decision. Never break it *silently*: build to it, and if it no longer fits, rule on it per `ops/process.md` → The loop, step 2 (*Decide, don't ask*) and record why. A new ruling changes it; nothing else does.
- A line starting **Accepted residual** is a known gap, carried deliberately until the named condition retires it.

Some sections link `invariants/<domain>.md` for the why, the pattern and the worked examples. Read the domain file for what you are touching; read all of them as the security lens.

## Transactions / Atomicity

→ [transactions-atomicity](invariants/transactions-atomicity.md) — any DB write path.

- `db.transaction()` throws at runtime — neon-http has no interactive transactions. Never call it.
- Where the earlier steps of a marker-last sequence are NOT redo-safe, the marker becomes a CLAIM written FIRST (`ON CONFLICT DO NOTHING` on a unique index), and the non-idempotent work is gated on the claim's rowcount.
- In a batch the compare-and-set goes FIRST and the dependent write's `WHERE` re-asserts what the claim set — an empty `returning()` is not an error and rolls nothing back.
- A compare-and-set serialises only same-row writers; a predicate about another table is a snapshot read. To compete for a row elsewhere, `SELECT … FOR UPDATE` it as statement ONE and gate on the write's rowcount.
- In a `WITH` chain a `FOR UPDATE` snapshot CTE must be a DEPENDENCY of the write (`update … from current c`), never a sibling only the journal joins: pulled lazily it reads nothing, and the history row is lost.
- A migration that adds an arbiter index goes FIRST: `ON CONFLICT (…) WHERE …` against a database lacking it is SQLSTATE 42P10 on EVERY call, and nothing here applies migrations on deploy — code-first is the default unless an operator runs `pnpm db:migrate`.
- Accepted residual: `createHouseholdWithHead`'s two statements take separate READ COMMITTED snapshots, so a person soft-deleted between them commits an orphan household.
- `isUniqueViolation` (`@/db/errors`) matches on the `constraint` FIELD and nothing else. The `message.includes(<index name>)` fallback was DELETED (#323): Postgres puts the offending VALUE into some unique-violation messages, so a crafted row made somebody else's violation read as our index doing its job — and every caller swallows that as a benign race. Both shapes the drivers really raise populate the field.

## Multi-Tenancy

→ [multi-tenancy](invariants/multi-tenancy.md) — invitations, associations, onboarding.

- All feature data carries `church_id`; `church_id = null` means global content (wiki articles).
- Tenant isolation is enforced in the application layer; there is no RLS behind you.
- ⚖ An existing account MAY be targeted, but EVERY refusal reachable after the address resolves to a target is the ONE message `ACCOUNT_NOT_INVITABLE_MESSAGE`. The property is positional: anything downstream of `resolveInvitationTarget` speaks about a STRANGER.
- ⚖ No invitation that cannot be answered, for every role: each TYPE that can name an existing account has an in-app surface where that role answers it AND leaves the association.
- ⚖ One inviting org may address ONE email at most `INVITES_PER_INVITEE_PER_WINDOW` (3) times per `INVITATION_EXPIRY_DAYS`, counting EVERY status. The cap runs BEFORE target resolution and covers open invitations.
- ⚖ …and it RESETS AFTER A SEVER: both count queries drop every invitation older than that org's most recent `association_events` row about the same subject. A decline writes no event, so that loop stays capped.
- ⚖ The create-invitation success notice shows ONE neutral message for both kinds and never says whether an account exists.
- ⚖ The rule covers the WHOLE `/oversight/invitations` page, notice AND pending list: nothing derived from either target column reaches the client, and no admin surface renders a `/register?invitation=` link.
- ⚖ The rule is TRANSITIVE and `type` is target-derived, so a caption off `invitation.type` flips for an address holding an account of the other kind. `InvitationListRow` carries five fields, built by `toInvitationListRow`.
- ⚖ The rule reaches `/register` and BOTH readers of the row, and the two verbs have DIFFERENT indistinguishable sets: the GET for {targeted, answered, nonexistent}, the POST for those plus an open row submitted with a NON-matching address. ONE predicate decides.
- ⚖ The anonymous `/register` POST returns NO per-row message: a wrong-address submit falls through to the ordinary sign-up exactly as an unknown id does. One decision is made once and read by every later branch.
- Accepted residual: an OPEN row stays distinguishable at `/register` — the GET renders the redeeming form with a pre-filled `readOnly` address (never `disabled`, which submits nothing), and the matching POST redeems. Retired by invite-at-registration.
- ⚖ `association_events` names a SUBJECT, not a plant (0036): `subject_type` ∈ {church, sending_church}, one nullable FK per kind, a CHECK that exactly one is set. `acceptInvitationAs` has ONE batch shape, `[lock, claim, association, audit]`; `requireAssociationPair` decides which ids a type implies.
- ⚖ A notification is anchored to a CHURCH or to an ORG (`anchor_type`, `anchor_org_id`, CHECK exactly-one) — ONE table, never a parallel org table, and neither tenancy coalesces with the other.
- An oversight audience arm is its org's FK AND the rest of the exactly-one-tenancy rule (`church_id` null, every other oversight FK null) — the SQL half of `oversightOrgOf`. Never the FK alone: that admits a row with a competing claim on another tenancy. The other columns come off `OVERSIGHT_ADMIN_ROWS`, so a third org kind tightens every arm.
- ⚖ A `users` row an oversight FK reached whose OWN TENANCY is not that org is a DATA DEFECT, never a recipient: the audience PARTITIONS them (`OversightAudience`), so `fanOutTo` loops `recipients` alone and logs the rest. The exclusion is in TypeScript, not the `WHERE`, to be COUNTED; `oversightReachCondition` is that probe, never an audience.
- That log names the row's OWN tenancy columns (`names`), never the org it administers: a row only reaches that branch by naming more than one tenancy, and such a row administers nothing — so an "administers" field could only ever print null, which is a count an operator cannot act on.
- ⚖ A pending invitation carries a "Resend email" action so a failed or missed send is recoverable. NOTHING is persisted about delivery, because provider acceptance is not a delivery receipt.
- ⚖ After a successful resend the button is DISABLED for the rest of that 60s bucket (`RESEND_DEDUPE_WINDOW_MS`) and counts it down. ONE arithmetic feeds both the provider idempotency-key suffix and the countdown, and only DURATIONS cross to the browser.
- Accepted residual — ⚖ that cooldown is PER CLIENT SESSION: it lives in `useActionState`, so a reload or a second tab mounts with none. Retired only by reversing the no-persistence ruling.
- ⚖ AND THE ADMIN LINK DOES NOT COME BACK: the create result carries `{ inviteeEmail, emailSent }` and no path, and no notice or row renders a link or Copy control. The rule reaches the refusal copy too.
- ⚖ THREE SEVERS, one per side of the two associations. None calls the bare `disassociate*` primitives, which stay out of every `"use server"` module — a sever's FK write asserts the org it severs.
- ⚖ A sever ships only where the audit table can hold its subject: a type-to-confirm, a notification AND an `association_events` row are required. A sending church can only be severed FROM a network.
- ⚖ AN OVERSIGHT ACCOUNT'S FEED IS SCOPED TO ITS ORG, NOT TO A CHURCH (N-027, #308): `notificationViewer` asks the tenancy FIRST, and `oversightScopedWhere` is ONE recipient predicate ANDed over a THREE-arm OR — but only TWO of the arms are bounded by an ANCHOR. Arm 1 is `church_id IN (…)` over the plants that are in the org's portfolio AND have `share_activity_with_oversight` on — a SUBQUERY, evaluated at read time, never an id list a caller assembled. Arm 3 is `anchor_org_id = org.id`, which retires the write-only residual on org-anchored rows. Arm 2 is a TYPE test alone — `type IN OVERSIGHT_SHARING_EXEMPT_TYPES`, read off the constant `enqueue`'s gate reads — bounded by nothing but the recipient. Every user-facing path goes through `feedScopedWhere` — the list, the badge, the cold-start probe, the by-id read AND both mark-read UPDATEs — so a plant that has not opted in is unreachable by direct id and unmarkable, not merely unlisted.
- Accepted residual (#527, from #526's review): because arm 2 names no anchor, an exempt milestone stays visible to its recipient after the plant leaves the portfolio AND after that recipient is re-seated elsewhere. It is bounded by the RECIPIENT, so it never widens to another account — the row is the reader's own record of a relationship they were part of, which is why the arm exists. Closing it needs `anchor_org_id` stamped on exempt milestones at write time, and backfilled: a migration, deliberately out of scope.
- Accepted residual: a sending-church-subject `association_events` row is WRITE-ONLY, because the one reader filters on `church_id`. Retired by the first surface that shows it, widening the query by SUBJECT.
- ⚖ SEAT invitations (`user_invitations`, #495) are the SAME rulings on a second table, never a second copy: `INVITATION_EXPIRY_DAYS`, `INVITES_PER_INVITEE_PER_WINDOW`, `RESEND_DEDUPE_WINDOW_MS`, `ACCOUNT_NOT_INVITABLE_MESSAGE` and `resendRefusalMessage` are IMPORTED from `invitations/core.ts` and `invitations/resend*.ts`, and `/settings/team` renders the org surface's own `InvitationsList` given its two actions.
- ⚖ …and they INVERT only the first clause: a seat invitation is REGISTER-ONLY, so an address that already holds an account of ANY kind is refused with `ACCOUNT_NOT_INVITABLE_MESSAGE`. The positional rule is unchanged — the authority check, the email parse, the duplicate check and the cap all run ABOVE the `users` lookup, and nothing below it composes a sentence.
- ⚖ THE SEAT TOKEN IS A SECRET, NOT AN ID: `token_hash` holds sha256 of a 32-byte token that exists only in transit, so a resend cannot repeat a link and MINTS a new one. `?invitation=` carries either kind; the seat lookup is a point read on the digest, which a uuid never matches, so the two never collide.
- ⚖ …so a seat resend's PROVIDER KEY is its ROTATION, never the 60s bucket: two resends in one bucket share a key, the provider swallows the second, and the row is left holding the digest of a link nobody has. A refused resend restores the previous digest, and `describeSeatInvitationForRegistration` throws rather than returning null on a database failure — a null there registers the invitee as a cold planter at an address AS-010 will not re-invite.
- ⚖ A seat invitation grants its tenancy FK and its seat AT REGISTRATION, in the SAME `db.batch` as the users insert, the person link and the claim — which is what keeps "outside registration a seat is granted in exactly one place" true. `userChurchId` is the field that distinguishes it from an invited planter, whose link is still the compare-and-set (ruling 408-4B).

## Hierarchical Access Control

→ [hierarchical-access](invariants/hierarchical-access.md) — every oversight surface.

- Oversight users see AGGREGATE metrics only, never individual person records.
- Call `canAccessFeatureData(user, churchId, feature)` before returning feature data; the six `share_*` toggles default false and gate what oversight may PULL.
- ⚖ PUSH is far narrower: an oversight recipient gets ONLY the daily digest and three milestone events, and `enqueue` refuses every granular category for them, gated on `share_activity_with_oversight`.
- That toggle gates PUSH only and the consent copy may not claim more — plant health (name, phase, launch countdown, health) returns with NO privacy gate.
- ⚖ A refused category is never OFFERED either: the settings screen and the preference action both derive from `OVERSIGHT_ELIGIBLE_CATEGORIES`, never a second list.
- ⚖ Its ruled presentation is SHOWN-AND-LABELLED, not hidden: the five rows stay visible with a "Not sent to you" token and inert switches, and the reason is said once, visibly.
- ⚖ The consent copy NAMES ALL THREE consent-exempt types in one sentence with the reason. The reversibility bullet sits ABOVE it; pin it by a map keyed on the exempt-type list.
- ⚖ Inheritable vs explicit is decided from the row's OWN stamp, `notification_preferences.intent`, never from its channel: `preferenceValueIsInheritable` calls a `chosen` row a choice however it agrees with the coded default, and holds an `incidental` one to #237's value-equality rule. Every (category, channel) pair is decided alike — no exemption, no carve-out — so the emailed undo's "keep sending these" survives a flip of the default on `digest` as on any other category.
- Reaching a plant is not permission to name the orgs BEHIND it: every org name on an oversight surface must be the caller's own or inside it, scoped in the `WHERE`.
- NO `/oversight` page reads the database.
- ⚖ `tasks.own` is the ONLY own-duty verb, because it is the only one whose subject is derivable: `tasks.assigned_to_id` references `users.id`, so `assertMayActOnTask` (`@/lib/tasks/service`) admits the assignee and falls back to `tasks.write`. It runs in the SERVICE after the row loads, so `/launch`'s milestone ticks get it too, and the bulk press applies it PER TASK — a refused row is a named failure beside "already complete", never a silent write.
- Accepted residual: AS-006's OTHER two own-duty writes — a Member's meeting RSVP and their own ministry team — still ship at `meetings.write` / `teams.write`, which is NARROWER than AS-006 describes: a team leader holding only a Member seat cannot yet make their team's writes. The reason they could not be `SEATED` is now GONE — `persons.user_id` (#378) is the subject half `ministry_teams.leader_id` and the meeting guest list needed — so what is left is the rewire itself, which is #495+'s and must re-make the widening argument against the link rather than assume it.
- A launch countdown compares two DAYS — floor `asOf` to its UTC day BEFORE subtracting a `yyyy-mm-dd` target. ONE implementation: `daysUntilTarget` (`launch/countdown.ts`).

## Authentication

→ [authentication](invariants/authentication.md) — sessions, `"use server"` modules, route handlers, `src/proxy.ts`.

- **Every export of a `"use server"` module is a POSTable endpoint reachable with no session and no UI** — the export list IS the auth surface. Keep helpers, reads and unwired writes in a sibling module with no directive.
- A state-changing action never takes its actor as an argument — it mints one from `verifySession()`. An entity implied by the actor is not an argument either.
- SESSION FIRST, THEN THE PARSE: the mint is the FIRST statement of the export, ahead of `safeParse`, because parsing first answers a sessionless caller differently for a malformed argument than a well-formed one.
- ⚖ AND THE MINT *IS* THE SEAT CHECK: every export of every `"use server"` module calls `requireSeat(capability)` first (AS-019, ruling 185 (8)) — it returns what `verifySession()` returned, so there is one statement, not two. The eight exceptions are named with their reason AND their `kind` in `UNSEATED_EXPORTS` (`sessionless` vs `non-seat-guard`); `seat-guard.test.ts` asserts that set EXACTLY and walks the rest.
- ⚖ A SESSIONLESS POST GETS ONE ANSWER, AND IT IS A THROW (#508). Where the guard sits inside an action's `try`, the `catch` opens with `rethrowUnauthorized(error)` (`@/lib/auth/unauthorized`) — converting it into `{ success: false, error: "You must be logged in…" }` hands an anonymous caller the well-formed answer the endpoint should never give. Moving the mint ABOVE the `try` (`tasks/actions.ts`, `settings/actions.ts`) satisfies it too and needs no rethrow; `server-action-surface.test.ts` walks every catch that still needs one.
- The refusal is `UnauthorizedError`, and its `SESSION_EXPIRED_DIGEST` is the ONLY thing `@/components/app-error` may claim sign-in expiry on — a client boundary gets no message in production, and every other 500 gets a sentence that does not diagnose.
- A `"use server"` directive is a MODULE PROLOGUE and nothing else. A function-level one publishes a POST endpoint the export-walk cannot see — it reads the exports of modules whose prologue carries the directive — so the form is banned outright and `inlineServerDirectives` fails the suite on one.
- WHICH capability each endpoint is guarded with is CHECKED IN (`@/lib/auth/capability-map`) and asserted with `deepEqual`. The walk proves a guard is called; only the map proves it was called with the right verb, so a permission change is a reviewable diff in one file.
- A seat refusal is a TYPE, `SeatRefusalError`, never `message.startsWith("Forbidden")` — `requireChurchAccess` and the invitation layer throw that prefix too, so a prefix test is a classification resting on prose.
- ONE permissions module, `@/lib/auth/seats`: `OWNER_ONLY` and `ADMIN_PLUS` are declared there and NOWHERE else, and one capability table pairs each verb with a seat set AND a tenancy requirement. A per-module matrix was rejected by name. `holdsSeatFor` is the non-throwing form for a sibling module holding an actor it cannot mint.
- A row naming TWO tenancies is refused EVERY capability including the reads — the check sits above the tenancy switch, because a `tenancy: "any"` verb would otherwise wave the defect through.
- A shared secret is never compared with `===`: use `matchesBearerSecret`/`constantTimeEquals`, which hash both sides to a fixed length first. Covers `CRON_SECRET` and `REVALIDATION_SECRET`.
- A request header the app does not write UNCONDITIONALLY is client input and nothing may branch on it. The trusted headers are `x-routed-url` (absence fails closed) and the platform-written `x-real-ip`.
- `x-routed-url` (`@/lib/routed-url`) carries the RELATIVE URL the proxy routed — path AND query — because a Server Component gets neither otherwise, and a layout is never handed `searchParams`. A route-scoping reader calls `routedPathname` for the route half; it does not get a second header.
- A signed-out bounce to `/login` goes through `loginPathFor` and comes back through `safeRedirectPath` (`@/lib/auth/safe-redirect`) — ONE param name (`redirect`), sanitised at BOTH ends. There are exactly TWO writers, `src/proxy.ts` and the `(dashboard)` layout; a page or a shared guard inside that group NEVER spells its own, because it can only race the two that carry a return path.
- ONE `"use server"` MODULE NEVER RE-EXPORTS ANOTHER'S NAMES, and `export type { … }` is not an exception: `next build` enumerates each action module's exports into the page's action manifest by NAME, so a re-exported type is registered as an action and then cannot be found. Import from the module that DECLARES it. Re-exporting from a directive-free module is fine; `server-action-surface.test.ts` resolves the specifier.
- `/login` IS NOT AN AUTH ROUTE in the proxy (`AUTH_ROUTES` is `/` and `/register`). The already-signed-in bounce is the login PAGE's, because it asks the session and the proxy can only ask the cookie — and a cookie that no longer verifies is precisely the reader the layout sends there, so bouncing on it closed an inescapable redirect loop.

## Seats & Tenancy

→ [seats-and-tenancy](invariants/seats-and-tenancy.md) — anything reading who an account is.

- `users.role` DOES NOT EXIST (dropped by migration 0051). An account is a SEAT — `users.seat` ∈ {owner, admin, member}, NULL for a coach — held in a TENANCY named by `church_id`, `sending_church_id` or `sending_network_id`. Neither half answers alone: `seat = 'owner'` says nothing about whose owner.
- ⚖ ONE OWNER PER TENANCY, ENFORCED BY THE DATABASE (AS-002, ruling 185 (4)): three partial unique indexes, one per tenancy FK, each `WHERE seat = 'owner'`. This RETIRED the OB-010 claim race — a second Owner is now a write that cannot commit, not a defect to detect. The `notExists` in `claimPlanterStatements` stays only to make the ordinary already-claimed case a no-op instead of an error.
- The partial predicate and the NULL-distinct rule are BOTH what keep a coach-only account writable — no tenancy, no seat, caught by neither half. An index made total, or a `seat` made NOT NULL, breaks the second coach account with nothing in the app to say why.
- ONE function answers "which tenancy is this", `oversightOrgOf` (`@/lib/auth/tenancy`, an import-free leaf), and it answers ONLY for a row naming EXACTLY ONE tenancy FK. A row naming two is a data defect that reaches NOTHING in either direction; `isChurchLevelUser` is stated positively for the same reason, so the defect is neither church-level nor oversight.
- A ROUTE HANDLER IS NOT COVERED BY ANY OF THIS. The seat guard and its walk are about `"use server"` exports; anything under `src/app/api/**` is a separate surface with its own auth (`memory/contracts/api.md`), and adding a route handler that writes feature data needs its own `requireSeat`/`assertSeatFor` call, chosen deliberately.
- Accepted residual: nothing in the schema holds an account to one tenancy. Migration 0050 §1 cleared the twelve rows that carried two (measured on the shared branch, 2026-08-20), but a CHECK would have refused them, so the state stays REPRESENTABLE and every reader fails closed on it. Retired by a `num_nonnulls(...) <= 1` CHECK once no writer can produce one.
- Outside registration a seat is granted in exactly ONE place — the OB-010 claim on a plant with no Owner, promoting `{owner, member}` and NOT `admin`. The pair is the ruled `{planter, team_member}` migrated; `admin` is a seat the role model could not express, so admitting it would be a widening, not a rename.
- An authority arm that names an oversight org asks the SEAT as well as the tenancy (`isOrgOwner`) — `sending_church_admin` and `network_admin` each meant "the Owner seat in this kind of org", so a seatless org row and an org Member were already refused. Dropping the seat half widens the rule while looking like a rename.
- REMOVING A SEAT CLEARS THE TENANCY AND THE SEAT AND NOTHING ELSE ABOUT THE PERSON (AS-016). The account ROW survives, and the `persons` row and its `team_memberships` are untouched — a person record and an account are separate things, so losing the login must never lose the roster entry. The cascade's other three effects are sessions deleted, OPEN tasks (`status <> 'complete'`) reassigned to the Owner, and `ministry_teams.leader_id` nulled for the teams that account's own person record led.
- A REMOVAL CLEARS ALL THREE TENANCY FKs, NOT ONLY THE ONE IT ACTED ON, AND THAT IS A SECURITY RULE. A row naming two tenancies is representable (the accepted residual below) and reaches NOTHING, because `oversightOrgOf` answers only for exactly one FK. Clearing `church_id` alone would leave the row naming exactly one and PROMOTE the removed account into that org's oversight surface — `requireOversightUser` admits on the FK alone and never asks the seat. A removal must never widen reach.
- The removal is ONE `db.batch` with the TENANCY CLEAR LAST, and every statement carries the actor's `church_id` (the sessions delete through an `exists`, its subject being keyed by the account). The three earlier statements are redo-safe, so a replay re-runs three no-ops. `db.batch` is all-or-nothing on FAILURE only — a zero-row UPDATE is a success — so the marker RETURNS and the caller refuses on an empty rowcount rather than reporting a removal that changed nothing. `src/lib/seats/roster.test.ts` fails on a reorder, a missing scope, or a dropped rowcount check.
- ⚖ Ending a coach assignment is `coach.assignment.manage` (ADMIN_PLUS, plant), NOT `seat.manage` — coaching is an assignment, never a seat, and AS-004 already gives an Admin the power to invite a coach (ruled 2026-08-21 for #497).
- Accepted residual: any plant Admin may end a coach assignment, not only the Admin who created it as AS-018 words it. `coach_assignments` records no author, and a column added now would be NULL on every row because the coach invitation surface has not shipped. Retired when that surface lands and writes one.

## Phase History — Declarations vs Transitions

Applies to `phase_transitions` and every reader of it.

- A declaration is NOT an advance. Anything counting, gating on or announcing "reached a new stage" filters `kind = 'transition'` through one predicate, `phaseAdvanceCondition()`.

## Phase Engine — Cited Facts & Attestation Citations

Applies to `src/lib/phase-engine/**` and the `/phase` surfaces rendering `plant_insights.cited_facts`.

- A CITED PATH IS UNTRUSTED INPUT — the judge writes it, so a segment may be `constructor`, `toString` or `__proto__` — binding every read of a judge-written key AND the write that assembles `manual.byKey`. Exactly three shapes are sanctioned: a `Map` read with `.get`, a `Record` read through `Object.hasOwn`, or a prototype-free `Object.create(null)` accumulator; never a bare `in` or `[key]`.

## Wiki Articles

- **Never interpolate a slug into a wiki path.** Build every one — `href`/`router.push`, OpenGraph `url`, the active-item test — with `wikiHref()`, which encodes per segment so `/` stays a separator.
- Bookmarks, recently-viewed and last-in-progress store SLUG-ONLY rows and re-resolve each through `getArticle`, whose `churchId` defaults to `null` — so on that default a church's own article resolves to `null` and the surrounding `.filter(Boolean)` drops it SILENTLY.
- `getArticles` is request-cached (`React.cache`) and its docblock does NOT say what that costs: a mutate-then-read inside ONE request goes stale. Revalidate and let the next request read, rather than reaching around the cache.
- A church's published row for a slug overrides the global one in SQL and ONLY in SQL: a JS collapse cannot answer for a RANKED read, because it sees only the rows that survived the `ts_rank` cut and the church's rewritten copy need not be among them. The test pins the ABSENCE of a second implementation, never that reason.
- Cross-links live ONLY in `related_article_slugs`, never in an article's prose and never seeded: a prose link duplicating the column renders that link twice. No test catches a violation.

## Generated Documents

Applies to `generated_documents`, `src/lib/documents/service.ts`, and `/documents/history`.

- The upload comes BEFORE the insert because the two failure modes are not symmetrical: an object with no row is garbage a sweep can collect, while a row with no object is a download button that 404s and cannot be repaired from inside the app. `service.test.ts` runs both forced failures; the source order alone never proved it.
- A foreign artifact id reads as MISSING, not forbidden — the church-scoped lookup IS the answer, so no separate refusal exists to distinguish "not yours" from "not there".
- `storage_key`'s UNIQUE index guards nothing constructible today (keys carry a fresh uuid). It is kept as a fence for a future DETERMINISTIC key scheme, where a collision would silently overwrite one church's artifact with another's render.

## Person Photos

Applies to `persons.photo_url`, `src/app/api/people/[personId]/photo/route.ts` and `uploadPersonPhotoAction`.

- `persons.photo_url` holds a PRIVATE-BUCKET STORAGE KEY, never a URL, despite the column's name. The only address a browser gets is `/api/people/{id}/photo`, which checks the session and reads the person church-scoped before streaming bytes — no signed URL reaches the page, because a signed URL is a bearer token anyone can pass on.
- `setPersonPhoto` is the ONLY writer of that column, and `personUpdateSchema` deliberately has NO `photoUrl` field: the profile form is a `FormData` bag a POST shapes, so a photo key there would let a caller aim their own person's avatar at another church's object and read it through a route that trusts the stored key. REMOVAL IS THAT SAME WRITER WITH A NULL KEY (P-024b), never a writer of its own — upload, replace and remove then share one spelling of the ordering below.
- Upload BEFORE the row points at the object, delete the old object AFTER it stops (same asymmetry as Generated Documents). A failed delete is collectable garbage; a row naming a missing object is an avatar nothing in the app can repair — the route answers 404 for it and the initials fallback renders.
- The delete half lives INSIDE `setPersonPhoto`, not in its callers, so no caller can forget it or hoist it above the row write; `photo-ordering.test.ts` runs the sequence against forced failures rather than reading the source, the way `GeneratedDocumentEffects` does.

## List Pagination — `/people` and `/tasks`

- A keyset cursor MUST compare the expression the query is `ORDER BY`-ed on, with the id tie-break in the SAME direction. `listTasks` ordered by due date and paged on `created_at`, which skips and repeats rows at every boundary; `TASK_SORT_KEYS` now names the SQL expression and its TypeScript key together so the two cannot drift (`src/lib/tasks/pagination.test.ts` pins both halves).
- "Load more" reads the URL through the SAME parser the page used (`parsePeopleListSearchParams`, `parseTaskListSearchParams`), never a filter object marshalled by the client — a second reading of the URL is free to drift and returns a different query's rows.
- The tasks list REGROUPS over every loaded row rather than merging a page into the groups already drawn, so a bucket that first appears on page two gets its heading instead of dropping its rows. The grouping recompute uses the server's single `now`, never a fresh clock read.

## Rich Text — Stored HTML & the Sanitiser

→ [rich-text](invariants/rich-text.md) — `src/lib/rich-text/**` and every writer or reader of a rich-text body.

- The SERVER is the gate, never the editor — every compose/task action is a POSTable endpoint that never saw the toolbar — and there is ONE sanitiser, `sanitizeRichText`, allow-list only.
- ONE door converts a stored value for reading or editing, `toRichTextHtml`, and ONE read-only renderer draws it, `RichText`. A hand-rolled `dangerouslySetInnerHTML` is a second copy of both.

## Tasks, Subtasks & Recurrence

- ⚖ A vision meeting's follow-up tasks go to the FIRST-TIME attendees and to nobody else (VM-007, #323): `followUpRecipients` (`tasks/events.ts`) reads the `attendance_type` the register already derived, and `null` is unknown rather than first-time. Returning and core-group attendees get none.
- ⚖ Their due date is the MEETING's day + 2, never the finalize's (`followUpDueDate`) — a late finalize creates a task that is already due, which is the true statement about that window. The planter's 24-hour evaluation task still anchors to `now`.
- That due date IS the identity of "this meeting's follow-up", because the row relates to a PERSON and no column names the meeting: (church, person, category `follow_up`, due date). `handleMeetingAttendanceFinalized` writes only what a meeting is still owed, so a reconcile tops up a late-added first-timer instead of dropping them, and a replay writes nothing.
- `completion_event` IS NOT CLIENT-WRITABLE: it is absent from `taskCreateSchema`/`taskUpdateSchema` (#323, deleting a field neither `createTask` nor `updateTask` ever read). It was the follow-up SUPPRESSION VECTOR — the partial index named the event and the soft-delete while the guard ALSO demanded `related_type = 'meeting'`, so a posted task with that event, a meeting's id and `relatedType: 'person'` held the slot unseen and stranded the meeting at zero tasks. The INDEX repeats that clause too (#521), so the same row written OUTSIDE the app buys nothing either. AN INDEX PREDICATE WIDER THAN THE READ IT GUARDS IS A SUPPRESSION VECTOR — that is the general shape, and the two spellings change together.
- EVERY ROW THE GENERATION INSERT WRITES HAS AN ARBITER, so the statement is PER-ROW idempotent (#521): `tasks_person_follow_up_unique_idx` over (church_id, related_id, due_date) for live person follow-ups joins the evaluation index, and the INSERT carries an UNTARGETED `ON CONFLICT DO NOTHING` — untargeted because a named arbiter covers one index and re-raises on the other. This RETIRED the top-up residual: two concurrent reconciles can no longer each write one late attendee a follow-up. All-or-nothing became the WORSE shape once follow-ups had a key of their own — a race whose `owed` sets differ aborted the wider racer whole and dropped the late-added first-timer the handler was made convergent for.
- ⚖ The answer to a phase-template prompt belongs to the PLANT, not to the planter: the key is the transition alone and `/tasks` has no role gate, so any church member who opens it first answers for everyone. Widening that key to a per-person answer needs the idempotency argument re-made against it — a new ruling, not a refactor.
- The static `/tasks/templates` route is what keeps `importTaskTemplateAction` legal under the Authentication invariant: unmount the picker and it becomes a POSTable endpoint no UI reaches. Neither `page.tsx` nor `actions.ts` says so.
- Accepted residual: `findOpenInSeries` is a SELECT-then-INSERT, so two instances of one recurring series completed concurrently each mint a successor. The honest fix is a partial unique index on the series key for open rows.
- Accepted residual: `wouldCreateCycle` is a SELECT-then-INSERT with no `FOR UPDATE`, so two concurrent writers adding opposite edges each read an acyclic set and commit a cycle; the unique index stops only a duplicate of the same pair. Retired by a serialising guard over the church's edge set.

## Notifications — the shared F11 queue, from a consumer's side

- ⚖ A weekly digest lands SUNDAY 16:00 in the CHURCH's zone by DEFAULT, and the day and hour are a CHURCH SETTING (N-013, ruled 2026-08-15, superseding Monday). The hour carries the rule: at the UTC period boundary a Sunday digest arrives Saturday evening in the Americas. The CHURCH sets when; the RECIPIENT still sets whether and how often. Code ships Monday-at-boundary until #448 lands — do not "restore" it.
- Making that anchor per-church keeps the church out of the digest dedupe key STRING but makes its VALUE church-dependent: `currentDigestDedupeKeys` takes the church's anchor, never computing one current key set across churches. The two-literal `IN` survives only because the sweep is already per-church (#448).

## Meetings

- ⚖ `finalizeAttendance` runs its downstream generation on EVERY call, not only the first (#323): the `actual_attendance` marker decides what the call REPORTS (`finalized` / `reconciled` / `already_finalized`) and whether the count needs refreshing, never whether the work happens. Gating the work on the marker is what dropped a late-added attendee's follow-up; gating it on the count has the same hole one step in.
- `meeting.attendance.finalized` is emitted STRICTLY, and strictness is a property of the EMIT: EVERY subscriber to it is load-bearing and can fail a planter's finalize. A third subscriber must be safe to fail one, or the flag has to become handler-scoped first.
- The meeting-title lookup inside the task generator is tenant-filtered (`eq(churchMeetings.churchId, churchId)`); the id reaches it from a route parameter, and there is no RLS behind it.
- Accepted residual: the meetings client boundary — no `"use client"` module reaching a meetings DB module (`service.ts`, `response-queries.ts`), directly or transitively — is a TEST (`client-boundary.test.ts`), not the compiler. `import "server-only"` is unresolvable under `pnpm test`, and `--conditions=react-server` breaks every email-rendering test. Retired by a `react-server` lane.

## People — Contacts, Import & Households

Applies to `src/lib/people/**` and the `/people` surfaces, plus the ministry-team roster, which reads a person's background check.

- `createPerson()` is the ONE writer of the `person_created` timeline activity.
- `persons.user_id` is the account a person record IS (AS-013, #378), written at CHURCH-GAIN and NOWHERE else: `churchCreationStatements` mints it, and both church-gain paths spread that tuple whole. UNIQUE per (church, account) — `persons_church_user_unique_idx`, partial on `user_id IS NOT NULL` — and the insert repeats that predicate VERBATIM so ON CONFLICT inference cannot fail; the index and the statement change together.
- IT GRANTS NOTHING. No seat, no capability and no oversight reach is derived from it; it makes an account ADDRESSABLE as a person, which is a different question from what that account may do.
- The row is minted at `status = 'leader'` and carries NO `person_created` activity — it is not a contact anybody typed in. An adopted row (matched by address in 0052's backfill) keeps its own name and status; only a MINTED one gets those values.
- SO EVERY READ THAT MEASURES RECRUITING EXCLUDES IT, through ONE predicate — `isRecruitedContact()` (`people/person-user.ts`), which is `user_id IS NULL`. Three readers have it: the dashboard's Core Group count, `getLeadershipCandidates` (the phase-engine signal), and the compose form's STATUS COHORTS. Without it a plant one minute old reports a core group of 1, a leadership candidate nobody developed, and a "Leaders" quick-select containing the sender.
- It is NOT a blanket rule, and the line is what the read is ABOUT: everything asking who is HERE keeps the planter — the people list, the assignment dialog, the roster, `all` in the compose form, and `deriveAttendanceType`, where the planter attending their own vision meeting is a real attendance.
- NO read hands `user_id` to a client surface, and the people domain's EXIT is where that holds: `getPerson`, `listPeople`, `getHouseholdMembers`, `checkForDuplicates`, `changeStatus` and every person-returning mutation return `PersonForClient` and strip through `toPersonForClient` (`people/types.ts`), the one spelling; `pipeline.ts` omits the column in its projection instead. A type alone cannot — `Person` is structurally assignable to the narrower shape, which is how the duplicate check once SPREAD a full row into a value typed `PersonWithTags` and carried the column into the quick-add dialog while the signature denied it.
- The only full-row read left is `getPeopleForExport`, which renders CSV by named column and never reaches a component. `people/client-boundary.test.ts` ratchets both ends — no `"use client"` component may name `Person` in a type position, and no boundary module may return it — and names that one exception with its reason, so a second has to argue for itself there.
- Accepted residual: `people/person-user.ts`'s ADDRESS bridge is still how an audience read asks "does this person hold a login", because the FK covers only accounts that gained a church. The two answer different questions — identity vs discovery — and the bridge retires when every account-holding person carries the FK.
- `peopleTextSearch` is the ONE people text predicate — list, search and export all call it. Never a second copy under any name.
- ⚖ A background check is required PER TEAM, never per role, and the roster asks `teamRequiresBackgroundCheck(team.templateKey)` (`ministry-teams/role-templates.ts`). A custom team carries no key and shows no column; `getTeam` selects `backgroundCheckStatus` for EVERY team, so only that predicate decides.
- ⚖ `not_started` is the FLOOR, not a null, and the person profile HEADER hides it — every prospect a plant adds starts there, so that badge would sit beside every name saying nothing. The Overview row and the team roster show it like any other value.

Status advances one hop at a time. `autoAdvanceStatus` (`people/events.ts`) moves a person only when their CURRENT status is exactly the `from` below, so an event-driven hop never demotes and never skips, and a failed advance is logged rather than thrown. Every other hop is unguarded; `getStatusWarnings` warns on backward, skipped and out-of-order moves without blocking.

| Event | From | To | Handler |
|---|---|---|---|
| `person.created` | — | `prospect` | initial status |
| `meeting.attendance.recorded` (vision meetings) | `prospect` | `attendee` | `handleVisionMeetingAttendance` |
| `follow_up.initiated` | `attendee` | `following_up` | `handleFollowUpInitiated` (deferred, unwired) |
| interview completed | (unguarded) | `interviewed` | `createInterviewAction` |
| commitment recorded | (unguarded) | `core_group` | `createCommitmentAction` |
| `team.member.assigned` | `core_group` | `launch_team` | `handleTeamMemberAssigned` |
| `team.leader.assigned` | `launch_team` | `leader` | `handleTeamLeaderAssigned` |

Those two server actions write their hop through `changeStatus`, which enforces no `from`: recording an interview or a commitment for a later-stage person DEMOTES them.

## Ministry Teams — which template a team came from

Applies to `ministry_teams`, `src/lib/ministry-teams/**` and every surface that treats a predefined team as one of the ten.

- ⚖ `ministry_teams.template_key` is a predefined team's IDENTITY and `name` is DISPLAY ONLY (ruled 2026-08-12). Four surfaces used to match on the name — the org-chart root, the responsibilities tab, the role-import map and `teamRequiresBackgroundCheck` — so a rename, ours or a planter's, silently broke them. NULL means a custom team, and every one of the four answers "not a template team" for it.
- ⚖ The `senior_pastor` template's team is named **"Leadership"** (ruled 2026-08-09): a TEAM carries a ministry's name, a ROLE carries a person's. The key and both role names ("Senior Pastor", "Associate Pastor") are unchanged.
- ⚖ `importRoleTemplates` APPLIES the plant's own leadership answer: on `planter_confirmed` the Owner's linked person is assigned to the Senior Pastor role through `assignMember` — never a raw insert, so the seat index, the role's status flip and both domain events all apply. `no_planter` and an unanswered plant leave the role open.
- That auto-fill NEVER RAISES and never overwrites a filled role. The import is real and useful either way, and the planter can still assign themselves; migration 0053 §4 is the one-shot SQL twin for plants that initialized before it shipped.

## Migrations

- RESERVING AN `idx` DOES NOT RESERVE AN ORDER — `when` decides. `drizzle-kit migrate` applies a migration only while the ledger's MAXIMUM `created_at` is below its `when`, so a sibling holding a lower `when` on another branch is SILENTLY SKIPPED: exit 0, nothing applied. Such a migration owes its sibling a FORWARD reconcile in its header.
- ⚖ A RENUMBERED migration ships with an OPERATOR RECONCILE step or it does not ship: `drizzle-kit migrate` never asks whether THIS migration's row is present, so a database that applied the OLD number is invisible to it, the DDL re-runs and the apply aborts on `column ... already exists`. The header carries the detection and both exits.
- ⚖ A CHECK REJECTS ONLY `false`, so a constraint that evaluates to `NULL` ACCEPTS the row. `(kind = 'seat' and seat in (…)) or (kind = 'coach' and seat is null)` reads as an ⟺ and admits `kind='seat', seat=NULL` (`true and NULL` = `NULL`). Write the biconditional over non-null booleans — `(kind = 'seat') = (seat is not null)` — and PROVE a new constraint by writing the row it forbids, never by reading the DDL.
- ⚖ THE LEDGER IS DIAGNOSED READ-ONLY: any write to `drizzle.__drizzle_migrations` is ATTENDED-ONLY, never a side effect of another track, and `_journal.json` is never edited to invent a tag for a hash no committed blob matches. An applied row the journal cannot name is ACCEPTED HISTORY — deleting it hides applied DDL nobody can name; the check and both orphans are in [`contracts/db.md`](contracts/db.md) → Migration ledger vs journal.

## Dev Seeds

Why and how: [`contracts/db.md`](contracts/db.md) → The dev-seed wipe. Applies to `scripts/seed-dev-db.ts` and anything that inserts a `churches` row.

- A seeded coach carries a `church_id` and NO seat, deliberately: that reads as "in this plant, holding nothing", which is what a coach is, and `getAccessibleChurchIds` still answers them from `coach_assignments`.
- `pnpm db:seed` deletes ALL users and ALL churches unscoped — the fixture is the whole database, not the rows the script created. Run it against your own or a throwaway database ONLY.
- Every script that inserts a `churches` row stamps `onboarding_completed_at` with `now()` in that same INSERT — an unstamped seeded church puts its planter in the wizard.
- ⚖ A credential removed from the repo needs a ROUTE, or the fixture it opens becomes unreachable: `SEED_ADMIN_PASSWORD` is recorded in `.env.local` — gitignored, machine-local, and read by a verifier BEFORE seeding rather than re-chosen.
- The seed's sentinel probe proves ONE thing: the three `PROTECTED_ACCOUNTS` addresses are absent. It does NOT prove every account is fixture, so widening the seed's fixed oversight pair needs a ruling.

## Date & Time Rendering

→ [dates-times](invariants/dates-times.md) — anything rendering or parsing a date.

- Never format a `Date` without a pinned `timeZone` — format through `src/lib/datetime.ts`. Church-scoped surfaces take the church's IANA zone as an argument (plumbed down, never a global); `APP_TIME_ZONE` (UTC) remains the pin for meeting wall-clocks and surfaces with no church. `Intl`/`toLocale*`/date-fns follow the runtime's zone, so SSR and hydrated markup differ (React #418).
- The CALENDAR-DAY primitives live in `datetime.ts` and nowhere else: `MS_PER_DAY`, `toCalendarDate(date, timeZone?)`, `addCalendarDays(from, days)` — every `date` column written by tasks, ministry-teams and launch goes through them, so the day a write NAMES is measured in the zone it is READ in. Not yet absolute: a ten-site debt list lives in [dates-times](invariants/dates-times.md) — route a call site whenever you touch its module; a NEW local day constant or a re-export is the mistake this line stops.
- ⚖ Every church has a non-null IANA `time_zone` defaulting to `America/Chicago` (existing rows backfilled). Invalid ids are rejected on write. Church-scoped instants render in that zone; there is no per-user timezone, and onboarding does not ask.

## Client/Server Data Synchronization

Conventions and examples: [`contracts/data-patterns.md`](contracts/data-patterns.md).

- NEVER store server data in `useState` (it goes stale the moment the server revalidates) and NEVER sync data with `useEffect` — server data flows through props from server components.
- Use `useOptimistic` for instant feedback; the server action calls `refresh()` from `next/cache` to reconcile, not the client calling `router.refresh()`. Example: `ActivityTimelineClient`. Props-only is the other shape (`TagPicker`). ⚖ ONE EXCEPTION, and it is about WHEN: when the same action is also reached by a click that NAVIGATES, the refresh moves to the client, because only the caller knows whether it is staying — and therefore whether the refresh runs inside the press or after the push (`notification-feed.tsx`, #228, #527).
- ⚖ A CLICK THAT NAVIGATES OWNS NO SYNCHRONOUS WORK ON THE ROUTE IT IS LEAVING (#228, #308). A `<Link>` whose `onClick` also fires a server action must call it plainly — not in `startTransition`, and not through an action that calls `refresh()`. Either one turns the click into work React owns on the route being LEFT: a transition entangles the push behind an update suspended on a round-trip, and the refresh re-renders the route the push is replacing. Measured on #308's preview, both strand the navigation (22/22 and 11/11) while the write still lands, which is the "it marked read and went nowhere" bug; with neither, 22/22 navigate. There is no optimistic state to keep on a page the user has left.
- ⚖ …BUT IT STILL RECONCILES, ONCE THE PUSH HAS COMMITTED AND PAINTED (#527): `void action(id).then(() => whenPushCommits(leaving)).then(() => router.refresh()).catch(() => {})`, where `whenPushCommits` waits for `location.pathname` to leave the route the click started on and then one more frame (double `requestAnimationFrame`, 3s cap). Skipping the reconcile is a bug, and #308 shipped it skipped on a FALSE premise — "the destination's own render is a fresher read". A client-side push REUSES the layout segments both routes share rather than re-rendering them (partial rendering; `.next-docs/01-app/02-guides/authentication.mdx:1350`), and the shell's bell sits in exactly such a shared layout, so nothing re-read it on arrival: 25 unread, row click, `read_at` set, bell stuck at 25 for the session (12/12 navigated, 0/12 counted, on the pre-#527 preview).
- …and the two waits are separate claims, both measured on #527's preview. AFTER THE ACTION is not after the push — the action settles in 200–500 ms and the push commits in 180–430 ms, so they overlap and it still stranded 8 of 11. AFTER THE URL CHANGES is not after the destination RENDERS — the URL is written when the router starts committing, so the refresh lands inside that render and is coalesced away about one time in ten (22/22 navigated, 20/22 counted). With the extra frame: **22/22 navigated, 22/22 counted**, median 422 ms, slowest 678 ms. The `.catch` is part of the shape: an unhandled rejection on a page the user has left has nobody to tell.
- The STRANDING is specific to a CONCURRENT push (#529, measured). The 22/22 and 11/11 above are a `<Link>` whose `onClick` fires the action: the push is already in flight when the transition or refresh arrives, so there is something to supersede. A handler that `await`s the action and only THEN pushes has no in-flight push, and both of #308's unswept violations navigated 22/22 with the banned shape still in place. They are still violations — the refresh re-renders a route nobody will be on, which is dead work and one wrong edit away from the concurrent shape — but do not expect a repro from the `await`-then-push form.
- …and the rule is SWEPT, not spot-fixed (#529): `src/components/navigating-clicks.test.ts` is a TABLE of every handler that ends in a `router.push`, asserting each owns no transition and no `router.refresh()`, plus that the actions reached only by a leaving caller carry no server `refresh()` either. A new leaving handler is a new ROW. Two things it caught: `<form action={fn}>` runs `fn` inside a transition REACT owns, so a leaving submit must be wired through `onSubmit` (`TaskForm`); and an action whose ONLY caller leaves should keep `revalidatePath` (it freshens the destination) and drop `refresh()`.
- Legitimate client state is UI state only: pagination cursors, drag-and-drop, open/closed (`PipelineView`).
- A message that a `router.refresh()` accompanies must NOT live inside the subtree that refresh re-renders — the refusal that fires the refresh unmounts its own `<Alert>` mid-read. Raise it through the root `<Toaster>`, a sibling nothing below can unmount, and never delay the refresh for it.

## Design Tokens — Contrast

The guards are four suites under `src/app/`: `theme-tokens.test.ts`, `text-contrast.test.ts`, `focus-ring.test.ts`, `status-badge-scale.test.ts`.

Applies to `src/app/globals.css` and every stylesheet under `src/app/`; colour maths comes from `src/lib/testing/theme-color.ts`.

- ⚖ WCAG AA (4.5:1) is the standard that BINDS `--muted-foreground`; APCA is advisory and never a reason to lighten it — the token sits at APCA Lc 68.2 on `--muted` and ships anyway.
- ⚖ The cost of darkening `--muted-foreground` is INLINE-LINK SEPARATION, and it is paid in CSS, never by capping the token's lightness: `p a[href]` carries a permanent underline at REST. Never delete that rule and never put `no-underline` on a link inside prose.
- The diagnostic for a LOST underline — an unlayered declaration beating the `@layer base` rule — is an asymmetry in computed style: `text-underline-offset: 4px` present while `text-decoration-line` is `none`. Only the browser or the stylesheet guard sees it.
- ⚖ `--destructive` is DESIGN.md's ruled `danger` #B4432F, NOT a red chosen to clear 4.5:1 — the app shares the palette. If danger has to move, it moves in DESIGN.md FIRST and `globals.css` follows.
- Accepted residual (DECISION): `bg-destructive/10 text-destructive` — twelve call sites — measures 4.07:1 light and 3.89:1 at `dark:bg-destructive/20`. NO token value fixes it; the remedy is a solid ground or a text-on-tint role token.
- ⚖ The person-status badges are the TINTED EDITORIAL scale: each status that carries colour paints ONE hue three ways in `people/status-colors.ts` — pale ground, deep ink, hairline border — mirrored in dark, so every entry spells six classes. `prospect` stays NEUTRAL; `attendee`/`launch_team` share ONE hue at different TINT LEVELS. All fourteen pairs must clear AA and there is NO deferral list.
