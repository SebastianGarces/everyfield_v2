# Invariants

**Every rule is stated below, one line each — these lines ARE the rules**, not a table of contents for them. Read only this file and you have still seen every rule.

Rules bind at two strengths (`ops/agent-os/README.md` → Rules bind at two strengths):

- An **untagged line is an invariant** — a mechanical or security fact. Never break it; a change that needs to is wrong.
- A line tagged **⚖ is a ruling** — a dated product decision. Never break it *silently*: build to it, and if it no longer fits, rule on it per `ops/agent-os/README.md` → Rulings and record why. A new ruling changes it; nothing else does.
- A line starting **Accepted residual** is a known gap, carried deliberately until the named condition retires it.

Each section links `invariants/<domain>.md` for the why, the pattern and the worked examples. Read the domain file for what you are touching; read all of them as the security lens.

## Transactions / Atomicity

→ [transactions-atomicity](invariants/transactions-atomicity.md) — any DB write path.

- `db.transaction()` throws at runtime — neon-http has no interactive transactions. Never call it.
- All writes known up front → one `db.batch([...])`: a Neon batched transaction, all-or-nothing.
- That rule is checked over SOURCE through ONE implementation, `assertBatchedWrites` (`src/lib/testing/db-atomicity.ts`), fed a body cut with `sourceReader`.
- Writes interleaved with reads, events or another feature: write the durable "already happened" marker LAST, every earlier step idempotent.
- Where the earlier steps are NOT redo-safe, the marker becomes a CLAIM written FIRST (`ON CONFLICT DO NOTHING` on a unique index), and the non-idempotent work is gated on the claim's rowcount.
- SELECT-then-INSERT is not a concurrency guard. Make duplicates impossible with a (partial) unique index, in the SAME `INSERT` as the rows it speaks for.
- In a batch the compare-and-set goes FIRST and the dependent write's `WHERE` re-asserts what the claim set — an empty `returning()` is not an error and rolls nothing back.
- A compare-and-set serialises only same-row writers; a predicate about another table is a snapshot read. To compete for a row elsewhere, `SELECT … FOR UPDATE` it as statement ONE and gate on the write's rowcount.
- In a `WITH` chain a `FOR UPDATE` snapshot CTE must be a DEPENDENCY of the write (`update … from current c`), never a sibling only the journal joins: pulled lazily it reads nothing, and the history row is lost.
- A plant declares its starting phase ONCE and the DATABASE says so, through `phase_transitions_initial_declaration_unique_idx` plus `ON CONFLICT … DO NOTHING`. A `NOT EXISTS` over `phase_transitions` is the same-lock-different-table trap.
- A church holds at most ONE fork of any system template: `message_templates_church_fork_unique_idx` (partial, `(church_id, source_template_id) where source_template_id is not null`) plus `forkTemplate`'s `ON CONFLICT … DO NOTHING`, re-reading the winner's fork on an empty `returning()` — the loser ADOPTS the winner, because a fork holds the planter's own edits. The nullable-`church_id` NULL gap is deliberate: nothing writes that shape, and a `coalesce` index would make the ON CONFLICT target unspellable.
- A (meeting, person) pair holds at most ONE unanswered RSVP: `meeting_confirm_tokens_pending_unique_idx` (partial, `(meeting_id, person_id) where status = 'pending'`) plus ONE `ON CONFLICT … DO UPDATE` in `createConfirmationToken`. An EXPIRED pending row is renewed IN PLACE, invalidating its old emailed link; a LIVE token is never rotated — the call writes nothing and re-reads it.
- One person per team role: `team_memberships_role_active_unique_idx` (partial, `role_id` ALONE where `status = 'active'`) — `(church_id, role_id)` was rejected: a forged church id would buy a second seat. The INSERT refuses with an empty `returning()` (`ON CONFLICT … DO NOTHING`); `isSeatConflict` (`ministry-teams/membership-conflict.ts`, via `isUniqueViolation` — the ONE copy of that predicate) is all that stands between a lost race and a raw driver error reaching a planter.
- That is the ONLY unique index on `team_memberships` (0039 dropped the subsumed `team_memberships_active_unique`): ANY second one is a non-arbiter a raced INSERT meets first, raising 23505 past the `DO NOTHING`. Never re-add one, never widen the `ON CONFLICT` target, never add a pre-flight SELECT; `ruled-guards.test.ts` §4c/§4d pin the name and, off the RENDERED table, the exactly-one-index shape.
- The REACTIVATION path is an UPDATE and the index is NOT its guard (one row cannot collide with itself): it carries `status = 'inactive'` in its own WHERE — a compare-and-set, not the banned pre-flight SELECT — and its empty `returning()` refuses as the INSERT's does (`ruled-guards.test.ts` §3c).
- WHICH refusal sentence the loser reads is decided by reading the seat's active holder ONCE, for BOTH refusal paths (`seatRefusalMessage`): the same person vs. anybody else — never an index→sentence table, because a seat key of `role_id` alone reports no intent. Post-refusal, wording only; never re-shape the read into a guard.
- A migration that adds an arbiter index goes FIRST: `ON CONFLICT (…) WHERE …` against a database lacking it is SQLSTATE 42P10 on EVERY call, and nothing here applies migrations on deploy — code-first is the default unless an operator runs `pnpm db:migrate`.
- One live suppression per ADDRESS: `email_suppressions_active_email_idx` (partial on `email` where `cleared_at is null`) is the `ON CONFLICT … DO NOTHING` arbiter, never DO UPDATE — the first row's reason and `suppressed_at` survive every redelivery.
- One card per (meeting, person): `meeting_responses_meeting_person_unique` is the upsert target, so a double submit corrects the card instead of double-counting; the DO UPDATE SET is field by field.
- A church and its `church_privacy_settings` row are created by ONE batch; the loser's orphan church is swept afterwards under `NOT EXISTS`.
- Both answers to an empty planter seat, the No as well as the Yes, open with `SELECT … FROM churches … FOR UPDATE` and gate on their own rowcount.
- `finalizeAttendance()` emits downstream first, then compare-and-sets `actual_attendance` (non-null = finalized = its idempotency key); `meeting.attendance.finalized` is emitted STRICTLY.
- `createHouseholdWithHead` is ONE `db.batch` whose household INSERT is an `insert … select` from the person row — never re-add a pre-flight SELECT — and stays FIRST, because `persons.household_id` FKs `households.id`.
- A race guard is only proven against a REAL Postgres: the `LIVE_DB_TESTS=1` suites reach one through a local Neon HTTP proxy, switched by the test-runner PRELOAD `scripts/live-db-endpoint.ts` — never a second driver (`node-postgres` has no `db.batch`) and never a seam in `src/db/index.ts`, which stays two lines and interprets no hostname.
- A live suite MINTS every row it needs, actor included, inside its own `SCRATCH_NAME` namespace — never `select … from users limit 1`. `live-suite-coverage.test.ts` fails if a suite opts into `LIVE_DB_TESTS` without joining `test:live`, if the preload is dropped, or if any module under `src/` touches `neonConfig`.
- Accepted residual: those two statements take separate READ COMMITTED snapshots, so a person soft-deleted between them commits an orphan household.
- Accepted residual: the task→communication log entry has only a SELECT-then-INSERT on `communication_recipients.external_id`, so a double-clicked Complete writes two entries.
- Accepted residual: `recordMeetingResponse`'s attendance guard is a separate read, so a row deleted between the two commits a card for somebody off the list — counted by neither breakdown query, so invisible rather than wrong.
- Accepted residual: `meeting.attendance.recorded` is non-strict — a failed prospect → attendee advance is swallowed rather than blocking finalization.

## Multi-Tenancy

→ [multi-tenancy](invariants/multi-tenancy.md) — invitations, associations, onboarding.

