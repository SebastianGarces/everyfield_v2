import { db } from "@/db";
import { persons, type Person, type PersonStatus } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { eventBus } from "@/lib/events/event-bus";
import { changeStatus } from "./status";

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
export async function emitPersonCreated(person: Person): Promise<void> {
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
  person: Person,
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
 * Handle vision meeting attendance event from F3.
 * Auto-advances person from prospect to attendee when they attend a Vision Meeting.
 *
 * Only advances if current status is "prospect". Other statuses are left unchanged
 * since the person is already further along the pipeline.
 */
export async function handleVisionMeetingAttendance(
  personId: string,
  meetingId: string,
  churchId: string
): Promise<void> {
  const person = await db.query.persons.findFirst({
    where: and(
      eq(persons.churchId, churchId),
      eq(persons.id, personId),
      isNull(persons.deletedAt)
    ),
  });

  if (!person) {
    console.warn(
      `[EVENT] handleVisionMeetingAttendance: person ${personId} not found`
    );
    return;
  }

  // Only auto-advance prospects to attendee
  if (person.status !== "prospect") {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Person ${personId} is "${person.status}", not advancing (only prospects are auto-advanced)`
      );
    }
    return;
  }

  try {
    await changeStatus(
      churchId,
      personId,
      person.createdBy,
      "attendee",
      "Auto-advanced from vision meeting attendance"
    );
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Auto-advanced person ${personId} from prospect to attendee (meeting ${meetingId})`
      );
    }
  } catch (error) {
    console.error(
      `[EVENT] Failed to auto-advance person ${personId}:`,
      error
    );
  }
}

/**
 * Handle team member assignment event from F8.
 * Auto-advances person from core_group to launch_team when assigned to a ministry team.
 *
 * Only advances if current status is "core_group". Other statuses are left unchanged
 * since the person is either not yet at core_group or already beyond launch_team.
 */
export async function handleTeamMemberAssigned(
  personId: string,
  teamId: string,
  roleId: string,
  churchId: string
): Promise<void> {
  const person = await db.query.persons.findFirst({
    where: and(
      eq(persons.churchId, churchId),
      eq(persons.id, personId),
      isNull(persons.deletedAt)
    ),
  });

  if (!person) {
    console.warn(
      `[EVENT] handleTeamMemberAssigned: person ${personId} not found`
    );
    return;
  }

  // Only auto-advance core_group members to launch_team
  if (person.status !== "core_group") {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Person ${personId} is "${person.status}", not advancing to launch_team (only core_group members are auto-advanced)`
      );
    }
    return;
  }

  try {
    await changeStatus(
      churchId,
      personId,
      person.createdBy,
      "launch_team",
      `Auto-advanced from team assignment (team: ${teamId}, role: ${roleId})`
    );
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Auto-advanced person ${personId} from core_group to launch_team (team ${teamId})`
      );
    }
  } catch (error) {
    console.error(
      `[EVENT] Failed to auto-advance person ${personId} to launch_team:`,
      error
    );
  }
}

/**
 * Handle team leader assignment event from F8.
 * Auto-advances person to leader status when assigned as team leader or
 * assigned to a leadership role.
 *
 * Advances from launch_team to leader. If person is at core_group, they
 * will first be advanced to launch_team by the team.member.assigned handler,
 * and then to leader by this handler.
 */
export async function handleTeamLeaderAssigned(
  personId: string,
  teamId: string,
  churchId: string
): Promise<void> {
  const person = await db.query.persons.findFirst({
    where: and(
      eq(persons.churchId, churchId),
      eq(persons.id, personId),
      isNull(persons.deletedAt)
    ),
  });

  if (!person) {
    console.warn(
      `[EVENT] handleTeamLeaderAssigned: person ${personId} not found`
    );
    return;
  }

  // Only auto-advance launch_team members to leader
  if (person.status !== "launch_team") {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Person ${personId} is "${person.status}", not advancing to leader (only launch_team members are auto-advanced)`
      );
    }
    return;
  }

  try {
    await changeStatus(
      churchId,
      personId,
      person.createdBy,
      "leader",
      `Auto-advanced from team leader assignment (team: ${teamId})`
    );
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[EVENT] Auto-advanced person ${personId} from launch_team to leader (team ${teamId})`
      );
    }
  } catch (error) {
    console.error(
      `[EVENT] Failed to auto-advance person ${personId} to leader:`,
      error
    );
  }
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
  console.warn("[DEFERRED] handleFollowUpInitiated called — no subscriber registered yet", {
    personId,
    churchId,
  });
}
