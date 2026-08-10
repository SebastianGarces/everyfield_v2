# Invariants

Stable truths that must not be violated. **Every rule is stated below, one line each — these lines ARE the invariants**, not a table of contents for them. Read only this file and you have still seen every rule.

Each section links `invariants/<domain>.md` for the why, the pattern and the worked examples. Read the domain file when you are touching the files it names; read all of them if you are the security lens or resolving a `memory/` conflict.

## Transactions / Atomicity

→ [transactions-atomicity](invariants/transactions-atomicity.md) — any DB write path.

- `db.transaction()` throws at runtime; neon-http has no interactive transactions. Never call it.
- All writes known up front → one `db.batch([...])`: a Neon batched transaction, all-or-nothing.
- Writes interleaved with reads, events or another feature: write the durable "already happened" marker LAST, every earlier step idempotent.
- SELECT-then-INSERT is not a concurrency guard. Make duplicates impossible with a (partial) unique index, keeping that row in the SAME `INSERT` as the rows it speaks for.
- In a batch the compare-and-set goes FIRST and the dependent write's `WHERE` re-asserts what the claim set — an empty `returning()` is not an error and rolls nothing back.
- A compare-and-set serialises only same-row writers; a predicate about another table is a snapshot read. To compete for a row elsewhere, `SELECT … FOR UPDATE` it as statement ONE and gate on the dependent write's own rowcount.
- In a `WITH` chain a `FOR UPDATE` snapshot CTE must be a DEPENDENCY of the write (`update … from current c`), never a sibling only the journal joins — pulled lazily after the UPDATE it reads nothing, and the history row is silently lost.
- A plant declares its starting phase ONCE, and the DATABASE is what says so: `phase_transitions_initial_declaration_unique_idx` (partial, on `church_id where kind = 'initial_declaration'`) plus `ON CONFLICT … DO NOTHING` — never a `NOT EXISTS` over `phase_transitions`, which is the same-lock-different-table trap and was raced into fabricating history.
- A church and its `church_privacy_settings` row are created by ONE batch; the loser's orphan church is swept afterwards under a `NOT EXISTS` guard.
- Both answers to an empty planter seat — the No as well as the Yes — open with `SELECT … FROM churches … FOR UPDATE` and are gated on their own rowcount.
- `finalizeAttendance()` emits downstream first, then compare-and-sets `actual_attendance` (non-null = finalized = its idempotency key); `meeting.attendance.finalized` is emitted STRICTLY.
- Accepted residual: the COM-020 task→communication log entry has only a SELECT-then-INSERT on `communication_recipients.external_id = 'task:<id>'`; `completeTask` is a read-then-write, so a double-clicked Complete writes two entries until a partial unique index exists.
- Accepted residual: `meeting.attendance.recorded` is non-strict — a failed prospect → attendee advance is swallowed rather than blocking finalization.

## Multi-Tenancy

→ [multi-tenancy](invariants/multi-tenancy.md) — invitations, associations, onboarding.

