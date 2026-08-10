// ============================================================================
// The resend dedupe window — RULED 2026-08-10 round 2 (Sebastian, on PR #392 /
// #293).
//
// Two things are derived from ONE bucket here, and that is the entire point of
// the file:
//
//   1. the provider's `Idempotency-Key` suffix (`./email` →
//      `invitationEmailIdempotencyKey`), and
//   2. how long the "Resend email" button stays disabled after a successful
//      send, plus the countdown it shows while it is.
//
// The round-1 shape kept the window and left the button live inside it, so a
// second press reported "Email sent" while the provider dropped the message as a
// duplicate — the product claiming a send that never left. The ruling closed it
// by making the button unavailable for the REMAINDER OF THE SAME BUCKET, which
// only works if the two numbers come from one arithmetic. A second copy of
// `Math.floor(t / W)` is how the button re-enables a second before the provider
// will accept a new key, which is exactly the claim the ruling forbids.
//
// IMPORT-FREE BY CONSTRUCTION, exactly like `./register-path` and for the same
// reason. `./email` reaches `@/lib/email/client`, which builds a Resend instance
// at module scope; the pending list is a `"use client"` module and needs this
// math for its countdown, so the math cannot live where the SDK does. Nothing
// below imports anything — keep it that way.
//
// NOT a launch countdown. `daysUntilTarget` (`@/lib/launch/countdown`) is the
// one implementation of "how many DAYS until a calendar date", and this is not
// that number under a second name: it is a sub-minute duration between two
// instants, with no calendar day, no time zone and no target date anywhere in
// it (memory/invariants.md → Hierarchical Access Control).
// ============================================================================

/**
 * How long two resends of one invitation share a dedupe key.
 *
 * This is the answer to "what stops an admin re-sending ten times?" for the only
 * thing that matters — the invitee's inbox. It is NOT a rate limit on the action
 * (nothing is persisted, by the round-1 ruling), it is the window in which a
 * double-clicked button, or a page kept open by two admins, presents the SAME
 * `Idempotency-Key` and the provider delivers once. One minute is long enough to
 * cover a human double-press and short enough that a deliberate second attempt —
 * the admin fixed a misconfigured sender and tried again — is a genuinely new
 * send.
 */
export const RESEND_DEDUPE_WINDOW_MS = 60_000;

/**
 * Which bucket a send fell in, and how much of it is left.
 *
 * `index` is what the key is built from, so two sends that share an index are
 * two sends the provider will collapse into one message. `remainingMs` is how
 * long until the next index opens — the exact span over which a second send
 * would be collapsed, and therefore the exact span the button must refuse.
 */
export interface ResendDedupeWindow {
  /** The bucket number. Plain arithmetic on the clock — never a secret. */
  index: number;
  /** Time until the NEXT bucket opens. Always in `(0, RESEND_DEDUPE_WINDOW_MS]`. */
  remainingMs: number;
}

/** THE bucket. Every other number on this path is derived from this one call. */
export function resendDedupeWindowAt(at: Date): ResendDedupeWindow {
  const ms = at.getTime();
  const index = Math.floor(ms / RESEND_DEDUPE_WINDOW_MS);

  return {
    index,
    // Never zero: a send landing exactly on a boundary opens the bucket it is
    // the first millisecond of, so it owns the whole window rather than a
    // countdown that is over before it renders.
    remainingMs: (index + 1) * RESEND_DEDUPE_WINDOW_MS - ms,
  };
}

/**
 * Whole seconds left on a cooldown, from a DURATION.
 *
 * A duration end to end — no epoch instant crosses to the browser and none is
 * compared there. The server measures how much of its bucket was left; the
 * surface subtracts how long it has been counting. A workstation clock minutes
 * out of step is therefore not a factor at all: nothing on the client is ever
 * asked what time it is on the server.
 *
 * Rounds UP, so the label never says "0s" while the button is still refusing,
 * and reaches 0 exactly when the button becomes usable again.
 */
export function resendCooldownSecondsLeft(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/**
 * What the disabled button says. A label, not a live-region announcement: it
 * changes every second, and a polite region that re-announced each tick would
 * make the row unusable with a screen reader (`.agents/skills/better-accessibility`).
 */
export function resendCooldownLabel(secondsLeft: number): string {
  return `Resend in ${secondsLeft}s`;
}
