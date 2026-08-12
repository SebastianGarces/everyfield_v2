// ============================================================================
// Meeting-type labels — client-safe leaf
// ============================================================================
//
// Keep this module free of runtime `@/db` imports — the compose form is a
// client component, and a value import here would pull schema code into the
// browser bundle. The type-only import below points at the one module that
// owns `MeetingType` and is erased at compile time. Mirrors
// src/lib/communication/status-display.ts.
// ============================================================================

import type { MeetingType } from "@/db/schema/meetings";

/**
 * Sentence-case labels for `meetingTypes` — keyed by the union, so a new
 * meeting type is a compile error here instead of a raw token leaking into
 * the UI. Canonical copy (ruled 2026-08-12, 407-4-1): the communication
 * surfaces read this; the remaining hand-copies consolidate in pass 2 (#411).
 */
export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  vision_meeting: "Vision Meeting",
  orientation: "Orientation",
  team_meeting: "Team Meeting",
};

/** Label for a type that may have arrived from an older row. */
export function meetingTypeLabel(type: string): string {
  return MEETING_TYPE_LABELS[type as MeetingType] ?? type;
}