- All feature data carries `church_id`; `church_id = null` means global content (e.g. wiki articles).
- Tenant isolation is enforced in the application layer — there is no RLS behind you.
- Hierarchy is SendingNetwork → SendingChurch → Church, every hierarchy FK nullable, and a plant's two oversight FKs are INDEPENDENT — neither implies the other.
- An accept never replaces an existing association: both statements of the accept batch carry `fk IS NULL OR fk = <this org>`, and the guard sits on the CLAIM so a refusal writes nothing at all.
- An invitation may name no target — that is the register path. Only `bindOpenInvitationTarget` (CAS on pending + both targets null + unexpired) gives it one, which is what makes a link single-use; registration binds BEFORE accepting, never after.
- An existing account MAY be targeted (#304 built the surface that answers), but EVERY refusal reachable AFTER the address has been resolved to a target is the ONE message, `ACCOUNT_NOT_INVITABLE_MESSAGE` — not merely the three the ruling listed ("not invitable" / "slot held by another org" / "already ours"). The property is positional, not a list: anything downstream of `resolveInvitationTarget` speaks about a STRANGER, so `assertTargetSlotFree` has no message of its own (`slotRefusalMessage`) and the second authority pass goes through `resolveInvitationForResolvedTarget`, which collapses it. Only the target-less AUTHORITY pass, which runs before any lookup and describes the ACTOR's own role and org, stays legible. Add a rule downstream and it is collapsed by construction; add one that reads the address by another route and it is yours to collapse.
- No invitation that cannot be answered, and it is now TRUE FOR ALL ROLES: every TYPE that can name an existing account has an in-app surface for the role that answers it, AND that role can leave the association from the same surface. `church_to_sending_church` / `church_to_network` → the planter, at `/settings/association` plus the dashboard reminder, with `LeaveOrgDialog`; `sending_church_to_network` → the target sending church's admin, at the same route's second view, with `LeaveNetworkDialog` (#304 WS3 / OV-013). `/settings/association` serves both roles and `/settings` links it to both; adding a fourth invitation type means adding its answering view AND its leave control in the same change (`answer-surfaces.test.ts` enumerates the type list and fails otherwise).
- The two leave endpoints are separate, and neither takes an entity id: the planter's takes a two-valued KIND (a plant has two associations to choose between), the sending church's takes NOTHING (a sending church has exactly one, always with a network). One shared endpoint with a role branch would put the choice of authority rule in the client's hands.
- One inviting org may address ONE email at most `INVITES_PER_INVITEE_PER_WINDOW` (3) times per `INVITATION_EXPIRY_DAYS`, counting EVERY status — a targeted invitation raises a dashboard reminder that is dismissible only by answering, so a decline–reinvite loop would be a permanent attacker-chosen banner. The cap runs BEFORE `resolveInvitationTarget` and applies to open invitations too, or "this address is rate-limited" would itself say an account exists.
- The create-invitation notice offers a `/register?invitation=…` link only for an OPEN invitation. A targeted one names an account that cannot register again, so `inviteePath` is null and the admin is told the invitee answers in-app.
- `association_events` names a SUBJECT, not a plant (ruled #351, migration 0035): `subject_type` ∈ {church, sending_church}, one nullable FK per kind, and a CHECK that exactly one is set. `church_id` is nullable HERE and that never means "global content" — the CHECK makes a subject-less row unwritable. All three invitation types audit; `auditableAssociationOrg` returns a subject for each.
- A notification is anchored to a CHURCH or to an ORG (`anchor_type` ∈ {church, sending_church, network}, `anchor_org_id`, CHECK exactly-one) — ONE table, never a parallel org table. Every church-scoped read still names `church_id` and is unchanged; the org reads name `anchor_org_id`; neither coalesces, so the two tenancies partition the table.
- The org anchor gets its OWN unique index and its own ON CONFLICT clause, on a single NON-NULL `anchor_org_id`. Two nullable per-kind columns would have put a NULL in every org row's index key, and NULLs never collide in a btree unique index — `dedupeKey` would have stopped being idempotent for exactly the rows #304 WS3 adds.
- Gate 1 for an org-anchored row is `recipientAdministersOrg` — this user's own org FK equals the anchor, and their role is an oversight one — NOT `canAccessChurch`, which has no plant to traverse. It is not a hierarchy walk either: a network admin does not receive a sending church's own rows. Consent has no third party to come from, so a category that requires sharing is refused outright.
- A decline names the ADDRESS THE ORG TYPED, never the plant: the refused org never associated with it, so `invitee_email` is the only identifier that goes back. Every OTHER milestone names the plant, which is why the field is `MilestoneFacts.subject`, not `plantName`.
- `status = 'pending'` is not "answerable": expiry is LAZY (a row is stamped `expired` only when somebody tries to answer it), so every list that OFFERS an answer carries `(expires_at is null or expires_at > now)` too — `getPendingInvitationsForPlant` included, because its reminder is dismissible only by answering.
- An invite token is bound to the invited ADDRESS, not the link holder: the registering email must equal `invitee_email` (trim+lowercase) for both the association and the beta bypass. Fix a wrong address by revoking, never by re-aiming a live invitation.
- "Is the slot free" is asked twice and the two are not interchangeable: at create for a legible refusal, at accept as the real guard.
- An invitation belongs to the inviting ORG, not the admin who typed it — list and revoke share ONE predicate, `invitingOrgOf(actor)`.
- THREE SEVERS, one per side of the two associations (#304): the planter's `leaveOversightOrgAs`, the org admin's `removePlantFromOrgAs`, the sending church admin's `leaveNetworkAsSendingChurchAdmin` (OV-013). None calls the three bare `disassociate*` primitives, which stay out of every `"use server"` module — a sever's FK write must assert the org it is severing (`fk = <this org>`) or it severs the wrong one for a plant that belongs to two.
- OV-013 could not ship before migration 0035 and that is the rule, not the history: #274 requires a type-to-confirm, a notification AND an `association_events` row of every sever, so a sever whose subject the audit table cannot hold does not ship at all. `severAssociationWithAuditStatement` serves both subjects through `subjectSql`; a sending church can only be severed FROM a network, and asking for anything else throws.
- The org side takes a CHURCH id and nothing else: which org, its kind and the actor all come from the session (`oversightOrgOfUser` — a `sending_church_admin` can only end the sending-church association, a `network_admin` only the network one), so "an admin of another org cannot sever this one's association" is structural rather than a check.
- The association audit has ONE reader, `associationHistoryQuery`, and its WHERE names the plant AND the caller's own org — a plant's history with an org the caller is not party to is that org's business (Hierarchical Access Control, same rule as the provenance lookup).
- The removal notice to the plant's planter is a CHURCH-role notification (`association.removed_by_org`), never an `oversight.milestone.*` type: the two exemption lists in `notifications/categories.ts` are keyed on type strings and a planter's message must not ride one written for an oversight admin.
- A sever's FK null and its `association_events` row are ONE statement — `insert … select … from severed` — because an UPDATE that matched nothing is not a batch error and would otherwise commit an audit row for a sever that never happened.
- An oversight admin is told about a plant they can no longer reach in exactly two cases (a declined invitation, an association ended); `enqueue`'s gate 1 rests those two server-composed types on a RECORDED relationship (an invitation or an `association_events` row), never on nothing.

## Hierarchical Access Control

→ [hierarchical-access](invariants/hierarchical-access.md) — every oversight surface.

- A coach reaches churches via `coach_assignments`, a sending church admin via matching `sending_church_id`, a network admin via matching `sending_network_id` — always through `getAccessibleChurchIds(user)`.
- Oversight users see AGGREGATE metrics only — never individual person records.
- Call `canAccessFeatureData(user, churchId, feature)` before returning feature data; the six `share_*` toggles default false and gate what oversight may PULL.
- PUSH is far narrower: an oversight recipient gets ONLY the daily digest and three milestone events; `enqueue` refuses every granular category for them unconditionally, gated by `share_activity_with_oversight` read at enqueue time.
- That toggle gates PUSH only and the consent copy may not claim more — `getOversightPlantHealth()` returns name, phase, launch countdown and health with NO privacy gate.
- A refused category is never OFFERED either (ruled 2026-08-09, extending #254): the settings screen and `setNotificationPreferenceAction` both derive from `OVERSIGHT_ELIGIBLE_CATEGORIES` via `audienceMayReceiveCategory` — never a second list of the five granular names.
- Its ruled presentation is SHOWN-AND-LABELLED, not hidden: the five rows stay visible with a "Not sent to you" token and inert switches, and the reason (`OVERSIGHT_INELIGIBLE_CATEGORY_NOTE`) is said once, visibly — never tooltip-only.
- Three notification types are consent-EXEMPT and all three are the org's OWN relationship changing: an invitation accepted, an invitation declined, an association ended. The exemption relaxes consent, never the category allow-list.
- Reaching a plant is not permission to name the orgs BEHIND it: every org name on an oversight surface must be the caller's own or inside it, scoped in the `WHERE` clause.
- A launch countdown compares two DAYS — floor `asOf` to its UTC day BEFORE subtracting a `yyyy-mm-dd` target date. ONE implementation: `daysUntilTarget` (`src/lib/launch/countdown.ts`); never a second copy under any name — the copy is always the one that misses the fix.

## Authentication

→ [authentication](invariants/authentication.md) — sessions, `"use server"` modules, route handlers, `src/proxy.ts`.

- Session-based, NOT JWT, for immediate revocability; `sessions` is keyed by the hashed token.
- Cookie `session` (httpOnly, secure in prod, sameSite=lax); 30-day expiry, 15-day sliding refresh; "fresh" for 10 minutes after login, which sensitive ops require.
- **Every export of a `"use server"` module is a POSTable endpoint reachable with no session and no UI** — the export list IS the auth surface. Keep helpers, reads and not-yet-wired writes in a sibling module with no directive.
- A state-changing action never takes its actor as an argument — it mints one from `verifySession()`. An entity implied by the actor (their own plant, their own org) is not an argument either.
- A shared secret is never compared with `===`: use `matchesBearerSecret`/`constantTimeEquals` from `src/lib/security/constant-time.ts`, which hashes both sides to a fixed length first. Covers `CRON_SECRET` and `REVALIDATION_SECRET`.
- A request header the app does not write UNCONDITIONALLY is client input and nothing may branch on it. `x-pathname` (`PATHNAME_HEADER`) is the one trusted header, and its absence must fail closed.
- The crawler allowance is ONE predicate, `isCrawlerPreviewRequest(userAgent, pathname)`, over a fixed route list that is a STRICT subset of the protected list — `/wiki` only. It buys the unauthenticated shell, never a session and never per-user data.
- Listing a route there means "this route produces a session-less render worth previewing" (ruled 2026-08-09): it must render with no session AND that render must be the page, not a redirect. `/dashboard` failed the first (it calls `verifySession()`, so crawlers 500'd); `/oversight` failed the second (its pages redirect to /login, so no card was ever produced).
- Both stay in the proxy's `PROTECTED_ROUTE_PREFIXES`, named EXPLICITLY and not through the spread of the previewable list — dropping a prefix from that list must never unprotect the route as a side effect.
- The `whatsapp` crawler token is anchored — `^whatsapp/<digit>`, which is WhatsApp's link-preview FETCHER, whose UA is only the token. Its in-app browser is a human behind a `Mozilla/5.0 …` UA that also says WhatsApp; a bare substring called that person a bot.

## Password Security

- Argon2id with OWASP parameters: memory 19456 KiB, time 2, parallelism 1, 32-byte output (`src/lib/auth/password.ts`).

## User Roles

- The roles are `planter`, `coach`, `team_member`, `sending_church_admin`, `network_admin`.
- Planter: full CRUD on their own church. Team member: feature-limited within it. Coach: read on assigned planters via `coach_assignments`. Both oversight admins: aggregates for churches matching their org FK, subject to the privacy toggles.
- Outside registration a role is granted in exactly ONE place — the OB-010 planter claim on a planterless plant, promoting `team_member` → `planter`. Eligibility is `canAnswerLeadershipQuestion` (`src/lib/onboarding/leadership.ts`), and the SQL repeats the role check so it never rests on a JS check alone. It is a raced write; see [transactions-atomicity](invariants/transactions-atomicity.md).

## Phase History — Declarations vs Transitions

Applies to `phase_transitions` and every reader of it. Ruled on #306 (2026-08-09).

- `phase_transitions` is TWO populations, told apart by the stored `kind` discriminator and never by the reason text: `transition` (a move the planter made inside EveryField) and `initial_declaration` (where the plant already stood when it arrived, OB-005).
- A declaration is NOT an advance. Anything counting, gating on or announcing "reached a new stage" filters `kind = 'transition'` — one predicate, `phaseAdvanceCondition()` (`src/lib/notifications/oversight-events.ts`), which `stageReachedCondition` and `hasActivityCondition` both call so the count and the "was there activity at all?" gate cannot drift apart.
- `declareInitialPhase` emits NO `phase.changed`. `PhaseChangedEvent` carries no `kind`, so its subscriber cannot tell a declaration from a move; adding a subscriber that needs to see declarations means adding `kind` to the payload FIRST, never re-adding the emit.
- A second declaration is REFUSED, never overwritten and never half-applied (ruled: refuse with a message). `declareJourney` branches on `already_declared`, reports the STORED phase, and says both what is on record and that the launch date on the same form did save.
- The launch date is never written to a column on `churches` — `churches.launch_date` was dropped by migration 0032 and the launch entity owns it (LS-001). Onboarding sets it through `scheduleLaunchAction`, the same rail as `/launch`, so the row lock, the `launch_events` journal, the oversight announcement and the Playbook seed all come for free.
- "No date yet" writes nothing on a first pass and is REFUSED on re-entry over a stored date: there is no unschedule write path (`launch_events` has no event type for a cleared date, and a scheduled launch has already seeded milestones), so the step names the stored day and points at `/launch` rather than silently leaving a countdown the radio hint promised would be empty.

## Wiki Articles

→ [wiki-articles](invariants/wiki-articles.md) — `src/lib/wiki/**`.

- Routing is slug-based, not id-based; progress and bookmarks link by `article_slug`, never `article_id`.
- **Never interpolate a slug into a wiki path.** Build every one — `href`/`router.push`, OpenGraph `url`, and the `pathname === wikiHref(slug)` active-item test — with `wikiHref()`, which encodes per segment so `/` stays a separator for the catch-all.
- `revalidatePath()` is the one wiki path `wikiHref` must NOT build — use `wikiRevalidationPath()`. The tag is derived from the DECODED pathname, so the href form matches no tag, revalidates nothing, and still returns 200.
- MDX is compiled at request time via `next-mdx-remote/rsc`; search is a weighted tsvector (title A > excerpt B > content C); revalidation requires `REVALIDATION_SECRET`.
- Every wiki article read is `church_id IS NULL OR church_id = :current_church_id` — global PLUS the reader's own, never "mine" alone. Isolation is application-layer; this predicate IS the boundary (asserted at SQL level in `tenancy.test.ts`).
- A church's own row for a slug OVERRIDES the global article of that name (`preferChurchOverride`); `wiki_articles_slug_church_idx` is unique on (slug, church_id), so at most two rows can match and the church's wins.
- Every `churchId` parameter on the wiki reads defaults to `null`, so a call site that forgets to thread the session fails CLOSED — it under-fetches the church's own content rather than leaking another church's.
- Cross-links live ONLY in `related_article_slugs`, never in an article's prose — the authored `## Related Articles` section was migrated out of all 96 articles (#317). Writing one back into `content` renders the list twice, and no test catches it.

## Communication — Resend & Delivery Figures

Applies to `src/lib/communication/**` and the `/communication` surfaces. Ruled 2026-08-09 on PR #371.

- A resend to non-openers is offered ONLY when both hold: at least `RESEND_COOLDOWN_HOURS` (24) since `sent_at`, AND at least one recipient row confirmed delivered. One decision — `evaluateResendEligibility` (`src/lib/communication/resend-policy.ts`) — drives the button and is re-checked inside `resendToNonOpeners`; the UI gate is never the only gate.
- A `sent` message with a null `sent_at` is `tooSoon`, not eligible. The cooldown that cannot be proven elapsed has not elapsed.
- `UNREACHABLE_STATUSES` = `bounced` AND `failed`, and `nonOpenerScope` excludes both. A `failed` row is an address the provider refused — retrying it cannot succeed and spends sender reputation. Never re-split the two.
- "Delivery rate" names exactly ONE figure: `delivered / attempted`, on the church-wide overview only. A single message's tiles report COUNTS with the denominator in the caption ("Delivered · 6 · of 10 recipients") and claim no rate — the tile once divided by all recipient rows and called that the delivery rate too, which is a different number under the same name.
- A rate with a zero denominator is UNKNOWN (`toPercent` → `null`, rendered as `—`), never `0%`. "0% open rate" is a claim about a send that never arrived.

## Tasks, Subtasks & Recurrence

→ [tasks](invariants/tasks.md) — `src/lib/tasks/**`, `src/app/(dashboard)/tasks/**`.

- Nesting is ONE level, enforced in both directions: a subtask may not take children, and a task that already has children may not be demoted into one. Half the rule is no rule — refusing only the first is bypassed by parenting the other way round.
- Completing every subtask does NOT complete the parent. There is deliberately no code that does it (#90); the absence is the ruling, not an oversight, and the UI says so out loud.
- A subtask is a checklist item, not a task. Anything reporting a NUMBER of tasks applies `topLevelTasksOnly()` — `listTasks` and `getTaskCounts` share it, because the badges and the list under them must count one population (ruled on #370). Checklist progress is reported separately, never folded into `complete`.
- A new subtask inherits its parent's assignee (#370). A default, not a lock — an explicit assignee wins and the subtask is reassignable. An unowned checklist item reaches no "My tasks" view and nobody is accountable for it.
- The checklist is part of a recurring task's TEMPLATE: completing one mints the successor with EVERY item copied across, unticked — the ticked ones and the never-started ones under one rule (#370). Per-item carry-over state was rejected; a repeating task repeats whole.
- Copied children get explicit `created_at` stamps one millisecond apart. `listSubtasks` sorts by `created_at`, and one multi-row INSERT stamps every default with the same transaction timestamp, leaving checklist order to a random-UUID tiebreak.
- Exactly ONE instance of a recurring series is open at a time, minted on completion — never by a cron. The guard runs BEFORE the successor insert, so a resurrected series gains neither a second open task nor a duplicate checklist.
- `completionEvent` is never copied to a successor: `meeting.evaluation.completed` is backed by a partial unique index, so copying it aborts the second instance's insert. Recurrence mints plain work; hooks stay with the generator.
- A completion is written FIRST and its successor second — the reverse of the usual durable-marker-last rule, deliberately. A successor with no completion leaves two open instances; a completion with no successor is repaired by reopening and re-completing.

## Dev Seeds

Why and how: [`contracts/db.md`](contracts/db.md) → The dev-seed wipe. Applies to
`scripts/seed-dev-db.ts` and anything that inserts a `churches` row.

- `pnpm db:seed` deletes ALL users and ALL churches unscoped — the fixture is the whole database, not the rows the script created. Run it against your own or a throwaway database ONLY; on the shared `development` branch it takes the alpha-cohort logins, the marketing fixture and every hand-registered plant.
- The wipe REFUSES to run on a database holding an alpha-cohort sentinel account unless `--allow-protected-db` is passed (`src/lib/dev-seed/protected-database.ts`, ruled 2026-08-09). Detection is POSITIVE — sentinel rows, never "does this connection string look like development", which fails open. Passing the override on the shared database is a deliberate, destructive act, not a way past a nagging prompt.
- The wipe ORDER is derived at runtime from `pg_constraint` by `planWipe()`. Never re-introduce a hand-kept table list — the derivation is what makes a new table join the wipe on its own.
- `wiki_articles` and `wiki_sections` are `PROTECTED_TABLES`: never deleted AND never walked through, so nothing downstream of them is dragged in either. The corpus is migrated content no script rebuilds (#317).
- A protected row pointing at a table the wipe deletes (a church-scoped wiki article) ABORTS the whole seed before its first DELETE — `assertProtectedTablesAreSafe()`. Stop and re-point by hand; never widen the wipe to cover it.
- Every script that inserts a `churches` row stamps `onboarding_completed_at` with `now()` in that same INSERT — an unstamped seeded church puts its planter in the onboarding wizard instead of the dashboard. Pinned by `src/lib/onboarding/seeded-churches.test.ts`.

## Request Deduplication

- `getCurrentSession()` is wrapped in `React.cache()`, so repeat calls in one request hit the cache, not the DB (`src/lib/auth/session.ts`).

## Date & Time Rendering

→ [dates-times](invariants/dates-times.md) — anything rendering or parsing a date.

- Never format a `Date` without a pinned `timeZone` — format through `src/lib/datetime.ts` (`APP_TIME_ZONE`, UTC). `Intl`/`toLocale*`/date-fns follow the runtime's zone, so SSR and hydrated markup differ (React #418).
- A meeting's `datetime` is a wall clock, not a zoned instant: `meetingDatetimeSchema` with `parseDateTimeLocalValue()`/`toDateTimeLocalValue()`, never `z.coerce.date()`.
- There is no per-user or per-church timezone column. Adding one means changing `APP_TIME_ZONE` and back-filling, never re-introducing runtime-local formatting.

## Client/Server Data Synchronization

Conventions and examples: [`contracts/data-patterns.md`](contracts/data-patterns.md).

- NEVER store server data in `useState` (it goes stale the moment the server revalidates) and NEVER sync data with `useEffect` — server data flows through props from server components.
- Use `useOptimistic` for instant feedback; the server action calls `refresh()` from `next/cache` to reconcile, not the client calling `router.refresh()`. Example: `ActivityTimelineClient`. Props-only is the other shape — no local state at all (`TagPicker`).
- Legitimate client state is UI state only — pagination cursors, drag-and-drop, open/closed (`PipelineView`).
