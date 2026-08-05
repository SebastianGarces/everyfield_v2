# API Contracts

## Route Handlers

| Route | Auth | Contract |
|-------|------|----------|
| `GET /api/health` | None | `{ status: "ok", timestamp }` |
| `GET /api/wiki/article?slug=` | Session (401) | WikiGuide article JSON `{ slug, title, description, readTime, type, content(raw MDX) }`; 400 no slug, 404 |
| `POST /api/wiki/revalidate` | `REVALIDATION_SECRET` in body | `{ slug, secret }` → `{ revalidated: true, slug, timestamp }` |
| `DELETE /api/wiki/revalidate` | secret in body | `{ secret }` → `{ revalidated: true, scope: "all", timestamp }` |
| `POST /api/phase-engine/assess` | `Authorization: Bearer <CRON_SECRET>` | Vercel Cron judge runner: dirty-or-stale plants, sequential, `MAX_BATCH=25`/run (rest roll over); returns `{selected,attempted,assessed,failed,skipped,outcomes[]}`; assessments run ONLY here or via manual trigger |
| `GET /api/notifications/dispatch` | `Authorization: Bearer <CRON_SECRET>` | F11 dispatcher (every 15 min). Claims due `pending` rows atomically (`MAX_DISPATCH_BATCH=100`), groups per (church, recipient, category) into ONE email + N feed rows, re-checks the still-live predicate, records a delivery per channel. At-most-once via the unique `(notification_id, channel)` index. Returns the run summary `{claimed,remainingPending,groups,emailsSent,delivered,cancelled,failed,retryScheduled,deferred,suppressed,released,durationMs}`. **Also carries the DAILY oversight digest** (N-025, ruled 2026-08-01): after the dispatch it runs `runDailyOversightDigestSweep` for the last complete day and reports `oversightDigest` (null if the sweep threw — the sweep can never fail the run). Once-a-day is DERIVED, not remembered: a plant is only offered while no digest row exists for it that day, so 96 ticks write one digest per oversight recipient. **"Owed" means WILL PRODUCE a digest, not merely "has not got one"** — the selection also requires sharing on, at least one oversight admin, and activity in the window (`hasActivityCondition`, built from the same four conditions the counts use), so the owed set shrinks monotonically through the day instead of being permanently occupied by plants that can never write a row. Within a tick the sweep KEYSET-pages past its batch (`MAX_DIGEST_SWEEP_BATCH=25` bounds a page, `MAX_DIGEST_SWEEP_PLANTS=500` and a 10s budget bound the tick), advancing the cursor even past a plant whose digest threw. Summary gains `plantsScanned` + `pages`, which is how a starved sweep is now distinguishable from a healthy one. Fails closed with no `CRON_SECRET` |
| `GET /api/notifications/unsubscribe?token=` | **None** — sealed token in the query string | F11 opt-out, RENDER half (N-007). **Never mutates** — synchronous handler, 303 to `/unsubscribe?token=`; HEAD is derived from it, so scanners/prefetches change nothing. Ruled 2026-08-01 |
| `POST /api/notifications/unsubscribe?token=` | **None** — sealed token; CSRF-exempt in `src/proxy.ts` | F11 opt-out, MUTATION half. RFC 8058 one-click (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`); body is read for the log, not as a gate. Disables `(token.user, token.category, email)` — reads no user/category/channel/direction from the request, all four come from the token, which is DISABLE-only. Always 200, refusal or not (a 4xx makes mail clients retry or drop the control) |
| `POST /api/rsvp/[token]` | None — token in path | Public RSVP: `{ response: "confirmed"\|"declined" }` → `{ success: true }`; 400 invalid; backed by `meeting_confirmation_tokens` |
| `POST /api/webhooks/resend` | Svix signature via `RESEND_WEBHOOK_SECRET` | Resend events advance `communication_recipients.status` (forward-only) AND settle `notification_deliveries` by `provider_message_id` — bounce/complaint/failure → `failed`, hard bounce + complaint prefixed `permanent: ` so `channelEligibility` never retries them; only `status IN (queued, sent)` is overwritable |

**Source files:** `src/app/api/<route>/route.ts`

---

## Server Actions

### Auth Actions

- `login(prevState, formData)` — `src/app/(auth)/login/actions.ts` — no auth, rate-limited
- `register(prevState, formData)` — `src/app/(auth)/register/actions.ts` — no auth, rate-limited + beta gate
- `devLoginAs(prevState, formData)` — `src/app/(auth)/login/dev-actions.ts` — LOCAL DEV ONLY (`isDevLoginEnabled()` gate)
- `logout()` — `src/lib/auth/actions.ts` — Session

`login`/`register` are `useActionState`-shaped: `(prevState, formData)` returning `{ error?, fieldErrors? }` or redirecting.

**Login:** Zod validate → `checkRateLimit(identifier, ip, "login")` BEFORE user lookup (generic "Too many attempts") → find user → `verifyPassword` → `recordAttempt` on every outcome → session → redirect to form's `redirect` field if a local path, else `/dashboard`.

**Register:** rate-limit → invitation token check (an `?invitation=` token binds the account to `invitee_email`; a mismatch is refused before anything else — ruled 2026-08-04) → beta gate: when `BETA_INVITE_CODE` is set, requires valid invite code unless the org-invitation bypass applies (itself conditioned on the same address match) → entity per `accountType`: `planter` → NO church at signup (`church_id: null`; created later via onboarding step 1, `createChurchBasics`, which also adds default `churchPrivacySettings`); `sending_church` → new SendingChurch; `network` → new SendingNetwork.

---

### Feature Server Actions

All files under `src/app/(dashboard)/`. Default auth unless noted: `verifySession()` + scope to the session user's `church_id`. Names omit the trailing `Action` suffix (`createPerson` = `createPersonAction`).

- **`people/actions.ts`** (~40): createPerson, updatePerson, deletePerson, changeStatus, changeStatusWithReason, addNote, deleteNote, getMoreActivities, tags (list/create/update/assign/remove/delete), createAssessment, createInterview, createCommitment, getCommitmentDownloadUrl, households (list/create/createFromPerson/update/delete/addTo/removeFrom, propagateAddress, getMembers), skills (add/update/remove/getPersonSkills), checkForDuplicates, quickAddPerson, downloadCsvTemplate, exportPeople, previewImport, executeBulkImport, reorderPipeline
- **`meetings/actions.ts`** (24): createMeeting, updateMeeting, deleteMeeting, updateMeetingStatus, createLocation, updateLocation, addAttendee, quickAddAttendee, removeAttendee, finalizeAttendance, recordAttendanceBatch, createInvitation, updateInvitationStatus, createEvaluation, toggleChecklistItem, updateChecklistItem, addToGuestList, removeFromGuestList, updateRsvpStatus, quickAddPersonToGuestList, toggleAttendanceStatus, addWalkInAttendee, quickAddWalkIn, addAttendeeNote
- **`tasks/actions.ts`** (9): createTask, quickAddTask, updateTask, completeTask, reopenTask, deleteTask, updateTaskStatus, bulkCompleteTasks, bulkRescheduleTasks — the two bulk actions take `taskIds: string[]` (max 100) and return `BulkTaskResult` `{requested, succeeded[], failed[{taskId,title,reason}], eventsEmitted}`; partial failure is reported, never swallowed
- **`teams/actions.ts`** (25): listTeams, getTeam, createTeam, updateTeam, assignTeamLeader, initializeTeams, roles (list/create/update/delete, importRoleTemplates), assignMember, removeMember, getPersonTeams, getPersonTeamCount, listMeetings, createMeeting, recordAttendance, listTrainingPrograms, createTrainingProgram, markTrainingComplete, getStaffingSummary, getTeamHealth, getAllTeamsHealth
- **`communication/actions.ts`** (9): sendMessage, resolveGroup, searchPeople, getTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, forkTemplate
- **`phase/actions.ts`**: transitionPhase (also `requireRole("planter")`), getPhaseReadiness — Session + `requireChurchAccess`
- **`phase/feedback-actions.ts`**: submitInsightFeedback — Session + `requireChurchAccess`
- **`phase/signals-actions.ts`**: setManualSignal — Session + `requireChurchAccess`
- **`feedback/actions.ts`**: submitFeedback (emails `FEEDBACK_EMAIL_TO`)
- **`admin/feedback/actions.ts`**: updateFeedbackStatus — `requirePlatformAdmin` (ADMIN_EMAILS)
- **`dashboard/actions.ts`**: `createChurchBasics` (onboarding step 1 — creates the church + `churchPrivacySettings`, does NOT redirect), `confirmLeadership(answer)` (onboarding step 2 / OB-004 — records `churches.leadership_status` from "yes"/"no"; re-enterable by design, no already-answered guard, and it does NOT re-run the step-1 church-link write), `completeOnboarding` (stamps `churches.onboarding_completed_at`, redirects to `/dashboard?churchCreated=true`) — both `verifySession` + planter-only
- **`wiki/actions.ts`**: `searchWikiArticles(query)`

Server-side `"use server"` services under `src/lib/phase-engine/`: `feedback/service.ts` (`upsertInsightFeedback`, `getInsightFeedbackForUser`), `signals/attestation-service.ts` (`upsertManualSignal`, `listManualSignals`, `getManualSignal`), `transitions/service.ts` (`transitionPhase`, `getPhaseReadiness`, helpers).

---

### Wiki Data Layer (all Session)

- `src/lib/wiki/progress.ts`: `updateProgress(slug, data)`, `markCompleted`, `recordView`, `getArticleProgress`, `getArticlesProgress`, `getRecentlyViewed`, `getProgressStats`, `getLastInProgress`
- `src/lib/wiki/bookmarks.ts`: `toggleBookmark`, `addBookmark`, `removeBookmark`, `isBookmarked`, `getBookmarkedSlugs`, `getBookmarks`

---

### Invitation Actions + Logic Layer

Split by #265 — it used to be one `"use server"` module with 11 exports, i.e. 11 POSTable endpoints, one of which took the acting user as an argument.

**`src/lib/invitations/service.ts`** — `"use server"`, exactly 4 exports, all Session, none takes an actor: `createInvitation(request)` · `acceptInvitation(id)` · `declineInvitation(id)` · `revokeInvitation(id)`. Each mints its actor with `invitationActorFromSession(await verifySession())` and returns `{ success: true, invitation } | { success: false, error }`, where `invitation` is an **`InvitationView`, not the row** — `inviterUserId` and `respondedBy` are dropped in `core.ts:invitationView()`, so a surface never receives another user's uuid. `createInvitation` derives the inviting org AND the invitation `type` from the actor's role — and since #23 a client names only an EMAIL, never a target id (a plant picker would list every plant in the product to every org; `resolveInvitationTarget` resolves the address against `users` server-side, after the ROLE is settled, so a non-inviter cannot use the refusal messages as an account-enumeration oracle). It also **refuses up front when the target's oversight slot is held** (ruled 2026-08-03, #23): `SLOT_TAKEN_MESSAGE` / `ALREADY_OURS_MESSAGE`, checked in `createInvitationAs` before the insert, so a forged direct call is refused too. That is a SELECT-then-INSERT check and therefore NOT a concurrency guard — `unboundTargetSlot` + `lockTargetRow` at accept time still are; its job is to tell the admin now instead of the invitee later. And since **2026-08-04** it refuses any address that ALREADY has an account (`ACCOUNT_EXISTS_MESSAGE`) — there is nowhere for such a person to answer until #277 — so every invitation created today is an OPEN one. Authority: create = `sending_church_admin` (own sending church) / `network_admin` (own network); accept + decline = the target plant's **planter**, or the target sending church's admin; revoke = **any admin of the inviting ORG** (ruled 2026-08-04, enforced in the UPDATE by the same `invitingOrgOf(actor)` predicate the org-scoped list is read with — `inviter_user_id` is no longer part of it).

**`src/lib/invitations/core.ts`** — NOT `"use server"`, so unreachable from a browser. Actor-explicit mutations (`createInvitationAs`, `acceptInvitationAs`, `declineInvitationAs`, `revokeInvitationAs`), the pure authority rules (`resolveInvitationRequest`, `verifyInvitationAuthority`), the reads (`getInvitation`, `getPendingInvitationsForChurch`, `getPendingInvitationsForSendingChurch`, `getInvitationsSentByUser`, `getInvitationsForOrg(actor)` — callers do their own access check; `getInvitation` is deliberately session-free for the register beta gate), the registration redemption write `bindOpenInvitationTarget` (compare-and-set: pending + BOTH targets null + unexpired; leaves `status` alone, so an invite link is single-use and a crash leaves pending+unbound rather than accepted+unbound), and the disassociation primitives (`disassociateChurchFromSendingChurch` / `...FromNetwork` / `disassociateSendingChurchFromNetwork`) which have **no action wrapper here** — kept importable on purpose: #274 ruled both sides may sever, and the authenticated wrappers ship with their surfaces (#277 planter, #278 org admin), each with an `association_events` audit write. `InvitationActor` is branded and mintable only from a session.

Shape pinned by `src/lib/invitations/service.test.ts`: the export surface is read off the IMPORTED module (`Object.keys`), so `export default`, `export {…} from` and arrow-const exports are all caught; every action is called with no session and must reject; no actor parameter; `core.ts` has no directive; no client component can reach it. Two closure walks over the real module graph guard `core.ts` from the action side, and the difference between them matters:

- **Re-export: banned outright.** No `"use server"` module may republish anything from `core.ts` through any chain of re-exports, barrels included.
- **Import: allowlisted, not banned.** A `"use server"` module may only REACH `core.ts` through its value imports (transitively, stopping at `"use server"` boundaries) if it is named in the test's `CORE_REACHING_ACTION_MODULES` list with a reason. Today that is exactly two: `src/lib/invitations/service.ts` and `src/app/(auth)/register/actions.ts` (the beta bypass via `register/beta-gate.ts`, plus #23's redemption — `bindOpenInvitationTarget` then `acceptInvitationAs`). Note what is NOT on it: `(dash)/oversight/invitations/actions.ts` imports only `service.ts`, so the walk stops at that `"use server"` boundary and the new surface needed no entry. The list is asserted **exhaustive in both directions** — an unlisted module that reaches core fails, and a listed one that no longer does fails too — so #277/#278 have to add their own line, reviewed, rather than routing an import through a barrel. Earlier versions tested the literal specifier `invitations/core` plus one resolved hop, and a barrel plus a one-line wrapper shipped a live unauthenticated detach endpoint past a green suite and `tsc` exit 0.

Responding, in order: fetch → **authority** → status/expiry. Authority comes first because these messages reach the client verbatim and invitation ids double as unauthenticated beta-gate tokens; a caller with no authority over the target gets only `NOT_AUTHORIZED_MESSAGE`, for a missing row and for every settled status alike, and cannot trigger the auto-expire write. Accept locks the target row, claims, then binds — three statements in one `db.batch`, in that order (see `memory/invariants.md` → Atomicity), and **an accept never replaces an association**: both writes require the target's slot to be free or already hold that same org, so a second accept from a different org matches no row, writes nothing, and is refused with `ALREADY_ASSOCIATED_MESSAGE`. The slot rule is a subquery, so the `SELECT … FOR UPDATE` in front of it is what makes it hold against a CONCURRENT accept and not only a sequential one; success and the milestone are gated on the association's own rowcount. `createInvitation` takes no expiry — `INVITATION_EXPIRY_DAYS` is server-fixed (ruled 2026-08-03) (severing is #277/#278's audited job — `memory/invariants.md` → Multi-Tenancy). Unknown `type` fails closed in `verifyInvitationAuthority`, `associationStatement` and `unboundTargetSlot` (the column is a `varchar(40)` with a TS-only cast; a pg enum/CHECK would be a separate migration).

---

### Access Control Functions

All in `src/lib/auth/access.ts`:

- `getAccessibleChurchIds(user)` — resolve all church IDs user can access
- `requireChurchAccess(user, churchId)` — throws if user cannot access church
- `requireRole(user, ...roles)` — throws if user lacks required role
- `canAccessFeatureData(user, churchId, feature)` — check privacy toggle for oversight

---

**Validation:** all form inputs validated with Zod schemas — `src/lib/validations/`
