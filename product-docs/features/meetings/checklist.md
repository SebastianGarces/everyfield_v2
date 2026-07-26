# Meetings – Implementation Checklist

> **Note:** F3 was originally built as standalone Vision Meetings, then migrated to the unified meeting system (`church_meetings` with a `type` discriminator) in migration `0011_unified_meetings.sql`. All paths below reflect the unified implementation.

## Phase 1: Foundation (Schema & Types)

### Database Schema
- [x] VM-S01a: Create `src/db/schema/meetings.ts` with all tables
- [x] VM-S01b: Define enums (`meetingTypes`, `meetingStatuses`, `meetingSubtypes`, `attendanceTypes`, `attendanceStatuses`, `responseStatuses`, `invitationStatuses`, `checklistCategories`)
- [x] VM-S01c: Create `locations` table (id, church_id, name, address, contact fields, cost, capacity, notes, is_active, timestamps)
- [x] VM-S01d: Create `churchMeetings` table — unified entity (id, church_id, type, title, datetime, status, location fields, meeting_number [vision only], team_id + meeting_subtype [team only], estimated/actual_attendance, duration_minutes, notes, agenda, created_by, timestamps)
- [x] VM-S01e: Create `meetingAttendance` table (id, church_id, meeting_id, person_id, attendance_type [nullable, derived], status [attended/absent/excused], invited_by_id, response_status, notes, created_by, timestamps) — doubles as the guest list
- [x] VM-S01f: Add unique constraint on `(meeting_id, person_id)` for attendance
- [x] VM-S01g: Create `invitations` table (id, church_id, meeting_id, inviter_id, invitee_name, invitee_id, status, timestamps)
- [x] VM-S01h: Create `meetingEvaluations` table (id, church_id, meeting_id, 8 score fields, total_score, notes, evaluated_by, timestamps)
- [x] VM-S01i: Create `meetingChecklistItems` table (id, church_id, meeting_id, item_name, category, is_checked, notes, assigned_to, timestamps)
- [x] VM-S01j: Add indexes on `church_id`, `type`, `status`, `team_id`, `meeting_id`, `person_id` columns
- [x] VM-S01k: Export all tables from `src/db/schema/index.ts`
- [x] VM-S01l: Generate and run migrations (including `src/db/migrations/0011_unified_meetings.sql` for the vision-meetings -> unified rename)

### Validation Schemas
- [x] VM-S02a: Create `src/lib/validations/meetings.ts`
- [x] VM-S02b: Create `meetingCreateSchema` (type, datetime, location_id or location_name/address, team_id, meeting_subtype, estimated_attendance, notes)
- [x] VM-S02c: Create `meetingUpdateSchema` (partial of create + status)
- [x] VM-S02d: Create `locationCreateSchema` (name, address, contact fields, cost, capacity, notes)
- [x] VM-S02e: Create `locationUpdateSchema` (partial of create)
- [x] VM-S02f: Create `attendanceCreateSchema` (person_id, attendance_type, invited_by_id, response_status, notes) + `attendanceBatchSchema` for batch recording
- [x] VM-S02g: Create `evaluationCreateSchema` (8 score fields, notes)
- [x] VM-S02h: Create `invitationCreateSchema` (inviter_id, invitee_name/id, status)
- [ ] VM-S02i: Remove legacy `src/lib/validations/vision-meetings.ts` (no longer imported anywhere)

### Types
- [x] VM-S03a: Create `src/lib/meetings/types.ts`
- [x] VM-S03b: Export Drizzle inferred types (`ChurchMeeting`, `NewChurchMeeting`, `Location`, etc.)
- [x] VM-S03c: Define `ListMeetingsOptions` (status/type filter, pagination)
- [x] VM-S03d: Define `MeetingWithCounts` (meeting + attendance counts)

---

## Phase 2: Core Service Layer

