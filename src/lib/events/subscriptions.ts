// ============================================================================
// Event Subscriptions
// ============================================================================
//
// This is the SINGLE place where cross-feature event wiring is defined.
// Every subscription maps an event type to a handler owned by the consuming
// feature. No feature service file should ever import from another feature.
//
// To add a new subscription:
// 1. Import the handler from the consuming feature's events.ts
// 2. Import the event type from the producing feature's events.ts
// 3. Register the handler with eventBus.on()
// ============================================================================

// Handlers owned by F2 (People/CRM)
import {
  handleVisionMeetingAttendance,
  handleTeamMemberAssigned,
  handleTeamLeaderAssigned,
} from "@/lib/people/events";

// Event types from producers
import type { MeetingAttendanceRecordedEvent } from "@/lib/meetings/events";
import type {
  TeamMemberAssignedEvent,
  TeamLeaderAssignedEvent,
} from "@/lib/ministry-teams/events";

/**
 * Minimal interface for the event bus, used to avoid importing from event-bus.ts
 * which would create a circular dependency in the Next.js bundler.
 */
interface EventBusLike {
  on<T>(eventType: string, handler: (event: T) => Promise<void>): void;
  isInitialized(): boolean;
  markInitialized(): void;
}

/**
 * Register all cross-feature event subscriptions.
 * Called lazily on first event emission. The bus instance is passed in
 * directly to avoid circular imports.
 */
export function registerSubscriptions(bus: EventBusLike): void {
  // Guard against double-registration (e.g. hot-reload in development)
  if (bus.isInitialized()) return;

  // --------------------------------------------------------------------------
  // F3 (Meetings) -> F2 (People/CRM)
  // --------------------------------------------------------------------------

  // When attendance is recorded at a vision meeting, auto-advance
  // prospects from prospect to attendee. The handler itself guards
  // against non-prospect statuses, so we only need to filter by
  // meeting type here.
  bus.on<MeetingAttendanceRecordedEvent>(
    "meeting.attendance.recorded",
    async (event) => {
      if (event.meetingType === "vision_meeting") {
        await handleVisionMeetingAttendance(
          event.personId,
          event.meetingId,
          event.churchId
        );
      }
    }
  );

  // --------------------------------------------------------------------------
  // F8 (Ministry Teams) -> F2 (People/CRM)
  // --------------------------------------------------------------------------

  // When a member is assigned to a team role, auto-advance from
  // core_group to launch_team.
  bus.on<TeamMemberAssignedEvent>(
    "team.member.assigned",
    async (event) => {
      await handleTeamMemberAssigned(
        event.personId,
        event.teamId,
        event.roleId,
        event.churchId
      );
    }
  );

  // When a person is assigned as team leader or to a leadership role,
  // auto-advance from launch_team to leader.
  bus.on<TeamLeaderAssignedEvent>(
    "team.leader.assigned",
    async (event) => {
      await handleTeamLeaderAssigned(
        event.personId,
        event.teamId,
        event.churchId
      );
    }
  );

  // --------------------------------------------------------------------------
  // Future subscriptions (no handlers yet)
  // --------------------------------------------------------------------------

  // meeting.attendance.finalized -> F5 (Task Management): create follow-up tasks
  // person.created -> welcome workflows
  // person.status.changed -> dashboard updates, trigger follow-up tasks
  // team.staffing.changed -> dashboard readiness metrics
  // training.scheduled -> calendar events, task creation

  bus.markInitialized();
}
