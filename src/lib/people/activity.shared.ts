import { type ActivityType } from "@/db/schema/people";

/**
 * Shared types and pure functions for activity timeline.
 * This file can be safely imported by client components.
 */

export type ActivityWithPerformer = {
  id: string;
  churchId: string;
  personId: string;
  activityType: ActivityType;
  metadata: unknown;
  performedBy: string | null;
  createdAt: Date;
  performer: {
    name: string | null;
    email: string;
  } | null;
};

export interface GetActivitiesOptions {
  limit?: number;
  cursor?: Date;
}

export interface GetActivitiesResult {
  activities: ActivityWithPerformer[];
  nextCursor?: Date;
}

/**
 * Status labels for display
 */
const STATUS_LABELS: Record<string, string> = {
  prospect: "Prospect",
  attendee: "Attendee",
  following_up: "Following Up",
  interviewed: "Interviewed",
  core_group: "Core Group",
  launch_team: "Launch Team",
  leader: "Leader",
};

/**
 * Format a status value into a human-readable label
 */
function formatStatus(status: string): string {
  return STATUS_LABELS[status] || status;
}

/**
 * Check if a status change is backward
 */
export function isStatusChangeBackward(
  metadata: Record<string, unknown> | null
): boolean {
  if (!metadata?.oldStatus || !metadata?.newStatus) return false;

  const statusOrder = [
    "prospect",
    "attendee",
    "following_up",
    "interviewed",
    "core_group",
    "launch_team",
    "leader",
  ];

  const oldIndex = statusOrder.indexOf(metadata.oldStatus as string);
  const newIndex = statusOrder.indexOf(metadata.newStatus as string);

  return oldIndex > newIndex;
}

/**
 * Format an activity into a human-readable message.
 * Pure function - no database access.
 */
export function formatActivityMessage(activity: {
  activityType: ActivityType;
  metadata: unknown;
}): string {
  const metadata = activity.metadata as Record<string, unknown> | null;

  switch (activity.activityType) {
    case "status_changed": {
      const oldStatus = formatStatus(
        (metadata?.oldStatus as string) || "unknown"
      );
      const newStatus = formatStatus(
        (metadata?.newStatus as string) || "unknown"
      );
      const isBackward = isStatusChangeBackward(metadata);
      const source = metadata?.source as string | undefined;

      let message: string;
      if (isBackward) {
        message = `moved backward from ${oldStatus} to ${newStatus}`;
      } else {
        message = `changed status from ${oldStatus} to ${newStatus}`;
      }

      // Add source indicator if it came from profile edit
      if (source === "profile_edit") {
        message += " (via profile edit)";
      }

      return message;
    }
    case "note_added":
      return "added a note";
    case "person_created":
      return "created this person";
    case "person_updated":
      return "updated profile details";
    case "interview_completed":
      return "completed an interview";
    case "assessment_completed":
      return "completed an assessment";
    case "commitment_recorded":
      return "recorded a commitment";
    case "tag_added":
      return `added tag "${metadata?.tagName || "unknown"}"`;
    case "tag_removed":
      return `removed tag "${metadata?.tagName || "unknown"}"`;
    case "skill_added":
      return `added skill "${metadata?.skillName || "unknown"}"`;
    case "skill_updated":
      return `updated skill "${metadata?.skillName || "unknown"}"`;
    case "skill_removed":
      return `removed skill "${metadata?.skillName || "unknown"}"`;
    case "household_created":
      return `created household "${metadata?.householdName || "unknown"}"`;
    case "household_joined":
      return `joined household "${metadata?.householdName || "unknown"}" as ${metadata?.role || "member"}`;
    case "household_left":
      return `left household "${metadata?.householdName || "unknown"}"`;
    case "household_role_changed":
      return `changed household role to ${metadata?.newRole || "unknown"}`;
    default:
      return "performed an action";
  }
}
