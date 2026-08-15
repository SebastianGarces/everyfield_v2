import type { OrganizationInvitationType } from "@/db/schema";
import {
  noOversightOrg,
  oversightOrgOfKind,
  type OversightOrgIds,
} from "./oversight-admin";
import {
  listOversightAdminsOfOrg,
  listOversightRecipientsForChurch,
  type OversightAudience,
} from "./oversight-audience";
import {
  anchorId,
  churchAnchor,
  orgAnchor,
  type NotificationAnchor,
} from "./anchor";
import {
  enqueue,
  type EnqueueNotificationInput,
  type EnqueueResult,
} from "./enqueue";

// ============================================================================
// The oversight notification model (N-025 / N-026, ruled 2026-07-27).
//
// Everything an oversight recipient (`sending_church_admin`, `network_admin`)
// is ever told about a plant is composed here or in `./oversight-digest.ts`.
// There are exactly two shapes:
//
//   MILESTONES  five events, delivered per event (this file):
//                 - the planter accepted an invitation,
//                 - the planter declined an invitation           (#304/OV-006),
//                 - the planter left the org                     (#304/OV-007),
//                 - the plant advanced a phase/stage,
//                 - a launch date was set or changed.
//               The first three are the ORG'S OWN relationship changing and go
//               to that one org, consent-exempt; the last two are facts about
//               the plant and go to the plant's whole oversight union, gated.
//               The first three repeat ONE LEVEL UP for a sending church's own
//               membership of a network (#304 WS3 / OV-013): same kinds, same
//               types, same exempt rail, but ANCHORED TO THE NETWORK because
//               they name no plant at all (`announceSendingChurch*`).
//   DIGEST      one daily activity SUMMARY, and only on a day that had
//               activity (`./oversight-digest.ts`).
//
// Nothing else. The per-event stream a plant's own team lives in stays inside
// the plant — `enqueue` refuses a granular category for an oversight recipient
// outright (`OVERSIGHT_ELIGIBLE_CATEGORIES` in `./categories.ts`), so that is a
// structural fact and not a rule these emitters have to remember.
//
// ----------------------------------------------------------------------------
// Enqueue stays the single gatekeeper
// ----------------------------------------------------------------------------
//
// Nothing here reads `church_privacy_settings`. These functions compose WHAT to
// say and fan it out — WHO the audience is belongs to `./oversight-audience.ts`
// — and whether the plant is sharing at all is `enqueue`'s question, asked per
// recipient, at the moment the row would be written. Two consequences worth
// stating:
//
//   * A plant that is not sharing gets no row, ever — not a row that is later
//     filtered, not a suppressed delivery. The refusal is total, because it
//     happens before the INSERT.
//   * A toggle flipped at 09:00 is honoured by the 09:01 enqueue. There is no
//     cached eligibility, no per-run snapshot, and no deploy in the loop.
//
// Duplicating the gate here would be worse than useless: two places to forget,
// and the fan-out below would start deciding privacy questions on behalf of a
// module that already decides them correctly.
//
// ----------------------------------------------------------------------------
// Best-effort at the call site, never at the gate
// ----------------------------------------------------------------------------
//
// A milestone announcement must not be able to fail the action that caused it —
// accepting an invitation, advancing a phase, saving a launch date. So every
// emitter returns a report and swallows its own infrastructure errors
// (`announceMilestone`), the same posture `handleMaterialEvent` takes for
// phase-engine dirty marking. A REFUSED recipient is not an error at all: it
// is `enqueue`'s documented skip, and it arrives in the report as one.
// ============================================================================

// ----------------------------------------------------------------------------
// The three milestones
// ----------------------------------------------------------------------------

/**
 * The closed set. A milestone is a moment an oversight partner would want to
 * hear about the day it happens; everything else is a line in tomorrow's
 * summary. Keeping it a tuple means "which events interrupt someone" is one
 * reviewable list rather than a judgement made three times in three features.
 */