### Meeting Service
- [x] VM-001a: Create `src/lib/meetings/service.ts`
- [x] VM-001b: Implement `getNextMeetingNumber(churchId)` — MAX + 1 per church (vision meetings only)
- [x] VM-001c: Implement `createMeeting(churchId, userId, data)` — Auto-assigns meeting_number for vision meetings, auto-populates checklist, emits training event for training-subtype team meetings
- [x] VM-001d: Implement `getMeeting(churchId, meetingId)` — With attendance counts
- [x] VM-001e: Implement `updateMeeting(churchId, meetingId, data)`
- [x] VM-001f: Implement `deleteMeeting(churchId, meetingId)`
- [x] VM-001g: Implement `listMeetings(churchId, options)` — Filter by status (upcoming/past/all) and meeting type, pagination
- [x] VM-001h: Implement `updateMeetingStatus(churchId, meetingId, newStatus)` — Emits `meeting.completed` on transition to completed

### Location Service
- [x] VM-009a: Create `src/lib/meetings/locations.ts`
- [x] VM-009b: Implement `createLocation(churchId, data)`
- [x] VM-009c: Implement `listLocations(churchId)` — Active locations only
- [x] VM-009d: Implement `getLocation(churchId, locationId)`
- [x] VM-009e: Implement `updateLocation(churchId, locationId, data)`
- [x] VM-009f: Implement `deactivateLocation(churchId, locationId)` — Set is_active = false

### Event Definitions
- [x] VM-007a: Create `src/lib/meetings/events.ts`
- [x] VM-007b: Define `MeetingAttendanceRecordedEvent` interface
- [x] VM-007c: Define `MeetingAttendanceFinalizedEvent` interface
- [x] VM-007d: Define `MeetingCompletedEvent` and `MeetingEvaluationCompletedEvent` interfaces
- [x] VM-007e: Implement `emitAttendanceRecorded()` — Publishes to the in-process event bus (`src/lib/events/event-bus.ts`)
- [x] VM-007f: Implement `emitAttendanceFinalized()` — Publishes to the event bus with `attendeeIds[]` + `totalAttendance`
- [x] VM-007g: Implement `emitMeetingCompleted()` and `emitEvaluationCompleted()` — Publish to the event bus

### Server Actions
- [x] VM-001i: Create `src/app/(dashboard)/meetings/actions.ts`
- [x] VM-001j: Implement `createMeetingAction(formData)` — verifySession, validate, call service, revalidatePath
- [x] VM-001k: Implement `updateMeetingAction(formData)` + `updateMeetingStatusAction`
- [x] VM-001l: Implement `deleteMeetingAction(meetingId)`
- [x] VM-009g: Implement `createLocationAction(formData)`
- [x] VM-009h: Implement `updateLocationAction(formData)`

---

## Phase 3: Meeting List & Creation (VM-001, VM-002, VM-026)

### Meeting List Page
- [x] VM-002a: Create `src/app/(dashboard)/meetings/page.tsx` — Server component
- [x] VM-002b: Fetch meetings with `listMeetings()`, split into upcoming/past
- [x] VM-002c: Create `src/components/meetings/meeting-list.tsx` — Upcoming/Past sections
- [x] VM-002d: Create `src/components/meetings/meeting-card.tsx` — Date, title/number, type badge, location, status badge, attendance summary
- [x] VM-002e: Implement Upcoming/Past/All view toggle
- [x] VM-002f: Empty state for no meetings
- [x] VM-026a: Type filter tabs (All, Vision Meetings, Orientations, Team Meetings) via `?type=` search param

### Schedule Meeting
- [x] VM-001m: Create `src/app/(dashboard)/meetings/new/page.tsx`
- [x] VM-001n: Create `src/components/meetings/meeting-form.tsx` — Type, date/time, location, team + subtype (team meetings), estimated attendance, notes
- [x] VM-001o: Create `src/components/meetings/location-picker.tsx` — Select saved or add new inline
- [x] VM-001p: Integrate server action for form submission
- [x] VM-001q: Redirect to meeting detail after creation
- [x] VM-026b: Create team meetings from the Teams feature (`src/app/(dashboard)/teams/actions.ts` `createMeetingAction` calls the unified `createMeeting`)

### Navigation
- [x] VM-NAV: "Meetings" nav item pointing at `/meetings` (`src/lib/navigation.ts`)

