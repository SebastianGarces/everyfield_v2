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

// Handlers owned by F5 (Task Management)
import {
  handleMeetingAttendanceFinalized,
  autoCompleteTasksByEvent,
} from "@/lib/tasks/events";

// Handlers owned by F7 (Communication Hub)
import { handleTaskCompletedForCommunicationLog } from "@/lib/communication/log";

// Handlers owned by PE (Phase Engine / Plant Intelligence)
import { handleMaterialEvent } from "@/lib/phase-engine/dirty-handler";

// Handlers owned by F11 (Notifications)
import { handlePhaseChangedForOversight } from "@/lib/notifications/oversight-events";

// Event types from producers
import type {
  MeetingAttendanceRecordedEvent,
  MeetingAttendanceFinalizedEvent,
  MeetingEvaluationCompletedEvent,
} from "@/lib/meetings/events";
import type {
  TeamMemberAssignedEvent,
  TeamLeaderAssignedEvent,
} from "@/lib/ministry-teams/events";
import type { PersonCreatedEvent } from "@/lib/people/events";
import type { PhaseChangedEvent } from "@/lib/phase-engine/events";
import type { TaskCompletedEvent } from "@/lib/tasks/events";

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
  bus.on<TeamMemberAssignedEvent>("team.member.assigned", async (event) => {
    await handleTeamMemberAssigned(
      event.personId,
      event.teamId,
      event.roleId,
      event.churchId
    );
  });

  // When a person is assigned as team leader or to a leadership role,
  // auto-advance from launch_team to leader.
  bus.on<TeamLeaderAssignedEvent>("team.leader.assigned", async (event) => {
    await handleTeamLeaderAssigned(
      event.personId,
      event.teamId,
      event.churchId
    );
  });

  // --------------------------------------------------------------------------
  // F3 (Meetings) -> F5 (Task Management)
  // --------------------------------------------------------------------------

  // When attendance is finalized for a vision meeting, create follow-up tasks
  // for all attendees (48h due) and a meeting evaluation task (24h due).
  bus.on<MeetingAttendanceFinalizedEvent>(
    "meeting.attendance.finalized",
    async (event) => {
      await handleMeetingAttendanceFinalized(
        event.meetingId,
        event.meetingType,
        event.churchId,
        event.attendeeIds
      );
    }
  );

  // --------------------------------------------------------------------------
  // F3 (Meetings) -> F5 (Task Management) — Auto-completion
  // --------------------------------------------------------------------------

  // When a meeting evaluation is submitted, auto-complete the corresponding
  // evaluation task (matched by completion_event + related_id).
  bus.on<MeetingEvaluationCompletedEvent>(
    "meeting.evaluation.completed",
    async (event) => {
      await autoCompleteTasksByEvent(
        "meeting.evaluation.completed",
        event.meetingId,
        event.churchId
      );
    }
  );

  // --------------------------------------------------------------------------
  // Material events -> PE (Phase Engine / Plant Intelligence) — dirty marking
  // --------------------------------------------------------------------------

  // A "material" event meaningfully changes a plant's state, so its latest
  // assessment may be out of date. Each of these stamps
  // churches.last_material_event_at = now for the affected church, marking the
  // plant "dirty" for re-assessment (PE-010). The handler is tenant-scoped and
  // best-effort — it only ever touches the event's own churchId and never
  // throws back into the originating flow.
  bus.on<MeetingAttendanceFinalizedEvent>(
    "meeting.attendance.finalized",
    handleMaterialEvent
  );
  bus.on<TeamMemberAssignedEvent>("team.member.assigned", handleMaterialEvent);
  bus.on<PersonCreatedEvent>("person.created", handleMaterialEvent);
  bus.on<TaskCompletedEvent>("task.completed", handleMaterialEvent);

  // --------------------------------------------------------------------------
  // PE (Phase Engine) -> F11 (Notifications) — the oversight phase milestone
  // --------------------------------------------------------------------------

  // F11 N-025, milestone #2: a plant advancing to a new stage is one of the
  // three events an oversight partner hears about the day it happens.
  //
  // Wired HERE rather than called from `transitions/service.ts`, because the
  // phase engine already publishes this fact and this file is the single place
  // cross-feature wiring lives. The handler is best-effort and never throws
  // back into the transition, and it decides nothing about privacy — `enqueue`
  // is the gate, per recipient, and writes no row for a plant that is not
  // sharing.
  bus.on<PhaseChangedEvent>("phase.changed", handlePhaseChangedForOversight);

  // --------------------------------------------------------------------------
  // F5 (Task Management) -> F7 (Communication Hub) — the task-driven log entry
  // --------------------------------------------------------------------------

  // COM-020: completing a task attached to a PERSON is a record that the
  // planter made contact, so it lands in that person's communication log as an
  // entry with `status = 'logged'` — never as a sent message. The handler
  // decides for itself whether the event is about a person; every other
  // `task.completed` writes nothing.
  //
  // This is the SECOND handler on `task.completed` — `handleMaterialEvent`
  // above marks the plant dirty (PE-010). The bus runs handlers through
  // `Promise.allSettled`, and this one additionally swallows its own failures,
  // so a communication log that cannot be written can never cost the phase
  // engine its dirty mark.
  bus.on<TaskCompletedEvent>(
    "task.completed",
    handleTaskCompletedForCommunicationLog
  );

  // --------------------------------------------------------------------------
  // Future subscriptions (no handlers yet)
  // --------------------------------------------------------------------------

  // person.created -> welcome workflows
  // person.status.changed -> dashboard updates
  // team.staffing.changed -> dashboard readiness metrics
  // training.scheduled -> calendar events, task creation

  bus.markInitialized();
}