export const oversightMilestoneKinds = [
  "invitation_accepted",
  "invitation_declined",
  "association_ended",
  "phase_advanced",
  "launch_date_changed",
] as const;

export type OversightMilestoneKind = (typeof oversightMilestoneKinds)[number];

/** The `type` discriminator carried on the notification row. */
export function oversightMilestoneType(kind: OversightMilestoneKind): string {
  return `oversight.milestone.${kind}`;
}

/** The shape of an `organization_invitations` row this module reads. */
export interface InvitingInvitation {
  type: OrganizationInvitationType;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
}

/**
 * WHICH org issued an invitation — derived from its TYPE, never from which of
 * its two FK columns happen to be populated (ruled 2026-08-02).
 *
 * `organization_invitations` has a `sending_church_id` AND a
 * `sending_network_id`, no CHECK constraint tying either to `type`, and
 * `createInvitation` validates nothing: it inserts whatever it is handed. So a
 * `church_to_sending_church` row can carry a network id as well, and the
 * previous code — which copied both columns into the audience — fanned the
 * consent-EXEMPT invitation milestone out to a network that had invited nobody
 * and had consented to nothing.
 *
 * The type is the invitation's own statement of who issued it, and it is the
 * field `applyAssociation` acts on, so deriving from it keeps the notification
 * addressed to exactly the org whose association was just made. A stray FK on
 * the other column is ignored rather than trusted, and the ignored org stays
 * where it was: behind the sharing toggle, hearing nothing.
 *
 * `sending_church_to_network` names no plant, so it never reaches THESE
 * plant-anchored milestones; it maps to no org here and the caller sends to
 * nobody rather than guessing. Its own three milestones are org-anchored and
 * name their network explicitly (`announceSendingChurch*`, #304 WS3) — they do
 * not come through this function, which reads a PLANT's invitation.
 *
 * WHAT IT RETURNS IS A NARROWED READING OF THE ROW — never the row's two FK
 * columns copied across. `OversightOrgIds` (`./oversight-admin.ts`) is keyed on
 * the pairing table rather than re-declared here: this module used to spell the
 * two FK names out in an interface of its own while the probe in
 * `./oversight-relationship.ts` spelled the identical pair in a second one, and
 * that half-pairing-per-site is what left a third org kind invisible to both.
 *
 * At most one field of the result is non-null, and INSIDE
 * `src/lib/notifications/` that holds by construction — `oversightOrgOfKind`
 * and `noOversightOrg` are the only ways to make one from a kind. It is NOT a
 * domain-wide guarantee; `./oversight-admin.ts` names the one constructor
 * outside this directory.
 */
export function invitingOrgForInvitation(
  invitation: InvitingInvitation
): OversightOrgIds {
  // Each arm names the ORG KIND the invitation type means and hands over the
  // column that type is allowed to read. `oversightOrgOfKind` files it under
  // the FK the pairing row names and nulls the rest, so no arm here writes an
  // oversight FK name or the other kind's `null`.
  switch (invitation.type) {
    case "church_to_sending_church":
      return oversightOrgOfKind("sending_church", invitation.sendingChurchId);
    case "church_to_network":
      return oversightOrgOfKind("network", invitation.sendingNetworkId);
    case "sending_church_to_network":
      return noOversightOrg();
  }
}

/** What a fan-out did, per recipient, without throwing. */
export interface OversightFanOutReport {
  /** Rows actually written (a dedupe hit counts as recorded, not created). */
  recorded: number;
  created: number;
  /** Recipients `enqueue` refused — not sharing, or not eligible. */
  skipped: number;
  /** Rows considered at all. Zero means the plant has no oversight. */
  considered: number;
  /** Infrastructure failures, swallowed so the caller's action survives. */
  failed: number;
  /**
   * Rows the org FK reached whose ROLE does not administer that kind of org —
   * a data defect, counted and logged instead of silently dropped. Nothing is
   * enqueued for them; see `OversightAudience` (`./oversight-audience.ts`),
   * whose second array they arrive in.
   *
   * It is a sub-count of `considered`, so
   * `considered === recorded + skipped + failed + misprovisioned` still holds.
   * A non-zero value is never normal and never the fan-out's fault: it says a
   * `users` row was provisioned with an oversight FK its role cannot use.
   */
  misprovisioned: number;
}

