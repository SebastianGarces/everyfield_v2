import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { churches, users } from "@/db/schema";
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
//   MILESTONES  three events, delivered per event (this file):
//                 - the planter accepted an invitation,
//                 - the plant advanced a phase/stage,
//                 - a launch date was set or changed.
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
 * ONE oversight organisation, as identified by the row that names it.
 *
 * Exactly one field is set in practice — an invitation is issued by a sending
 * church or by a network, never both — but the type carries both because the
 * `organization_invitations` row does, and reading it back is what makes the
 * audience below provable rather than inferred.
 */
export interface OversightOrg {
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
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
 * `invitedBy` is REQUIRED and is read off the invitation row, not off the
 * plant. This is the only milestone `enqueue` will write without consent, so
 * "who invited them" cannot be a guess: a plant that belongs to a sending
 * church AND a network would otherwise have this ungated row delivered to the
 * organisation that had nothing to do with it. The audience is narrowed to the
 * inviting org, and the other org stays exactly where it was — behind the
 * sharing toggle, hearing nothing.
 *
 * An invitation carrying NEITHER id names no org, so it reaches nobody. That is
 * the safe direction and it is unreachable in practice: `createInvitation`
 * requires the id its type implies.
 */
export async function announceInvitationAccepted(
  input: {
    churchId: string;
    plantName: string;
    invitationId: string;
    invitedBy: OversightOrg;
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

  // Not `announceMilestone`: this is the one emitter that does NOT address the
  // plant's oversight union. Same never-throws posture, different audience.
  try {
    return await fanOutToOversightOrg(deps, input.invitedBy, (recipientId) =>
      composeMilestone(facts, recipientId)
    );
  } catch (error) {
    console.error("oversight milestone announcement failed", {
      churchId: input.churchId,
      kind: facts.kind,
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

/** Source: `setChurchLaunchDate()` in `src/lib/churches/launch-date.ts`. */
export function announceLaunchDateChanged(
  input: {
    churchId: string;
    plantName: string;
    /** `YYYY-MM-DD`, as stored. */
    launchDate: string;
    /**
     * The instant the change was durably written — `churches.updated_at` as
     * returned by the UPDATE that made it. Half the dedupe key; see below.
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
      // intact: `setChurchLaunchDate` compare-and-sets, so a re-save of the
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
