import { eventBus } from "@/lib/events/event-bus";

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event payload for team.member.assigned
 */
export interface TeamMemberAssignedEvent {
  type: "team.member.assigned";
  teamId: string;
  personId: string;
  roleId: string;
  churchId: string;
  timestamp: Date;
  triggeredBy: string;
}

/**
 * Event payload for team.leader.assigned
 * Emitted when a person is assigned as team leader or assigned to a leadership role.
 */
export interface TeamLeaderAssignedEvent {
  type: "team.leader.assigned";
  teamId: string;
  personId: string;
  churchId: string;
  timestamp: Date;
  triggeredBy: string;
}

/**
 * Event payload for team.staffing.changed
 */
export interface TeamStaffingChangedEvent {
  type: "team.staffing.changed";
  teamId: string;
  filledCount: number;
  totalCount: number;
  churchId: string;
  timestamp: Date;
  triggeredBy: string;
}

/**
 * Event payload for training.scheduled
 */
export interface TrainingScheduledEvent {
  type: "training.scheduled";
  teamId: string;
  personIds: string[];
  trainingType: string;
  datetime: Date;
  churchId: string;
  timestamp: Date;
  triggeredBy: string;
}

// ============================================================================
// Event Emission
// ============================================================================

/**
 * Emit an event when a member is assigned to a team role.
 * F2 (People/CRM) subscribes to auto-advance person status (core_group -> launch_team).
 */
export async function emitTeamMemberAssigned(
  teamId: string,
  personId: string,
  roleId: string,
  churchId: string,
  triggeredBy: string
): Promise<void> {
  await eventBus.emit<TeamMemberAssignedEvent>({
    type: "team.member.assigned",
    teamId,
    personId,
    roleId,
    churchId,
    timestamp: new Date(),
    triggeredBy,
  });
}

/**
 * Emit an event when a person is assigned as team leader or to a leadership role.
 * F2 (People/CRM) subscribes to auto-advance person status (launch_team -> leader).
 */
export async function emitTeamLeaderAssigned(
  teamId: string,
  personId: string,
  churchId: string,
  triggeredBy: string
): Promise<void> {
  await eventBus.emit<TeamLeaderAssignedEvent>({
    type: "team.leader.assigned",
    teamId,
    personId,
    churchId,
    timestamp: new Date(),
    triggeredBy,
  });
}

/**
 * Emit an event when team staffing changes (role added/removed/filled).
 * Dashboard (F4) subscribes to update readiness metrics.
 */
export async function emitTeamStaffingChanged(
  teamId: string,
  filledCount: number,
  totalCount: number,
  churchId: string,
  triggeredBy: string
): Promise<void> {
  await eventBus.emit<TeamStaffingChangedEvent>({
    type: "team.staffing.changed",
    teamId,
    filledCount,
    totalCount,
    churchId,
    timestamp: new Date(),
    triggeredBy,
  });
}

/**
 * Emit an event when a training session is scheduled.
 * Task Management (F5) subscribes to create calendar events.
 */
export async function emitTrainingScheduled(
  teamId: string,
  personIds: string[],
  trainingType: string,
  datetime: Date,
  churchId: string,
  triggeredBy: string
): Promise<void> {
  await eventBus.emit<TrainingScheduledEvent>({
    type: "training.scheduled",
    teamId,
    personIds,
    trainingType,
    datetime,
    churchId,
    timestamp: new Date(),
    triggeredBy,
  });
}