const emptyReport = (): OversightFanOutReport => ({
  recorded: 0,
  created: 0,
  skipped: 0,
  considered: 0,
  failed: 0,
  misprovisioned: 0,
});

/** Enqueueing is the only thing every fan-out shares. */
interface OversightEnqueueDep {
  /** The real `enqueue` — the gate, and the only writer. */
  enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult>;
}

/** The PLANT-wide audience: everyone with oversight of this plant. */
export interface OversightFanOutDeps extends OversightEnqueueDep {
  /** Who oversees this plant right now. */
  listOversightRecipients(churchId: string): Promise<OversightAudience>;
}

/**
 * The ONE-ORG audience, used by the one consent-exempt milestone.
 *
 * Kept a SEPARATE dependency from the plant-wide one on purpose. "Everyone over
 * this plant" and "the admins of the org that invited them" are different
 * questions with different consent stories, and a caller that wants the exempt
 * one has to ask for it by name — it cannot arrive by accident because a shared
 * deps object happened to expose it.
 */
export interface OversightOrgFanOutDeps extends OversightEnqueueDep {
  listOversightAdminsOfOrg(org: OversightOrgIds): Promise<OversightAudience>;
}

/**
 * The loop both fan-outs share: one `enqueue` call per recipient, because that
 * is the grain `enqueue` gates at. A recipient the plant is not sharing with is
 * skipped and the loop continues. A shared `dedupeKey` is safe and intended —
 * the index includes `recipient_user_id`, so one key per EVENT does not let
 * admin #1 swallow admin #2's row.
 *
 * IT TAKES A PARTITIONED AUDIENCE, so "a cross-paired row is never enqueued" is
 * not something this function does — it is something it cannot help doing. The
 * defects are not in `recipients`, so there is no branch here to skip them with
 * and none to get wrong. What is left to do is REPORT them, which is the loop
 * below: `console.error`, not `warn`, because a row provisioned with an
 * oversight FK its role cannot use is a defect in stored data, and the whole
 * point of the ruling is that it stops being something only a database query
 * could notice.
 */
async function fanOutTo(
  deps: OversightEnqueueDep,
  audience: OversightAudience,
  compose: (recipientId: string) => EnqueueNotificationInput,
  context: Record<string, unknown>
): Promise<OversightFanOutReport> {
  const report = emptyReport();
  report.considered =
    audience.recipients.length + audience.misprovisioned.length;
  report.misprovisioned = audience.misprovisioned.length;

  for (const row of audience.misprovisioned) {
    console.error("oversight fan-out reached a cross-paired admin", {
      ...context,
      recipientUserId: row.id,
      role: row.role,
      reachedBy: row.reachedBy,
    });
  }

  for (const recipient of audience.recipients) {
    try {
      const result = await deps.enqueue(compose(recipient.id));
      if (result.status === "recorded") {
        report.recorded += 1;
        if (result.created) report.created += 1;
      } else {
        report.skipped += 1;
      }
    } catch (error) {
      // One recipient's failure must not cost the others theirs, and none of
      // them may cost the caller its action.
      report.failed += 1;
      console.error("oversight fan-out failed for a recipient", {
        ...context,
        error,
      });
    }
  }

  return report;
}

/** Fan a composed notification out to everyone with oversight of a plant. */
export async function fanOutToOversight(
  deps: OversightFanOutDeps,
  churchId: string,
  compose: (recipientId: string) => EnqueueNotificationInput
): Promise<OversightFanOutReport> {
  return fanOutTo(deps, await deps.listOversightRecipients(churchId), compose, {
    churchId,
  });
}