---

## Phase 4: Meeting Detail View (VM-008)

### Detail Layout
- [x] VM-008a: Create `src/app/(dashboard)/meetings/[id]/layout.tsx` — Fetch meeting, render header + tabs + children
- [x] VM-008b: Create `src/components/meetings/meeting-header.tsx` — Title/number, type, date, location, countdown/days-ago, status badge
- [x] VM-008c: Create `src/components/meetings/meeting-tabs.tsx` — Link-based tabs (Details, Attendance, Guest List, Evaluation, Analytics, Logistics), context-aware by type and status

### Details Tab
- [x] VM-008d: Create `src/app/(dashboard)/meetings/[id]/page.tsx` — Meeting info display
- [x] VM-008e: Display meeting date/time, location, estimated attendance, notes
- [x] VM-008f: Status transition buttons (planning -> ready -> in_progress -> completed)

### Edit Support
- [x] VM-008g: Edit and delete dialogs in `src/app/(dashboard)/meetings/[id]/meeting-details-client.tsx`

---

## Phase 5: Attendance Capture (VM-003, VM-004, VM-005, VM-007)

### Attendance Service
- [x] VM-003a: Add `addAttendee(churchId, meetingId, data)` to service
- [x] VM-003b: Add `removeAttendee(churchId, meetingId, personId)` to service
- [x] VM-003c: Add `listAttendees(churchId, meetingId)` — With Person details joined
- [x] VM-003d: Add `getAttendanceSummary(churchId, meetingId)` — Counts by type
- [x] VM-003e: Add `finalizeAttendance(churchId, meetingId)` — Counts attended rows, sets actual_attendance, emits events (sequential queries; not wrapped in a DB transaction — known gap vs FRD atomicity NFR)
- [x] VM-003k: Add `recordAttendanceBatch(churchId, meetingId, data)` — Upsert batch attendance (team meeting pattern)
- [x] VM-004b: Create `src/lib/meetings/attendance-type.ts` — `deriveAttendanceType()` derives first_time/returning/core_group on every attended-transition (system-derived, not user-selected — divergence from FRD AC 3 pending decision)

### Server Actions
- [x] VM-003f: Add `addAttendeeAction(formData)` — Add existing person as attendee
- [x] VM-005a: Add `quickAddAttendeeAction(formData)` — Create Person + add as attendee in one action
- [x] VM-003g: Add `removeAttendeeAction(meetingId, personId)`
- [x] VM-003l: Add `toggleAttendanceStatusAction`, `recordAttendanceBatchAction`, `addWalkInAttendeeAction`, `quickAddWalkInAction`, `addAttendeeNoteAction`
- [x] VM-007h: Add `finalizeAttendanceAction(meetingId)` — Triggers event emission

### Attendance Page
- [x] VM-003h: Create `src/app/(dashboard)/meetings/[id]/attendance/page.tsx` — Server component

### Attendance Components
- [x] VM-003i: Create `src/components/meetings/attendance-capture.tsx` — Main screen with search, list, counters
- [x] VM-005b: Create `src/components/meetings/attendee-quick-add.tsx` — Inline form (name, email, phone, invited-by)
- [x] VM-003j: Create `src/components/meetings/attendee-row.tsx` and `attendee-notes.tsx` — Name, type badge, invited-by, notes, remove button
- [x] VM-004a: Display new vs returning counters in attendance header

### Person Search Integration
- [x] VM-005c: Reuse Person search from F2 for "Search existing contacts"
- [x] VM-006a: Person picker for "Invited by" field (Core Group members)

### Attendance Finalization
- [x] VM-007i: Finalize button on attendance screen
- [x] VM-007j: Emit `meeting.attendance.recorded` per attended person on finalize
- [x] VM-007k: Emit `meeting.attendance.finalized` with all attended person IDs + total on finalize
- [x] VM-007l: Update meeting `actual_attendance` count on finalize

---

## Phase 6: Basic Analytics (VM-010)

