# Entrypoints

> Path shorthand: `(dash)/` = `(dash)/`

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

**Primary modules:** `(dash)/`, `src/components/`

**Key deps:** `getCurrentSession()`, sidebar state cookie

---

## People / CRM

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| People list | `(dash)/people/page.tsx` | Route `/people` |
| Person detail | `(dash)/people/[id]/page.tsx` | Route `/people/[id]` |
| Activity tab | `(dash)/people/[id]/activity/page.tsx` | Route `/people/[id]/activity` |
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

## Tasks

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Pages | `(dash)/tasks/{page,new/page,[id]/page}.tsx` | Routes `/tasks`, `/tasks/new`, `/tasks/[id]` |
| Task CRUD | `(dash)/tasks/actions.ts:createTaskAction()` / `quickAddTaskAction()` / `updateTaskAction()` / `deleteTaskAction()` | Form submit |
| Status changes | `(dash)/tasks/actions.ts:completeTaskAction()` / `reopenTaskAction()` / `updateTaskStatusAction()` | User action |
| Bulk complete / reschedule | `(dash)/tasks/actions.ts:bulkCompleteTasksAction()` / `bulkRescheduleTasksAction()` | Bulk actions bar (multi-select) |

**Primary modules:** `src/lib/tasks/`, `src/components/tasks/`, `src/db/schema/tasks.ts`

**Key deps:** `tasks` table

**Events:** `meeting.attendance.finalized` → auto-creates follow-up (48h) + evaluation (24h) tasks; `meeting.evaluation.completed` → auto-completes matching task; `task.completed` → Phase Engine dirty-marking

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
| `/api/rsvp/[token]` | `src/app/api/rsvp/[token]/route.ts` | POST | Public, token-based RSVP |
| `/api/webhooks/resend` | `src/app/api/webhooks/resend/route.ts` | POST | Resend webhook signature |

---

## Database

| Connection | File |
|------------|------|
| DB instance | `src/db/index.ts` |
| Schema exports | `src/db/schema/index.ts` |

**Migrations:** `src/db/migrations/`