- All feature data carries `church_id`; `church_id = null` means global content (wiki articles).
- Tenant isolation is enforced in the application layer; there is no RLS behind you.
- A person-scoped write whose service does not itself scope the person by church calls `assertPersonInChurch` FIRST, and the commitment check precedes the upload so no object lands for a foreign person.
- Hierarchy is SendingNetwork → SendingChurch → Church, every hierarchy FK nullable, and a plant's two oversight FKs are INDEPENDENT.
- An accept never replaces an existing association: both statements carry `fk IS NULL OR fk = <this org>`, and the guard sits on the CLAIM so a refusal writes nothing.
- An invitation may name no target — that is the register path. Only `bindOpenInvitationTarget` (CAS on pending + both targets null + unexpired) gives it one, which makes a link single-use; registration BINDS before accepting, never after.
- ⚖ An existing account MAY be targeted, but EVERY refusal reachable after the address resolves to a target is the ONE message `ACCOUNT_NOT_INVITABLE_MESSAGE`. The property is positional: anything downstream of `resolveInvitationTarget` speaks about a STRANGER.
- ⚖ No invitation that cannot be answered, for every role: each TYPE that can name an existing account has an in-app surface where that role answers it AND leaves the association.
- The two leave endpoints are separate and neither takes an entity id: the planter's takes a two-valued KIND, the sending church's takes NOTHING. Never one endpoint with a role branch.
- ⚖ One inviting org may address ONE email at most `INVITES_PER_INVITEE_PER_WINDOW` (3) times per `INVITATION_EXPIRY_DAYS`, counting EVERY status. The cap runs BEFORE target resolution and covers open invitations.
- ⚖ …and it RESETS AFTER A SEVER: both count queries drop every invitation older than that org's most recent `association_events` row about the same subject. A decline writes no event, so that loop stays capped.
- Both create-time caps count the resolved TARGET as well as the address, because one org is reachable through several accounts. That refusal is `ACCOUNT_NOT_INVITABLE_MESSAGE`.
- The two rate-limit passes are two FUNCTIONS, not one called twice: the address-scoped one is the only composer of `INVITE_RATE_LIMITED_MESSAGE`; the post-resolution one has no legible message.
- A client NEVER names an invitation's target: the request is built key by key from the server-resolved target, never a spread. Every `"use server"` export taking an OBJECT parses a `z.strictObject` schema first.
- ⚖ The create-invitation success notice shows ONE neutral message for both kinds and never says whether an account exists.
- ⚖ The rule covers the WHOLE `/oversight/invitations` page, notice AND pending list: nothing derived from either target column reaches the client, and no admin surface renders a `/register?invitation=` link.
- ⚖ The rule is TRANSITIVE and `type` is target-derived, so a caption off `invitation.type` flips for an address holding an account of the other kind. `InvitationListRow` carries five fields, built by `toInvitationListRow`.
- Pin that by CALLING the row mapper over both target shapes and asserting the two rendered rows are deep-equal, never by a regex or an allowed-field whitelist.
- ⚖ The rule reaches `/register` and BOTH readers of the row, and the two verbs have DIFFERENT indistinguishable sets: the GET for {targeted, answered, nonexistent}, the POST for those plus an open row submitted with a NON-matching address. ONE predicate decides.
- An invitation token buys TWO things on `/register`, a described invitation and a beta-gate bypass. When a rule is about a ROUTE, enumerate that route's readers of the row.
- ⚖ The anonymous `/register` POST returns NO per-row message: a wrong-address submit falls through to the ordinary sign-up exactly as an unknown id does. One decision is made once and read by every later branch.
- Accepted residual: an OPEN row stays distinguishable at `/register` — the GET renders the redeeming form with a pre-filled `readOnly` address (never `disabled`, which submits nothing), and the matching POST redeems. Retired by invite-at-registration.
- Pin BOTH readers by CALLING them over rows the real resolver produced, never by a regex over the source.
- `redeemable` is deleted rather than left constant; `accountType` survives only because every described row is open.
- ⚖ `association_events` names a SUBJECT, not a plant (0036): `subject_type` ∈ {church, sending_church}, one nullable FK per kind, a CHECK that exactly one is set. `acceptInvitationAs` has ONE batch shape, `[lock, claim, association, audit]`; `requireAssociationPair` decides which ids a type implies.
- ⚖ A notification is anchored to a CHURCH or to an ORG (`anchor_type`, `anchor_org_id`, CHECK exactly-one) — ONE table, never a parallel org table, and neither tenancy coalesces with the other.
- The org anchor gets its OWN unique index on a single NON-NULL `anchor_org_id`, never per-kind nullable columns: NULLs never collide in a btree unique index.
- Gate 1 for an org-anchored row is `recipientAdministersOrg` — the user's own org FK equals the anchor AND their role administers THAT KIND of org. "Any oversight role" is too coarse — both org FKs live on one `users` row.
- The role↔org-kind↔FK pairing is ONE TABLE, `OVERSIGHT_ADMIN`; no reader in `src/lib/notifications/` writes an oversight role literal or an FK column name.
- That table is a TYPE-IMPORT-ONLY leaf, tied to `OVERSIGHT_ROLES` by test rather than by copy, and outside `@/lib/auth/access`, which opens with `@/db`.
- An audience builder returning `SQL | undefined` NEVER reaches a bare `and()`: drizzle DROPS undefined arms, so the `exists (…)` matches every row. The builder is OVERLOADED, so it is a compile error.
- No `inArray(role, OVERSIGHT_ROLES)` floor beside that audience — each arm already names its role from the pairing table, and the floor would silently AND a mis-edited arm to zero rows.
- ⚖ A `users` row an oversight FK reached whose ROLE does not administer that kind of org is a DATA DEFECT, never a recipient: the audience PARTITIONS them (`OversightAudience`), so `fanOutTo` loops `recipients` alone and logs the rest. The exclusion is in TypeScript, not the `WHERE`, to be COUNTED; `oversightReachCondition` is that probe, never an audience.
- Accepted residual: the digest sweep selects on the PAIRED audience, so a plant whose only oversight row is cross-paired is never swept and its defect reaches the log through the milestone fan-outs alone.
- A decline names the ADDRESS THE ORG TYPED, never the plant — the refused org never associated with it. Every OTHER milestone names the plant, which is why the field is `MilestoneFacts.subject`.
- `status = 'pending'` is not "answerable": expiry is LAZY, so every list that OFFERS an answer carries `(expires_at is null or expires_at > now)`.
- An invite token is bound to the invited ADDRESS, not the link holder. Fix a wrong address by revoking, never by re-aiming a live invitation.
- The invitation email is TRANSACTIONAL and bypasses the notifications machinery — no category, no preference gate, no `enqueue`, no `List-Unsubscribe`. It is best-effort and NEVER fails the create.
- The invitation id is a BEARER CREDENTIAL, so neither it nor any URL built from it reaches a log, an error message or an analytics event; failure logs carry the TYPE and a reason code only.
- The `?invitation=` link has ONE spelling, in the IMPORT-FREE leaf `invitations/register-path.ts`, called only by the invitation EMAIL. A leaf whose contents are ALSO served from the trunk is not a leaf. The property holds for EVERY import-free leaf, and `export … from` is an import.
- THE SAME LEAF RULE, SECOND INSTANCE: `oversight/org-label.ts` owns the two words for an oversight org's kind and is import-free because a `"use client"` dialog renders them. `presentation.ts` must NEVER re-export them.
- THIRD AND FOURTH INSTANCES: `notifications/permanent-failure.ts` (the retry-permanence prefix, keeping the Resend webhook route out of the dispatcher's `@/db` graph) and `notifications/digest-content.ts` (the digest's identity, periods and dedupe keys, cutting an import CYCLE). Neither is re-exported.
- "Is the slot free" is asked twice and the two are not interchangeable: at create for a legible refusal, at accept as the guard.
- The inviting org's name comes from `invitation.type`, never from whichever FK is set, through ONE exhaustive implementation.
- An invitation belongs to the inviting ORG, not the admin who typed it — list, revoke and resend share ONE predicate, `invitingOrgOf(actor)`.
- ⚖ A pending invitation carries a "Resend email" action so a failed or missed send is recoverable. NOTHING is persisted about delivery, because provider acceptance is not a delivery receipt.
- A deliberate resend must never be deduped away by the provider: the `Idempotency-Key` stays invitation-scoped, and a resend adds a window suffix (`RESEND_DEDUPE_WINDOW_MS` = 60s).
- ⚖ After a successful resend the button is DISABLED for the rest of that 60s bucket and counts it down. ONE arithmetic feeds the key suffix and the countdown, and only DURATIONS cross to the browser.
- Accepted residual — ⚖ that cooldown is PER CLIENT SESSION: it lives in `useActionState`, so a reload or a second tab mounts with none. Retired only by reversing the no-persistence ruling.
- ⚖ AND THE ADMIN LINK DOES NOT COME BACK: the create result carries `{ inviteeEmail, emailSent }` and no path, and no notice or row renders a link or Copy control. The rule reaches the refusal copy too.
- …AND THE GREP IS A TEST, over COMMENTS TOO, scanning the DIRECTORY rather than a hand-list.
- A source-shaped test in this domain never slices with a bare `indexOf` and never anchors on a comment: `sourceReader(code, label).span(from, to)` / `.after(from)` (`src/lib/testing/source-span.ts`) THROW on a moved anchor. ORDER rots independently, so `assertInOrder` uses the same throw-on-missing lookup.
- ⚖ THREE SEVERS, one per side of the two associations. None calls the bare `disassociate*` primitives, which stay out of every `"use server"` module — a sever's FK write asserts the org it severs.
- ⚖ A sever ships only where the audit table can hold its subject: a type-to-confirm, a notification AND an `association_events` row are required. A sending church can only be severed FROM a network.
- The org side takes a CHURCH id and nothing else — which org, its kind and the actor come from the session — so cross-org severing is structurally impossible rather than checked.
- The association audit has ONE reader, whose WHERE names the plant AND the caller's own org.
- The removal notice to the plant's planter is a CHURCH-role notification, never an `oversight.milestone.*` type.
- A sever's FK null and its `association_events` row are ONE statement, or a refused sever audits a sever that never happened.
- An oversight admin is told about a plant they can no longer reach in exactly two cases (a declined invitation, an association ended), and gate 1 rests both on a RECORDED relationship.
- That probe PAIRS THE ROLE TO THE ORG KIND, taking the RECIPIENT rather than a pair of ids; never OR both FKs.
- Accepted residual: ORG-ANCHORED NOTIFICATIONS are write-only in-app — the feed viewer returns null when `session.user.churchId` is null, so those milestones arrive by EMAIL only. Retired by the org notification screen.
- Accepted residual: `notifications.anchor_org_id` carries NO FK and NO cascade, so deleting an org orphans its rows while `church_id` cascades.
- Accepted residual: a sending-church-subject `association_events` row is WRITE-ONLY, because the one reader filters on `church_id`. Retired by the first surface that shows it, widening the query by SUBJECT.

