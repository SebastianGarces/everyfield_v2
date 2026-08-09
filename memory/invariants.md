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
- A church and its `church_privacy_settings` row are created by ONE batch; the loser's orphan church is swept afterwards under a `NOT EXISTS` guard.
- Both answers to an empty planter seat — the No as well as the Yes — open with `SELECT … FROM churches … FOR UPDATE` and are gated on their own rowcount.
- `finalizeAttendance()` emits downstream first, then compare-and-sets `actual_attendance` (non-null = finalized = its idempotency key); `meeting.attendance.finalized` is emitted STRICTLY.
- Accepted residual: `meeting.attendance.recorded` is non-strict — a failed prospect → attendee advance is swallowed rather than blocking finalization.

## Multi-Tenancy

→ [multi-tenancy](invariants/multi-tenancy.md) — invitations, associations, onboarding.

- All feature data carries `church_id`; `church_id = null` means global content (e.g. wiki articles).
- Tenant isolation is enforced in the application layer — there is no RLS behind you.
- Hierarchy is SendingNetwork → SendingChurch → Church, every hierarchy FK nullable, and a plant's two oversight FKs are INDEPENDENT — neither implies the other.
- An accept never replaces an existing association: both statements of the accept batch carry `fk IS NULL OR fk = <this org>`, and the guard sits on the CLAIM so a refusal writes nothing at all.
- An invitation may name no target — that is the register path. Only `bindOpenInvitationTarget` (CAS on pending + both targets null + unexpired) gives it one, which is what makes a link single-use; registration binds BEFORE accepting, never after.
- An address that already has an account cannot be invited (`ACCOUNT_EXISTS_MESSAGE`) — one message for every role, so nothing leaks about the account behind it.
- An invite token is bound to the invited ADDRESS, not the link holder: the registering email must equal `invitee_email` (trim+lowercase) for both the association and the beta bypass. Fix a wrong address by revoking, never by re-aiming a live invitation.
- "Is the slot free" is asked twice and the two are not interchangeable: at create for a legible refusal, at accept as the real guard.
- An invitation belongs to the inviting ORG, not the admin who typed it — list and revoke share ONE predicate, `invitingOrgOf(actor)`.
- There is still no in-product way to SEVER an association; the `disassociate*` primitives stay out of every `"use server"` module until #277/#278 ship them with type-to-confirm, a notification to the other side and an `association_events` row.
- That missing sever is a privacy fact: the oversight portfolio listing is deliberately ungated, so a plant that accepts once cannot withdraw the exposure and no `share_*` toggle would close it.

## Hierarchical Access Control

→ [hierarchical-access](invariants/hierarchical-access.md) — every oversight surface.

- A coach reaches churches via `coach_assignments`, a sending church admin via matching `sending_church_id`, a network admin via matching `sending_network_id` — always through `getAccessibleChurchIds(user)`.
- Oversight users see AGGREGATE metrics only — never individual person records.
- Call `canAccessFeatureData(user, churchId, feature)` before returning feature data; the six `share_*` toggles default false and gate what oversight may PULL.
- PUSH is far narrower: an oversight recipient gets ONLY the daily digest and three milestone events; `enqueue` refuses every granular category for them unconditionally, gated by `share_activity_with_oversight` read at enqueue time.
- That toggle gates PUSH only and the consent copy may not claim more — `getOversightPlantHealth()` returns name, phase, launch countdown and health with NO privacy gate.
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