/**
 * Fan a composed notification out to the admins of ONE named organisation.
 *
 * This exists because of a consent bypass that was reachable in production. The
 * invitation-accepted milestone is exempt from the sharing toggle (ruled
 * 2026-08-01) on the grounds that it is the inviting org's OWN event — but the
 * fan-out resolved its recipients from the PLANT, whose `sending_church_id` and
 * `sending_network_id` can both be set at once (`applyAssociation` in
 * `src/lib/invitations/service.ts` sets one without clearing the other). So
 * accepting a sending church's invitation delivered an ungated notification to
 * a network that had invited nobody and had never been consented to.
 *
 * The exemption is still keyed on notification TYPE, which is what keeps it
 * from being able to promote a granular category into oversight's reach. What
 * changed is the AUDIENCE: the org is read off the invitation row, and nothing
 * in this function can widen it back to the plant.
 */
export async function fanOutToOversightOrg(
  deps: OversightOrgFanOutDeps,
  org: OversightOrgIds,
  compose: (recipientId: string) => EnqueueNotificationInput
): Promise<OversightFanOutReport> {
  return fanOutTo(deps, await deps.listOversightAdminsOfOrg(org), compose, {
    org,
  });
}

// ----------------------------------------------------------------------------
// Composition — what each milestone says
// ----------------------------------------------------------------------------

export interface MilestoneFacts {
  /**
   * WHICH TENANT the row is filed under (#304 WS3, ruling #351).
   *
   * A plant for the five milestones that are about a plant; the NETWORK for the
   * three that are about a sending church's own membership of it. It is the
   * anchor rather than a church id because those three name no plant at all —
   * which is exactly why they were unsendable before 0036.
   */
  anchor: NotificationAnchor;
  /**
   * WHAT THE TITLE NAMES THE COUNTERPARTY BY, and it is not always the plant.
   *
   * For the four milestones whose recipient is already associated with the
   * plant it is the plant's NAME, so the subject line is useful to an admin
   * over twenty. For `invitation_declined` it is the ADDRESS THE ORG ITSELF
   * TYPED (#304, ruled 2026-08-09): an org that was refused never became
   * associated, so the plant's name is not theirs to learn — the invitation is
   * the only thing that ever passed between them, and an email address is the
   * only identifier they supplied.
   *
   * The field is named for what it does rather than for the common case,
   * because a `plantName` that sometimes holds an email is exactly how the
   * decline leak came back.
   */
  subject: string;
  kind: OversightMilestoneKind;
  /**
   * The stable part of the dedupe key: the id of the thing that happened
   * (an invitation id, the phase reached, the new date). One event = one
   * notification per recipient, however many times the emitter runs.
   */
  occurrence: string;
  /** The one-line body. Summary language only — no names, no item detail. */
  detail: string;
}

/** Title + body + dedupe key for a milestone. Pure, so it is testable alone. */
export function composeMilestone(
  facts: MilestoneFacts,
  recipientUserId: string
): EnqueueNotificationInput {
  return {
    // Exactly one of the two anchors, never both — `enqueue`'s own refinement
    // and the table's CHECK both say so.
    ...(facts.anchor.type === "church"
      ? { churchId: facts.anchor.churchId }
      : { anchorOrg: { type: facts.anchor.type, orgId: facts.anchor.orgId } }),
    recipientUserId,
    category: "milestones",
    type: oversightMilestoneType(facts.kind),
    title: milestoneTitle(facts),
    body: facts.detail,
    // One key per EVENT, shared across recipients: the partial unique index is
    // on (anchor, recipient_user_id, dedupe_key), so each admin still gets their
    // own row while a replay of the emitter writes nothing. The ANCHOR's id is
    // in the key — the plant's, or the org's — so the two anchor spaces cannot
    // collide on a shared occurrence id.
    dedupeKey: `${oversightMilestoneType(facts.kind)}:${anchorId(facts.anchor)}:${facts.occurrence}`,
  };
}