### Analytics Service
- [x] VM-010a: Create `src/lib/meetings/analytics.ts`
- [x] VM-010b: Implement `getAttendanceTrend(churchId, limit?, meetingType?)` — Attendance counts per meeting over time, optional type filter
- [x] VM-010c: Implement new-vs-returning breakdown per meeting
- [x] VM-010d: Implement `getMeetingSummaryStats(churchId, meetingType?)` — Total meetings, avg attendance, growth %

### Analytics Page
- [x] VM-010e: Create `src/app/(dashboard)/meetings/[id]/analytics/page.tsx`
- [x] VM-010f: Create `src/components/meetings/analytics-charts.tsx` — Client component
- [x] VM-010g: Attendance trend line chart
- [x] VM-010h: New vs returning stacked bar chart
- [x] VM-010i: Summary stat cards (total meetings, avg attendance)
- [ ] VM-010k: Type filter UI on the analytics view — the lib supports a type filter but the page hardcodes `vision_meeting` and offers no filter control

### Dependencies
- [x] VM-010j: Install charting library (`pnpm add recharts`)

---

## Phase 7: Meeting Evaluation (Should Have: VM-015, VM-016)

### Evaluation Service
- [x] VM-015a: Add `createEvaluation(churchId, meetingId, userId, data)` to service — Emits `meeting.evaluation.completed`
- [x] VM-015b: Add `getEvaluation(churchId, meetingId)` to service
- [x] VM-016a: Add `getEvaluationTrend(churchId, limit?)` to service — Score trends over time (no UI consumer yet)

### Server Actions
- [x] VM-015c: Add `createEvaluationAction(formData)`

### Evaluation Tab
- [x] VM-015d: Add Evaluation tab to completed vision meeting detail tabs
- [x] VM-015e: Create `src/app/(dashboard)/meetings/[id]/evaluation/page.tsx`

### Evaluation Components
- [x] VM-015f: Create `src/components/meetings/evaluation-form.tsx` — 8 quality factor rating inputs (1-5), notes, auto-calculated total
- [x] VM-016b: Create `src/components/meetings/evaluation-summary.tsx` — Per-factor star display + total score
- [ ] VM-016c: Comparison to previous meetings in the evaluation summary — `getEvaluationTrend` exists but nothing consumes it; no radar chart or previous-meeting comparison rendered

---

## Phase 8: Materials Checklist (Should Have: VM-012)

### Checklist Service
- [x] VM-012a: Add `populateChecklist(churchId, meetingId)` to service — Seed items from kit template
- [x] VM-012b: Add `getChecklist(churchId, meetingId)` to service
- [x] VM-012c: Add `updateChecklistItem(churchId, itemId, data)` to service — Toggle, notes, assign
- [x] VM-012d: Add `getChecklistSummary(churchId, meetingId)` — Checked/total counts

### Kit Template
- [x] VM-012e: Create `src/lib/meetings/kit-template.ts` — 18 default items with name and category

### Server Actions
- [x] VM-012f: Add `toggleChecklistItemAction(itemId)`
- [x] VM-012g: Add `updateChecklistItemAction(formData)`

### Checklist Tab
- [x] VM-012h: Add Logistics tab to planning mode meeting detail tabs (vision meetings)
- [x] VM-012i: Create `src/app/(dashboard)/meetings/[id]/logistics/page.tsx`

### Checklist Components
- [x] VM-012j: Create `src/components/meetings/materials-checklist.tsx` — Grouped by category, checkboxes, notes, assign-to, progress indicator

### Auto-Population
- [x] VM-012k: Call `populateChecklist()` in `createMeeting()` flow (vision meetings only)

---

## Phase 9: Invited-By Invitation Tracking (dropped from FRD v2.0 — decision pending)

The FRD v2.0 dropped legacy invited-by tracking (VM-017) in favor of guest list management. The code below still exists but is not wired into any page — the `/meetings/[id]/invitations` route renders the Guest List instead. Pending decision: permanently drop (and remove this code) or re-add to the FRD.