## Hierarchical Access Control

→ [hierarchical-access](invariants/hierarchical-access.md) — every oversight surface.

- A coach reaches churches via `coach_assignments`, a sending church admin via matching `sending_church_id`, a network admin via matching `sending_network_id` — always through `getAccessibleChurchIds(user)`.
- Oversight users see AGGREGATE metrics only, never individual person records.
- Call `canAccessFeatureData(user, churchId, feature)` before returning feature data; the six `share_*` toggles default false and gate what oversight may PULL.
- ⚖ PUSH is far narrower: an oversight recipient gets ONLY the daily digest and three milestone events, and `enqueue` refuses every granular category for them, gated on `share_activity_with_oversight`.
- That toggle gates PUSH only and the consent copy may not claim more — plant health (name, phase, launch countdown, health) returns with NO privacy gate.
- ⚖ A refused category is never OFFERED either: the settings screen and the preference action both derive from `OVERSIGHT_ELIGIBLE_CATEGORIES`, never a second list.
- ⚖ Its ruled presentation is SHOWN-AND-LABELLED, not hidden: the five rows stay visible with a "Not sent to you" token and inert switches, and the reason is said once, visibly.
- Three notification types are consent-EXEMPT and all three are the org's OWN relationship changing: an invitation accepted, an invitation declined, an association ended. The exemption relaxes consent, never the category allow-list.
- ⚖ The consent copy NAMES ALL THREE in one sentence with the reason: "Three things reach them either way, because the relationship itself is theirs too: when you accept their invitation, when you decline one, and when your association with them ends." The reversibility bullet sits ABOVE it; pin it by a map keyed on the exempt-type list.
- ⚖ A stored row on `UNSUBSCRIBE_CHANNEL` is a CHOICE, never inheritable: `preferenceValueIsInheritable` exempts that channel from #237's value-equality rule, so the emailed undo's "keep sending these" survives a flip of the coded default. The exemption is by CHANNEL — nothing stored says who wrote a row.
- …and (`digest`, `DIGEST_CADENCE_CHANNEL`) is carved back out of it, since a cadence-only save INVENTS that row's `enabled`. Accepted residual: an undo on the `digest` category therefore still follows the coded default, retired by the deferred per-row intent stamp.
- Reaching a plant is not permission to name the orgs BEHIND it: every org name on an oversight surface must be the caller's own or inside it, scoped in the `WHERE`.
- EVERY `/oversight` route opens with `requireOversightUser()` and no page re-states the role test. THE 404 IS NOT PART OF IT: `/oversight/sending-churches` refuses a `sending_church_admin` with `notFound()`, never the shared redirect.
- NO `/oversight` page reads the database. `getOversightPortfolio` refuses a non-oversight role ITSELF before any `@/db` edge; `getAccessibleChurchIds` does not decide this and may never be leaned on for it.
- Accepted residual: ministry-team write actions check only session + `church_id`, so any authenticated user in a church can mutate any team. Retired by the `risk:high` team-leader-scoping unit.
- A launch countdown compares two DAYS — floor `asOf` to its UTC day BEFORE subtracting a `yyyy-mm-dd` target. ONE implementation: `daysUntilTarget` (`launch/countdown.ts`).

## Authentication

→ [authentication](invariants/authentication.md) — sessions, `"use server"` modules, route handlers, `src/proxy.ts`.