function milestoneTitle(facts: MilestoneFacts): string {
  switch (facts.kind) {
    case "invitation_accepted":
      return `${facts.subject} joined you`;
    case "invitation_declined":
      return `${facts.subject} declined your invitation`;
    case "association_ended":
      return `${facts.subject} left your organization`;
    case "phase_advanced":
      return `${facts.subject} reached a new stage`;
    case "launch_date_changed":
      return `${facts.subject} has a launch date`;
  }
}

// ----------------------------------------------------------------------------
// The emitters, one per source
// ----------------------------------------------------------------------------

/**
 * Announce a milestone. Never throws — see the header.
 *
 * Every source calls this and ignores the result unless it wants to log it: an
 * invitation is accepted whether or not the sending church heard about it.
 */
export async function announceMilestone(
  facts: MilestoneFacts,
  deps: OversightFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  // The PLANT-WIDE fan-out asks "who oversees this plant", so it needs one.
  // Typed out rather than assumed: the two gated milestones are the only
  // callers and both compose a church anchor, and an org-anchored fact reaching
  // here would otherwise fan out to whoever oversees a church id that is null.
  if (facts.anchor.type !== "church") {
    console.error("a plant-wide milestone was composed with no plant", {
      kind: facts.kind,
      anchor: facts.anchor,
    });
    return emptyReport();
  }

  const churchId = facts.anchor.churchId;

  try {
    return await fanOutToOversight(deps, churchId, (recipientId) =>
      composeMilestone(facts, recipientId)
    );
  } catch (error) {
    console.error("oversight milestone announcement failed", {
      churchId,
      kind: facts.kind,
      error,
    });
    return emptyReport();
  }
}

/**
 * Source: `acceptInvitation()` — the plant joined a sending church/network.
 *
 * `deps` is injectable on all three emitters for the same reason: the BODY each
 * one composes is a promise made to a third party, and a promise is worth a
 * test. This one's was wrong for a release.
 *
 * `invitation` is REQUIRED and the audience comes from it, not from the plant.
 * This is the only milestone `enqueue` will write without consent, so "who
 * invited them" cannot be a guess: a plant that belongs to a sending church AND
 * a network would otherwise have this ungated row delivered to the organisation
 * that had nothing to do with it.
 *
 * Nor can it be "whichever of the invitation's two FKs is set": nothing
 * constrains a row to one, and `createInvitation` validates nothing at all.
 * `invitingOrgForInvitation` derives the single org from `invitation.type`, so
 * a row carrying BOTH ids still reaches only the org its type names. The other
 * org stays exactly where it was — behind the sharing toggle, hearing nothing.
 *
 * An invitation whose type-implied id is null names no org, so it reaches
 * nobody. That is the safe direction, and it is reachable: nothing validates
 * the row on the way in.
 */
export async function announceInvitationAccepted(
  input: {
    churchId: string;
    plantName: string;
    invitationId: string;
    invitation: InvitingInvitation;
  },
  deps: OversightOrgFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  const facts: MilestoneFacts = {
    anchor: churchAnchor(input.churchId),
    subject: input.plantName,
    kind: "invitation_accepted",
    occurrence: input.invitationId,
    // This is the one milestone that arrives with the plant's sharing toggle
    // in EITHER state (`OVERSIGHT_SHARING_EXEMPT_TYPES`, ruled 2026-08-01),
    // and the body has to be true in both. The previous copy — "You'll get a
    // summary on the days something happens" — was written when the row could
    // only exist with sharing already on; under the exemption it is now
    // read most often by someone who will get nothing further, which would
    // make it a promise the product does not keep.
    //
    // So it states the fact (they accepted) and then says plainly that
    // anything beyond this is the plant's decision. That is accurate with
    // sharing off AND with sharing on, and it tells the sending church where
    // the choice actually lives instead of implying it has already been made.
    detail:
      "They accepted your invitation. Anything beyond this — a summary on the days something happens, plus the occasional milestone — is theirs to switch on.",
  };

  // Not `announceMilestone`: this is one of the three emitters that do NOT
  // address the plant's oversight union. Same never-throws posture, different
  // audience — `announceToOrg` is that posture, shared.
  return announceToOrg(
    deps,
    invitingOrgForInvitation(input.invitation),
    facts,
    input.invitationId
  );
}

