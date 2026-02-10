# Meetings – Implementation Checklist

## Phase 1: Foundation (Schema & Types)

### Database Schema
- [x] VM-S01a: Create `src/db/schema/vision-meetings.ts` with all tables
- [x] VM-S01b: Define enums (`meetingStatuses`, `attendanceTypes`, `responseStatuses`, `invitationStatuses`, `checklistCategories`)
- [x] VM-S01c: Create `locations` table (id, church_id, name, address, contact fields, cost, capacity, notes, is_active, timestamps)
- [x] VM-S01d: Create `visionMeetings` table (id, church_id, meeting_number, datetime, location_id, location_name, location_address, estimated/actual_attendance, status, notes, agenda, created_by, timestamps)
- [x] VM-S01e: Create `visionMeetingAttendance` table (id, church_id, meeting_id, person_id, attendance_type, invited_by_id, response_status, notes, timestamps)
- [x] VM-S01f: Add unique constraint on `(meeting_id, person_id)` for attendance
- [x] VM-S01g: Create `invitations` table (id, church_id, meeting_id, inviter_id, invitee_name, invitee_id, status, timestamps)
- [x] VM-S01h: Create `meetingEvaluations` table (id, church_id, meeting_id, 8 score fields, total_score, notes, evaluated_by, timestamps)
- [x] VM-S01i: Create `meetingChecklistItems` table (id, church_id, meeting_id, item_name, category, is_checked, notes, assigned_to, timestamps)
- [x] VM-S01j: Add indexes on `church_id`, `meeting_id`, `person_id` columns
- [x] VM-S01k: Export all tables from `src/db/schema/index.ts`
- [x] VM-S01l: Generate and run migration

### Validation Schemas
- [x] VM-S02a: Create `src/lib/validations/vision-meetings.ts`
- [x] VM-S02b: Create `meetingCreateSchema` (datetime, location_id or location_name/address, estimated_attendance, notes)
- [x] VM-S02c: Create `meetingUpdateSchema` (partial of create + status)
- [x] VM-S02d: Create `locationCreateSchema` (name, address, contact fields, cost, capacity, notes)
- [x] VM-S02e: Create `locationUpdateSchema` (partial of create)
- [x] VM-S02f: Create `attendanceCreateSchema` (person_id, attendance_type, invited_by_id, response_status, notes)
- [x] VM-S02g: Create `evaluationCreateSchema` (8 score fields, notes)
- [x] VM-S02h: Create `invitationCreateSchema` (inviter_id, invitee_name/id, status)

### Types
- [x] VM-S03a: Create `src/lib/vision-meetings/types.ts`
- [x] VM-S03b: Export Drizzle inferred types (`VisionMeeting`, `NewVisionMeeting`, `Location`, etc.)
- [x] VM-S03c: Define `ListMeetingsOptions` (status filter, pagination)
- [x] VM-S03d: Define `MeetingWithCounts` (meeting + attendance counts)

---

## Phase 2: Core Service Layer

### Meeting Service
- [x] VM-001a: Create `src/lib/vision-meetings/service.ts`
- [x] VM-001b: Implement `getNextMeetingNumber(churchId)` — MAX + 1 per church
- [x] VM-001c: Implement `createMeeting(churchId, userId, data)` — Auto-assigns meeting_number
- [x] VM-001d: Implement `getMeeting(churchId, meetingId)` — With attendance counts
- [x] VM-001e: Implement `updateMeeting(churchId, meetingId, data)`
- [x] VM-001f: Implement `deleteMeeting(churchId, meetingId)`
- [x] VM-001g: Implement `listMeetings(churchId, options)` — Filter by status (upcoming/past/all), pagination
- [x] VM-001h: Implement `updateMeetingStatus(churchId, meetingId, newStatus)`

### Location Service
- [x] VM-009a: Create `src/lib/vision-meetings/locations.ts`
- [x] VM-009b: Implement `createLocation(churchId, data)`
- [x] VM-009c: Implement `listLocations(churchId)` — Active locations only
- [x] VM-009d: Implement `getLocation(churchId, locationId)`
- [x] VM-009e: Implement `updateLocation(churchId, locationId, data)`
- [x] VM-009f: Implement `deactivateLocation(churchId, locationId)` — Set is_active = false

