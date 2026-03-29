# Task & Project Management – Implementation Checklist

## Must Have

- [x] T-001: Task creation (title, due date, priority)
  - `src/lib/tasks/service.ts` createTask()
  - `src/app/(dashboard)/tasks/actions.ts` createTaskAction(), quickAddTaskAction()
  - `src/components/tasks/task-form.tsx`, `task-quick-add.tsx`
- [x] T-002: Task list view (filterable, sortable)
  - `src/app/(dashboard)/tasks/page.tsx` with grouped-by-due-date display
  - `src/components/tasks/task-list.tsx` groups: Overdue, Today, This Week, Later, No Date, Completed
  - `src/components/tasks/task-filters.tsx` with status, priority, category filters
- [x] T-003: Task status tracking (Not Started, In Progress, Blocked, Complete)
  - `taskStatuses` enum in `src/db/schema/tasks.ts`
  - `updateTaskStatusAction()` in actions
- [x] T-004: Task assignment to users
  - `assignedToId` FK to users table
  - User selector in task form, auto-assignment for quick-add
- [x] T-005: Due date management with overdue indicators
  - `dueDate` column, overdue detection in task-card.tsx
  - Red styling and alert icon for overdue tasks
  - Summary badge showing overdue count on tasks page
- [x] T-006: Priority levels (Low, Medium, High, Urgent)
  - `taskPriorities` enum with color-coded badges
- [x] T-007: Task categorization (Vision Meeting, Follow-up, etc.)
  - `taskCategories` enum with 10 categories
  - Filter by category in task-filters.tsx
- [x] T-008: Task completion with timestamp
  - `completeTask()` service sets `completedAt` and `completedById`
  - Emits `task.completed` event
  - Checkbox toggle on task cards
- [x] T-009: My Tasks view (filter to assigned tasks)
  - My Tasks / All Tasks toggle in filters
  - Defaults to My Tasks view
- [x] T-010: Related entity linking (Person, Meeting, Team, etc.)
  - `relatedType` enum + `relatedId` UUID on tasks table
  - Deep-link to related entity on task detail page
  - Meeting evaluation tasks link directly to /meetings/[id]/evaluation

## Should Have

- [ ] T-011: Checklist templates (pre-built by phase and category)
- [ ] T-012: Template import with relative dates
- [ ] T-013: GANTT timeline view
- [ ] T-014: Milestone tracking
- [ ] T-015: Task dependencies (prerequisite tasks)
- [ ] T-016: Subtasks/checklists (nested items)
  - Schema supports via `parentTaskId` self-FK (not yet used in UI)
- [ ] T-017: Recurring tasks
  - Schema supports via `isRecurring` + `recurrenceRule` JSONB (not yet used in UI)
- [ ] T-018: Task notifications (due and overdue)
- [ ] T-019: Bulk operations (complete/reschedule multiple)
- [ ] T-020: Phase-triggered templates (prompt on phase change)
- [ ] T-021: Task descriptions (rich text)
  - Plain text descriptions implemented; rich text deferred

## Nice to Have

- [ ] T-022: Calendar sync (Google/Outlook)
- [ ] T-023: Team assignment (to ministry teams)
- [ ] T-024: Time tracking (effort spent)
- [ ] T-025: Task comments (threaded collaboration)
- [ ] T-026: Mobile optimization
- [ ] T-027: Drag-and-drop timeline (adjust dates on GANTT)

## Event Integration

- [x] `meeting.attendance.finalized` -> Auto-create follow-up tasks for new vision meeting attendees (48h due date)
- [x] `meeting.attendance.finalized` -> Auto-create meeting evaluation task for planter (24h due date, links to evaluation page)
- [x] `task.completed` -> Emit event on task completion (for future dashboard integration)