/**
 * Source: `declineAssociationInvitation()` — the planter said no (#304, OV-006).
 *
 * The mirror image of `announceInvitationAccepted`, and deliberately the same
 * shape: the audience is the ONE org that issued the invitation, derived from
 * the invitation's `type` by `invitingOrgForInvitation` and never from the
 * plant's FKs, so a plant that already belongs to a second org cannot leak this
 * to it. Same never-throws posture — a decline is recorded whether or not the
 * org hears about it.
 *
 * Its tenancy basis is not the plant's FK (a decline never set one); `enqueue`
 * rests it on the invitation ON RECORD instead — `OVERSIGHT_OWN_RELATIONSHIP_TYPES`
 * in ./categories.ts.
 *
 * The body says what the org can DO about it, because the alternative reading
 * of a bare "declined" — that the address was wrong, or that the product ate
 * the invitation — is the one an admin will act on.
 *
 * IT NAMES THE ADDRESS, NOT THE PLANT (#304, ruled 2026-08-09). Every other
 * milestone names the plant because its recipient is associated with it; a
 * refused org is not, and never was. All that ever passed between them is an
 * email address the org typed itself, so that is the only identifier it gets
 * back — the plant's name, its existence and the fact that the address belongs
 * to a planter with a plant at all are things the refusal must not hand over.
 * It is also the identifier the admin actually needs: the queue they are
 * reading is a list of addresses they invited.
 */
export async function announceInvitationDeclined(
  input: {
    churchId: string;
    /**
     * The address on the invitation — `organization_invitations.invitee_email`,
     * which is what this org typed. Never a lookup of who answered.
     */
    inviteeEmail: string;
    invitationId: string;
    invitation: InvitingInvitation;
  },
  deps: OversightOrgFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  return announceToOrg(
    deps,
    invitingOrgForInvitation(input.invitation),
    {
      anchor: churchAnchor(input.churchId),
      subject: input.inviteeEmail,
      kind: "invitation_declined",
      occurrence: input.invitationId,
      detail:
        "They declined your invitation. Nothing is associated, and they keep no link to your organization — you can invite them again whenever it makes sense.",
    },
    input.invitationId
  );
}

/**
 * Source: `leaveOversightOrg()` — the planter severed the association (#304,
 * OV-007a).
 *
 * The org is passed EXPLICITLY, and it is the org whose FK was just nulled —
 * never re-derived from the plant, which by now points at neither it nor
 * (possibly) its other oversight org. A plant that belongs to a sending church
 * AND a network leaves one of them; the other must hear nothing, because
 * nothing about it changed.
 *
 * Announced AFTER the sever commits, which is why the tenancy basis has to be
 * the `association_events` row written in the same statement rather than the FK
 * (`OVERSIGHT_OWN_RELATIONSHIP_TYPES`). Announcing first would have kept gate 1
 * happy and told an org that a plant had left it before that was true.
 */
export async function announceAssociationEnded(
  input: {
    churchId: string;
    plantName: string;
    /** The org that was left — exactly one field set. */
    org: OversightOrgIds;
    /**
     * What makes this event unique. The audit row's id: one sever, one
     * announcement, and a plant that leaves, rejoins and leaves again is three
     * distinct events rather than one swallowed by a permanent dedupe key.
     */
    occurrence: string;
  },
  deps: OversightOrgFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  return announceToOrg(
    deps,
    input.org,
    {
      anchor: churchAnchor(input.churchId),
      subject: input.plantName,
      kind: "association_ended",
      occurrence: input.occurrence,
      detail:
        "They have left your organization. They no longer appear in your plants directory, and you will receive no further updates about them.",
    },
    input.occurrence
  );
}

