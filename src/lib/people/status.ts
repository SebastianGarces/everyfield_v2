/**
 * Server-side status service.
 * For client-safe utilities, import from "./status.shared" instead.
 */

import { db } from "@/db";
import {
  personActivities,
  persons,
  type Person,
  type PersonStatus,
} from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { emitPersonStatusChanged } from "./events";
import type { StatusTransition } from "./types";

// Re-export client-safe utilities for convenience (server-side usage)
export {
  getAvailableStatuses,
  getNextStatus,
  handleOutOfOrderProgression,
  isBackwardProgression,
  isForwardProgression,
  STATUS_LABELS,
  validateStatusTransition,
} from "./status.shared";

// Re-export types
export type { StatusTransition } from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Action types that can trigger status warnings
 */
export type StatusAction =
  | "record_interview"
  | "record_commitment"
  | "record_assessment"
  | "manual_status_change";

/**
 * Warning for a specific action
 */
export interface StatusWarning {
  action: StatusAction;
  message: string;
  severity: "info" | "warning";
}

// ============================================================================
// Server-side Status Functions
// ============================================================================

// Import shared utilities for internal use
import { validateStatusTransition as _validateStatusTransition } from "./status.shared";

/**
 * Status order for index calculations (server-side only)
 */
const STATUS_ORDER: PersonStatus[] = [
  "prospect",
  "attendee",
  "following_up",
  "interviewed",
  "committed",
  "core_group",
  "launch_team",
  "leader",
];

function getStatusIndex(status: PersonStatus): number {
  return STATUS_ORDER.indexOf(status);
}

/**
 * Get warnings for a specific action based on person's current state.
 * These are soft warnings that don't block the action.
 */
export function getStatusWarnings(
  person: Person,
  action: StatusAction
): StatusWarning[] {
  const warnings: StatusWarning[] = [];
  const currentIndex = getStatusIndex(person.status);

  switch (action) {
    case "record_interview":
      // Warn if person hasn't attended a Vision Meeting (not yet attendee)
      if (currentIndex < getStatusIndex("attendee")) {
        warnings.push({
          action,
          message:
            "This person hasn't attended a Vision Meeting yet. You can still record the interview, but typically interviews happen after attendance.",
          severity: "warning",
        });
      }
      break;

    case "record_commitment":
      // Warn if person hasn't been interviewed
      if (currentIndex < getStatusIndex("interviewed")) {
        warnings.push({
          action,
          message:
            "This person hasn't been interviewed yet. You can still record the commitment, but typically commitments happen after interviews.",
          severity: "warning",
        });
      }
      break;

    case "record_assessment":
      // Warn if person isn't core_group or higher
      if (currentIndex < getStatusIndex("core_group")) {
        warnings.push({
          action,
          message:
            "4 C's assessments are typically for Core Group members and above. This person is currently at an earlier stage.",
          severity: "info",
        });
      }
      break;

    case "manual_status_change":
      // General warning for manual changes
      warnings.push({
        action,
        message:
          "Manual status changes bypass the normal progression flow. Consider recording the relevant action instead (interview, commitment, etc.).",
        severity: "info",
      });
      break;
  }

  return warnings;
}

// ============================================================================
// Status Change Operations (Server-side only)
// ============================================================================

/**
 * Change a person's status with proper validation, activity logging, and event emission.
 *
 * @param churchId - The church ID for multi-tenant scoping
 * @param personId - The person to update
 * @param userId - The user performing the action
 * @param newStatus - The target status
 * @param reason - Optional reason for manual override
 * @returns The updated person and transition details
 */
export async function changeStatus(
  churchId: string,
  personId: string,
  userId: string,
  newStatus: PersonStatus,
  reason?: string
): Promise<{ person: Person; transition: StatusTransition }> {
  // Get the existing person
  const existing = await db.query.persons.findFirst({
    where: and(
      eq(persons.churchId, churchId),
      eq(persons.id, personId),
      isNull(persons.deletedAt)
    ),
  });

  if (!existing) {
    throw new Error("Person not found");
  }

  const oldStatus = existing.status;

  // If status hasn't changed, return early
  if (oldStatus === newStatus) {
    return {
      person: existing,
      transition: {
        from: oldStatus,
        to: newStatus,
        warnings: [],
        requiresConfirmation: false,
        skippedStatuses: [],
      },
    };
  }

  // Validate the transition
  const transition = _validateStatusTransition(oldStatus, newStatus, existing);

  // Update the person's status
  const [updated] = await db
    .update(persons)
    .set({
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(persons.churchId, churchId),
        eq(persons.id, personId),
        isNull(persons.deletedAt)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update person status");
  }

  // Build activity metadata
  const metadata: Record<string, unknown> = {
    oldStatus,
    newStatus,
  };

  if (reason) {
    metadata.reason = reason;
  }

  if (transition.skippedStatuses.length > 0) {
    metadata.skippedStatuses = transition.skippedStatuses;
  }

  // Log the activity
  await db.insert(personActivities).values({
    churchId,
    personId,
    activityType: "status_changed",
    metadata,
    performedBy: userId,
  });

  // Emit event (stubbed for now)
  await emitPersonStatusChanged(updated, oldStatus, newStatus);

  return {
    person: updated,
    transition,
  };
}
