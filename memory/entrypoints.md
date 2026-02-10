# Entrypoints

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
| Article view | `src/app/(dashboard)/wiki/[...slug]/page.tsx` | Route `/wiki/*` |
| Article retrieval | `src/lib/wiki/get-article.ts:getArticle()` | Page render |
| Search | `src/app/(dashboard)/wiki/actions.ts:searchWikiArticles()` | Search input |
| Progress update | `src/lib/wiki/progress.ts:updateProgress()` | Article scroll/view |
| Bookmark toggle | `src/lib/wiki/bookmarks.ts:toggleBookmark()` | User action |
| Cache revalidation | `src/app/api/wiki/revalidate/route.ts` | POST with secret |

**Primary modules:** `src/lib/wiki/`, `src/components/wiki/`, `src/db/schema/wiki.ts`

**Key deps:** `wiki_articles`, `wiki_sections`, `wiki_progress`, `wiki_bookmarks` tables

---

## Dashboard

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Layout auth guard | `src/app/(dashboard)/layout.tsx` | Any `/dashboard/*` route |
| Dashboard page | `src/app/(dashboard)/dashboard/page.tsx` | Route `/dashboard` |

**Primary modules:** `src/app/(dashboard)/`, `src/components/`

**Key deps:** `getCurrentSession()`, sidebar state cookie

---

## People / CRM

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| People list | `src/app/(dashboard)/people/page.tsx` | Route `/people` |
| Person detail | `src/app/(dashboard)/people/[id]/page.tsx` | Route `/people/[id]` |
| Activity tab | `src/app/(dashboard)/people/[id]/activity/page.tsx` | Route `/people/[id]/activity` |
| Create person | `src/app/(dashboard)/people/actions.ts:createPersonAction()` | Form submit |
| Update person | `src/app/(dashboard)/people/actions.ts:updatePersonAction()` | Form submit |
| Delete person | `src/app/(dashboard)/people/actions.ts:deletePersonAction()` | User action |
| Change status | `src/app/(dashboard)/people/actions.ts:changeStatusAction()` | Drag-drop / Modal |
| Change status w/reason | `src/app/(dashboard)/people/actions.ts:changeStatusWithReasonAction()` | Modal submit |
| Add note | `src/app/(dashboard)/people/actions.ts:addNoteAction()` | Form submit |
| Tag management | `src/app/(dashboard)/people/actions.ts:*TagAction()` | User action |

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

## Vision Meetings

| Flow | Entrypoint | Trigger |
|------|-----------|---------|
| Meeting list | `src/app/(dashboard)/vision-meetings/page.tsx` | Route `/vision-meetings` |
| Schedule meeting | `src/app/(dashboard)/vision-meetings/new/page.tsx` | Route `/vision-meetings/new` |
| Meeting detail | `src/app/(dashboard)/vision-meetings/[id]/page.tsx` | Route `/vision-meetings/[id]` |
| Attendance capture | `src/app/(dashboard)/vision-meetings/[id]/attendance/page.tsx` | Route `/vision-meetings/[id]/attendance` |
| Analytics | `src/app/(dashboard)/vision-meetings/[id]/analytics/page.tsx` | Route `/vision-meetings/[id]/analytics` |
| Evaluation | `src/app/(dashboard)/vision-meetings/[id]/evaluation/page.tsx` | Route `/vision-meetings/[id]/evaluation` |
| Logistics | `src/app/(dashboard)/vision-meetings/[id]/logistics/page.tsx` | Route `/vision-meetings/[id]/logistics` |
| Invitations | `src/app/(dashboard)/vision-meetings/[id]/invitations/page.tsx` | Route `/vision-meetings/[id]/invitations` |
| Create meeting | `src/app/(dashboard)/vision-meetings/actions.ts:createMeetingAction()` | Form submit |
| Update meeting | `src/app/(dashboard)/vision-meetings/actions.ts:updateMeetingAction()` | Form submit |
| Delete meeting | `src/app/(dashboard)/vision-meetings/actions.ts:deleteMeetingAction()` | User action |
| Update status | `src/app/(dashboard)/vision-meetings/actions.ts:updateMeetingStatusAction()` | Status button |
| Add attendee | `src/app/(dashboard)/vision-meetings/actions.ts:addAttendeeAction()` | User action |
| Quick add attendee | `src/app/(dashboard)/vision-meetings/actions.ts:quickAddAttendeeAction()` | Form submit |
| Remove attendee | `src/app/(dashboard)/vision-meetings/actions.ts:removeAttendeeAction()` | User action |
| Finalize attendance | `src/app/(dashboard)/vision-meetings/actions.ts:finalizeAttendanceAction()` | Button click |
| Create location | `src/app/(dashboard)/vision-meetings/actions.ts:createLocationAction()` | Form submit |
| Create invitation | `src/app/(dashboard)/vision-meetings/actions.ts:createInvitationAction()` | Form submit |
| Update invitation status | `src/app/(dashboard)/vision-meetings/actions.ts:updateInvitationStatusAction()` | Dropdown change |
| Create evaluation | `src/app/(dashboard)/vision-meetings/actions.ts:createEvaluationAction()` | Form submit |
| Toggle checklist | `src/app/(dashboard)/vision-meetings/actions.ts:toggleChecklistItemAction()` | Checkbox click |

**Primary modules:** `src/lib/vision-meetings/`, `src/components/vision-meetings/`, `src/db/schema/vision-meetings.ts`

**Key deps:** `locations`, `vision_meetings`, `vision_meeting_attendance`, `invitations`, `meeting_evaluations`, `meeting_checklist_items` tables

**Events:** `meeting.attendance.recorded` → F2 handler (prospect → attendee), `meeting.attendance.finalized` → F5 (deferred), `meeting.completed` → F4 (deferred)

---

## API Routes

| Route | File | Method |
|-------|------|--------|
| `/api/health` | `src/app/api/health/route.ts` | GET |
| `/api/wiki/revalidate` | `src/app/api/wiki/revalidate/route.ts` | POST, DELETE |

---

## Database

| Connection | File |
|------------|------|
| DB instance | `src/db/index.ts` |
| Schema exports | `src/db/schema/index.ts` |

**Migrations:** `src/db/migrations/`
