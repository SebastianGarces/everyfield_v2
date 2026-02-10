/**
 * Client-safe status utilities.
 * These functions don't require database access and can be used in client components.
 */

import { personStatuses, type Person, type PersonStatus } from "@/db/schema";
import type { StatusTransition } from "./types";

// ============================================================================
// Status Order & Labels
// ============================================================================

/**
 * The ordered progression of statuses.
 * Index represents the progression order (0 = earliest, 6 = latest)
 */
const STATUS_ORDER: PersonStatus[] = [
  "prospect",
  "attendee",
  "following_up",
  "interviewed",
  "core_group",
  "launch_team",
  "leader",
];

/**
 * Human-readable labels for statuses
 */
export const STATUS_LABELS: Record<PersonStatus, string> = {
  prospect: "Prospect",
  attendee: "Attendee",
  following_up: "Following Up",
  interviewed: "Interviewed",
  core_group: "Core Group",
  launch_team: "Launch Team",
  leader: "Leader",
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the index of a status in the progression order
 */
function getStatusIndex(status: PersonStatus): number {
  return STATUS_ORDER.indexOf(status);
}

/**
 * Check if moving from one status to another is moving forward
 */
export function isForwardProgression(
  from: PersonStatus,
  to: PersonStatus
): boolean {
  return getStatusIndex(to) > getStatusIndex(from);
}

/**
 * Check if moving from one status to another is moving backward
 */
export function isBackwardProgression(
  from: PersonStatus,
  to: PersonStatus
): boolean {
  return getStatusIndex(to) < getStatusIndex(from);
}

/**
 * Get all statuses between two statuses (exclusive of both endpoints)
 */
function getStatusesBetween(
  from: PersonStatus,
  to: PersonStatus
): PersonStatus[] {
  const fromIndex = getStatusIndex(from);
  const toIndex = getStatusIndex(to);

  if (toIndex <= fromIndex) {
    return [];
  }

  return STATUS_ORDER.slice(fromIndex + 1, toIndex);
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a status transition and return any warnings.
 * Warnings are soft (non-blocking) - they inform but don't prevent the action.
 */
export function validateStatusTransition(
  from: PersonStatus,
  to: PersonStatus,
  _person: Person
): StatusTransition {
  const warnings: string[] = [];
  let requiresConfirmation = false;

  // Same status - no change needed
  if (from === to) {
    return {
      from,
      to,
      warnings: [],
      requiresConfirmation: false,
      skippedStatuses: [],
    };
  }

  // Calculate skipped statuses for out-of-order progression
  const skippedStatuses = getStatusesBetween(from, to);

  // Forward progression warnings
  if (isForwardProgression(from, to)) {
    // Warn if skipping statuses
    if (skippedStatuses.length > 0) {
      const skippedLabels = skippedStatuses.map((s) => STATUS_LABELS[s]);
      warnings.push(
        `This will skip: ${skippedLabels.join(", ")}. The person hasn't gone through these stages yet.`
      );
      requiresConfirmation = true;
    }

    // Specific warnings for certain transitions
    if (to === "interviewed" && from !== "following_up") {
      warnings.push(
        "This person hasn't attended a Vision Meeting yet. Consider inviting them first."
      );
    }

    if (
      to === "core_group" &&
      getStatusIndex(from) < getStatusIndex("interviewed")
    ) {
      warnings.push(
        "This person hasn't been interviewed yet. Consider conducting an interview first."
      );
    }

    if (
      (to === "launch_team" || to === "leader") &&
      getStatusIndex(from) < getStatusIndex("core_group")
    ) {
      warnings.push(
        "This person hasn't signed a commitment yet. Core Group members typically sign commitment cards."
      );
    }
  }

  // Backward progression warnings
  if (isBackwardProgression(from, to)) {
    warnings.push(
      `Moving backward from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}. This is unusual but allowed.`
    );
    requiresConfirmation = true;
  }

  return {
    from,
    to,
    warnings,
    requiresConfirmation,
    skippedStatuses,
  };
}

/**
 * Get the next logical status in the progression
 */
export function getNextStatus(current: PersonStatus): PersonStatus | null {
  const currentIndex = getStatusIndex(current);
  if (currentIndex >= STATUS_ORDER.length - 1) {
    return null; // Already at the highest status
  }
  return STATUS_ORDER[currentIndex + 1];
}

/**
 * Get all available statuses for manual selection
 */
export function getAvailableStatuses(): Array<{
  value: PersonStatus;
  label: string;
}> {
  return personStatuses.map((status) => ({
    value: status,
    label: STATUS_LABELS[status],
  }));
}

/**
 * Handle out-of-order progression by determining what the target status
 * should be based on the action performed.
 */
export function handleOutOfOrderProgression(
  currentStatus: PersonStatus,
  targetStatus: PersonStatus
): StatusTransition {
  const minimalPerson = { status: currentStatus } as Person;
  return validateStatusTransition(currentStatus, targetStatus, minimalPerson);
}
