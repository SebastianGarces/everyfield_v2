// ============================================================================
// How a communication's status is shown
// ============================================================================
//
// One map per concern, keyed by the status union itself, so a new status is a
// COMPILE error here instead of a raw lowercase token leaking into a badge.
// That is exactly how `logged` (COM-020) reached the UI: three pages and the
// history filter each carried their own partial copy of these maps, and a
// logged contact rendered as a blue "sent" pill on every one of them.
//
// Keep this module free of `@/db` — the history filter is a client component.
// ============================================================================

import type {
  CommunicationStatus,
  RecipientStatus,
} from "@/db/schema/communication";

/** Sentence-case labels. Never render `communications.status` raw. */
export const COMMUNICATION_STATUS_LABELS: Record<CommunicationStatus, string> =
  {
    draft: "Draft",
    scheduled: "Scheduled",
    sending: "Sending",
    sent: "Sent",
    failed: "Failed",
    // COM-020: recorded, not delivered. Grey, and never the word "Sent".
    logged: "Logged",
  };

/** Badge tint per status. `logged` is deliberately neutral, like `draft`. */
export const COMMUNICATION_STATUS_BADGE_CLASSES: Record<
  CommunicationStatus,
  string
> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-yellow-100 text-yellow-700",
  sending: "bg-blue-100 text-blue-700",
  sent: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  logged: "bg-gray-100 text-gray-700",
};

/**
 * What a logged entry says on the surfaces that show one row per contact.
 * The badge alone reads as jargon; this line is the honest part.
 */
export const LOGGED_ENTRY_NOTE =
  "Logged from a completed task. No email was sent.";

/** Label for a status that may have arrived from an older row. */
export function communicationStatusLabel(status: string): string {
  return COMMUNICATION_STATUS_LABELS[status as CommunicationStatus] ?? status;
}

/** Badge classes for a status that may have arrived from an older row. */
export function communicationStatusBadgeClass(status: string): string {
  return (
    COMMUNICATION_STATUS_BADGE_CLASSES[status as CommunicationStatus] ?? ""
  );
}

// ---------------------------------------------------------------------------
// Recipient status — `communication_recipients.status`
// ---------------------------------------------------------------------------
//
// The same rule for the OTHER status column. The message detail page carried
// a private copy of this map (and the meetings guest list still carries a
// partial one), which is exactly how `logged` once leaked as a raw token —
// keyed by the union, a new recipient status is a compile error here instead.

/** Sentence-case labels. Never render `communication_recipients.status` raw. */
export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: "Pending",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  bounced: "Bounced",
  failed: "Failed",
};

/** Badge tint per recipient status. */
export const RECIPIENT_STATUS_BADGE_CLASSES: Record<RecipientStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  delivered: "bg-green-100 text-green-700",
  opened: "bg-emerald-100 text-emerald-700",
  clicked: "bg-teal-100 text-teal-700",
  bounced: "bg-red-100 text-red-700",
  failed: "bg-red-100 text-red-700",
};

/**
 * Label for a status that may have arrived from an older row. Falls back to
 * "Pending" — the neutral state — matching the detail page's previous
 * behaviour for an unknown value.
 */
export function recipientStatusLabel(status: string): string {
  return (
    RECIPIENT_STATUS_LABELS[status as RecipientStatus] ??
    RECIPIENT_STATUS_LABELS.pending
  );
}

/** Badge classes for a status that may have arrived from an older row. */
export function recipientStatusBadgeClass(status: string): string {
  return (
    RECIPIENT_STATUS_BADGE_CLASSES[status as RecipientStatus] ??
    RECIPIENT_STATUS_BADGE_CLASSES.pending
  );
}