### Event Definitions
- [x] VM-007a: Create `src/lib/vision-meetings/events.ts`
- [x] VM-007b: Define `MeetingAttendanceRecordedEvent` interface
- [x] VM-007c: Define `MeetingAttendanceFinalizedEvent` interface
- [x] VM-007d: Define `MeetingCompletedEvent` interface
- [x] VM-007e: Implement `emitAttendanceRecorded()` — Console stub
- [x] VM-007f: Implement `emitAttendanceFinalized()` — Console stub
- [x] VM-007g: Implement `emitMeetingCompleted()` — Console stub

### Server Actions
- [x] VM-001i: Create `src/app/(dashboard)/vision-meetings/actions.ts`
- [x] VM-001j: Implement `createMeetingAction(formData)` — verifySession, validate, call service, revalidatePath
- [x] VM-001k: Implement `updateMeetingAction(formData)`
- [x] VM-001l: Implement `deleteMeetingAction(meetingId)`
- [x] VM-009g: Implement `createLocationAction(formData)`
- [x] VM-009h: Implement `updateLocationAction(formData)`

---

## Phase 3: Meeting List & Creation (VM-001, VM-002)

### Meeting List Page
- [x] VM-002a: Create `src/app/(dashboard)/vision-meetings/page.tsx` — Server component
- [x] VM-002b: Fetch meetings with `listMeetings()`, split into upcoming/past
- [x] VM-002c: Create `src/components/vision-meetings/meeting-list.tsx` — Upcoming/Past sections
- [x] VM-002d: Create `src/components/vision-meetings/meeting-card.tsx` — Date, number, location, status badge, attendance summary
- [x] VM-002e: Implement Upcoming/Past/All view toggle
- [x] VM-002f: Empty state for no meetings

### Schedule Meeting
- [x] VM-001m: Create `src/app/(dashboard)/vision-meetings/new/page.tsx`
- [x] VM-001n: Create `src/components/vision-meetings/meeting-form.tsx` — Date/time, location, estimated attendance, notes
- [x] VM-001o: Create `src/components/vision-meetings/location-picker.tsx` — Select saved or add new inline
- [x] VM-001p: Integrate server action for form submission
- [x] VM-001q: Redirect to meeting detail after creation

### Navigation
- [x] VM-NAV: Enable Vision Meetings nav item (remove `isDisabled: true` from `src/lib/navigation.ts`)

---

## Phase 4: Meeting Detail View (VM-008)

### Detail Layout
- [x] VM-008a: Create `src/app/(dashboard)/vision-meetings/[id]/layout.tsx` — Fetch meeting, render header + tabs + children
- [x] VM-008b: Create `src/components/vision-meetings/meeting-header.tsx` — Number, date, location, countdown/days-ago, status badge
- [x] VM-008c: Create `src/components/vision-meetings/meeting-tabs.tsx` — Link-based tabs, context-aware (planning vs completed)

### Details Tab
- [x] VM-008d: Create `src/app/(dashboard)/vision-meetings/[id]/page.tsx` — Meeting info display
- [x] VM-008e: Display meeting date/time, location, estimated attendance, notes
- [x] VM-008f: Status transition buttons (planning -> ready -> in_progress -> completed)

### Edit Support
- [x] VM-008g: Create `src/components/vision-meetings/meeting-edit-dialog.tsx` — Dialog wrapper around MeetingForm
- [x] VM-008h: Edit action from detail page header

---

## Phase 5: Attendance Capture (VM-003, VM-004, VM-005, VM-006, VM-007)

### Attendance Service
- [x] VM-003a: Add `addAttendee(churchId, meetingId, data)` to service
- [x] VM-003b: Add `removeAttendee(churchId, meetingId, personId)` to service
- [x] VM-003c: Add `listAttendees(churchId, meetingId)` — With Person details joined
- [x] VM-003d: Add `getAttendanceSummary(churchId, meetingId)` — Counts by type
- [x] VM-003e: Add `finalizeAttendance(churchId, meetingId, userId)` — Atomic: set actual_attendance, emit events

### Server Actions
- [x] VM-003f: Add `addAttendeeAction(formData)` — Add existing person as attendee
- [x] VM-005a: Add `quickAddAttendeeAction(formData)` — Create Person + add as attendee in one action
- [x] VM-003g: Add `removeAttendeeAction(meetingId, personId)`
- [x] VM-007h: Add `finalizeAttendanceAction(meetingId)` — Triggers event emission

### Attendance Page
- [x] VM-003h: Create `src/app/(dashboard)/vision-meetings/[id]/attendance/page.tsx` — Server component

