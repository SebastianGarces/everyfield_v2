// ============================================================================
// Event Type Registry
// ============================================================================
//
// Central type registry for all application events. Each feature defines its
// own event interfaces in its own events.ts file. This file re-exports them
// and provides a union type for type-safe event handling.
// ============================================================================

// F2: People / CRM
export type {
  PersonCreatedEvent,
  PersonStatusChangedEvent,
} from "@/lib/people/events";

// F3: Meetings (unified)
export type {
  MeetingAttendanceRecordedEvent,
  MeetingAttendanceFinalizedEvent,
  MeetingCompletedEvent,
} from "@/lib/meetings/events";

// F8: Ministry Teams
export type {
  TeamMemberAssignedEvent,
  TeamLeaderAssignedEvent,
  TeamStaffingChangedEvent,
  TrainingScheduledEvent,
} from "@/lib/ministry-teams/events";

// ============================================================================
// Union Type
// ============================================================================

import type { PersonCreatedEvent, PersonStatusChangedEvent } from "@/lib/people/events";
import type {
  MeetingAttendanceRecordedEvent,
  MeetingAttendanceFinalizedEvent,
  MeetingCompletedEvent,
} from "@/lib/meetings/events";
import type {
  TeamMemberAssignedEvent,
  TeamLeaderAssignedEvent,
  TeamStaffingChangedEvent,
  TrainingScheduledEvent,
} from "@/lib/ministry-teams/events";

/**
 * Union of all application events.
 * Add new event types here as features grow.
 */
export type AppEvent =
  // F2: People / CRM
  | PersonCreatedEvent
  | PersonStatusChangedEvent
  // F3: Meetings (unified)
  | MeetingAttendanceRecordedEvent
  | MeetingAttendanceFinalizedEvent
  | MeetingCompletedEvent
  // F8: Ministry Teams
  | TeamMemberAssignedEvent
  | TeamLeaderAssignedEvent
  | TeamStaffingChangedEvent
  | TrainingScheduledEvent;
