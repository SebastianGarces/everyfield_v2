# Entrypoints

> Path shorthand: `(dash)/` = `src/app/(dashboard)/`

## Marketing (public)

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Landing page | `src/app/(marketing)/page.tsx` | Route `/` (authed users → `/dashboard` via `src/proxy.ts`) |
| Invite request | `src/app/(marketing)/actions.ts:requestInviteAction()` | Landing CTA form → email to `ADMIN_EMAILS` |
| SEO shell | `src/app/{robots,sitemap,manifest}.ts` + `src/app/icon.svg` | `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest` |

**Primary modules:** `src/app/(marketing)/` (layout, page, `marketing.css` scoped under `.marketing`, `_components/`), `public/marketing/` (optimized WebP art)

**Design authority:** `DESIGN.md` at repo root (sharp system, ruled 2026-07-30); footer links `/terms` + `/privacy` are delivered by #189.

---

## Authentication

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Login | `src/app/(auth)/login/actions.ts:login()` | Form submit |
| Register | `src/app/(auth)/register/actions.ts:register()` | Form submit |
| Session validation | `src/lib/auth/session.ts:getCurrentSession()` | Every authenticated request |
| Logout | `src/lib/auth/actions.ts:logout()` | User action |

**Primary modules:** `src/lib/auth/`, `src/db/schema/session.ts`, `src/db/schema/user.ts`

**Key deps:** `sessions` table, `users` table, `session` cookie

---

## Wiki

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Article view | `(dash)/wiki/[...slug]/page.tsx` | Route `/wiki/*` |
| Article retrieval | `src/lib/wiki/get-article.ts:getArticle()` | Page render |
| Search | `(dash)/wiki/actions.ts:searchWikiArticles()` | Search input |
| Progress update | `src/lib/wiki/progress.ts:updateProgress()` | Article scroll/view |
| Bookmark toggle | `src/lib/wiki/bookmarks.ts:toggleBookmark()` | User action |
| Cache revalidation | `src/app/api/wiki/revalidate/route.ts` | POST with secret |

**Primary modules:** `src/lib/wiki/`, `src/components/wiki/`, `src/db/schema/wiki.ts`

**Key deps:** `wiki_articles`, `wiki_sections`, `wiki_progress`, `wiki_bookmarks` tables

---

## Dashboard

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Layout auth guard | `(dash)/layout.tsx` | Any `/dashboard/*` route |
| Dashboard page | `(dash)/dashboard/page.tsx` | Route `/dashboard` |
| Onboarding flow (F12) | `(dash)/dashboard/page.tsx` → `components/onboarding/onboarding-flow.tsx` | Route `/dashboard` when `shouldShowOnboarding()` |
| Onboarding step 1 (create church) | `(dash)/dashboard/actions.ts:createChurchBasics()` | Step 1 form submit |
| Onboarding step 2 (leadership) | `(dash)/dashboard/actions.ts:confirmLeadership()` | Step 2 form submit |
| Leadership re-entry | `(dash)/dashboard/page.tsx` → `components/onboarding/leadership-reentry.tsx` | `/dashboard?step=leadership` (from the no-planter nudge) |
| Leave onboarding | `(dash)/dashboard/actions.ts:completeOnboarding()` | Finish / skip-the-rest |

**Primary modules:** `(dash)/`, `src/components/`, `src/components/onboarding/`, `src/lib/onboarding/steps.ts`, `src/lib/validations/onboarding.ts`

**Key deps:** `getCurrentSession()`, `getCurrentUserChurch()`, sidebar state cookie

