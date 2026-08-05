// ============================================================================
// Four real tasks and the meeting that produced them, frozen so the landing
// page can render the app's own task row and meeting card.
//
// Source: Redemption Hill Church, snapshotted read-only on 2026-08-04 via
// `listTasks(churchId, { limit: 12 })` (src/lib/tasks/service.ts),
// `getLatestPersonNote(personId)` (src/lib/people/service.ts) and
// `listMeetings(churchId, { status: "past" })` (src/lib/meetings/service.ts) —
// the same church and the same rows the retired r5-tasks.webp and
// r5-meetcards.webp captures screenshotted. To regenerate, re-run those three
// queries for Redemption Hill and paste the rows back over the constants
// below.
//
// The four are the app's own order (due date ascending, which is how
// `listTasks` sorts by default) and they carry the panel's claim between them:
// two overdue, one due today, one still ahead; urgent, high and medium; a
// vision-meeting task, a follow-up, a promotion task; one row mid-flight
// (`in_progress`) and one carrying the pastoral note the follow-up was created
// with.
//
// Why the meeting is a PAST one. The panel's sentence is "meeting attendance
// creates the follow-up tasks for you, automatically", and Vision Night #4 is
// the meeting those follow-ups came out of: 28 attended, 1 of them new — the
// same two numbers the Plant Intelligence assessment on this page cites as
// `visionMeetings.latestAttendance=28`. Rendered with `isPast`, the card shows
// that attendance instead of a countdown, so nothing on it depends on what day
// you are reading the page.
//
// ---------------------------------------------------------------------------
// The one thing that is NOT frozen: due dates.
//
// `getDueDateInfo` (components/tasks/task-card-view.tsx) turns a due date into
// "1 day overdue" / "Due today" / "Due in 5 days" by reading the clock. Freeze
// the dates and the row keeps its verbatim string for about a week and then
// starts lying — by next spring the landing page would advertise a task 250
// days overdue. So each row stores the OFFSET it had from the day it was
// snapshotted, and the date is rebuilt at render time. The rendered sentence
// is then the same sentence forever, which is the thing worth preserving; the
// absolute dates behind it (2026-08-01, -08-03, -08-04, -08-14) are recorded
// here instead.
//
// Built through the same local-midnight arithmetic `getDueDateInfo` uses, so
// the two agree in any timezone. Server-rendered only — nothing here is ever
// recomputed on the client, so there is no hydration mismatch to have.
//
// This is the same move `snapshot-clock.ts` makes for the fixtures whose
// components render relative *timestamps*, and it is deliberately not that
// helper: `dueDate` is a `date` column, and shifting it by a millisecond
// distance can land it on the far side of a midnight — "3 days overdue"
// becomes "4 days overdue" depending on what time of day the page was built.
// Whole days in, whole days out. If the two ever want one home, `dueDay`
// belongs next to `snapshotClock`.
// ---------------------------------------------------------------------------
//
// import type only: `@/lib/tasks/types` and `@/lib/meetings/types` both
// re-export from `@/db/schema`, and a value import would pull Drizzle into the
// marketing bundle.
// ============================================================================

import type { MeetingWithCounts } from "@/lib/meetings/types";
import type { TaskWithAssignee } from "@/lib/tasks/types";

const CHURCH_ID = "fixture-church";
const USER_ID = "fixture-user";
const LOCATION_ID = "fixture-location";

/** The day the rows below were snapshotted; every offset is counted from it. */
export const SNAPSHOT_DAY = "2026-08-04";

/** `YYYY-MM-DD`, `offset` days from today, built from local date parts because
 *  that is what `getDueDateInfo` compares against. */