### Attendance Components
- [x] VM-003i: Create `src/components/vision-meetings/attendance-capture.tsx` — Main screen with search, list, counters
- [x] VM-005b: Create `src/components/vision-meetings/attendee-quick-add.tsx` — Inline form (name, email, phone, invited-by)
- [x] VM-003j: Create `src/components/vision-meetings/attendee-row.tsx` — Name, type badge, invited-by, remove button
- [x] VM-004a: Display new vs returning counters in attendance header

### Person Search Integration
- [x] VM-005c: Reuse Person search from F2 for "Search existing contacts"
- [x] VM-006a: Person picker for "Invited by" field (Core Group members)

### Attendance Finalization
- [x] VM-007i: Finalize button on attendance screen
- [x] VM-007j: Emit `meeting.attendance.recorded` per attendee on finalize
- [x] VM-007k: Emit `meeting.attendance.finalized` with new attendee IDs on finalize
- [x] VM-007l: Update meeting `actual_attendance` count on finalize

---

## Phase 6: Basic Analytics (VM-010)

### Analytics Service
- [x] VM-010a: Create `src/lib/vision-meetings/analytics.ts`
- [x] VM-010b: Implement `getAttendanceTrend(churchId, limit?)` — Attendance counts per meeting over time
- [x] VM-010c: Implement `getNewVsReturning(churchId, limit?)` — Stacked breakdown per meeting
- [x] VM-010d: Implement `getMeetingSummaryStats(churchId)` — Total meetings, avg attendance, growth %

### Analytics Page
- [x] VM-010e: Create analytics page (either per-meeting or aggregate view)
- [x] VM-010f: Create `src/components/vision-meetings/analytics-charts.tsx` — Client component
- [x] VM-010g: Attendance trend line chart
- [x] VM-010h: New vs returning stacked bar chart
- [x] VM-010i: Summary stat cards (total meetings, avg attendance)

### Dependencies
- [x] VM-010j: Install charting library (`pnpm add recharts`)

---

## Phase 7: Meeting Evaluation (Should Have: VM-015, VM-016)

### Evaluation Service
- [x] VM-015a: Add `createEvaluation(churchId, meetingId, userId, data)` to service
- [x] VM-015b: Add `getEvaluation(churchId, meetingId)` to service
- [x] VM-016a: Add `getEvaluationTrend(churchId, limit?)` to analytics — Score trends over time

### Server Actions
- [x] VM-015c: Add `createEvaluationAction(formData)`

### Evaluation Tab
- [x] VM-015d: Add Evaluation tab to completed meeting detail tabs
- [x] VM-015e: Create evaluation page route

### Evaluation Components
- [x] VM-015f: Create `src/components/vision-meetings/evaluation-form.tsx` — 8 quality factor rating inputs (1-5), notes, auto-calculated total
- [x] VM-016b: Create `src/components/vision-meetings/evaluation-summary.tsx` — Radar chart, comparison to previous, total score display

---

## Phase 8: Materials Checklist (Should Have: VM-012)

### Checklist Service
- [x] VM-012a: Add `populateChecklist(churchId, meetingId)` to service — Seed items from kit template
- [x] VM-012b: Add `getChecklist(churchId, meetingId)` to service
- [x] VM-012c: Add `updateChecklistItem(churchId, itemId, data)` to service — Toggle, notes, assign
- [x] VM-012d: Add `getChecklistSummary(churchId, meetingId)` — Checked/total counts

### Kit Template
- [x] VM-012e: Create `src/lib/vision-meetings/kit-template.ts` — 18 default items with name and category

### Server Actions
- [x] VM-012f: Add `toggleChecklistItemAction(itemId)`
- [x] VM-012g: Add `updateChecklistItemAction(formData)`

### Checklist Tab
- [x] VM-012h: Add Logistics tab to planning mode meeting detail tabs
- [x] VM-012i: Create logistics page route

### Checklist Components
- [x] VM-012j: Create `src/components/vision-meetings/materials-checklist.tsx` — Grouped by category, checkboxes, notes, assign-to, progress indicator

### Auto-Population
- [x] VM-012k: Call `populateChecklist()` in `createMeeting()` flow

---

## Phase 9: Invitation Tracking (Should Have: VM-011, VM-017)