// ----------------------------------------------------------------------------
// The SENDING CHURCH's own membership of a network (#304 WS3 / OV-013)
// ----------------------------------------------------------------------------
//
// The same three own-relationship milestones, one level up the hierarchy: a
// sending church accepted a network's invitation, declined it, or left the
// network. Same `kind`s, same `type` strings and therefore the same
// consent-exempt rail — the exemption's justification transfers exactly, because
// these are the NETWORK's own events about a handshake the network started.
//
// WHAT IS DIFFERENT IS THE ANCHOR, AND IT IS THE WHOLE OF #351. There is no
// plant, so there is no `church_id` these can be filed under; before migration
// 0036 that meant they were composed and then dropped by a `if
// (updated.targetChurchId)` gate. They are now anchored to the NETWORK
// (`orgAnchor`) — the tenant whose admins read them, and the only tenant party
// to the event.
//
// THE AUDIENCE IS STILL THE ONE ORG, resolved by `listOversightAdminsOfOrg` from
// the network id spelled out by the caller. `enqueue`'s org arm then re-asks the
// same question per recipient (`recipientAdministersOrg`), so a widened audience
// here would still write nothing for a stranger.

/**
 * The audience shape for one network — built from the pairing row for
 * `network`, so the FK it fills in is the same one the SQL audience will read.
 */
function networkAudience(sendingNetworkId: string): OversightOrgIds {
  return oversightOrgOfKind("network", sendingNetworkId);
}

/**
 * Source: `acceptInvitationAs()` on a `sending_church_to_network` invitation —
 * the sending church joined the network (#304 WS3).
 *
 * Mirrors `announceInvitationAccepted` including its body's promise: the network
 * hears the handshake completed, and nothing about the sending church's plants,
 * which are a separate tenancy the network reaches (or does not) through its own
 * hierarchy.
 */
export async function announceSendingChurchJoinedNetwork(
  input: {
    sendingNetworkId: string;
    sendingChurchName: string;
    invitationId: string;
  },
  deps: OversightOrgFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  return announceToOrg(
    deps,
    networkAudience(input.sendingNetworkId),
    {
      anchor: orgAnchor("network", input.sendingNetworkId),
      subject: input.sendingChurchName,
      kind: "invitation_accepted",
      occurrence: input.invitationId,
      detail:
        "They accepted your invitation. Their sending church now sits inside your network; what their church plants share stays each plant's own decision.",
    },
    input.invitationId
  );
}

/**
 * Source: `declineInvitationAs()` on a `sending_church_to_network` invitation
 * (#304 WS3).
 *
 * IT NAMES THE ADDRESS, NOT THE SENDING CHURCH — the same rule as the planter's
 * decline, ruled 2026-08-09, and for the same reason: an org that was refused
 * never associated, so the only identifier that goes back is the one it typed
 * itself. `MilestoneFacts.subject` is the field for exactly this.
 */
export async function announceSendingChurchDeclinedNetwork(
  input: {
    sendingNetworkId: string;
    /** `organization_invitations.invitee_email` — what this network typed. */
    inviteeEmail: string;
    invitationId: string;
  },
  deps: OversightOrgFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  return announceToOrg(
    deps,
    networkAudience(input.sendingNetworkId),
    {
      anchor: orgAnchor("network", input.sendingNetworkId),
      subject: input.inviteeEmail,
      kind: "invitation_declined",
      occurrence: input.invitationId,
      detail:
        "They declined your invitation. Nothing is associated, and they keep no link to your network — you can invite them again whenever it makes sense.",
    },
    input.invitationId
  );
}

/**
 * Source: `leaveNetworkAsSendingChurchAdmin()` — the sending church severed its
 * network association (#304 WS3 / OV-013).
 *
 * `occurrence` is the `association_events` row's id, exactly as the planter's
 * sever uses: one sever, one announcement, and a sending church that leaves,
 * rejoins and leaves again is three events rather than one swallowed by a
 * permanent key.
 */
