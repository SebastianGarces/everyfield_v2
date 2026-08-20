import { db } from "@/db";
import { persons, type PersonStatus } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { eventBus } from "@/lib/events/event-bus";
import { changeStatus } from "./status";
import type { PersonForClient } from "./types";

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
// Event Emission
// ============================================================================

/**
 * Emit an event when a person is created.
 */
export async function emitPersonCreated(
  person: PersonForClient
): Promise<void> {
  await eventBus.emit<PersonCreatedEvent>({
    type: "person.created",
    personId: person.id,
    churchId: person.churchId,
    status: person.status,
    timestamp: new Date(),
  });
}

/**
 * Emit an event when a person's status changes.
 */
export async function emitPersonStatusChanged(
  person: PersonForClient,
  oldStatus: PersonStatus,
  newStatus: PersonStatus
): Promise<void> {
  await eventBus.emit<PersonStatusChangedEvent>({
    type: "person.status.changed",
    personId: person.id,
    churchId: person.churchId,
    oldStatus,
    newStatus,
    timestamp: new Date(),
  });
}

// ============================================================================
// Inbound Event Handlers
// ============================================================================

/**
 * The one auto-advance rule: move a person from exactly `from` to `to`.
 *
 * Any other current status is left unchanged — the person is already further
 * along (or not far enough), and an event must never demote or skip. A missing
 * person is warned about, and a failed advance is swallowed and logged so the
 * emitting flow (attendance, team assignment) never breaks on it.
 *
 * The `reason` is written into the status_changed activity metadata verbatim;
 * `context` only decorates the dev logs.
 */
async function autoAdvanceStatus(options: {
  churchId: string;
  personId: string;
  from: PersonStatus;
  to: PersonStatus;
  reason: string;
  context: string;
}): Promise<void> {
  const { churchId, personId, from, to, reason, context } = options;

  const person = await db.query.persons.findFirst({
    where: and(
      eq(persons.churchId, churchId),
      eq(persons.id, personId),
      isNull(persons.deletedAt)
    ),
  });

  if (!person) {
    console.warn(`[EVENT] ${context}: person ${personId} not found`);
    return;
  }

  if (person.status !== from) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Person ${personId} is "${person.status}", not advancing to ${to} (only ${from} is auto-advanced)`
      );
    }
    return;
  }

  try {
    await changeStatus(churchId, personId, person.createdBy, to, reason);
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Auto-advanced person ${personId} from ${from} to ${to} (${context})`
      );
    }
  } catch (error) {
    console.error(
      `[EVENT] Failed to auto-advance person ${personId} to ${to}:`,
      error
    );
  }
}

/**
 * Handle vision meeting attendance event from F3.
 * Auto-advances person from prospect to attendee when they attend a Vision Meeting.
 */
export async function handleVisionMeetingAttendance(
  personId: string,
  meetingId: string,
  churchId: string
): Promise<void> {
  await autoAdvanceStatus({
    churchId,
    personId,
    from: "prospect",
    to: "attendee",
    reason: "Auto-advanced from vision meeting attendance",
    context: `handleVisionMeetingAttendance (meeting ${meetingId})`,
  });
}

/**
 * Handle team member assignment event from F8.
 * Auto-advances person from core_group to launch_team when assigned to a ministry team.
 */
export async function handleTeamMemberAssigned(
  personId: string,
  teamId: string,
  roleId: string,
  churchId: string
): Promise<void> {
  await autoAdvanceStatus({
    churchId,
    personId,
    from: "core_group",
    to: "launch_team",
    reason: `Auto-advanced from team assignment (team: ${teamId}, role: ${roleId})`,
    context: `handleTeamMemberAssigned (team ${teamId})`,
  });
}

/**
 * Handle team leader assignment event from F8.
 * Auto-advances person from launch_team to leader when assigned as team
 * leader. If the person is at core_group, the team.member.assigned handler
 * advances them to launch_team first, and then this handler to leader.
 */
export async function handleTeamLeaderAssigned(
  personId: string,
  teamId: string,
  churchId: string
): Promise<void> {
  await autoAdvanceStatus({
    churchId,
    personId,
    from: "launch_team",
    to: "leader",
    reason: `Auto-advanced from team leader assignment (team: ${teamId})`,
    context: `handleTeamLeaderAssigned (team ${teamId})`,
  });
}

/**
 * Handle follow-up initiated event.
 * Auto-advances person from attendee to following_up.
 *
 * DEFERRED: Will be implemented when task/follow-up system (F5) is built.
 */
export async function handleFollowUpInitiated(
  personId: string,
  churchId: string,
  _noteId?: string
): Promise<void> {
  console.warn(
    "[DEFERRED] handleFollowUpInitiated called — no subscriber registered yet",
    {
      personId,
      churchId,
    }
  );
}
