// ============================================================================
// What ONE pending/answered invitation looks like to the browser — the whole
// narrowing for `/oversight/invitations`, in one pure function.
//
// WHY THIS IS A LIBRARY FUNCTION AND NOT AN INLINE `.map()` IN `page.tsx`
// (#304 ruling 4 item 5, extended twice — 2026-08-09, then 2026-08-10)
// ----------------------------------------------------------------------------
//
// The rule this file enforces is POSITIONAL, and two attempts at it have now
// been satisfied in letter and left open one field away:
//
//   * attempt 1 collapsed the SUCCESS NOTICE and left `isOpen` + a per-row
//     `/register?invitation=` Copy-link button on the list below it;
//   * attempt 2 removed `isOpen` and the button, and left `kindLabel` —
//     `invitation.type === "sending_church_to_network" ? … : …` — on the row.
//
// `type` is target-derived: `resolveInvitationRequest` reads the RESOLVED
// target first and only falls back to the admin's `inviteAs` when there is no
// target (core.ts, `const kind`). So the label equalled the admin's own form
// selection for an address with no EveryField account and FLIPPED to the other
// value for an address that had one of the other kind. One submission, no
// error, same screen: pick "Church plant", read "Sending church" on the row
// that just appeared, and you have learned that the address is a registered
// sending-church admin with an organization. Exactly the fact about a stranger
// item 5 forbids, arriving through a label nobody had listed.
//
// It was DEAD CODE before this track. On main `resolveInvitationTarget` refused
// every address that already had an account, so every creatable invitation was
// open, `type` always followed `inviteAs`, and the label could never disagree
// with the selection. #304 revives targeting and arms it — the same lesson
// `memory/invariants/multi-tenancy.md` records: reviving a refused path
// re-arms every conditional that was only safe because the path was dead.
//
// So the narrowing lives HERE, where it is one exported pure function that a
// test can CALL. Both previous attempts were pinned by regexes over `page.tsx`
// (`assert.doesNotMatch(page, /targetChurchId/)`) and an allowed-field set that
// whitelisted `kindLabel` — every one of them passed while the property was
// false. `invitations-ui.test.ts` §9b now runs the real resolver for the two
// target shapes an admin can produce and asserts this function returns the SAME
// row for both. A regex cannot see a transitive derivation; that test can.
//
// THE RULE, for whoever adds the next field: an `InvitationListRow` may carry
// only what the ADMIN THEMSELVES put in, plus the invitee's own answer. Nothing
// computed from `target_church_id`, `target_sending_church_id`, or `type` —
// which is computed from them — may appear, directly or as a label. Of the five
// fields below: `id` is the row's own key, `inviteeEmail` is what the admin
// typed, `status` is the invitee's answer (and may branch — it is THEIR fact,
// not a stranger's), and the two dates are the row's own clock against a fixed
// window.
//
// WHAT WAS LOST is the per-row "Sending church" / "Church plant" caption. It
// only ever varied for a network admin (a sending church admin can invite
// exactly one kind), and there is no non-target-derived source for it: the
// admin's stated `inviteAs` is not stored on the row. Restoring the caption
// therefore needs either a new column recording what was ASKED, or a ruling
// that supersedes item 5. Do not derive it from `type` again.
//
// Dates are formatted here, against `APP_TIME_ZONE` (`@/lib/datetime`), because
// a `Date` formatted in the visitor's zone and again on the server is a
// hydration mismatch — memory/invariants.md → Date & Time Rendering.
// ============================================================================

import type {
  OrganizationInvitation,
  OrganizationInvitationStatus,
} from "@/db/schema/organization-invitation";
import { formatDate } from "@/lib/datetime";

export type InvitationListRow = {
  id: string;
  inviteeEmail: string;
  status: OrganizationInvitationStatus;
  sentLabel: string;
  expiresLabel: string | null;
};

export function toInvitationListRow(
  invitation: OrganizationInvitation
): InvitationListRow {
  return {
    id: invitation.id,
    // Rows predating #23 have no address recorded; say so rather than render a
    // blank identity.
    inviteeEmail: invitation.inviteeEmail ?? "(no address recorded)",
    status: invitation.status,
    sentLabel: formatDate(invitation.createdAt, "short"),
    expiresLabel: invitation.expiresAt
      ? formatDate(invitation.expiresAt, "short")
      : null,
  };
}