function dueDay(offset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

const BLANK = {
  churchId: CHURCH_ID,
  dueTime: null,
  assignedToId: USER_ID,
  relatedId: null,
  parentTaskId: null,
  isRecurring: false,
  recurrenceRule: null,
  completionEvent: null,
  completedAt: null,
  completedById: null,
  createdById: USER_ID,
  deletedAt: null,
  assigneeName: "Daniel Reyes",
  assigneeEmail: "daniel@redemptionhill.org",
} as const;

/**
 * The four rows, in the app's own due-date order.
 *
 * A function rather than a constant so the due dates are rebuilt on every
 * render rather than at module load — see the note above.
 */
export function tasksFixture(): TaskWithAssignee[] {
  return [
    {
      ...BLANK,
      // was 2026-08-01: three days overdue on the day of the snapshot
      id: "fixture-task-1",
      title: "Complete evaluation for Vision Night #4",
      description: null,
      status: "not_started",
      priority: "high",
      dueDate: dueDay(-3),
      category: "vision_meeting",
      relatedType: "meeting",
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
      updatedAt: new Date("2026-07-31T06:28:01.512Z"),
    },
    {
      ...BLANK,
      // was 2026-08-03
      id: "fixture-task-2",
      title: "Follow up with Dana Whitfield",
      description: null,
      status: "not_started",
      priority: "high",
      dueDate: dueDay(-1),
      category: "follow_up",
      relatedType: "person",
      createdAt: new Date("2026-07-31T00:00:00.000Z"),
      updatedAt: new Date("2026-07-31T06:27:56.464Z"),
    },
    {
      ...BLANK,
      // was 2026-08-04, the day of the snapshot
      id: "fixture-task-3",
      title: "Find a location for Vision Night #5",
      description: null,
      status: "not_started",
      priority: "urgent",
      dueDate: dueDay(0),
      category: "vision_meeting",
      relatedType: null,
      createdAt: new Date("2026-07-29T06:27:14.774Z"),
      updatedAt: new Date("2026-07-31T06:28:05.594Z"),
    },
    {
      ...BLANK,
      // was 2026-08-14
      id: "fixture-task-4",
      title: "Website go-live",
      description: null,
      status: "in_progress",
      priority: "medium",
      dueDate: dueDay(10),
      category: "promotion",
      relatedType: null,
      createdAt: new Date("2026-07-22T06:27:14.774Z"),
      updatedAt: new Date("2026-07-31T06:28:05.594Z"),
    },
  ] satisfies TaskWithAssignee[];
}

/** The two the phone composition shows: the follow-up that carries a pastoral
 *  note, and the urgent one due today. Between them they still say what the
 *  four say — a task list that knows what is late, what is urgent, and why the
 *  follow-up exists — and two rows is the most a phone can show at full size. */
export function tasksFixtureCompact(): TaskWithAssignee[] {
  return tasksFixture().slice(1, 3);
}

/** The follow-up note the app prints under a person task, keyed by task id.
 *  Verbatim from `getLatestPersonNote` for Dana Whitfield. */
export const TASK_NOTES: Record<string, string> = {
  "fixture-task-2": "Came back for VN #4 — bring the launch-team ask gently.",
};

/**
 * Vision Night #4 — the meeting the follow-ups above came out of.
 *
 * Frozen whole, including the datetime: rendered with `isPast`, the card
 * prints the absolute date and the attendance and never asks what today is.
 */
export const MEETING_FIXTURE = {
  id: "fixture-meeting",
  churchId: CHURCH_ID,
  type: "vision_meeting",
  title: "Vision Night #4",
  datetime: new Date("2026-07-24T19:00:00.000Z"),
  status: "completed",
  locationId: LOCATION_ID,
  locationName: "The Riveras' home",
  locationAddress: null,
  meetingNumber: 4,
  teamId: null,
  meetingSubtype: null,
  estimatedAttendance: 26,
  actualAttendance: 28,
  durationMinutes: 90,
  notes: null,
  agenda: null,
  createdBy: USER_ID,
  createdAt: new Date("2026-07-31T06:27:56.629Z"),
  updatedAt: new Date("2026-07-25T09:00:00.000Z"),
  totalAttendees: 28,
  newAttendees: 1,
  returningAttendees: 1,
  location: {
    id: LOCATION_ID,
    churchId: CHURCH_ID,
    name: "The Riveras' home",
    address: "1418 Sagebrush Ln, Denton, TX",
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    cost: null,
    capacity: 35,
    notes: null,
    isActive: true,
    createdAt: new Date("2026-07-31T06:27:44.945Z"),
    updatedAt: new Date("2026-07-31T06:27:44.945Z"),
  },
  teamName: null,
} satisfies MeetingWithCounts;

/** The count the app's own Tasks header prints beside this list on the day of
 *  the snapshot: not-started + in-progress + blocked. */
export const ACTIVE_TASK_COUNT = 13;
