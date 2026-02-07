import type { Person, PersonStatus } from "@/db/schema";

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event payload for person.created
 */
export interface PersonCreatedEvent {
  type: "person.created";
  personId: string;
  churchId: string;
  status: PersonStatus;
  timestamp: Date;
}

/**
 * Event payload for person.status.changed
 */
export interface PersonStatusChangedEvent {
  type: "person.status.changed";
  personId: string;
  churchId: string;
  oldStatus: PersonStatus;
  newStatus: PersonStatus;
  timestamp: Date;
}

// ============================================================================
// Event Emission (Stubs)
// ============================================================================

/**
 * Emit an event when a person is created.
 * Currently stubbed - logs to console in development.
 * Will be replaced with actual event bus when integrated with other features.
 */
export async function emitPersonCreated(person: Person): Promise<void> {
  const event: PersonCreatedEvent = {
    type: "person.created",
    personId: person.id,
    churchId: person.churchId,
    status: person.status,
    timestamp: new Date(),
  };

  // Stub: Log to console in dev
  if (process.env.NODE_ENV === "development") {
    console.log("[EVENT] person.created", event);
  }

  // TODO: Replace with actual event emission when event system is built
  // await eventBus.emit(event);
}

/**
 * Emit an event when a person's status changes.
 * Currently stubbed - logs to console in development.
 * Will be replaced with actual event bus when integrated with other features.
 */
export async function emitPersonStatusChanged(
  person: Person,
  oldStatus: PersonStatus,
  newStatus: PersonStatus
): Promise<void> {
  const event: PersonStatusChangedEvent = {
    type: "person.status.changed",
    personId: person.id,
    churchId: person.churchId,
    oldStatus,
    newStatus,
    timestamp: new Date(),
  };

  // Stub: Log to console in dev
  if (process.env.NODE_ENV === "development") {
    console.log("[EVENT] person.status.changed", event);
  }

  // TODO: Replace with actual event emission when event system is built
  // await eventBus.emit(event);
}

// ============================================================================
// Inbound Event Handlers (Deferred - Depends on F3/F8)
// ============================================================================

/**
 * Handle vision meeting attendance event from F3.
 * Auto-advances person from prospect to attendee.
 *
 * DEFERRED: This handler will be implemented when F3 (Vision Meetings) is built.
 *
 * @throws Error - Not implemented yet
 */
export async function handleVisionMeetingAttendance(
  personId: string,
  meetingId: string,
  churchId: string
): Promise<void> {
  // Log the attempted call for debugging
  console.warn("[DEFERRED] handleVisionMeetingAttendance called", {
    personId,
    meetingId,
    churchId,
  });

  throw new Error(
    "Not implemented - depends on F3 (Vision Meetings). " +
      "Use manual status change until F3 is built."
  );
}

/**
 * Handle team member assignment event from F8.
 * Auto-advances person from core_group to launch_team.
 *
 * DEFERRED: This handler will be implemented when F8 (Ministry Teams) is built.
 *
 * @throws Error - Not implemented yet
 */
export async function handleTeamMemberAssigned(
  personId: string,
  teamId: string,
  role: string,
  churchId: string
): Promise<void> {
  // Log the attempted call for debugging
  console.warn("[DEFERRED] handleTeamMemberAssigned called", {
    personId,
    teamId,
    role,
    churchId,
  });

  throw new Error(
    "Not implemented - depends on F8 (Ministry Teams). " +
      "Use manual status change until F8 is built."
  );
}

/**
 * Handle team leader assignment event from F8.
 * Auto-advances person from launch_team to leader.
 *
 * DEFERRED: This handler will be implemented when F8 (Ministry Teams) is built.
 *
 * @throws Error - Not implemented yet
 */
export async function handleTeamLeaderAssigned(
  personId: string,
  teamId: string,
  churchId: string
): Promise<void> {
  // Log the attempted call for debugging
  console.warn("[DEFERRED] handleTeamLeaderAssigned called", {
    personId,
    teamId,
    churchId,
  });

  throw new Error(
    "Not implemented - depends on F8 (Ministry Teams). " +
      "Use manual status change until F8 is built."
  );
}

/**
 * Handle follow-up initiated event.
 * Auto-advances person from attendee to following_up.
 *
 * This can be triggered when a note with follow-up tag is created.
 *
 * DEFERRED: This handler will be fully implemented when task/follow-up system is built.
 *
 * @throws Error - Not implemented yet
 */
export async function handleFollowUpInitiated(
  personId: string,
  churchId: string,
  _noteId?: string
): Promise<void> {
  // Log the attempted call for debugging
  console.warn("[DEFERRED] handleFollowUpInitiated called", {
    personId,
    churchId,
  });

  throw new Error(
    "Not implemented - depends on follow-up/task system. " +
      "Use manual status change until the feature is built."
  );
}

/**
 * Handle orientation completed event.
 * Auto-advances person from committed to core_group.
 *
 * DEFERRED: This handler will be implemented when orientation tracking is built.
 *
 * @throws Error - Not implemented yet
 */
export async function handleOrientationCompleted(
  personId: string,
  churchId: string
): Promise<void> {
  // Log the attempted call for debugging
  console.warn("[DEFERRED] handleOrientationCompleted called", {
    personId,
    churchId,
  });

  throw new Error(
    "Not implemented - depends on orientation tracking system. " +
      "Use manual status change until the feature is built."
  );
}