**Leadership (F12 / OB-004, #202):** step 2 asks "will you be the lead planter/pastor?", default **Yes** (ruling #157 — assume, but ask). The answer lands in `churches.leadership_status`: `planter_confirmed` | `no_planter` | **null = never asked**, and null is NOT no-planter (that three-state rule, plus the copy for what No limits, lives in `src/lib/onboarding/leadership.ts` and nowhere else). The planter ASSIGNMENT is unchanged — `users.church_id` + role, written at step 1 through `linkUserToChurchFilter()` (#183 compare-and-set); step 2 records the answer and never re-links. `churchHasNoPlanter()` has two consumers: the dashboard's `NoPlanterNudge` (persistent, dismissed per SESSION via `sessionStorage` + `useSyncExternalStore`) and `src/lib/tasks/events.ts`, where an explicit No takes the pre-existing sanctioned no-planter path — warn and return, so the meeting still finalizes with no follow-up tasks (FRD AC 4). `/dashboard?step=leadership` re-enters that ONE question as a standalone card (`LeadershipReentry`), which is the single specced exception to onboarding's one-way exit (ruling 2026-07-31).

**Onboarding (F12 / OB-001, OB-002):** the flow — not a create-church card — is the primary dashboard content whenever `shouldShowOnboarding()` says so: a planter with no church, OR a planter whose church exists but whose `churches.onboarding_completed_at` is still null. The church is created at **step 1**, so abandonment leaves a valid named church and the planter resumes rather than losing it; steps 2-4 are updates (shells until #202-#210). `resolveResumeStep()` is the single place that decides where a returning planter lands. `completeOnboarding()` stamps `onboarding_completed_at` (idempotent `IS NULL` guard) and redirects to `/dashboard?churchCreated=true`; it means "done answering", not "answered everything" — which facts are missing stays derivable from the columns.

---

## People / CRM

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| People list | `(dash)/people/page.tsx` | Route `/people` |
| Person detail | `(dash)/people/[id]/page.tsx` | Route `/people/[id]` |
| Activity tab | `(dash)/people/[id]/activity/page.tsx` | Route `/people/[id]/activity` |
| Teams & Training tab | `(dash)/people/[id]/teams/page.tsx` → `ministry-teams/service.ts:getPersonTeams()` + `getPersonTraining()` | Route `/people/[id]/teams` |
| Create person | `(dash)/people/actions.ts:createPersonAction()` | Form submit |
| Update person | `(dash)/people/actions.ts:updatePersonAction()` | Form submit |
| Delete person | `(dash)/people/actions.ts:deletePersonAction()` | User action |
| Change status | `(dash)/people/actions.ts:changeStatusAction()` | Drag-drop / Modal |
| Change status w/reason | `(dash)/people/actions.ts:changeStatusWithReasonAction()` | Modal submit |
| Add note | `(dash)/people/actions.ts:addNoteAction()` | Form submit |
| Tag management | `(dash)/people/actions.ts:*TagAction()` | User action |

**Primary modules:** `src/lib/people/`, `src/components/people/`, `src/db/schema/people.ts`

**Key deps:** `persons`, `households`, `tags`, `person_tags`, `assessments`, `interviews`, `commitments`, `skills_inventory`, `person_activities` tables

**Status flow:** See `memory/flows/person-status.mmd`

---

## Invitations / Associations

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Create invitation | `src/lib/invitations/service.ts:createInvitation()` | Oversight admin action |
| Accept invitation | `src/lib/invitations/service.ts:acceptInvitation()` | Target user action |
| Decline invitation | `src/lib/invitations/service.ts:declineInvitation()` | Target user action |
| Revoke invitation | `src/lib/invitations/service.ts:revokeInvitation()` | Inviter action |
| Disassociate | `src/lib/invitations/service.ts:disassociate*()` | User action |

**Primary modules:** `src/lib/invitations/`, `src/db/schema/organization-invitation.ts`

**Key deps:** `organization_invitations`, `churches`, `sending_churches` tables

---

## Access Control

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Resolve accessible churches | `src/lib/auth/access.ts:getAccessibleChurchIds()` | Any cross-church query |
| Check church access | `src/lib/auth/access.ts:requireChurchAccess()` | Before data access |
| Check feature privacy | `src/lib/auth/access.ts:canAccessFeatureData()` | Before returning data to oversight |
| Role guard | `src/lib/auth/access.ts:requireRole()` | Server actions |

**Primary modules:** `src/lib/auth/access.ts`, `src/db/schema/coach-assignment.ts`, `src/db/schema/church-privacy-settings.ts`

---

## Meetings

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Meeting list / schedule | `(dash)/meetings/page.tsx`, `new/page.tsx` | Routes `/meetings`, `/meetings/new` |
| Meeting detail + tabs | `(dash)/meetings/[id]/page.tsx` + `{attendance,analytics,evaluation,logistics,invitations}/page.tsx` | Route `/meetings/[id]/*` |
| Meeting CRUD | `(dash)/meetings/actions.ts:createMeetingAction()` / `updateMeetingAction()` / `deleteMeetingAction()` / `updateMeetingStatusAction()` | Form submit / status button |
| Locations | `(dash)/meetings/actions.ts:createLocationAction()` / `updateLocationAction()` | Form submit |
| Attendees | `(dash)/meetings/actions.ts:addAttendeeAction()` / `quickAddAttendeeAction()` / `removeAttendeeAction()` | User action |
| Attendance | `(dash)/meetings/actions.ts:recordAttendanceBatchAction()` / `toggleAttendanceStatusAction()` / `finalizeAttendanceAction()` | Attendance UI |
| Walk-ins | `(dash)/meetings/actions.ts:addWalkInAttendeeAction()` / `quickAddWalkInAction()` / `addAttendeeNoteAction()` | Attendance UI |
| Guest list / RSVP | `(dash)/meetings/actions.ts:*GuestListAction()` / `updateRsvpStatusAction()` | User action |
| Invitations | `(dash)/meetings/actions.ts:createInvitationAction()` / `updateInvitationStatusAction()` | Form submit / dropdown |
| Evaluation | `(dash)/meetings/actions.ts:createEvaluationAction()` | Form submit |
| Checklist | `(dash)/meetings/actions.ts:toggleChecklistItemAction()` / `updateChecklistItemAction()` | Checkbox / form |

**Primary modules:** `src/lib/meetings/`, `src/components/meetings/`, `src/db/schema/meetings.ts`

**Key deps:** `locations`, `church_meetings`, `meeting_attendance`, `invitations`, `meeting_evaluations`, `meeting_checklist_items` tables

**Events:** `meeting.attendance.recorded` → prospect → attendee auto-advance (vision meetings only), `meeting.attendance.finalized` → follow-up/evaluation task creation + Phase Engine dirty-marking, `meeting.evaluation.completed` → auto-completes evaluation task. Handlers registered in `src/lib/events/subscriptions.ts`.

**Finalize contract:** `finalizeAttendance()` returns `{ outcome: finalized | already_finalized | reconciled, total, attendeeIds }` and throws `FinalizeAttendanceError` if follow-up generation failed (meeting left un-finalized, safe to retry). Atomicity rules: `memory/invariants.md` → Transactions / Atomicity.

---

## Communication

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Pages | `(dash)/communication/{page,compose/page,history/page,[id]/page,templates/page}.tsx` | Routes `/communication/*` |
| Send message | `(dash)/communication/actions.ts:sendMessageAction()` | Form submit |
| Template CRUD | `(dash)/communication/actions.ts:*TemplateAction()` | User action |
| Recipient resolution | `(dash)/communication/actions.ts:resolveGroupAction()` / `searchPeopleAction()` | Compose UI |

**Primary modules:** `src/lib/communication/`, `src/lib/email/`, `src/components/communication/`, `src/db/schema/communication.ts`

**Key deps:** `message_templates`, `communications`, `communication_recipients`, `meeting_confirmation_tokens` tables; Resend delivery webhook (`/api/webhooks/resend`)

---

## Notifications

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| In-app feed | `(dash)/notifications/page.tsx` → `feed.ts:loadNotificationFeedScreen()` | Route `/notifications` (`?filter=unread` for the unread tab) |
| Load more | `(dash)/notifications/actions.ts:loadMoreNotificationsAction()` → `feed.ts:loadOlderNotifications()` | "Load more" in the feed |
| Unread badge | `(dash)/layout.tsx` → `(dash)/notification-badge.ts:loadUnreadBadgeCountSafely()` → `feed.ts:loadUnreadBadgeCount()` → `components/notifications/notification-bell.tsx` | Every dashboard route |
| Mark one read | `(dash)/notifications/actions.ts:markNotificationReadAction()` | Row click / "Mark read" |
| Mark all read | `(dash)/notifications/actions.ts:markAllNotificationsReadAction()` | Toolbar action |
| Enqueue (no UI) | `src/lib/notifications/enqueue.ts:enqueue()` / `cancelByEntity()` | Feature callers |
| Preferences screen | `(dash)/settings/page.tsx` → `preferences.ts:buildPreferenceMatrixView()` | Route `/settings` (linked from the user menu) |
| Save a toggle | `(dash)/settings/actions.ts:setNotificationPreferenceAction()` | Switch in the matrix |
| Save a digest cadence | `(dash)/settings/actions.ts:setDigestCadenceAction()` | Cadence select in the `digest` row |

**Primary modules:** `src/lib/notifications/` (feed, feed-view, queries, mark-read, entity-links, enqueue, preferences, categories), `src/components/notifications/`, `src/db/schema/notifications.ts`

**Key deps:** `notifications`, `notification_preferences`, `notification_deliveries` tables

**Read state:** `notifications.read_at` only — never a delivery row. Both mark-read writes are built from `scopedWhere` + `feedVisibility` (`queries.ts`), so a write is never looser than the read that surfaced the row and cannot mark a cancelled or not-yet-due row read. Actions call `refresh()` (not `revalidatePath`) because the badge lives in the layout, not on the page.

**Feed links:** `entity-links.ts:notificationEntityHref()` — an exhaustive `Record` over `notificationEntityTypes`; `null` where this app has no screen (`training`, `document`, `facility`, `financial_entry`), so a row renders as plain text rather than a dead link.

**One composition module:** every user-facing read AND both mark-read writes go through `feed.ts` (`notificationViewer(session)` → `{scope, owner}`). `queries.ts`/`mark-read.ts` take the preference allow-list as an OPTION (the dispatcher must not consult a UI preference), and `feed.ts` is what guarantees the page, the badge, the cold-start probe and the writes all get the same one, resolved once per request.

**Paging (N-008):** keyset, `(created_at, id)` — `listNotificationPage()` reads `limit + 1` and returns `{rows, nextCursor}`, so "is there another page" is known before the click. Page 1 is a prop; later pages are client state appended by id (a cursor is legitimate client state per data-patterns.md). The tab remounts the feed, so All and Unread never share a cursor.

**Preferences at read time (N-005, ruled 2026-07-27):** a category disabled for `in_app` leaves the feed, the badge and the probe — `resolveInAppCategories()` (`preferences.ts`) is the allow-list, absence = coded default (so `digest` is out by default). Mark-all is bounded by the same list, so a hidden category keeps its unread state. Delivery rows are never touched by any of it.

**Preferences screen (N-006, Screen 2):** `/settings` renders the matrix from the CODE registry — rows from `notificationCategories`, columns from `notificationChannels` — so a seventh category needs only its entry + copy in `categories.ts`. The server builds the whole view model (`buildPreferenceMatrixView`) and the client component imports types only; state is `useOptimistic` + `refresh()` (the bell is in the layout, and an `in_app` change moves it). **Both writes are no-op-guarded** (`preferenceWriteIsNoop` / `digestCadenceWriteIsNoop`): a save that restates the effective value writes NOTHING, so absence — and with it the coded default, and N-019's future re-default — survives a visit to the screen. Ownership is the `PreferenceOwner` brand and nothing else: no action, page or query on this screen names a user.

**Digest cadence (N-013 only):** one CATEGORY-level value, stored on the `(digest, email)` row (`DIGEST_CADENCE_CHANNEL`) and read by `resolveDigestCadence()`, which falls back to the other digest row then to `DEFAULT_DIGEST_CADENCE`. `setDigestCadenceQuery` updates `digest_cadence` alone — cadence never switches the digest back on. The screen's copy is scoped to the user's own open-items digest; the oversight activity digest (N-025) is fixed daily and is governed by the plant-side sharing toggle (N-026), which is NOT on this screen.
**Badge failure isolation (#227):** the badge is the one notifications read on EVERY dashboard route, so the layout never awaits it directly. `loadUnreadBadgeCountSafely()` degrades a throwing (or nonsense) count to 0 — `unstable_rethrow` first, so `redirect`/`notFound`/dynamic bailouts still escape — and the `await` sits inside a `<Suspense>`-wrapped `NotificationBellSlot`, so a notifications outage or stall costs the count, not the shell.

**Empty states:** `hasAnyNotifications()` separates cold start ("no notifications yet") from "all caught up"; it shares the feed's visibility rules (allow-list included) so `hasAny === false` implies the feed is empty. Two states only — "all caught up" is reachable only under `?filter=unread`, since on the All tab an empty list and `hasAny` true are contradictory.

---

## Tasks

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Pages | `(dash)/tasks/{page,new/page,[id]/page}.tsx` | Routes `/tasks`, `/tasks/new`, `/tasks/[id]` |
| Task CRUD | `(dash)/tasks/actions.ts:createTaskAction()` / `quickAddTaskAction()` / `updateTaskAction()` / `deleteTaskAction()` | Form submit |
| Status changes | `(dash)/tasks/actions.ts:completeTaskAction()` / `reopenTaskAction()` / `updateTaskStatusAction()` | User action |
| Bulk complete / reschedule | `(dash)/tasks/actions.ts:bulkCompleteTasksAction()` / `bulkRescheduleTasksAction()` | Bulk actions bar (multi-select) |

**Primary modules:** `src/lib/tasks/`, `src/components/tasks/`, `src/db/schema/tasks.ts`

**Key deps:** `tasks` table

**Events:** `meeting.attendance.finalized` → auto-creates follow-up (48h) + evaluation (24h) tasks **assigned to the church's planter** — resolved as "declared answer first, role lookup second": an explicit `churches.leadership_status = 'no_planter'` (OB-004) skips the lookup entirely, so the handler warns and returns without creating tasks rather than assigning them to an account that said it is not the pastor. Finalization still succeeds either way; `meeting.evaluation.completed` → auto-completes matching task; `task.completed` → Phase Engine dirty-marking

**Bulk ops (T-019):** one SQL statement per bulk write; every requested id comes back as a success or a reasoned failure (never dropped). Bulk complete emits one `task.completed` per completed task, awaited **sequentially** so subscribers are not stampeded. Reschedule emits nothing. **Both refuse already-complete tasks** — reschedule too, so the list's Completed group select-all cannot silently re-date finished work. Cap is `MAX_BULK_TASKS` (100) in `src/lib/tasks/types.ts`, enforced in the action schema and shown in the UI before the click.

---

## Ministry Teams

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Pages | `(dash)/teams/{page,[teamId]/page,org-chart/page,health/page}.tsx` (+ `[teamId]/{meetings,responsibilities,training}/`) | Routes `/teams/*` |
| Team CRUD | `(dash)/teams/actions.ts:createTeamAction()` / `updateTeamAction()` / `initializeTeamsAction()` | Form submit |
| Roles | `(dash)/teams/actions.ts:*RoleAction()` / `importRoleTemplatesAction()` | User action |
| Membership | `(dash)/teams/actions.ts:assignMemberAction()` / `removeMemberAction()` / `assignTeamLeaderAction()` | User action |
| Training | `(dash)/teams/actions.ts:*TrainingProgramAction()` / `markTrainingCompleteAction()` | User action |

**Primary modules:** `src/lib/ministry-teams/`, `src/components/ministry-teams/`, `src/db/schema/ministry-teams.ts`

**Key deps:** `ministry_teams`, `team_roles`, `team_memberships`, `training_programs`, `training_completions` tables

**Events:** `team.member.assigned` → core_group → launch_team auto-advance, `team.leader.assigned` → launch_team → leader auto-advance (handlers in `src/lib/people/events.ts`)

---

## Notifications (F11)

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Enqueue | `src/lib/notifications/enqueue.ts:enqueue()` / `cancelByEntity()` | Any feature announcing something |
| Preferences | `src/lib/notifications/preferences.ts:setPreference()` / `setDigestCadence()` / `buildPreferenceMatrixView()` | `(dash)/settings/` — see the Notifications section above (needs a `PreferenceOwner`) |
| Feed / unread count | `src/lib/notifications/queries.ts:listNotifications()` / `getUnreadCount()` | App shell + feed page |
| **Scheduled dispatch** | `src/app/api/notifications/dispatch/route.ts` → `src/lib/notifications/dispatch.ts:runDispatch()` | GitHub Actions schedule, every 15 min (`.github/workflows/notifications-dispatch.yml`, `CRON_SECRET`) — NOT a Vercel cron; Hobby caps those at daily |
| Still-live predicate | `dispatch.ts:registerStillLivePredicate(type, fn)` | Owning feature, at module load |

**Primary modules:** `src/lib/notifications/` (categories, enqueue, preferences, queries, dispatch), `src/db/schema/notifications.ts`

**Key deps:** `notifications`, `notification_preferences`, `notification_deliveries` tables; `src/lib/email/client.ts` (dispatch ONLY — enqueue's import graph provably cannot reach it)

**Dispatch contract:** claims rows `pending → claimed` in ONE `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`, then claims each channel through the unique `(notification_id, channel)` index — at-most-once is a DB property, not a dispatcher intention. Groups by (church, recipient, category) so N notifications become ONE email and N feed rows. Backoff lives on the DELIVERY row's `updated_at`, never on `scheduled_for` (which is also the feed's visibility gate). Batch bounded by `MAX_DISPATCH_BATCH`; the remainder stays pending and claimed-but-unprocessed rows are released.

---

## Phase Engine (Plant Intelligence)

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Phase page | `(dash)/phase/page.tsx` | Route `/phase` |
| Phase transition | `(dash)/phase/actions.ts:transitionPhaseAction()` / `getPhaseReadinessAction()` | User action |
| Manual signals | `(dash)/phase/signals-actions.ts:setManualSignalAction()` | User action |
| Insight feedback | `(dash)/phase/feedback-actions.ts:submitInsightFeedbackAction()` | User action |
| Assessment run | `src/app/api/phase-engine/assess/route.ts` | Vercel cron (daily, `CRON_SECRET`) |

**Primary modules:** `src/lib/phase-engine/` (assessment, judge, rag, signals, transitions, feedback, oversight), `src/components/phase-engine/`, `src/db/schema/phase-engine.ts`

**Key deps:** `phase_transitions`, `plant_signals`, `plant_assessments`, `plant_insights`, `insight_feedback`, `methodology_embeddings` tables; `churches.last_material_event_at` dirty flag (`src/lib/phase-engine/dirty-handler.ts`)

---

## Feedback

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Submit feedback | `(dash)/feedback/actions.ts:submitFeedbackAction()` | Feedback widget |
| Admin review | `(dash)/admin/feedback/page.tsx` | Route `/admin/feedback` (platform admin) |
| Update status | `(dash)/admin/feedback/actions.ts:updateFeedbackStatusAction()` | Admin action |

**Primary modules:** `src/lib/feedback/`, `src/components/feedback/`, `src/db/schema/feedback.ts`

**Key deps:** `feedback` table; `ADMIN_EMAILS` allowlist (`src/lib/auth/admin.ts:isPlatformAdmin()`)

---

## Oversight

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Oversight dashboard | `(dash)/oversight/page.tsx` | Route `/oversight` (oversight roles) |
| Plant health | `(dash)/oversight/health/page.tsx` | Route `/oversight/health` |

**Primary modules:** `src/lib/phase-engine/oversight/`, `src/lib/dashboard/`

**Key deps:** `getAccessibleChurchIds()`, church privacy settings

---

## API Routes

| Route | File | Method | Auth / Trigger |
|-------|------|--------|----------------|
| `/api/health` | `src/app/api/health/route.ts` | GET | Public health check |
| `/api/wiki/article` | `src/app/api/wiki/article/route.ts` | GET | Session-authed article JSON |
| `/api/wiki/revalidate` | `src/app/api/wiki/revalidate/route.ts` | POST, DELETE | `REVALIDATION_SECRET` |
| `/api/phase-engine/assess` | `src/app/api/phase-engine/assess/route.ts` | GET | Vercel cron (daily), `CRON_SECRET` bearer |
| `/api/notifications/dispatch` | `src/app/api/notifications/dispatch/route.ts` | GET | GitHub Actions schedule (every 15 min), `CRON_SECRET` bearer |
| `/api/rsvp/[token]` | `src/app/api/rsvp/[token]/route.ts` | POST | Public, token-based RSVP |
| `/api/webhooks/resend` | `src/app/api/webhooks/resend/route.ts` | POST | Resend webhook signature |

---

## Database

| Connection | File |
|------------|------|
| DB instance | `src/db/index.ts` |
| Schema exports | `src/db/schema/index.ts` |

**Migrations:** `src/db/migrations/`