- [x] VM-011a: `src/lib/meetings/invitations.ts` exists (`createInvitation`, `listInvitations`, `updateInvitationStatus`, `getInvitationLeaderboard`, `getInvitationSummary`)
- [x] VM-011f: `createInvitationAction` / `updateInvitationStatusAction` exist in `src/app/(dashboard)/meetings/actions.ts`
- [x] VM-011j: `src/components/meetings/invitation-tracker.tsx` and `invitation-leaderboard.tsx` exist
- [ ] VM-011k: Components have zero importers — dead code unless invited-by tracking is re-adopted

---

## Phase 10: Unified Meetings — Guest List, RSVP & Communication (VM-006, VM-011, VM-026, VM-028, VM-029)

### Guest List (VM-006, VM-028)
- [x] VM-006b: Create `src/lib/meetings/guest-list.ts` — Guest list CRUD on the `meeting_attendance` table (people added before the meeting, attendance marked after)
- [x] VM-006c: Create `src/components/meetings/guest-list.tsx` — Search/add people, RSVP badges, per-guest email delivery status
- [x] VM-006d: Guest list actions: `addToGuestListAction`, `removeFromGuestListAction`, `updateRsvpStatusAction`, `quickAddPersonToGuestListAction`
- [x] VM-006e: Guest List tab at `src/app/(dashboard)/meetings/[id]/invitations/page.tsx`
- [ ] VM-027a: Auto-populate team meeting guest list from ministry team roster — not implemented (decision pending: roster auto-population vs. per-person batch attendance from the team tab)

### RSVP Confirmation Tokens (VM-028)
- [x] VM-028a: `meeting_confirmation_tokens` table in `src/db/schema/communication.ts` (URL-safe unique token, 7-day expiry, pending/confirmed/declined)
- [x] VM-028b: Create `src/lib/communication/confirmation.ts` — Token generation and resolution; updates token + guest list `response_status`
- [x] VM-028c: Public RSVP page `src/app/rsvp/[token]/page.tsx` + API route `src/app/api/rsvp/[token]/route.ts`

### Communication Hub Integration (VM-011)
- [x] VM-011l: Guest list "Send Email" hands off to `/communication/compose?meetingId=...&recipientIds=...` (compose preloads recipients and auto-suggests a meeting template)
- [x] VM-011m: Per-guest delivery tracking on the Guest List tab via `getMeetingTrackingByPerson` (`src/lib/communication/service.ts`)
- [x] VM-011n: Create `src/components/meetings/meeting-communication-status.tsx`

### Meeting Subtypes (VM-029)
- [x] VM-029a: Team meeting subtypes (regular/training/planning/special/rehearsal) in schema and meeting form
- [x] VM-029b: Training-subtype team meetings emit a training scheduled event on creation

---

## Phase 11: Integration & Events

### F2 Integration (People/CRM)
- [x] VM-INT-01: Wire `meeting.attendance.recorded` event emission in `finalizeAttendance()`
- [x] VM-INT-02: F2's `handleVisionMeetingAttendance()` in `src/lib/people/events.ts` implements Prospect -> Attendee progression
- [x] VM-INT-03: Verify Person record creation from quick-add flows correctly

### F5 Integration (Task Management)
- [x] VM-INT-04: `meeting.attendance.finalized` subscriber wired in `src/lib/events/subscriptions.ts`
- [x] VM-INT-05: Follow-up task creation implemented in `src/lib/tasks/events.ts` (`handleMeetingAttendanceFinalized`) — creates per-attendee follow-up tasks (due 2 days from finalization) plus a 24-hour meeting evaluation task. Note: intentionally diverges from FRD AC 7 (tasks for ALL attendees, due from finalization time, not new-attendees-only / meeting date + 48h) — canon decision pending
- [x] VM-INT-09: `meeting.evaluation.completed` subscriber auto-completes the evaluation task

### F4 Integration (Dashboard)
- [x] VM-INT-06: `meeting.completed` event emitted on status transition to completed — no event bus subscriber; the dashboard aggregates meeting metrics via direct queries instead
- [x] VM-INT-07: Metrics query functions available in `analytics.ts` for F4 consumption

### Privacy Settings
- [x] VM-INT-08: Meeting data respects the `share_meetings` privacy toggle for oversight users (renamed from `share_vision_meetings` in `0011_unified_meetings.sql`; mapping in `src/lib/auth/access.ts`)