### Invitation Service
- [x] VM-011a: Create `src/lib/vision-meetings/invitations.ts`
- [x] VM-011b: Implement `createInvitation(churchId, meetingId, data)`
- [x] VM-011c: Implement `listInvitations(churchId, meetingId)`
- [x] VM-011d: Implement `updateInvitationStatus(churchId, invitationId, status)`
- [x] VM-017a: Implement `getInvitationLeaderboard(churchId, meetingId)` — Per-member invitation counts
- [x] VM-011e: Implement `getInvitationSummary(churchId, meetingId)` — Totals by status

### Server Actions
- [x] VM-011f: Add `createInvitationAction(formData)`
- [x] VM-011g: Add `updateInvitationStatusAction(formData)`

### Invitation Tab
- [x] VM-011h: Add Invitations tab to planning mode meeting detail tabs
- [x] VM-011i: Create invitations page route

### Invitation Components
- [x] VM-011j: Create `src/components/vision-meetings/invitation-tracker.tsx` — Member list, add invitation, status dropdowns, summary
- [x] VM-017b: Create `src/components/vision-meetings/invitation-leaderboard.tsx` — Ranked list, target indicator, below-target warning

---

## Phase 10: Integration & Events

### F2 Integration (People/CRM)
- [x] VM-INT-01: Wire `meeting.attendance.recorded` event emission in `finalizeAttendance()`
- [x] VM-INT-02: Update F2's `handleVisionMeetingAttendance()` in `src/lib/people/events.ts` — Remove throw, implement Prospect -> Attendee progression
- [x] VM-INT-03: Verify Person record creation from quick-add flows correctly

### F5 Integration (Task Management — Deferred)
- [x] VM-INT-04: DEFERRED: `meeting.attendance.finalized` event emitted but no subscriber until F5 is built
- [ ] VM-INT-05: DEFERRED: Follow-up task creation (48-hour deadline) — Stub event, implement when F5 exists

### F4 Integration (Dashboard — Deferred)
- [x] VM-INT-06: DEFERRED: `meeting.completed` event emitted but no subscriber until F4 is built
- [x] VM-INT-07: DEFERRED: Metrics query functions available in `analytics.ts` for F4 consumption

### Privacy Settings
- [x] VM-INT-08: Ensure Vision Meeting data respects `share_vision_meetings` privacy toggle for oversight users

---

## Follow-Up Completion Tracking (Should Have: VM-020)

- [ ] VM-020a: DEFERRED: Display follow-up completion percentage on meeting detail — Depends on F5 task data
- [ ] VM-020b: DEFERRED: Query F5 tasks linked to meeting for completion % calculation

---

## Agenda Builder (Should Have: VM-013)

- [ ] VM-013a: Display structured agenda on meeting detail (stored as JSON)
- [ ] VM-013b: Create `src/components/vision-meetings/agenda-builder.tsx` — Section editor with timing
- [ ] VM-013c: Default template with 6 sections (Welcome, Worship, Vision, Q&A, Response, Fellowship)
- [ ] VM-013d: Add agenda editing to meeting form or detail page

---

## Response Card Capture (Should Have: VM-014)

- [ ] VM-014a: Add `response_status` field to attendance capture form
- [ ] VM-014b: Display response card summary on meeting outcomes (Outcomes tab)
- [ ] VM-014c: Create `src/components/vision-meetings/response-summary.tsx` — Breakdown by response type

---

## Meeting Reminders (Should Have: VM-018)

- [ ] VM-018a: DEFERRED: Automated reminder system — Depends on Communication Hub (F9) or background job infrastructure
- [ ] VM-018b: DEFERRED: 7-day, 3-day, 1-day reminder schedule
- [ ] VM-018c: DEFERRED: Core Group notification on meeting creation

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

All Phase 1-9 items are unblocked and can be implemented in order.

### Deferred TODOs (Blocked by Dependencies)

- [ ] VM-INT-02: F2 event handler activation (can be done when F3 attendance is built)
- [ ] VM-INT-04/05: Follow-up task creation (depends on F5)
- [ ] VM-INT-06/07: Dashboard metrics consumption (depends on F4)
- [ ] VM-020a/b: Follow-up completion tracking display (depends on F5)
- [ ] VM-018a/b/c: Meeting reminders (depends on F9 or job infrastructure)
- [ ] VM-019a/b: Calendar integration (depends on calendar infrastructure)

---

## Memory Updates Required

- [x] Update `memory/contracts/db.md` with Vision Meeting schema
- [x] Update `memory/entrypoints.md` with vision-meetings routes and actions (after Phase 3)
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
