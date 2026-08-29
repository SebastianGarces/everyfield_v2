import { createHash } from "node:crypto";

import { z } from "zod";

import { personSources } from "@/db/schema";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  trustedReviewForEvryPlanDocument,
} from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  authorizeEvryEffectCapability,
  eligibleEvryCapabilitiesFor,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  createEvryExecutionCapabilityRegistry,
  defineEvryExecutionCapability,
  type EvryEffectInput,
} from "@/lib/evry/executor";
import {
  parseEvryActionPlanCandidate,
  type EvryActionStep,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { createEvryActionPlanRecord } from "@/lib/evry/plans/repository";
import { defineEvryPlanCapability } from "@/lib/evry/plans/registry";
import {
  openEvryPeopleAttachmentReference,
  readExactEvryPeopleAttachment,
} from "@/lib/evry/capabilities/people/attachments";
import {
  claimEvryBulkImport,
  type EvryImportPersonRow,
} from "@/lib/people/evry-files";
import { recoverCompletedEvryPeopleEffect } from "@/lib/people/evry-effect";
import { parseCsvImport } from "@/lib/people/import";
import {
  claimEvryPersonPhotoMutation,
  getEvryPersonPhotoSnapshot,
} from "@/lib/people/person-photo";
import { getPerson } from "@/lib/people/service";
import type { ImportPreview, ImportRow } from "@/lib/people/types";
import { personCreateSchema } from "@/lib/validations/people";

export const PEOPLE_FILE_IDENTITIES = {
  photo: "people.crm.people.upload-person-photo",
  import: "people.crm.imports.execute-bulk-import",
} as const;

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const reference = z.string().min(1).max(4_000);
const photoSchema = z.strictObject({
  personId: z.string().uuid(),
  personLabel: z.string().min(1).max(511),
  expectedFirstName: z.string().min(1).max(255),
  expectedLastName: z.string().max(255),
  currentPhotoDigest: digest.nullable(),
  attachmentReference: reference,
  attachmentDigest: digest,
  contentType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
  size: z
    .number()
    .int()
    .positive()
    .max(3 * 1024 * 1024),
  originalName: z.string().min(1).max(255),
});
const importRowSchema = z
  .strictObject({
    rowNumber: z.number().int().min(2).max(27),
    rowKey: digest,
    personId: z.string().uuid(),
    firstName: z.string().trim().min(1).max(255),
    lastName: z.string().trim().min(1).max(255),
    email: z.string().email().max(255).nullable(),
    phone: z.string().max(50).nullable(),
    source: z.enum(personSources).nullable(),
    addressLine1: z.string().max(255).nullable(),
    addressLine2: z.string().max(255).nullable(),
    city: z.string().max(100).nullable(),
    state: z.string().max(100).nullable(),
    postalCode: z.string().max(20).nullable(),
    country: z.string().max(100),
    notes: z.string().max(20_000).nullable(),
    disposition: z.enum(["create", "merge"]),
    targetPersonId: z.string().uuid().nullable(),
    expectedTargetJson: z.string().max(40_000).nullable(),
  })
  .superRefine((row, context) => {
    if (
      (row.disposition === "create" &&
        (row.targetPersonId !== null || row.expectedTargetJson !== null)) ||
      (row.disposition === "merge" &&
        (row.targetPersonId === null || row.expectedTargetJson === null))
    ) {
      context.addIssue({
        code: "custom",
        path: ["disposition"],
        message: "Import disposition and target must agree",
      });
    }
  });
const rowsJson = z.string().refine((value) => {
  try {
    return z.array(importRowSchema).min(1).max(25).safeParse(JSON.parse(value))
      .success;
  } catch {
    return false;
  }
});
const importSchema = z.strictObject({
  attachmentReference: reference,
  attachmentDigest: digest,
  originalName: z.string().min(1).max(255),
  previewFingerprint: digest,
  duplicateSnapshotJson: z.string().refine((value) => {
    try {
      return z
        .array(
          z.strictObject({
            rowNumber: z.number().int().min(2).max(27),
            email: z.string().email().max(255).nullable(),
            phone: z.string().max(50).nullable(),
            firstName: z.string().trim().min(1).max(255),
            lastName: z.string().trim().min(1).max(255),
            matchIds: z.array(z.string().uuid()).max(6),
          })
        )
        .min(1)
        .max(25)
        .safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  }),
  rowsJson,
  totalRows: z.number().int().min(1).max(25),
  createCount: z.number().int().nonnegative().max(25),
  mergeCount: z.number().int().nonnegative().max(25),
  skipCount: z.number().int().nonnegative().max(25),
  invalidCount: z.number().int().nonnegative().max(25),
});

const PLANS = {
  photo: defineEvryPlanCapability({
    identity: PEOPLE_FILE_IDENTITIES.photo,
    effectClass: "file_storage_write",
    arguments: photoSchema.shape,
  }),
  import: defineEvryPlanCapability({
    identity: PEOPLE_FILE_IDENTITIES.import,
    effectClass: "database_write",
    arguments: importSchema.shape,
  }),
} as const;

function exactTuple(input: EvryEffectInput, identity: string): boolean {
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === input.authorization.actor.userId &&
    input.execution.plantId === input.authorization.actor.plantId
  );
}
function parseRows(value: string): EvryImportPersonRow[] {
  return z.array(importRowSchema).parse(JSON.parse(value));
}
function fingerprint(preview: ImportPreview): string {
  return createHash("sha256").update(JSON.stringify(preview)).digest("hex");
}
function duplicateSnapshot(preview: ImportPreview) {
  return [...preview.validRows, ...preview.duplicateRows]
    .toSorted((a, b) => a.rowNumber - b.rowNumber)
    .map((row) => ({
      rowNumber: row.rowNumber,
      email: row.data.email?.trim().toLocaleLowerCase("en-US") || null,
      phone: row.data.phone || null,
      firstName: row.data.firstName?.trim() ?? "",
      lastName: row.data.lastName?.trim() ?? "",
      matchIds: [
        ...(row.duplicates.exactMatch ? [row.duplicates.exactMatch.id] : []),
        ...row.duplicates.potentialMatches.map(({ id }) => id),
      ],
    }));
}
function uuidFromHash(value: string): string {
  const hex = createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

export const PEOPLE_FILE_EXECUTIONS = [
  defineEvryExecutionCapability({
    planCapability: PLANS.photo,
    async executeIfCurrent(input) {
      const args = photoSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.photo.identity))
        return { status: "refused", excludedCount: 1 };
      const replay = await recoverCompletedEvryPeopleEffect(input);
      if (replay) return replay;
      const current = await getEvryPersonPhotoSnapshot(
        input.authorization.actor.plantId,
        args.data.personId
      );
      if (!current || current.digest !== args.data.currentPhotoDigest)
        return { status: "refused", excludedCount: 1 };
      const attachment = await readExactEvryPeopleAttachment({
        reference: args.data.attachmentReference,
        actor: input.authorization.actor,
        expectedKind: "person_photo",
        expectedDigest: args.data.attachmentDigest,
      });
      if (
        !attachment ||
        attachment.document.personId !== args.data.personId ||
        attachment.document.contentType !== args.data.contentType ||
        attachment.document.size !== args.data.size ||
        attachment.document.originalName !== args.data.originalName
      )
        return { status: "refused", excludedCount: 1 };
      return claimEvryPersonPhotoMutation({
        execution: input.execution,
        effectKey: input.effectKey,
        personId: args.data.personId,
        expectedDigest: args.data.currentPhotoDigest,
        mutation: {
          kind: "upload",
          attachmentDigest: args.data.attachmentDigest,
          bytes: attachment.bytes,
          contentType: args.data.contentType,
        },
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.import,
    async executeIfCurrent(input) {
      const args = importSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.import.identity))
        return { status: "refused", excludedCount: 1 };
      const replay = await recoverCompletedEvryPeopleEffect(input);
      if (replay) return replay;
      const attachment = await readExactEvryPeopleAttachment({
        reference: args.data.attachmentReference,
        actor: input.authorization.actor,
        expectedKind: "people_csv",
        expectedDigest: args.data.attachmentDigest,
      });
      if (
        !attachment ||
        attachment.document.originalName !== args.data.originalName
      )
        return { status: "refused", excludedCount: 1 };
      const preview = await parseCsvImport(
        attachment.bytes.toString("utf8"),
        input.authorization.actor.plantId
      );
      if (fingerprint(preview) !== args.data.previewFingerprint)
        return { status: "refused", excludedCount: 1 };
      return claimEvryBulkImport({
        execution: input.execution,
        effectKey: input.effectKey,
        rows: parseRows(args.data.rowsJson),
        duplicateSnapshotJson: args.data.duplicateSnapshotJson,
      });
    },
  }),
] as const;
export const PEOPLE_FILE_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(PEOPLE_FILE_EXECUTIONS);
export const PEOPLE_FILE_PLAN_REGISTRY =
  PEOPLE_FILE_EXECUTION_REGISTRY.planRegistry;

function target(label: string, value: string, href?: string) {
  return {
    label,
    value,
    sourceLink: href ? { label: `Open ${value}`, href } : null,
  };
}
export const PEOPLE_FILE_REVIEWS = [
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [PEOPLE_FILE_IDENTITIES.photo],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = photoSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Replace ${args.personLabel}'s photo`,
        actionLabel: "Upload photo",
        consequences: [
          "Stores this exact image and replaces the person's current photo.",
          "The previous photo object is removed after the database change commits.",
        ],
        steps: [
          {
            stepId: step.id,
            title: "Upload person photo",
            effectKind: "other",
            reversibility: "difficult_to_reverse",
            resolvedTargets: [
              target("Person", args.personLabel, `/people/${args.personId}`),
              target("File", args.originalName),
            ],
            counts: [
              { label: "Files to store", count: 1 },
              { label: "Bytes", count: args.size },
            ],
            exclusions: [],
            dateTime: null,
            contentPreviews: [
              { label: "SHA-256", content: args.attachmentDigest },
            ],
            beforeAfter: [
              {
                label: "Photo",
                before: args.currentPhotoDigest ? "Existing photo" : "No photo",
                after: args.originalName,
                count: 1,
              },
            ],
          },
        ],
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [PEOPLE_FILE_IDENTITIES.import],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = importSchema.parse(step.arguments);
      const rows = parseRows(args.rowsJson);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Apply ${args.createCount + args.mergeCount} People changes from ${args.originalName}`,
        actionLabel: "Import people",
        consequences: [
          "Creates every listed person and timeline entry atomically. Any changed duplicate result refuses the whole import.",
        ],
        steps: [
          {
            stepId: step.id,
            title: "Execute bulk import",
            effectKind: "file_import",
            reversibility: "difficult_to_reverse",
            resolvedTargets: rows.map((row) => {
              if (row.disposition === "create")
                return target("New person", `${row.firstName} ${row.lastName}`);
              const existing = z
                .strictObject({
                  firstName: z.string(),
                  lastName: z.string(),
                })
                .passthrough()
                .parse(JSON.parse(row.expectedTargetJson!));
              return target(
                "Merge target",
                `${existing.firstName} ${existing.lastName}`,
                `/people/${row.targetPersonId}`
              );
            }),
            counts: [
              { label: "CSV rows", count: args.totalRows },
              { label: "People to create", count: args.createCount },
              { label: "People to merge", count: args.mergeCount },
              { label: "Rows to skip", count: args.skipCount },
              { label: "Invalid rows", count: args.invalidCount },
            ],
            exclusions: [
              ...(args.skipCount
                ? [
                    {
                      reason: "Duplicate rows explicitly marked skip",
                      count: args.skipCount,
                    },
                  ]
                : []),
              ...(args.invalidCount
                ? [{ reason: "Invalid CSV rows", count: args.invalidCount }]
                : []),
            ],
            dateTime: null,
            contentPreviews: [
              { label: "CSV SHA-256", content: args.attachmentDigest },
            ],
            beforeAfter: rows.map((row) => ({
              label: `Row ${row.rowNumber}: ${row.firstName} ${row.lastName}`,
              before: "No new person",
              after: "Person created",
              count: 1,
            })),
          },
        ],
      });
    },
  }),
] as const;
export const PEOPLE_FILE_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(PEOPLE_FILE_REVIEWS);

function normalizedRow(input: {
  actor: EvryPlantActor;
  digest: string;
  row: ImportRow;
  disposition?: "create" | "merge";
  targetPersonId?: string | null;
  expectedTargetJson?: string | null;
}): EvryImportPersonRow | null {
  const parsed = personCreateSchema.safeParse({
    ...input.row.data,
    email: input.row.data.email || undefined,
    phone: input.row.data.phone || undefined,
    source: input.row.data.source || undefined,
    addressLine1: input.row.data.addressLine1 || undefined,
    addressLine2: input.row.data.addressLine2 || undefined,
    city: input.row.data.city || undefined,
    state: input.row.data.state || undefined,
    postalCode: input.row.data.postalCode || undefined,
    country: input.row.data.country || undefined,
    notes: input.row.data.notes || undefined,
    status: "prospect",
  });
  if (!parsed.success) return null;
  const rowKey = createHash("sha256")
    .update(
      `${input.actor.plantId}:${input.digest}:${input.row.rowNumber}:${JSON.stringify(parsed.data)}`
    )
    .digest("hex");
  return importRowSchema.parse({
    rowNumber: input.row.rowNumber,
    rowKey,
    personId: uuidFromHash(`${input.actor.plantId}:${rowKey}`),
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    source: parsed.data.source ?? null,
    addressLine1: parsed.data.addressLine1 || null,
    addressLine2: parsed.data.addressLine2 || null,
    city: parsed.data.city || null,
    state: parsed.data.state || null,
    postalCode: parsed.data.postalCode || null,
    country: parsed.data.country,
    notes: parsed.data.notes || null,
    disposition: input.disposition ?? "create",
    targetPersonId: input.targetPersonId ?? null,
    expectedTargetJson: input.expectedTargetJson ?? null,
  });
}

async function storeProposal(input: {
  actor: EvryPlantActor;
  requestKey: EvryPlanRequestKey;
  identity: string;
  args: Record<string, unknown>;
  registry: typeof PEOPLE_FILE_PLAN_REGISTRY;
}) {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id:
            input.identity === PEOPLE_FILE_IDENTITIES.photo
              ? "upload-photo"
              : "bulk-import",
          capabilityIdentity: input.identity,
          arguments: input.args,
          dependsOn: [],
        },
      ],
    },
    registry: input.registry,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(input.actor),
  });
  const stored = await createEvryActionPlanRecord({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey: input.requestKey,
    document,
  });
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: PEOPLE_FILE_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

export async function proposePeoplePhotoUpload(input: {
  actor: EvryPlantActor;
  reference: string;
  requestKey: EvryPlanRequestKey;
}) {
  const authorization = await authorizeEvryEffectCapability(
    PEOPLE_FILE_IDENTITIES.photo
  );
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  )
    return null;
  const attachment = openEvryPeopleAttachmentReference({
    reference: input.reference,
    actor: input.actor,
    expectedKind: "person_photo",
  });
  if (!attachment?.personId) return null;
  const [person, current] = await Promise.all([
    getPerson(input.actor.plantId, attachment.personId),
    getEvryPersonPhotoSnapshot(input.actor.plantId, attachment.personId),
  ]);
  if (!person || !current) return null;
  return storeProposal({
    actor: input.actor,
    requestKey: input.requestKey,
    identity: PEOPLE_FILE_IDENTITIES.photo,
    registry: PEOPLE_FILE_PLAN_REGISTRY,
    args: {
      personId: person.id,
      personLabel: `${person.firstName} ${person.lastName}`.trim(),
      expectedFirstName: person.firstName,
      expectedLastName: person.lastName,
      currentPhotoDigest: current.digest,
      attachmentReference: input.reference,
      attachmentDigest: attachment.digest,
      contentType: attachment.contentType,
      size: attachment.size,
      originalName: attachment.originalName,
    },
  });
}

export async function proposePeopleImport(input: {
  actor: EvryPlantActor;
  reference: string;
  duplicateResolutions: Readonly<Record<string, "skip" | "create" | "merge">>;
  requestKey: EvryPlanRequestKey;
}) {
  const authorization = await authorizeEvryEffectCapability(
    PEOPLE_FILE_IDENTITIES.import
  );
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  )
    return null;
  const opened = openEvryPeopleAttachmentReference({
    reference: input.reference,
    actor: input.actor,
    expectedKind: "people_csv",
  });
  if (!opened) return null;
  const attachment = await readExactEvryPeopleAttachment({
    reference: input.reference,
    actor: input.actor,
    expectedKind: "people_csv",
    expectedDigest: opened.digest,
  });
  if (!attachment) return null;
  const preview = await parseCsvImport(
    attachment.bytes.toString("utf8"),
    input.actor.plantId
  );
  const duplicateRows = preview.duplicateRows;
  if (
    duplicateRows.some(
      (row) => !input.duplicateResolutions[String(row.rowNumber)]
    ) ||
    Object.keys(input.duplicateResolutions).some(
      (key) => !duplicateRows.some((row) => String(row.rowNumber) === key)
    )
  )
    return null;
  const createRows = [
    ...preview.validRows,
    ...duplicateRows.filter(
      (row) => input.duplicateResolutions[String(row.rowNumber)] === "create"
    ),
  ].toSorted((a, b) => a.rowNumber - b.rowNumber);
  const rows = createRows.map((row) =>
    normalizedRow({ actor: input.actor, digest: opened.digest, row })
  );
  const mergeRows = await Promise.all(
    duplicateRows
      .filter(
        (row) => input.duplicateResolutions[String(row.rowNumber)] === "merge"
      )
      .map(async (row) => {
        const target =
          row.duplicates.exactMatch ?? row.duplicates.potentialMatches[0];
        if (!target) return null;
        const person = await getPerson(input.actor.plantId, target.id);
        if (!person) return null;
        return normalizedRow({
          actor: input.actor,
          digest: opened.digest,
          row,
          disposition: "merge",
          targetPersonId: person.id,
          expectedTargetJson: JSON.stringify({
            firstName: person.firstName,
            lastName: person.lastName,
            email: person.email,
            phone: person.phone,
            addressLine1: person.addressLine1,
            addressLine2: person.addressLine2,
            city: person.city,
            state: person.state,
            postalCode: person.postalCode,
            country: person.country,
            status: person.status,
            backgroundCheckStatus: person.backgroundCheckStatus,
            source: person.source,
            sourceDetails: person.sourceDetails,
            notes: person.notes,
            householdId: person.householdId,
            householdRole: person.householdRole,
          }),
        });
      })
  );
  const allRows = [...rows, ...mergeRows].toSorted(
    (a, b) => (a?.rowNumber ?? 0) - (b?.rowNumber ?? 0)
  );
  if (!allRows.length || allRows.some((row) => !row)) return null;
  return storeProposal({
    actor: input.actor,
    requestKey: input.requestKey,
    identity: PEOPLE_FILE_IDENTITIES.import,
    registry: PEOPLE_FILE_PLAN_REGISTRY,
    args: {
      attachmentReference: input.reference,
      attachmentDigest: opened.digest,
      originalName: opened.originalName,
      previewFingerprint: fingerprint(preview),
      duplicateSnapshotJson: JSON.stringify(duplicateSnapshot(preview)),
      rowsJson: JSON.stringify(allRows),
      totalRows: preview.totalRows,
      createCount: rows.length,
      mergeCount: mergeRows.length,
      skipCount: duplicateRows.filter(
        (row) => input.duplicateResolutions[String(row.rowNumber)] === "skip"
      ).length,
      invalidCount: preview.invalidRows.length,
    },
  });
}

export async function peopleFileTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}): Promise<boolean> {
  if (input.step.capabilityIdentity === PEOPLE_FILE_IDENTITIES.photo) {
    const args = photoSchema.safeParse(input.step.arguments);
    if (!args.success) return false;
    const [person, current, attachment] = await Promise.all([
      getPerson(input.actor.plantId, args.data.personId),
      getEvryPersonPhotoSnapshot(input.actor.plantId, args.data.personId),
      readExactEvryPeopleAttachment({
        reference: args.data.attachmentReference,
        actor: input.actor,
        expectedKind: "person_photo",
        expectedDigest: args.data.attachmentDigest,
      }),
    ]);
    return Boolean(
      person &&
      current &&
      attachment &&
      person.firstName === args.data.expectedFirstName &&
      person.lastName === args.data.expectedLastName &&
      current.digest === args.data.currentPhotoDigest &&
      attachment.document.personId === person.id
    );
  }
  const args = importSchema.safeParse(input.step.arguments);
  if (!args.success) return false;
  const attachment = await readExactEvryPeopleAttachment({
    reference: args.data.attachmentReference,
    actor: input.actor,
    expectedKind: "people_csv",
    expectedDigest: args.data.attachmentDigest,
  });
  if (!attachment) return false;
  return (
    fingerprint(
      await parseCsvImport(
        attachment.bytes.toString("utf8"),
        input.actor.plantId
      )
    ) === args.data.previewFingerprint
  );
}