---

## Follow-Up Completion Tracking (Should Have: VM-020)

F5 exists, so this is unblocked but not implemented:

- [ ] VM-020a: Display follow-up completion percentage on meeting detail
- [ ] VM-020b: Query F5 tasks linked to meeting for completion % calculation

---

## Agenda Builder (Should Have: VM-013)

`church_meetings.agenda` jsonb column exists but there is no agenda UI:

- [ ] VM-013a: Display structured agenda on meeting detail (stored as JSON)
- [ ] VM-013b: Create `src/components/meetings/agenda-builder.tsx` — Section editor with timing
- [ ] VM-013c: Default template with 6 sections (Welcome, Worship, Vision, Q&A, Response, Fellowship)
- [ ] VM-013d: Add agenda editing to meeting form or detail page

---

## Response Card Capture (Should Have: VM-014)

Enum values (`interested`/`ready_commit`/`questions`/`not_interested`) exist in the schema but no UI writes them (attendance capture only shows confirmed/declined RSVP badges):

- [ ] VM-014a: Add response card capture to the attendance workflow
- [ ] VM-014b: Display response card summary on meeting outcomes (Outcomes tab)
- [ ] VM-014c: Create `src/components/meetings/response-summary.tsx` — Breakdown by response type

---

## Meeting Reminders (Should Have: VM-018)

F9 exists (manual sends work via templates, including a seeded `meeting_reminder` template), but there is no scheduler/cron for automated reminders (decision pending: automated scheduling vs. rescope to manual sends):

- [ ] VM-018a: Automated reminder system (needs background job/scheduler infrastructure)
- [ ] VM-018b: 7-day, 3-day, 1-day reminder schedule
- [ ] VM-018c: Core Group notification on meeting creation

---

## Calendar Integration (Should Have: VM-019)

- [ ] VM-019a: DEFERRED: Calendar event creation — Depends on calendar integration infrastructure
- [ ] VM-019b: DEFERRED: Google Calendar / Outlook integration

---

## Nice to Have (Future)

- [ ] VM-021: Digital check-in (QR code or tablet-based)
- [ ] VM-022: Recurring meeting scheduling
- [ ] VM-023: Virtual/hybrid meeting support
- [ ] VM-024: SMS confirmation to invited guests
- [ ] VM-025: AI-based attendance predictions

---

## Remaining Work Classification

### True TODOs (Unblocked, F3 Scope)

- [ ] VM-010k: Type filter UI on the analytics view
- [ ] VM-016c: Evaluation comparison to previous meetings
- [ ] VM-020a/b: Follow-up completion tracking display (F5 exists — unblocked)
- [ ] VM-013a-d: Agenda builder
- [ ] VM-014a-c: Response card capture
- [ ] VM-S02i: Remove legacy vision-meetings validation file

### Pending Decisions

- [ ] VM-027a: Team-roster guest list auto-population vs. current batch-attendance model
- [ ] VM-011k: Invited-by tracking (drop the orphaned invitations code, or re-add the feature to the FRD)
- [ ] AC 3 / AC 7 canon: system-derived attendance type and all-attendees/now+48h follow-up vs. FRD wording
- [ ] VM-018a-c: Automated reminders (needs scheduler infrastructure or rescope to manual sends)

### Deferred TODOs (Blocked by Dependencies)

- [ ] VM-019a/b: Calendar integration (depends on calendar infrastructure)

---

## Memory Updates Required

- [x] Update `memory/contracts/db.md` with unified meetings schema
- [x] Update `memory/entrypoints.md` with meetings routes and actions
- [ ] Update `memory/invariants.md` if new cross-feature invariants emerge

---

## Testing Checkpoints

After each phase, verify:
- [x] TypeScript compiles without errors (`pnpm tsc --noEmit`)
- [ ] Linter passes (`pnpm lint`)
- [ ] Database migrations run successfully
- [ ] UI renders correctly at each route
- [ ] Server actions work with proper auth and tenant scoping
- [ ] All queries enforce `church_id` scoping