- Session-based, NOT JWT, for immediate revocability. `sessions` is keyed by the hashed token.
- Cookie `session` (httpOnly, secure in prod, sameSite=lax); 30-day expiry, 15-day sliding refresh.
- The `sessions.fresh` column exists, but the freshness control is deliberately unwired until the first sensitive op ships.
- **Every export of a `"use server"` module is a POSTable endpoint reachable with no session and no UI** — the export list IS the auth surface. Keep helpers, reads and unwired writes in a sibling module with no directive.
- A state-changing action never takes its actor as an argument — it mints one from `verifySession()`. An entity implied by the actor is not an argument either.
- SESSION FIRST, THEN THE PARSE: the mint is the FIRST statement of the export, ahead of `safeParse`, because parsing first answers a sessionless caller differently for a malformed argument than a well-formed one.
- WHAT IS PINNED REPO-WIDE is that ORDER — a walk over every parsing export of every `"use server"` module under `src/`, deriving what counts as a mint per module. Only `(auth)` and `(marketing)` are exempt, asserted exactly.
- A NEW action mints ABOVE the `try`, so a sessionless call THROWS instead of becoming a handled `{ success: false }`. NAMED RESIDUAL: 45 older `(dashboard)` exports mint inside their `try` — `TRY_WRAPPED_MINTS`, retired when it empties.
- `UNSUBSCRIBE_TOKEN_SECRET` is REQUIRED in production, minimum 32 characters: the key is one SHA-256, not a KDF, so a genuine token is an offline guessing oracle. `CRON_SECRET` substitutes outside production only, so one secret never guards both the scheduler and every unsubscribe link.
- A shared secret is never compared with `===`: use `matchesBearerSecret`/`constantTimeEquals`, which hash both sides to a fixed length first. Covers `CRON_SECRET` and `REVALIDATION_SECRET`.
- A request header the app does not write UNCONDITIONALLY is client input and nothing may branch on it. The trusted headers are `x-pathname` (absence fails closed) and the platform-written `x-real-ip`.
- Client IP resolution reads `x-real-ip` first, then the LAST hop of `x-forwarded-for` — never the first hop, which the client writes.
- The crawler allowance is ONE predicate, `isCrawlerPreviewRequest(userAgent, pathname)`, over a route list that is a STRICT subset of the protected list — `/wiki` only. It buys the shell, not a session.
- Listing a route there means it must render with no session AND that render must be the page, not a redirect. `/dashboard` fails the first, `/oversight` the second.
- Both stay in the proxy's `PROTECTED_ROUTE_PREFIXES`, named EXPLICITLY and not through the spread of the previewable list — dropping a prefix must never unprotect a route.
- The `whatsapp` crawler token is anchored — `^whatsapp/<digit>`, the link-preview FETCHER. Its in-app browser is a human behind a `Mozilla/5.0 …` UA that also says WhatsApp.

## Password Security

- Argon2id with OWASP parameters: memory 19456 KiB, time 2, parallelism 1, 32-byte output (`src/lib/auth/password.ts`).

## User Roles

- The roles are `planter`, `coach`, `team_member`, `sending_church_admin` and `network_admin`.
- Planter: full CRUD on their own church. Team member: feature-limited within it. Coach: read on assigned planters. Both oversight admins: aggregates for churches matching their org FK, subject to the toggles.
- Outside registration a role is granted in exactly ONE place — the OB-010 planter claim on a planterless plant, promoting `team_member` → `planter`. The SQL repeats the role check, and it is a raced write.
- `OVERSIGHT_ROLES` and `CHURCH_LEVEL_ROLES` are declared ONCE, in the IMPORT-FREE leaf `auth/roles.ts`, because `@/lib/auth/access` opens with `@/db`. EVERY site imports that leaf DIRECTLY; `access.ts` MUST NOT RE-EXPORT them.

## Phase History — Declarations vs Transitions

Applies to `phase_transitions` and every reader of it.

- `phase_transitions` is TWO populations, told apart by the stored `kind` discriminator and never by the reason text: `transition` (a move made in EveryField) and `initial_declaration` (OB-005).
- A declaration is NOT an advance. Anything counting, gating on or announcing "reached a new stage" filters `kind = 'transition'` through one predicate, `phaseAdvanceCondition()`.
- `declareInitialPhase` emits NO `phase.changed`. `PhaseChangedEvent` carries no `kind`, so a subscriber that needs declarations means adding `kind` to the payload FIRST, never re-adding the emit.
- ⚖ A second declaration is REFUSED, never overwritten and never half-applied: the flow reports the STORED phase and confirms that the launch date on the same form did save.
- The launch date is never written to a column on `churches` — migration 0032 dropped it and the launch entity owns it (LS-001). Onboarding sets it through `scheduleLaunchAction`, so the lock, the journal and the seeds come for free.
- ⚖ "No date yet" writes nothing on a first pass and is REFUSED on re-entry over a stored date: there is no unschedule write path, so the step names the stored day and points at `/launch`.

## Phase Engine — Cited Facts & Attestation Citations

Applies to `src/lib/phase-engine/**` and the `/phase` surfaces rendering `plant_insights.cited_facts`.

Three lib modules are ONE concept each: `fact-phrases.ts` the phrase VOCABULARY, `attestation-citation.ts` the attestation TAXONOMY, `fact-format.ts` the MECHANISM.

- THE MANUAL-SIGNAL VOCABULARY IS ONE DECLARATION AND IT BINDS THE WRITER TOO: `MANUAL_SIGNALS` (import-free, because a `"use client"` island renders it) holds `key`, `label`, `description` and the citation `clause` per signal, and the clause map is BUILT from it; `satisfies` catches a MISSING clause, never DRIFTED wording.
- A manual attestation is citable TWO legal ways and BOTH are correct: the manual block is written twice, and which spelling the judge picks is a coin-flip.
- ⚖ ATTRIBUTION resolves the array spelling onto its signal, reading entry N's `signalKey` out of the assessment's OWN snapshot; `normalizeManualCitation` then rewrites the citation to `manual.byKey.<signal>` before matching. Never a bare `manual.` prefix rule — each attested gate measures ONE signal.
- An UNRESOLVABLE row (out-of-range index, non-numeric index, no `signalKey`) attributes to NOTHING and is never guessed onto a gate; the criterion then reads `not_addressed`.
- ⚖ WORDING is unified across all three surfaces from that same reading, and it is a READ-LAYER fix because a component holds no snapshot: resolved signals ride on `AssessedInsight.citedFactSignals`.
- ⚖ The folding path is a COUNTER and MUST NEVER BECOME A LISTER: one distinct attestation in a group reads the drill-down's own sentence, and two disagreeing collapse to a count.
- The fold is keyed on the RESOLVED SIGNAL, never on the rendered phrase — that is what makes it spelling-independent, so one attestation cited BOTH ways is one thing.
- That takes TWO keys: a group's IDENTITY is the leaf's own `groupKey`, signal-free and date-free, and its MEMBERS are the distinct resolved signals. Keying on the phrase gave every attestation its own group.
- ⚖ THE LEAF TAXONOMY IS ONE TABLE, `ATTESTATION_LEAVES` (`value` / `signalKey` / `attestedAt`), and every leaf answers all THREE questions from one row — `groupKey`, `counted`, `specific` — so a fourth leaf is one row that must supply all three. Two invariants below are structural:
  - `counted` returns `Phrase`, NEVER `Phrase | null` — a `null` reaches `fallbackPhrase` and its ledger-shaped label, and the return type forbids it.
  - `specificAtOne` is the ONE implementation of "drop the specifics above one row"; a leaf gets that rule by using the builder, never by re-deriving `rows === 1`.
- BOTH spellings hand the leaf the SAME `asserted`: a bare `manual.attestations.N.signalKey` carries no `=value`, so the resolved signal is substituted. Otherwise one spelling takes a different branch of the one shared template.
- The TWO legal spellings are declared ONCE in `attestation-citation.ts`, plus the module-private index-collapsed form, and every reader imports them. The pair once lived one letter apart in two modules.
- ONE dispatcher decides what a citation asserts — `citationRendering`, with the singular and plural formatters as thin wrappers over it.
- `normalizeManualCitation` rewrites for MATCHING only; the RAW citation is NEVER rewritten — the drill-down's `data-path` is what the judge wrote, and `buildEvidence` re-resolves that path verbatim against the snapshot.
- A CITED PATH IS UNTRUSTED INPUT — the judge writes it, so a segment may be `constructor`, `toString` or `__proto__` — binding every read of a judge-written key AND the write that assembles `manual.byKey`. Exactly three shapes are sanctioned: a `Map` read with `.get`, a `Record` read through `Object.hasOwn`, or a prototype-free `Object.create(null)` accumulator; never a bare `in` or `[key]`.
- Pin the WRITE half and all four reads, including the WALK itself rather than one caller's symptom, driving the cases off `Object.keys(ATTESTATION_LEAVES)`.

## Phase Engine — Assessment Status

