import { z } from "zod";

import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { findExactEvryActionPlan } from "@/lib/evry/plans/repository";
import { sweepEvryCommitmentDocumentObjects } from "@/lib/people/evry-milestones";
import { sweepEvryPersonPhotoObjects } from "@/lib/people/person-photo";

import {
  removeEvryPeopleAttachment,
  type EvryPeopleAttachmentReference,
} from "./attachments";
import { EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH } from "./attachment-contract";

const attachmentReferenceSchema = z
  .string()
  .min(1)
  .max(EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH);
const storedPlanDocumentSchema = z
  .object({
    steps: z.array(
      z.object({
        capabilityIdentity: z.string(),
        arguments: z.record(z.string(), z.unknown()),
      })
    ),
  })
  .passthrough();

type CleanupTarget = Readonly<{
  reference: string;
  kind: EvryPeopleAttachmentReference["kind"];
  personId: string | null;
}>;

function cleanupTargetForStep(input: {
  capabilityIdentity: string;
  arguments: Record<string, unknown>;
}): CleanupTarget | null {
  if (input.capabilityIdentity === "people.crm.people.upload-person-photo") {
    const reference = attachmentReferenceSchema.safeParse(
      input.arguments.attachmentReference
    );
    const personId = z.string().uuid().safeParse(input.arguments.personId);
    return reference.success && personId.success
      ? {
          reference: reference.data,
          kind: "person_photo",
          personId: personId.data,
        }
      : null;
  }
  if (input.capabilityIdentity === "people.crm.imports.execute-bulk-import") {
    const reference = attachmentReferenceSchema.safeParse(
      input.arguments.attachmentReference
    );
    return reference.success
      ? { reference: reference.data, kind: "people_csv", personId: null }
      : null;
  }
  if (input.capabilityIdentity === "people.crm.assessments.create-commitment") {
    const personId = z.string().uuid().safeParse(input.arguments.personId);
    if (!personId.success) return null;
    if (typeof input.arguments.attachmentJson !== "string") return null;
    try {
      const attachment = z
        .object({ reference: attachmentReferenceSchema })
        .nullable()
        .parse(JSON.parse(input.arguments.attachmentJson));
      return attachment
        ? {
            reference: attachment.reference,
            kind: "commitment_document",
            personId: personId.data,
          }
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Remove staged People inputs only after the exact plan reaches a terminal or
 * unusable state. The exact actor/plant/fingerprint lookup and signed reference
 * check make caller-selected plan bytes unable to target another object.
 */
export async function cleanupEvryPeoplePlanAttachments(input: {
  actor: EvryPlantActor;
  plan: EvryConversationPlanIdentity;
  loadPlan?: typeof findExactEvryActionPlan;
  remove?: typeof removeEvryPeopleAttachment;
  sweepPhotos?: typeof sweepEvryPersonPhotoObjects;
  sweepCommitments?: typeof sweepEvryCommitmentDocumentObjects;
}): Promise<Readonly<{ removed: number; failed: number }>> {
  const stored = await (input.loadPlan ?? findExactEvryActionPlan)({
    planId: input.plan.planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: input.plan.fingerprint,
  });
  if (!stored) return { removed: 0, failed: 0 };
  const document = storedPlanDocumentSchema.safeParse(stored.document);
  if (!document.success) return { removed: 0, failed: 0 };
  const unique = new Map<string, CleanupTarget>();
  for (const step of document.data.steps) {
    const target = cleanupTargetForStep(step);
    if (target) unique.set(`${target.kind}:${target.reference}`, target);
  }
  let removed = 0;
  let failed = 0;
  for (const target of unique.values()) {
    try {
      if (
        await (input.remove ?? removeEvryPeopleAttachment)({
          actor: input.actor,
          reference: target.reference,
          expectedKind: target.kind,
        })
      ) {
        removed += 1;
      }
    } catch {
      failed += 1;
    }
    if (target.kind === "person_photo" && target.personId) {
      try {
        const swept = await (input.sweepPhotos ?? sweepEvryPersonPhotoObjects)({
          plantId: input.actor.plantId,
          personId: target.personId,
        });
        removed += swept.removed;
        failed += swept.failed;
      } catch {
        failed += 1;
      }
    }
    if (target.kind === "commitment_document" && target.personId) {
      try {
        const swept = await (
          input.sweepCommitments ?? sweepEvryCommitmentDocumentObjects
        )({
          plantId: input.actor.plantId,
          personId: target.personId,
        });
        removed += swept.removed;
        failed += swept.failed;
      } catch {
        failed += 1;
      }
    }
  }
  return { removed, failed };
}
