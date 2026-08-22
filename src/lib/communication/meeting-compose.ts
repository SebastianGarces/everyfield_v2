// ============================================================================
// Starting an email FROM a meeting — who gets it, and where the link goes
// ============================================================================
//
// Two decisions, because the meeting detail page makes both every time a
// planter presses Send Email, and it used to make them in two different places:
// the Communications card built `/communication/compose?meetingId=X` by hand
// while the guest-list button built the same path WITH `recipientIds`. Two
// buttons one tab apart on the same meeting, and the one a planter reaches
// first opened compose with no recipients at all (#612).
//
// WHICH TEMPLATE a meeting type invites with is NOT here — it is a fact about
// the platform catalog, and it lives on the catalog entry itself
// (`system-templates.ts`, `invitesMeetingType`). Keeping it there is what makes
// "the invitation for this type exists" true by construction, and it keeps the
// template bodies out of the browser: `/communication/compose` resolves the
// auto-suggested template in its page, on the server.
//
// THIS MODULE IMPORTS NOTHING. `guest-list.tsx` is `"use client"`, so a runtime
// import of `@/db` here would ship the database client to the browser. Same
// rule and same reason as `@/lib/meetings/copy` and `@/lib/meetings/agenda`.
// ============================================================================

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

/**
 * What this module needs to know about one of a meeting's guests.
 *
 * A STRUCTURAL type, not `GuestListEntry`: that one lives in
 * `@/lib/meetings/guest-list`, which value-imports `@/db`, and the callers are
 * client components. `email` is REQUIRED and nullable — a caller that simply
 * did not project the column would otherwise type-check and quietly invite
 * everybody, including the guests who have no address to invite.
 */
export interface MeetingGuestContact {
  personId: string;
  email: string | null;
}

/**
 * The guests who can actually receive an email.
 *
 * ONE definition of "emailable", read by the URL builder AND by the button that
 * counts them, so the number on the button is the number of recipients the
 * compose screen opens with. A guest with no address is dropped here rather
 * than preloaded and silently skipped at send time.
 */
export function emailableGuests<T extends MeetingGuestContact>(
  guests: readonly T[]
): T[] {
  return guests.filter((guest) => Boolean(guest.email));
}

// ---------------------------------------------------------------------------
// The URL
// ---------------------------------------------------------------------------

/**
 * The compose URL for a meeting: the meeting itself, plus its emailable guests
 * as preloaded recipients.
 *
 * EVERY Send Email control on a meeting surface calls this — the Communications
 * card in both its states and the guest list's own button.
 *
 * `guests` IS REQUIRED, with no default. An omittable argument here would hand
 * the next Send Email control an opt-out that compiles, produces a link with no
 * recipients, and is invisible to the walk in `meeting-compose.test.ts` —
 * because the URL would not have been built by hand. That is #612 verbatim, one
 * call away. A surface with genuinely nobody to write to passes `[]` and says
 * so at the call site.
 *
 * `recipientIds` is omitted entirely when nobody is emailable, because an empty
 * `recipientIds=` is a parameter that says nothing and the compose page parses
 * it into an empty list anyway.
 *
 * The ids are person ids (`persons.id`), which `/communication/compose` re-reads
 * church-scoped — a foreign or soft-deleted id preloads nobody, so the URL
 * carries no authority of its own.
 */
export function meetingComposeUrl(
  meetingId: string,
  guests: readonly MeetingGuestContact[]
): string {
  const recipientIds = emailableGuests(guests).map((guest) => guest.personId);
  const query = new URLSearchParams({ meetingId });
  if (recipientIds.length > 0) {
    query.set("recipientIds", recipientIds.join(","));
  }
  return `/communication/compose?${query.toString()}`;
}