- `plant_assessments.status` is FOUR values and `deferred` is NOT `failed` (#376): a `RateLimitDeferralError` is throttling and says nothing about the judge, so the row is `deferred` and the plant comes back next run; every other throw is `failed`.
- ⚖ …the deadline-truncated 5xx included (#389): it stays `failed` and only the WARNING softens. A ladder that spent its LAST attempt is deliberately NOT marked, so `console.error` still means a genuinely down provider.
- ONE decider, `assessmentStatusForFailure`, on the runner's own `isRateLimitDeferral`, so the row and the `/api/phase-engine/assess` summary cannot disagree.
- Every read names `complete` POSITIVELY — never `<> 'complete'`, which folds the two back together.
- The vocabulary is closed by `plant_assessments_status_check` (migration 0040): `.$type<>()` on a varchar is a compile-time brand, nothing more.
- The unjudged-run write COMPARE-AND-SETS `status = 'pending'`: `generateAssessment`'s closing emit runs after the row is `complete`, so a bare `where(id)` demotes a persisted assessment. An empty rowcount is the guard working, never an error.

## Onboarding — the flow's `?step=` URL

Applies to `src/lib/onboarding/steps.ts` and `/dashboard`. The flow has no route of its own — it renders AS `/dashboard` while `onboarding_completed_at` is null — so its step lives in the URL.

- A `?step=` value becomes an onboarding step in ONE place, `resolveOnboardingStepRequest`, with a client mirror and a finished-dashboard half honouring `leadership` alone. A REPEATED param is REFUSED: `.get()` takes the FIRST value and the wiki guide's provider the LAST.
- ⚖ Step 1 (`basics`) is addressable EXACTLY WHILE THERE IS NO CHURCH, and every later step exactly once there is; step 1 never enters browser history. When step 1 is closed the server answers `none`, NOT `refuse`.
- ⚖ The finish screen has NO `?step=` of its own: it is `/dashboard` with the param REMOVED, which is also how the contextual wiki guide is suppressed. Never invent a fifth step value.
- It does not PAINT until the param has left: `onboardingFinishScreen` answers `open` (the history write) and `showing` (the render), never one boolean.

## Wiki Articles

→ [wiki-articles](invariants/wiki-articles.md) — `src/lib/wiki/**`.

- Routing is slug-based, not id-based: progress and bookmarks link by `article_slug`.
- **Never interpolate a slug into a wiki path.** Build every one — `href`/`router.push`, OpenGraph `url`, the active-item test — with `wikiHref()`, which encodes per segment so `/` stays a separator.
- `revalidatePath()` is the one wiki path `wikiHref` must NOT build — use `wikiRevalidationPath()`. The tag comes from the DECODED pathname, so the href form matches no tag and still returns 200.
- MDX compiles at request time via `next-mdx-remote/rsc`; search is a weighted tsvector (title A > excerpt B > content C); revalidation needs `REVALIDATION_SECRET`.
- Every wiki article read is `church_id IS NULL OR church_id = :current_church_id` — global PLUS the reader's own, never "mine" alone. This predicate IS the boundary.
- A church's own PUBLISHED row for a slug OVERRIDES the global one, through ONE PREDICATE: `notOverriddenByChurch` (`get-articles.ts`), carried by EVERY reader-facing read — lists, the single-article read (`LIMIT 1`), search, and the PE-024 slug index. A JS collapse cannot answer for a RANKED read (the church's copy need not survive the `ts_rank` cut), so the SQL form is the only form; the subquery's `published` term must match the read's `status` filter, or a DRAFT church copy hides a global article.
- Every `churchId` parameter on the wiki reads defaults to `null`, so a call site that forgets to thread the session fails CLOSED — it under-fetches rather than leaking another church's content.
- `searchWikiArticles` REFUSES BY REJECTING: its catch logs and RETHROWS, never `return []`, so "No articles found" is never said about a search that never ran. Every caller routes through `runWikiSearch` (`search-request.ts`); the dialog holds the outcome as ONE union state and announces through ONE unconditional `role="status"` region beside (never inside) the cmdk listbox.
- A wiki write NEVER spreads a caller-supplied object into a SET — `progressUpsertQuery` builds its DO UPDATE SET field by field from `status` and `scrollPosition` only — and BOTH parameters of every write endpoint are zod-parsed below the session mint (`write-input.ts`). The slug schema is deliberately NARROWER than `encodeWikiSlug` can address; `write-paths.test.ts` runs hostile bodies and slugs through the real builders.
- A wiki endpoint with NO caller is DELETED, not kept — dead code doubles the tenancy surface. `service.ts` holds `wikiRevalidationPath` + `revalidateArticle` and NOTHING else; `service.test.ts` pins the PROPERTY (no `@/db` specifier, no `db.<verb>(`, exactly those two exports), and `write-paths.test.ts` fails on any export no non-test file names.
- A guard's own COMPLETENESS is DERIVED, never asserted in prose: `readerFacingReads()` is `deepEqual`'d against every `*Query` export of `get-articles.ts` + `search.ts`, a second test pins that `*Query` builders are DECLARED only there and in `write-queries.ts`, and BOTH declaration spellings are read (`export function` AND `export const`, via `valueExportStatements`).
- Cross-links live ONLY in `related_article_slugs`, never in an article's prose and never seeded. No test catches a violation.

## Document PDFs

Applies to every `@react-pdf/renderer` path: the F6 templates under `src/lib/documents/pdf/` and the wiki article download under `src/components/wiki/article-pdf/`.

- Every PDF face is a ROLE from `PDF_FONT` (`documents/pdf/fonts.ts`), never a standard-14 name (`Helvetica`, `Courier`, `Times-Roman`, Bold/Oblique included) and never a `fontWeight`/`fontStyle` axis: standard-14 faces write a WRONG GLYPH outside WinAnsi instead of failing, and `@react-pdf/font` filters on `fontStyle` first, so an axis on a single-source family throws. A standard-14 name resolves with no asset, so the corruption is silent; `pdf/fonts.test.ts` scans the directory and `article-pdf/render.test.ts` pins every emphasis combination.

## Communication — Resend & Delivery Figures

Applies to `src/lib/communication/**` and the `/communication` surfaces.

- ⚖ A resend to non-openers is offered ONLY when both hold: at least `RESEND_COOLDOWN_HOURS` (24) since `sent_at`, AND at least one recipient row confirmed delivered. The UI gate is never the only gate.
- A `sent` message with a null `sent_at` is `tooSoon`: the cooldown that cannot be proven elapsed has not elapsed.
- `UNREACHABLE_STATUSES` = `bounced` AND `failed`, and the non-opener scope excludes both: a `failed` row is an address the provider refused, and retrying spends sender reputation.
- ⚖ "Delivery rate" names exactly ONE figure, `delivered / attempted`, on the church-wide overview only. A single message's tiles report COUNTS with the denominator in the caption and claim no rate.
- A rate with a zero denominator is UNKNOWN (rendered `—`), never `0%`: "0% open rate" claims something about a send that never arrived.

## Rich Text — Stored HTML & the Sanitiser

→ [rich-text](invariants/rich-text.md) — `src/lib/rich-text/**` and every writer or reader of a rich-text body.

- The SERVER is the gate, never the editor — every compose/task action is a POSTable endpoint that never saw the toolbar — and there is ONE sanitiser, `sanitizeRichText`, allow-list only.
- ONE door converts a stored value for reading or editing, `toRichTextHtml`, and ONE read-only renderer draws it, `RichText`. A hand-rolled `dangerouslySetInnerHTML` is a second copy of both.
- `sanitizeUrl` runs BEFORE merge substitution, so a `{{token}}` may decide NEITHER the SCHEME nor the AUTHORITY of an href — in either spelling, `/` or `\`, since every URL parser folds the two.
- A body is MARKUP by the time a surface decorates it, so a decoration over it is TEXT-NODE-AWARE, never a string-wide `replace`, which lands the unresolved-token pill inside an `href`.

## Tasks, Subtasks & Recurrence

→ [tasks](invariants/tasks.md) — `src/lib/tasks/**`, `src/app/(dashboard)/tasks/**`.

- ⚖ Nesting is ONE level, enforced in both directions: a subtask may not take children, and a task with children may not be demoted into one.
- `tasks.parent_task_id` is a self-FK `ON DELETE CASCADE` (0038), so a parent id naming no task is UNREPRESENTABLE — before the key, a forged parent made work hidden by `topLevelTasksOnly()` and still counted by `getTaskCounts`. CASCADE, never `set null`; soft deletes are unaffected.
- ⚖ Completing every subtask does NOT complete the parent. There is deliberately no code that does it; the absence is the ruling, and the UI says so.
- ⚖ A subtask is a checklist item, not a task. Anything reporting a NUMBER of tasks applies `topLevelTasksOnly()`, so badges and list count one population.
- ⚖ A new subtask inherits its parent's assignee — a default, not a lock. An unowned checklist item reaches no "My tasks" view.
- ⚖ The checklist is part of a recurring task's TEMPLATE: completing one mints the successor with EVERY item copied across, unticked.
- Copied children get explicit `created_at` stamps one millisecond apart; a multi-row INSERT stamps every default identically and loses checklist order.
- ⚖ Exactly ONE instance of a recurring series is open at a time, minted on completion, never by a cron. The guard runs BEFORE the successor insert.
- `completionEvent` is never copied to a successor: it is backed by a partial unique index, so copying it aborts the second insert. Recurrence mints plain work; hooks stay with the generator.
- A completion is written FIRST and its successor second — the reverse of the durable-marker-last rule, because only that order's failure is repairable.
- A task description is rich text on the SAME editor and sanitiser as a message body (T-021), and `normalizeTaskDescription` is the one write gate all FOUR writers go through. Enumerate the writers.
- `description` means ONE thing on every row, the stored HTML; a LIST row carries the readable summary BESIDE it, as `descriptionPreview`.
- The checklist catalog has TWO entrances: `/tasks/templates` is the standing route, a static segment beside `/tasks/[id]`. Remove it and the URL resolves to a task with id `"templates"` and 500s.
- ⚖ A phase change PROMPTS, it never creates (T-020). The subscriber writes NOTHING; the absence is the ruling. Twenty unasked-for tasks is the surprise the feature avoids.
- The prompt is DERIVED, never stored: the latest `kind = 'transition'` row plus the code-defined catalog. An `initial_declaration` row prompts nothing.
- ⚖ The one stored thing is the ANSWER, a ROW in `phase_prompt_answers` unique on `transition_id`, which re-arms the prompt by itself — AND THE ROW IS ITS ONLY READER: `PHASE_TEMPLATE_PROMPT_COOKIE` is DELETED (#411), with `fastPathTransitionId` and the decline `status` that fed its mint. Nothing browser-held may answer a prompt again.
- ⚖ Accepting is IDEMPOTENT per transition, on any device: the claim is written with `ON CONFLICT DO NOTHING` BEFORE the first import, which runs only if the claim returned a row.
- The claim happens AFTER the requested keys are filtered against the live prompt, or a forged key list spends the planter's one answer.
- Accepting dates the checklist from the TRANSITION instant, never from the press, re-filtering the keys against a freshly derived prompt.
- A claim whose import wrote NOTHING is released, so the prompt returns; a claim whose import got part-way is KEPT, or the planter imports it twice.
- ⚖ The answer belongs to the PLANT, not to the planter: the key is the transition alone and `/tasks` has no role gate, so any church member who opens it first answers for everyone.
- Because that answer cannot be un-answered, "Not now" carries a STALENESS GUARD: no row is written unless the posted `transitionId` EQUALS the plant's current transition. It is a GUARD, never an AIM.
- ⚖ Import REFUSES an empty selection: the button disables while no checklist is ticked, says why beside itself, and "Not now" stays live as the only way out.
- That tick count has TWO WRITERS — the second is React 19 restoring `defaultChecked` after a settle, firing NO `change` — and ONE reader, so a `useEffect` keyed on BOTH outcomes re-reads it. The DOM-subscription case, not data sync.
- A part-way import RETURNS `partial`, it does not throw, and its receipt is SERVER markup driven by a flash cookie, never client state in the island. The decoder never throws — the cookie is the browser's to forge.
- The receipt CARRIES THE TRANSITION IT REPORTS ON and is drawn for no other: one beaten by a new prompt is never shown and so never spent, and a later clean answer would raise an alert with every clause false.
- The phase-template prompt announces through exactly ONE `role="alert"`, derived from the last button pressed.
- A `?status=` / `?priority=` / `?category=` on `/tasks` is PARSED, never cast — `parseTaskListSearchParams` (`tasks/list-params.ts`), through the same zod enums the write schemas use, DROPPING what it does not recognise: a filter is a view, so unknown means unfiltered — the cast let a shared-link typo meet the column CHECK.
- `parseEnumParam` takes `schema: z.ZodType<T>` and threads `safeParse`'s own `data` through — no `as`, and the callers INFER `T`; a hand-rolled structural stand-in discards the parsed type and lets a status/priority mixup compile.
- A task's `related_id` is a value the CLIENT chose, so every read through it carries the caller's church: `getLatestPersonNote(churchId, personId)` inner-joins `persons` — `person_activities` has no `church_id`, so the join IS the boundary.
- Relative due dates are measured against ONE instant passed down from `/tasks` in `APP_TIME_ZONE`: `now` is REQUIRED on `getDueDateInfo`, `groupTasksByDueDate` and `TaskCardViewProps` — no clock default — or a hydrated card computes a different "Due today" (React #418).

## Notifications — the shared F11 queue, from a consumer's side

- A still-live predicate (N-014) is ARMED FROM THE DISPATCHER'S OWN ENTRYPOINT — `registerNotificationConsumers()` (`notifications/register-consumers.ts`), at module scope in the dispatch route — never by a load-time side effect in the feature. `resolveLiveness` calls an unregistered type LIVE and the route imports no feature module, so the load-time form armed every runtime EXCEPT the one reading a predicate. A new consumer joins that function; `route.test.ts` asserts the types over the ROUTE's graph.
- ONE sync skeleton, `runNotificationSync` (`notifications/sync.ts`): cancel → plan → tally → swallow, plus `cancelEntityNotifications`; `clampNotificationTitle` (255 chars) lives once, in `enqueue.ts`. A feature owns only its facts, planner, differ, deps and predicate. Accepted residual: the older fan-outs (`oversight.ts`, `plant-association.ts`) never cancel and keep a tally loop each; `sync.test.ts` fails on a THIRD.
- The person↔user bridge has ONE spelling — `personIsUserInChurch` / `personHoldsLoginFilter` (`people/person-user.ts`). TENANCY, not formatting: a copy that drops `users.church_id` mails one plant's meeting to another plant's planter while every `.toSQL()` test still passes.
- Every join in a notification read carries the church IN THE JOIN CONDITION, left joins included: `meetingNotificationFactsQuery`'s `teamName` reaches an emailed subject, and a `WHERE` cannot hold it.
- `meeting_attendance` IS the reminder audience, re-read on every sync, so EVERY writer of it re-syncs: a DIRECTORY PROPERTY over `src/lib/meetings/`, not a call-site list, `recordAttendanceBatch` and `addTeamMembersToGuestList` exempt by name. `cancelByEntity` is entity-wide: re-enqueuing without somebody is the only way their reminders stop.
- Whether the cancel runs is ONE boolean the caller owns — `mustCancel`, never an optional `previous`: create `false`, an edit its own differ, ADD `false`, REMOVE and bulk reschedule `true`.
- ⚖ CADENCE IS PART OF THE PLANTER DIGEST'S DEDUPE KEY (N-013), never a remembered last-sent-at: every run in a period computes the same key, so 96 ticks a day still send one per recipient per period. The CHURCH is deliberately OUT of it.
- ⚖ A weekly digest lands SUNDAY 16:00 in the CHURCH's zone (N-013, ruled 2026-08-15, superseding Monday). The hour carries the rule: at the UTC period boundary a Sunday digest arrives Saturday evening in the Americas. Code still ships Monday-at-boundary until #448 lands — do not "restore" it.
- The dispatch tick's three steps share ONE allowance, `TICK_DEADLINE_MS`, each sweep handed the REMAINDER — never a budget of its own, which summed to 65s under a 60s `maxDuration` and got the run killed past both never-fail catches.
- EVERY module that inserts into `tasks` asks for its notifications, `import.ts` and `events.ts` included — a checklist and a meeting's follow-ups are the tasks a planter never typed and will forget. A directory property in `tasks/notifications.test.ts`.

## Meetings — Evaluation Comparison

- ⚖ `compareEvaluationToHistory` returning `null` is NEVER rendered as "this is your first evaluated meeting": `null` has two causes the card cannot tell apart.
- ⚖ That sentence names no window and carries no number. It lives in `EVALUATION_COMPARISON_EMPTY_COPY` (`meetings/copy.ts`) so a guard can pin it by import.
- ⚖ The POPULATED card reports what the average COVERS, never what the planter EVALUATED: "The average covers the {previousCount} earlier meetings in view." That count is the WINDOW's, not the church's history.
- ⚖ The meeting-detail follow-up card is titled "Evaluation task", never "Follow-up completion": its query admits only `related_type = 'meeting'`. Widening it in the QUERY stays forbidden — joining through attendance double-counts.
- NO `"use client"` MODULE REACHES a meetings DB module — `service.ts` or `response-queries.ts` (VM-014), each opening with `@/db` and holding QUERIES ONLY — directly or transitively; `client-boundary.test.ts` walks both. What a client component needs lives in one of SEVEN db-free siblings: `copy.ts`, `agenda.ts`, `meeting-type-filter.ts`, `evaluation-comparison.ts`, `labels.ts`, `evaluation-factors.ts`, `response-card.ts`.
- Accepted residual: that boundary is a TEST, not the compiler. `import "server-only"` is unresolvable under `pnpm test`, and `--conditions=react-server` breaks every email-rendering test. Retired by a `react-server` lane.
- ONE meeting-type filter table is rendered by BOTH `/meetings` and `/meetings/[id]/analytics`, and the module is named for what it HOLDS. The two DEFAULTS differ on purpose: `"all"` for browsing, `"vision_meeting"` for analytics.
- EVERY read of `?type=` goes through a parser in that module and NONE casts. `churchMeetings.type` is a pg ENUM, so a cast let `?type=all` raise `invalid input value for enum meeting_type`.
- …and that covers the CREATE FORM, a THIRD reader of `?type=`: a token claiming to be a meeting TYPE goes through `parseMeetingType(value: unknown)` in `labels.ts`, never a cast — `searchParams` hands back `string | string[] | undefined`.
- ONE MEETING DISPLAY VOCABULARY, `src/lib/meetings/labels.ts`: the type labels, both badge tints, the status labels, the create-form options AND the display title. It replaced seven hand-written tables plus four title derivations, already drifted in view.
- The SINGULAR labels and the PLURAL filter captions are two tables and neither copies the other — `MEETING_TYPE_LABELS` names ONE meeting, `MEETING_TYPE_FILTERS` captions a CHIP. Consolidating them puts a plural caption on a badge.
- `MEETING_TYPE_OPTIONS` is DERIVED from `MEETING_TYPE_LABELS`' own key order, never a parallel `{value,label}[]` — the Record makes a missing type a compile error; the array shape makes it nothing at all.
- `meetingDisplayTitle` is the title derivation for SEVEN ENUMERATED SURFACES (never "everywhere"), and the branch order IS the rule: a NUMBERED vision meeting outranks a stored title, a team meeting with a team falls back to `<Team> Meeting`, else `title || <type label>`. `labels.test.ts` walks the list and fails on a surface that stops calling it.
- CALLING the function is not SHARING the name: every field it branches on is REQUIRED and nullable (`MeetingTitleFacts`), never optional — an optional field lets a surface skip a SELECT and silently take a different branch; the projections test passes the real row shapes through it.
- A caller NEVER SYNTHESISES a meeting to name one: the route derives the title ONCE on the server and passes a `title: string` down.
- `meetingTypeLabel` and `parseMeetingType` are the module's only string-keyed accessors, and each reads its table through `Object.hasOwn`, never a bare index — `"constructor"` reached `Object.prototype`, which the `??` fallback never caught.
- `labels.test.ts` pins the PROPERTY: any second module mapping ALL THREE meeting types to strings, or a `{value,label}` row list, fails it; only `labels.ts` and `meeting-type-filter.ts` are exempt.
- ONE evaluation quality-factor list, `EVALUATION_QUALITY_FACTORS` (`evaluation-factors.ts`): the zod schema, both components, `FACTOR_COUNT` and the stored-average divisor are all BUILT from it, never restated.
- The meeting-detail progress bar names itself by `aria-labelledby` pointing at the visible progress line, a VALUE in `copy.ts`, which owns the one `task`/`tasks` grammar branch.

## People — Contacts, Import & Households

Applies to `src/lib/people/**` and the `/people` surfaces.

- `createPerson()` is the ONE writer of the `person_created` timeline activity. `activitySource` is a closed union with NO default, so a new creation path must name itself or it does not compile.
- `peopleTextSearch` is the ONE people text predicate — list, search and export all call it. Never a second copy under any name.
- The import preview carries REDACTED duplicate matches only — `{id, displayName}` — and the matcher loads no tags. Restoring the full record re-opens the PII round trip to the client.

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

## Migrations

- RESERVING AN `idx` DOES NOT RESERVE AN ORDER — `when` decides. `drizzle-kit migrate` applies a migration only while the ledger's MAXIMUM `created_at` is below its `when`, so a sibling holding a lower `when` on another branch is SILENTLY SKIPPED: exit 0, nothing applied. Such a migration owes its sibling a FORWARD reconcile in its header.
- ⚖ A RENUMBERED migration ships with an OPERATOR RECONCILE step or it does not ship: `drizzle-kit migrate` never asks whether THIS migration's row is present, so a database that applied the OLD number is invisible to it, the DDL re-runs and the apply aborts on `column ... already exists`. The header carries the detection and both exits.

## Dev Seeds

Why and how: [`contracts/db.md`](contracts/db.md) → The dev-seed wipe. Applies to `scripts/seed-dev-db.ts` and anything that inserts a `churches` row.

- `pnpm db:seed` deletes ALL users and ALL churches unscoped — the fixture is the whole database, not the rows the script created. Run it against your own or a throwaway database ONLY.
- The wipe REFUSES to run on a database holding an alpha-cohort sentinel account unless `--allow-protected-db` is passed. Detection is POSITIVE — sentinel rows, never "does this connection string look like development", which fails open.
- The wipe ORDER is derived at runtime from `pg_constraint` by `planWipe()`. Never re-introduce a hand-kept table list; the derivation is what makes a new table join the wipe.
- `wiki_articles` and `wiki_sections` are `PROTECTED_TABLES`: never deleted AND never walked through, so nothing downstream of them is dragged in either.
- A protected row pointing at a table the wipe deletes ABORTS the whole seed before its first DELETE. Re-point it by hand; never widen the wipe to cover it.
- Every script that inserts a `churches` row stamps `onboarding_completed_at` with `now()` in that same INSERT — an unstamped seeded church puts its planter in the wizard.
- EVERY seed mode asks the sentinel BEFORE it writes, and no in-repo constant is a working password on a protected database. `--oversight-orgs-only` deletes nothing but INSERTS a login, so it refuses without an override.
- A seed mode that ANNOUNCES a password must have SET it: `--oversight-orgs-only` upserts both oversight admins (`onConflictDoUpdate` on `users.email`), never `onConflictDoNothing`.
- ⚖ A credential removed from the repo needs a ROUTE, or the fixture it opens becomes unreachable: `SEED_ADMIN_PASSWORD` is recorded in `.env.local` — gitignored, machine-local, and read by a verifier BEFORE seeding rather than re-chosen.
- The mode's credential write is keyed on the ADDRESS (`OVERSIGHT_ADMIN_EMAILS`), never on the role, which is not unique by construction. The statement lives in that module, so a guard asserts the emitted SQL.
- The sentinel probe proves ONE thing: the three `PROTECTED_ACCOUNTS` addresses are absent. It does NOT prove every account is fixture, so widening the fixed oversight pair needs a ruling.
- The FULL seed gives those two admins `password123` like every other row, but no shared database is ever full-seeded — so wherever a credential is printed, name the MODE that set it.
- The seed owns exactly ONE `sending_networks` row and ONE `sending_churches` row, on PINNED uuids inserted with `onConflictDoNothing`, so a `sending_church_admin` has an org. They stay OUTSIDE the wipe.

## Request Deduplication

- `getCurrentSession()` is wrapped in `React.cache()`, so repeat calls in one request hit the cache, not the DB (`src/lib/auth/session.ts`).

## Date & Time Rendering

→ [dates-times](invariants/dates-times.md) — anything rendering or parsing a date.

- Never format a `Date` without a pinned `timeZone` — format through `src/lib/datetime.ts` (`APP_TIME_ZONE`, UTC). `Intl`/`toLocale*`/date-fns follow the runtime's zone, so SSR and hydrated markup differ (React #418).
- The CALENDAR-DAY primitives live in `datetime.ts` and nowhere else: `MS_PER_DAY`, `toCalendarDate(date)`, `addCalendarDays(from, days)` — every `date` column written by tasks, ministry-teams and launch goes through them, so the day a write NAMES is measured in the zone it is READ in. Not yet absolute: a 13-site debt list lives in [dates-times](invariants/dates-times.md) — route a call site whenever you touch its module; a NEW local day constant or a re-export is the mistake this line stops.
- A meeting's `datetime` is a wall clock, not a zoned instant: `meetingDatetimeSchema` with `parseDateTimeLocalValue()`/`toDateTimeLocalValue()`, never `z.coerce.date()`.
- There is no per-user or per-church timezone column. Adding one means changing `APP_TIME_ZONE` and back-filling, never runtime-local formatting.

## Client/Server Data Synchronization

Conventions and examples: [`contracts/data-patterns.md`](contracts/data-patterns.md).

- NEVER store server data in `useState` (it goes stale the moment the server revalidates) and NEVER sync data with `useEffect` — server data flows through props from server components.
- Use `useOptimistic` for instant feedback; the server action calls `refresh()` from `next/cache` to reconcile, not the client calling `router.refresh()`. Example: `ActivityTimelineClient`. Props-only is the other shape (`TagPicker`).
- Legitimate client state is UI state only: pagination cursors, drag-and-drop, open/closed (`PipelineView`).
- A message that a `router.refresh()` accompanies must NOT live inside the subtree that refresh re-renders — the refusal that fires the refresh unmounts its own `<Alert>` mid-read. Raise it through the root `<Toaster>`, a sibling nothing below can unmount, and never delay the refresh for it.

## Design Tokens — Contrast

→ [design-tokens](invariants/design-tokens.md) — the token layer and the guards.

Applies to `src/app/globals.css` and every stylesheet under `src/app/`; colour maths comes from `src/lib/testing/theme-color.ts`.

- Text contrast is a property of the TOKEN, not of a screen: `--muted-foreground` must clear WCAG AA 4.5:1 on ALL EIGHT surfaces it lands on, in both themes. Darken the token, NEVER a per-component override.
- ⚖ WCAG AA (4.5:1) is the standard that BINDS `--muted-foreground`; APCA is advisory and never a reason to lighten it — the token sits at APCA Lc 68.2 on `--muted` and ships anyway.
- The cost of darkening is INLINE-LINK SEPARATION: as `--muted-foreground` darkens it converges on `--primary`, so a link in muted prose drops under the 3:1 SC 1.4.1 asks.
- ⚖ That cost is paid in CSS, never by capping the token's lightness: `p a[href]` carries a permanent underline at REST. Never delete that rule and never put `no-underline` on a link inside prose.
- The underline rule is NOT paid once: it lives in `@layer base`, which any UNLAYERED declaration beats at ANY specificity. Every unlayered stylesheet under `src/app/` touching `text-decoration` on a bare `a` owes its own scoped underline rule.
- The diagnostic for that failure is an asymmetry in computed style: `text-underline-offset: 4px` present while `text-decoration-line` is `none`. Only the browser or the stylesheet guard sees it.
- Accepted residual: `--ring` is 2.4:1 on `--background` light and ~1.5:1 once `focus-visible:ring-ring/50` composites, so focus indicators fail SC 1.4.11; Lighthouse scores 100 anyway. Retired by the focus-indicator redesign.
- ⚖ `--destructive` is DESIGN.md's ruled `danger` #B4432F, NOT a red chosen to clear 4.5:1 — the app shares the palette. If danger has to move, it moves in DESIGN.md FIRST and `globals.css` follows.
- …and that pin READS DESIGN.md: both guards parse `ink` and `danger` out of its `colors:` block at test time and never declare the hexes as literals.
- `--ink` is the SOLE declaration of DESIGN.md's ink #181D19: every ink-coloured token says `var(--ink)`. The check is derived from the `:root` block, so pasting the literal onto a NEW token fails too.
- An `asChild` Button call site selects its colour with `variant`, NEVER by hand-painting `bg-*`/`text-*` in `className`: Radix's Slot CONCATENATES `buttonVariants()` with the child's, so tailwind-merge is out of that path and CSS source order picks the wrong fill.
- Any `*-foreground` utility in shipped markup owes a token declared in `:root`/`.dark` AND exported through `@theme inline`: an undeclared utility emits NO CSS. The converse is NOT a rule.
- A token-identity check compares COLOURS, channel-wise (`isSameColour`), never `contrastRatio`, which is relative luminance and throws hue and chroma away.
- `globals.css` states what a token IS and what it is FOR; it never names a MEASURED contrast ratio, only the standard's thresholds. Put each measured number in the guard that measures it.
- `--ef-field` is a STATE-carrying icon colour (the wiki bookmark is the only cue an article is saved), so it owes SC 1.4.11 3:1 on all eight surfaces in BOTH themes.
- `--ef-dark` is the ink that reads on GREEN and deliberately has no dark value, so `.dark` inherits the light one: paint it ONLY where `bg-ef` is under it, never as page or card text.
- Test-only support code lives in `src/lib/testing/`, NOT under `src/app/`, and the shipped-markup walk skips that DIRECTORY, never a path equality on one file.
- Accepted residual (DECISION): `bg-destructive/10 text-destructive` — twelve call sites — measures 4.07:1 light and 3.89:1 at `dark:bg-destructive/20`. NO token value fixes it; the remedy is a solid ground or a text-on-tint role token.
- ⚖ The person-status badges are the TINTED EDITORIAL scale: each status that carries colour paints ONE hue three ways in `people/status-colors.ts` — pale ground, deep ink, hairline border — mirrored in dark, so every entry spells six classes. `prospect` stays NEUTRAL; `attendee`/`launch_team` share ONE hue at different TINT LEVELS. All fourteen pairs must clear AA and there is NO deferral list.
