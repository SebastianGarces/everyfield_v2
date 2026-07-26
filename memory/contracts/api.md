# API Contracts

## Route Handlers

| Route | Auth | Contract |
|-------|------|----------|
| `GET /api/health` | None | `{ status: "ok", timestamp }` |
| `GET /api/wiki/article?slug=` | Session (401) | WikiGuide article JSON `{ slug, title, description, readTime, type, content(raw MDX) }`; 400 no slug, 404 |
| `POST /api/wiki/revalidate` | `REVALIDATION_SECRET` in body | `{ slug, secret }` → `{ revalidated: true, slug, timestamp }` |
| `DELETE /api/wiki/revalidate` | secret in body | `{ secret }` → `{ revalidated: true, scope: "all", timestamp }` |
| `POST /api/phase-engine/assess` | `Authorization: Bearer <CRON_SECRET>` | Vercel Cron judge runner: dirty-or-stale plants, sequential, `MAX_BATCH=25`/run (rest roll over); returns `{selected,attempted,assessed,failed,skipped,outcomes[]}`; assessments run ONLY here or via manual trigger |
| `POST /api/rsvp/[token]` | None — token in path | Public RSVP: `{ response: "confirmed"\|"declined" }` → `{ success: true }`; 400 invalid; backed by `meeting_confirmation_tokens` |
| `POST /api/webhooks/resend` | Svix signature via `RESEND_WEBHOOK_SECRET` | Resend events advance `communication_recipients.status` (forward-only) |

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

**Register:** rate-limit → beta gate: when `BETA_INVITE_CODE` is set, requires valid invite code unless org-invitation bypass applies → entity per `accountType`: `planter` → NO church at signup (`church_id: null`; created later via `createChurch`, which also adds default `churchPrivacySettings`); `sending_church` → new SendingChurch; `network` → new SendingNetwork.

---

### Feature Server Actions

All files under `src/app/(dashboard)/`. Default auth unless noted: `verifySession()` + scope to the session user's `church_id`. Names omit the trailing `Action` suffix (`createPerson` = `createPersonAction`).

- **`people/actions.ts`** (~40): createPerson, updatePerson, deletePerson, changeStatus, changeStatusWithReason, addNote, deleteNote, getMoreActivities, tags (list/create/update/assign/remove/delete), createAssessment, createInterview, createCommitment, getCommitmentDownloadUrl, households (list/create/createFromPerson/update/delete/addTo/removeFrom, propagateAddress, getMembers), skills (add/update/remove/getPersonSkills), checkForDuplicates, quickAddPerson, downloadCsvTemplate, exportPeople, previewImport, executeBulkImport, reorderPipeline
- **`meetings/actions.ts`** (24): createMeeting, updateMeeting, deleteMeeting, updateMeetingStatus, createLocation, updateLocation, addAttendee, quickAddAttendee, removeAttendee, finalizeAttendance, recordAttendanceBatch, createInvitation, updateInvitationStatus, createEvaluation, toggleChecklistItem, updateChecklistItem, addToGuestList, removeFromGuestList, updateRsvpStatus, quickAddPersonToGuestList, toggleAttendanceStatus, addWalkInAttendee, quickAddWalkIn, addAttendeeNote
- **`tasks/actions.ts`** (7): createTask, quickAddTask, updateTask, completeTask, reopenTask, deleteTask, updateTaskStatus
- **`teams/actions.ts`** (25): listTeams, getTeam, createTeam, updateTeam, assignTeamLeader, initializeTeams, roles (list/create/update/delete, importRoleTemplates), assignMember, removeMember, getPersonTeams, getPersonTeamCount, listMeetings, createMeeting, recordAttendance, listTrainingPrograms, createTrainingProgram, markTrainingComplete, getStaffingSummary, getTeamHealth, getAllTeamsHealth
- **`communication/actions.ts`** (9): sendMessage, resolveGroup, searchPeople, getTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, forkTemplate
- **`phase/actions.ts`**: transitionPhase (also `requireRole("planter")`), getPhaseReadiness — Session + `requireChurchAccess`
- **`phase/feedback-actions.ts`**: submitInsightFeedback — Session + `requireChurchAccess`
- **`phase/signals-actions.ts`**: setManualSignal — Session + `requireChurchAccess`
- **`feedback/actions.ts`**: submitFeedback (emails `FEEDBACK_EMAIL_TO`)
- **`admin/feedback/actions.ts`**: updateFeedbackStatus — `requirePlatformAdmin` (ADMIN_EMAILS)
- **`dashboard/actions.ts`**: `createChurch` (planter creates church post-signup)
- **`wiki/actions.ts`**: `searchWikiArticles(query)`

Server-side `"use server"` services under `src/lib/phase-engine/`: `feedback/service.ts` (`upsertInsightFeedback`, `getInsightFeedbackForUser`), `signals/attestation-service.ts` (`upsertManualSignal`, `listManualSignals`, `getManualSignal`), `transitions/service.ts` (`transitionPhase`, `getPhaseReadiness`, helpers).

---

### Wiki Data Layer (all Session)

- `src/lib/wiki/progress.ts`: `updateProgress(slug, data)`, `markCompleted`, `recordView`, `getArticleProgress`, `getArticlesProgress`, `getRecentlyViewed`, `getProgressStats`, `getLastInProgress`
- `src/lib/wiki/bookmarks.ts`: `toggleBookmark`, `addBookmark`, `removeBookmark`, `isBookmarked`, `getBookmarkedSlugs`, `getBookmarks`

---

### Invitation Service Functions

All in `src/lib/invitations/service.ts` (11 exports, all Session):

`createInvitation(input)` (oversight role) · `acceptInvitation(id, user)` (target user) · `declineInvitation(id, user)` (target user) · `revokeInvitation(id)` (inviter) · `disassociateChurchFromSendingChurch` · `disassociateChurchFromNetwork` · `disassociateSendingChurchFromNetwork` · `getInvitation` · `getPendingInvitationsForChurch` · `getPendingInvitationsForSendingChurch` · `getInvitationsSentByUser`

---

### Access Control Functions

All in `src/lib/auth/access.ts`:

- `getAccessibleChurchIds(user)` — resolve all church IDs user can access
- `requireChurchAccess(user, churchId)` — throws if user cannot access church
- `requireRole(user, ...roles)` — throws if user lacks required role
- `canAccessFeatureData(user, churchId, feature)` — check privacy toggle for oversight

---

**Validation:** all form inputs validated with Zod schemas — `src/lib/validations/`
