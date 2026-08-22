// ============================================================================
// Starting an email FROM a meeting — the one module that decides how
// ============================================================================
//
// Three decisions live here, because the meeting detail page makes all three
// every time a planter presses Send Email, and it used to make them in two
// different places:
//
//   1. WHICH URL a Send Email control points at.
//   2. WHO of the meeting's guests is a recipient.
//   3. WHICH template a meeting type invites with.
//
// The Communications card built `/communication/compose?meetingId=X` by hand
// and the guest-list button built the same path WITH `recipientIds`, so two
// buttons one scroll apart on the same page opened two different compose
// screens — the top one with no recipients at all. That is the shape this
// module exists to end (#612).
//
// IT IMPORTS NOTHING BUT A TYPE. `guest-list.tsx` and `compose-form.tsx` are
// both `"use client"`, so a runtime import of `@/db` here would ship the
// database client to the browser; `MeetingType` is erased at compile time and
// costs the bundle nothing. Same rule and same reason as
// `@/lib/meetings/labels` and `@/lib/meetings/agenda`.
// ============================================================================

import type { MeetingType } from "@/db/schema/meetings";

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
 * card in both its states and the guest list's own button. `recipientIds` is
 * omitted entirely when nobody is emailable, because an empty `recipientIds=`
 * is a parameter that says nothing and the compose page would parse it into an
 * empty list anyway.
 *
 * The ids are person ids (`persons.id`), which is what `/communication/compose`
 * re-reads church-scoped — a foreign or soft-deleted id preloads nobody, so the
 * URL carries no authority of its own.
 */
export function meetingComposeUrl(
  meetingId: string,
  guests: readonly MeetingGuestContact[] = []
): string {
  const recipientIds = emailableGuests(guests).map((guest) => guest.personId);
  const query = new URLSearchParams({ meetingId });
  if (recipientIds.length > 0) {
    query.set("recipientIds", recipientIds.join(","));
  }
  return `/communication/compose?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

/**
 * WHICH system template each meeting type invites with — keyed by the union, so
 * a new meeting type is a compile error here instead of a type that silently
 * opens compose with an empty subject and an empty body.
 *
 * That silence is what this map replaced. Its predecessor was a
 * `Record<string, string[]>` of name PATTERNS inside `compose-form.tsx`, and it
 * named `"Team Meeting Invitation"` — a template `scripts/seed-system-templates.ts`
 * has never seeded. A team meeting therefore reached compose with `meetingId`
 * set, matched nothing, and gave the planter a blank email; nothing failed, so
 * nothing said why (#612).
 *
 * `meeting-compose.test.ts` holds every name here to the seeded catalog, which
 * is the half a `Record` cannot check: the key set is the compiler's, the
 * VALUES are strings and a string can name a template that does not exist.
 */
export const MEETING_INVITATION_TEMPLATE_NAMES: Record<MeetingType, string> = {
  vision_meeting: "Vision Meeting Invitation",
  orientation: "Orientation Invitation",
  team_meeting: "Team Meeting Invitation",
};

/** What the lookup below needs off a template row. */
export interface InvitationTemplateCandidate {
  name: string;
  category: string;
}

/**
 * The invitation template to open a meeting's email with, or `null`.
 *
 * `includes`, not equality: a church that edits a system template gets a FORK
 * (`templates.ts`, copy-on-write) which it may rename around the original, and
 * `getTemplates` returns the fork in the original's place. Matching on a
 * substring keeps the church's own copy of "Vision Meeting Invitation" winning
 * over the platform's.
 *
 * `Object.hasOwn`-gated, never a bare index: `type` arrives off a row that may
 * predate the current enum, and a bare index reaches `Object.prototype`, so
 * `"constructor"` returns a native FUNCTION that no `??` fallback catches.
 * Same rule and same reason as `meetingTypeLabel` (`@/lib/meetings/labels`).
 */
export function meetingInvitationTemplate<
  T extends InvitationTemplateCandidate,
>(meetingType: string, templates: readonly T[]): T | null {
  if (!Object.hasOwn(MEETING_INVITATION_TEMPLATE_NAMES, meetingType)) {
    return null;
  }
  const name = MEETING_INVITATION_TEMPLATE_NAMES[meetingType as MeetingType];

  return (
    templates.find(
      (template) =>
        template.category === "meeting_invitation" &&
        template.name.includes(name)
    ) ?? null
  );
}
