// ============================================================================
// Communication — the sentences that depend on the reader's seat (AS-020).
//
// WHY A MODULE AND NOT A TERNARY IN THE PAGE. The repo's harness runs
// `src/**/*.test.ts` under node:test with no DOM, so copy that lives inside a
// `.tsx` is copy no test can read. `launch/presentation.ts` was extracted for
// the same reason and for the same defect (#659); this is that file's sibling.
//
// Keep it free of `@/db` and of anything a client component cannot import.
// ============================================================================

/**
 * WHO SENDS, IN ONE PLACE — what a reader without `communication.send` is told
 * instead of being asked to send something.
 *
 * The hub's empty state and its header both answer the same question, and two
 * sentences answering it differently is how #659 shipped: a card and its
 * destination disagreed about who acts. They say different things on purpose —
 * the empty state explains an empty list, the subtitle describes the page — but
 * they are decided here, together, so they cannot drift apart.
 */
export const ADMINS_SEND_THE_MESSAGES =
  "Your plant's admins send messages to your people.";

/**
 * The Communication Hub's subtitle (#666).
 *
 * The old line was "Send messages and track communication with your people"
 * for every seat, including a plant Member, who holds no `communication.send`
 * and is refused at `requireSeat` the moment they try. What a Member gets now
 * describes what the page IS for them — the counts, the delivery overview and
 * the recent list are all readable — rather than naming a verb they do not
 * hold.
 */
export function communicationHubSubtitle(canSend: boolean): string {
  return canSend
    ? "Send messages and track communication with your people"
    : "What your plant has sent, and how it was delivered";
}

/**
 * The line under "No messages yet".
 *
 * A reader who cannot send is told the FACT — who sends here — rather than
 * being invited to send a first message they would be refused.
 */
export function communicationEmptyStateLine(canSend: boolean): string {
  return canSend
    ? "Send your first message to get started"
    : ADMINS_SEND_THE_MESSAGES;
}