export async function announceSendingChurchLeftNetwork(
  input: {
    sendingNetworkId: string;
    sendingChurchName: string;
    occurrence: string;
  },
  deps: OversightOrgFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  return announceToOrg(
    deps,
    networkAudience(input.sendingNetworkId),
    {
      anchor: orgAnchor("network", input.sendingNetworkId),
      subject: input.sendingChurchName,
      kind: "association_ended",
      occurrence: input.occurrence,
      detail:
        "They have left your network. Their sending church no longer appears in your roster, and you will receive no further updates about them.",
    },
    input.occurrence
  );
}

/**
 * The one-org fan-out with the never-throws posture, shared by the six
 * own-relationship milestones so none of them can be the one that lets an
 * infrastructure error escape into the action that caused it.
 */
async function announceToOrg(
  deps: OversightOrgFanOutDeps,
  org: OversightOrgIds,
  facts: MilestoneFacts,
  context: string
): Promise<OversightFanOutReport> {
  try {
    return await fanOutToOversightOrg(deps, org, (recipientId) =>
      composeMilestone(facts, recipientId)
    );
  } catch (error) {
    console.error("oversight milestone announcement failed", {
      anchor: facts.anchor,
      kind: facts.kind,
      context,
      error,
    });
    return emptyReport();
  }
}

/** Source: the `phase.changed` event, wired in `src/lib/events/subscriptions.ts`. */
export function announcePhaseAdvanced(
  input: {
    churchId: string;
    plantName: string;
    toPhase: number;
  },
  deps: OversightFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  return announceMilestone(
    {
      anchor: churchAnchor(input.churchId),
      subject: input.plantName,
      kind: "phase_advanced",
      // The phase REACHED, not the transition id: advancing to stage 3 twice
      // (after a correction back to 2) is one milestone, and a replayed event is
      // none.
      occurrence: `phase-${input.toPhase}`,
      detail: `They moved up to stage ${input.toPhase}.`,
    },
    deps
  );
}

/** Source: `setLaunchDate()` in `src/lib/launch/service.ts` (LS-001/LS-002). */
export function announceLaunchDateChanged(
  input: {
    churchId: string;
    plantName: string;
    /** `YYYY-MM-DD`, as stored. */
    launchDate: string;
    /**
     * The instant the change was durably written — `launches.updated_at` as
     * returned by the statement that made it. Half the dedupe key; see below.
     */
    changedAt: Date;
  },
  deps: OversightFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  return announceMilestone(
    {
      anchor: churchAnchor(input.churchId),
      subject: input.plantName,
      kind: "launch_date_changed",
      // Keyed by the CHANGE, not by the value.
      //
      // Keying the date alone looked right and was wrong in one direction that
      // matters: the key is permanent (a delivered row keeps reserving it
      // forever), so a plant that moved 4 Oct → 1 Nov → back to 4 Oct got the
      // first two announcements and then SILENCE on the third. Moving a launch
      // date back to a previously announced one is not a duplicate event — it
      // is arguably the most newsworthy version of this milestone — and the
      // sending church would simply never hear it.
      //
      // The instant makes the key per-EVENT while keeping replay protection
      // intact: `setLaunchDate` compare-and-sets, so a re-save of the
      // same date is `unchanged` and never reaches here at all, and a retry of
      // only the announcement carries the same `changedAt` and still dedupes.
      // The date stays in the key so the row is legible in the database.
      occurrence: `${input.launchDate}@${input.changedAt.toISOString()}`,
      detail: `They are aiming to launch on ${input.launchDate}.`,
    },
    deps
  );
}

// ----------------------------------------------------------------------------
// Production wiring
// ----------------------------------------------------------------------------

export const dbOversightFanOutDeps: OversightFanOutDeps &
  OversightOrgFanOutDeps = {
  listOversightRecipients: listOversightRecipientsForChurch,
  listOversightAdminsOfOrg,
  enqueue,
};
