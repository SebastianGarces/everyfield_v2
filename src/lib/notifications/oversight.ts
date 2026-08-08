import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { churches, users, type OrganizationInvitationType } from "@/db/schema";
import { OVERSIGHT_ROLES } from "@/lib/auth/access";

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
// Nothing here reads `church_privacy_settings`. These functions resolve WHO the
// oversight recipients of a plant are and compose WHAT to say; whether the
// plant is sharing at all is `enqueue`'s question, asked per recipient, at the
// moment the row would be written. Two consequences worth stating:
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

/** One oversight recipient of a plant. */
export interface OversightRecipient {
  id: string;
}

/**
 * ONE oversight organisation.
 *
 * At most one field is set. The type carries both because the
 * `organization_invitations` row does, but a value of this type is a NARROWED
 * reading of that row, produced by `invitingOrgForInvitation` below — never the
 * row's two FK columns copied across.
 */
export interface OversightOrg {
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
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
 * `sending_church_to_network` names no plant (`target_church_id` is null), so
 * it never reaches this milestone; it maps to no org here and the caller sends
 * to nobody rather than guessing.
 */
export function invitingOrgForInvitation(
  invitation: InvitingInvitation
): OversightOrg {
  switch (invitation.type) {
    case "church_to_sending_church":
      return {
        sendingChurchId: invitation.sendingChurchId,
        sendingNetworkId: null,
      };
    case "church_to_network":
      return {
        sendingChurchId: null,
        sendingNetworkId: invitation.sendingNetworkId,
      };
    case "sending_church_to_network":
      return { sendingChurchId: null, sendingNetworkId: null };
  }
}

/** What a fan-out did, per recipient, without throwing. */
export interface OversightFanOutReport {
  /** Rows actually written (a dedupe hit counts as recorded, not created). */
  recorded: number;
  created: number;
  /** Recipients `enqueue` refused — not sharing, or not eligible. */
  skipped: number;
  /** Recipients considered at all. Zero means the plant has no oversight. */
  considered: number;
  /** Infrastructure failures, swallowed so the caller's action survives. */
  failed: number;
}

const emptyReport = (): OversightFanOutReport => ({
  recorded: 0,
  created: 0,
  skipped: 0,
  considered: 0,
  failed: 0,
});

/** Enqueueing is the only thing every fan-out shares. */
interface OversightEnqueueDep {
  /** The real `enqueue` — the gate, and the only writer. */
  enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult>;
}

/** The PLANT-wide audience: everyone with oversight of this plant. */
export interface OversightFanOutDeps extends OversightEnqueueDep {
  /** Who oversees this plant right now. */
  listOversightRecipients(churchId: string): Promise<OversightRecipient[]>;
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
  listOversightAdminsOfOrg(org: OversightOrg): Promise<OversightRecipient[]>;
}

/**
 * The loop both fan-outs share: one `enqueue` call per recipient, because that
 * is the grain `enqueue` gates at. A recipient the plant is not sharing with is
 * skipped and the loop continues. A shared `dedupeKey` is safe and intended —
 * the index includes `recipient_user_id`, so one key per EVENT does not let
 * admin #1 swallow admin #2's row.
 */
async function fanOutTo(
  deps: OversightEnqueueDep,
  recipients: OversightRecipient[],
  compose: (recipientId: string) => EnqueueNotificationInput,
  context: Record<string, unknown>
): Promise<OversightFanOutReport> {
  const report = emptyReport();
  report.considered = recipients.length;

  for (const recipient of recipients) {
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
  org: OversightOrg,
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
  churchId: string;
  /** The plant's name, so the subject line is useful to an admin over twenty. */
  plantName: string;
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
    churchId: facts.churchId,
    recipientUserId,
    category: "milestones",
    type: oversightMilestoneType(facts.kind),
    title: milestoneTitle(facts),
    body: facts.detail,
    // One key per EVENT, shared across recipients: the partial unique index is
    // on (church_id, recipient_user_id, dedupe_key), so each admin still gets
    // their own row while a replay of the emitter writes nothing.
    dedupeKey: `${oversightMilestoneType(facts.kind)}:${facts.churchId}:${facts.occurrence}`,
  };
}

function milestoneTitle(facts: MilestoneFacts): string {
  switch (facts.kind) {
    case "invitation_accepted":
      return `${facts.plantName} joined you`;
    case "invitation_declined":
      return `${facts.plantName} declined your invitation`;
    case "association_ended":
      return `${facts.plantName} left your organization`;
    case "phase_advanced":
      return `${facts.plantName} reached a new stage`;
    case "launch_date_changed":
      return `${facts.plantName} has a launch date`;
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
  try {
    return await fanOutToOversight(deps, facts.churchId, (recipientId) =>
      composeMilestone(facts, recipientId)
    );
  } catch (error) {
    console.error("oversight milestone announcement failed", {
      churchId: facts.churchId,
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
    churchId: input.churchId,
    plantName: input.plantName,
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
 * the invitation — is the one an admin will act on. The plant is named for the
 * same reason every milestone names it: an admin over twenty needs to know
 * which.
 */
export async function announceInvitationDeclined(
  input: {
    churchId: string;
    plantName: string;
    invitationId: string;
    invitation: InvitingInvitation;
  },
  deps: OversightOrgFanOutDeps = dbOversightFanOutDeps
): Promise<OversightFanOutReport> {
  return announceToOrg(
    deps,
    invitingOrgForInvitation(input.invitation),
    {
      churchId: input.churchId,
      plantName: input.plantName,
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
    org: OversightOrg;
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
      churchId: input.churchId,
      plantName: input.plantName,
      kind: "association_ended",
      occurrence: input.occurrence,
      detail:
        "They have left your organization. They no longer appear in your plants directory, and you will receive no further updates about them.",
    },
    input.occurrence
  );
}

/**
 * The one-org fan-out with the never-throws posture, shared by the three
 * own-relationship milestones so none of them can be the one that lets an
 * infrastructure error escape into the action that caused it.
 */
async function announceToOrg(
  deps: OversightOrgFanOutDeps,
  org: OversightOrg,
  facts: MilestoneFacts,
  context: string
): Promise<OversightFanOutReport> {
  try {
    return await fanOutToOversightOrg(deps, org, (recipientId) =>
      composeMilestone(facts, recipientId)
    );
  } catch (error) {
    console.error("oversight milestone announcement failed", {
      churchId: facts.churchId,
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
      churchId: input.churchId,
      plantName: input.plantName,
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
      churchId: input.churchId,
      plantName: input.plantName,
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

/**
 * The oversight recipients of a plant: the admins of the sending church it
 * belongs to, and the admins of the network it belongs to.
 *
 * Derived from the plant's own FKs rather than from a stored recipient list, so
 * a plant that leaves a network stops being reported on immediately. Both FKs
 * are nullable (memory/invariants.md → Multi-Tenancy) and a plant with neither
 * simply has no oversight — the fan-out considers nobody and writes nothing.
 *
 * A projection, not `select()`: this answers "who", so it must not pull
 * `password_hash` into application memory (same reasoning as `accessColumns`
 * in `enqueue.ts`).
 */
export async function listOversightRecipientsForChurch(
  churchId: string
): Promise<OversightRecipient[]> {
  const [plant] = await db
    .select({
      sendingChurchId: churches.sendingChurchId,
      sendingNetworkId: churches.sendingNetworkId,
    })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  if (!plant) return [];

  const reaches = [
    plant.sendingChurchId
      ? eq(users.sendingChurchId, plant.sendingChurchId)
      : undefined,
    plant.sendingNetworkId
      ? eq(users.sendingNetworkId, plant.sendingNetworkId)
      : undefined,
  ].filter((clause) => clause !== undefined);

  if (reaches.length === 0) return [];

  // One statement, and the role is IN it: `OVERSIGHT_ROLES` is the definition
  // of "oversight", and a `team_member` who happens to carry a
  // `sending_church_id` is not one. `enqueue` would refuse them anyway (a
  // church-level role with no access to this plant fails `canAccessChurch`),
  // but a fan-out that reports "considered 40" when 38 of them were never
  // candidates is lying to whoever reads the report.
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(or(...reaches), inArray(users.role, OVERSIGHT_ROLES)));

  return rows;
}

/**
 * The oversight admins of ONE named organisation.
 *
 * Deliberately does NOT touch `churches`: the audience of the consent-exempt
 * invitation milestone is defined by the invitation, and reading the plant's
 * FKs is exactly the step that let a second, uninvolved org in. Nothing here
 * can widen — a caller has to name the org, and only the org's own admins come
 * back.
 *
 * A projection, not `select()`, for the same reason as
 * `listOversightRecipientsForChurch`: this answers "who", so `password_hash`
 * must not enter application memory.
 */
export async function listOversightAdminsOfOrg(
  org: OversightOrg
): Promise<OversightRecipient[]> {
  const reaches = [
    org.sendingChurchId
      ? eq(users.sendingChurchId, org.sendingChurchId)
      : undefined,
    org.sendingNetworkId
      ? eq(users.sendingNetworkId, org.sendingNetworkId)
      : undefined,
  ].filter((clause) => clause !== undefined);

  // No org named — no recipients. Never "everyone".
  if (reaches.length === 0) return [];

  return db
    .select({ id: users.id })
    .from(users)
    .where(and(or(...reaches), inArray(users.role, OVERSIGHT_ROLES)));
}

export const dbOversightFanOutDeps: OversightFanOutDeps &
  OversightOrgFanOutDeps = {
  listOversightRecipients: listOversightRecipientsForChurch,
  listOversightAdminsOfOrg,
  enqueue,
};
