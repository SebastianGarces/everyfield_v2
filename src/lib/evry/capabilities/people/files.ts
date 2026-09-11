import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { personSources } from "@/db/schema";
import { exactEvryContentPages } from "@/lib/evry/artifacts/exact-content-pages";
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
import { EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH } from "@/lib/evry/capabilities/people/attachment-contract";
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
const reference = z
  .string()
  .min(1)
  .max(EVRY_PEOPLE_ATTACHMENT_REFERENCE_MAX_LENGTH);
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
const importRowsSchema = z
  .array(importRowSchema)
  .min(1)
  .max(25)
  .superRefine((rows, context) => {
    const unique = (
      values: readonly (string | number | null)[],
      path: string,
      allowNull = false
    ) => {
      const present = allowNull
        ? values.filter((value) => value !== null)
        : values;
      if (new Set(present).size !== present.length) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `Import ${path} values must be unique`,
        });
      }
    };
    unique(
      rows.map(({ rowNumber }) => rowNumber),
      "rowNumber"
    );
    unique(
      rows.map(({ rowKey }) => rowKey),
      "rowKey"
    );
    unique(
      rows.map(({ personId }) => personId),
      "personId"
    );
    unique(
      rows
        .filter(({ disposition }) => disposition === "merge")
        .map(({ targetPersonId }) => targetPersonId),
      "targetPersonId",
      true
    );
  });
const rowsJson = z.string().refine((value) => {
  try {
    return importRowsSchema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
});
const importSnapshotRowSchema = z
  .strictObject({
    rowNumber: z.number().int().min(2).max(27),
    email: z.string().email().max(255).nullable(),
    phone: z.string().max(50).nullable(),
    firstName: z.string().trim().min(1).max(255),
    lastName: z.string().trim().min(1).max(255),
    matchIds: z.array(z.string().uuid()).max(6),
    disposition: z.enum(["create", "merge", "skip"]),
    targetPersonId: z.string().uuid().nullable(),
  })
  .superRefine((row, context) => {
    if (
      (row.disposition === "merge") !== (row.targetPersonId !== null) ||
      (row.targetPersonId !== null &&
        !row.matchIds.includes(row.targetPersonId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetPersonId"],
        message:
          "Import merge targets must be exact reviewed duplicate matches",
      });
    }
  });
const importSnapshotSchema = z
  .array(importSnapshotRowSchema)
  .min(1)
  .max(25)
  .superRefine((rows, context) => {
    if (new Set(rows.map(({ rowNumber }) => rowNumber)).size !== rows.length) {
      context.addIssue({
        code: "custom",
        path: ["rowNumber"],
        message: "Import preview rows must be unique",
      });
    }
    const mergeTargets = rows.flatMap((row) =>
      row.targetPersonId ? [row.targetPersonId] : []
    );
    if (new Set(mergeTargets).size !== mergeTargets.length) {
      context.addIssue({
        code: "custom",
        path: ["targetPersonId"],
        message: "Two import rows cannot merge into one existing person",
      });
    }
  });
const importSchema = z.strictObject({
  attachmentReference: reference,
  attachmentDigest: digest,
  originalName: z.string().min(1).max(255),
  previewFingerprint: digest,
  duplicateSnapshotJson: z.string().refine((value) => {
    try {
      return importSnapshotSchema.safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  }),
  rowsJson,
  totalRows: z.number().int().min(1).max(25),
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
  return importRowsSchema.parse(JSON.parse(value));
}
function parseImportSnapshot(value: string) {
  return importSnapshotSchema.parse(JSON.parse(value));
}
function fingerprint(preview: ImportPreview): string {
  return createHash("sha256").update(JSON.stringify(preview)).digest("hex");
}
function duplicateSnapshot(
  preview: ImportPreview,
  resolutions: Readonly<Record<string, "skip" | "create" | "merge">>
) {
  return [...preview.validRows, ...preview.duplicateRows]
    .toSorted((a, b) => a.rowNumber - b.rowNumber)
    .map((row) => {
      const duplicate = preview.duplicateRows.some(
        ({ rowNumber }) => rowNumber === row.rowNumber
      );
      const disposition = duplicate
        ? resolutions[String(row.rowNumber)]!
        : ("create" as const);
      const mergeTarget =
        disposition === "merge"
          ? (row.duplicates.exactMatch ?? row.duplicates.potentialMatches[0])
          : null;
      return importSnapshotRowSchema.parse({
        rowNumber: row.rowNumber,
        email: row.data.email?.trim().toLocaleLowerCase("en-US") || null,
        phone: row.data.phone || null,
        firstName: row.data.firstName?.trim() ?? "",
        lastName: row.data.lastName?.trim() ?? "",
        matchIds: [
          ...(row.duplicates.exactMatch ? [row.duplicates.exactMatch.id] : []),
          ...row.duplicates.potentialMatches.map(({ id }) => id),
        ],
        disposition,
        targetPersonId: mergeTarget?.id ?? null,
      });
    });
}

function plannedImportMatchesPreview(input: {
  actor: EvryPlantActor;
  digest: string;
  preview: ImportPreview;
  rows: readonly EvryImportPersonRow[];
  snapshot: z.infer<typeof importSnapshotSchema>;
}): boolean {
  const duplicateRowNumbers = new Set(
    input.preview.duplicateRows.map(({ rowNumber }) => rowNumber)
  );
  const resolutions = Object.fromEntries(
    input.snapshot
      .filter(({ rowNumber }) => duplicateRowNumbers.has(rowNumber))
      .map(({ rowNumber, disposition }) => [String(rowNumber), disposition])
  ) as Record<string, "skip" | "create" | "merge">;
  const expectedSnapshot = duplicateSnapshot(input.preview, resolutions);
  if (!isDeepStrictEqual(input.snapshot, expectedSnapshot)) return false;
  const previewRows = new Map(
    [...input.preview.validRows, ...input.preview.duplicateRows].map((row) => [
      row.rowNumber,
      row,
    ])
  );
  const rowsByNumber = new Map(input.rows.map((row) => [row.rowNumber, row]));
  if (rowsByNumber.size !== input.rows.length) return false;
  for (const decision of input.snapshot) {
    const row = rowsByNumber.get(decision.rowNumber);
    if (decision.disposition === "skip") {
      if (row) return false;
      continue;
    }
    const source = previewRows.get(decision.rowNumber);
    if (!row || !source) return false;
    const normalized = normalizedRow({
      actor: input.actor,
      digest: input.digest,
      row: source,
      disposition: decision.disposition,
      targetPersonId: decision.targetPersonId,
      expectedTargetJson: row.expectedTargetJson,
    });
    if (!normalized || !isDeepStrictEqual(row, normalized)) return false;
  }
  return input.rows.length === rowsByNumber.size;
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
      const rows = parseRows(args.data.rowsJson);
      const snapshot = parseImportSnapshot(args.data.duplicateSnapshotJson);
      if (
        fingerprint(preview) !== args.data.previewFingerprint ||
        preview.totalRows !== args.data.totalRows ||
        !plannedImportMatchesPreview({
          actor: input.authorization.actor,
          digest: args.data.attachmentDigest,
          preview,
          rows,
          snapshot,
        })
      )
        return { status: "refused", excludedCount: 1 };
      return claimEvryBulkImport({
        execution: input.execution,
        effectKey: input.effectKey,
        rows,
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

function importCounts(
  snapshot: z.infer<typeof importSnapshotSchema>,
  total: number
) {
  const count = (disposition: "create" | "merge" | "skip") =>
    snapshot.filter((row) => row.disposition === disposition).length;
  return {
    create: count("create"),
    merge: count("merge"),
    skip: count("skip"),
    invalid: total - snapshot.length,
  };
}

function importRowDisclosure(row: EvryImportPersonRow): string {
  const incoming = {
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    source: row.source,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    notes: row.notes,
  };
  return JSON.stringify(
    row.disposition === "create"
      ? { disposition: "create", rowNumber: row.rowNumber, incoming }
      : {
          disposition: "merge",
          rowNumber: row.rowNumber,
          targetPersonId: row.targetPersonId,
          before: JSON.parse(row.expectedTargetJson!),
          incoming,
        }
  );
}

function exactImportRowPages(row: EvryImportPersonRow) {
  const content = importRowDisclosure(row);
  const pages = exactEvryContentPages(content);
  return pages.map((page, index) => ({
    label: `Row ${row.rowNumber} ${row.disposition} · page ${index + 1} of ${pages.length}`,
    content: page,
  }));
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
      const snapshot = parseImportSnapshot(args.duplicateSnapshotJson);
      const counts = importCounts(snapshot, args.totalRows);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Apply ${counts.create + counts.merge} People changes from ${args.originalName}`,
        actionLabel: "Import people",
        consequences: [
          `Creates ${counts.create} People records, merges ${counts.merge} exact existing targets, and writes one timeline entry per changed CSV row atomically. Any changed duplicate result refuses the whole import.`,
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
              { label: "People to create", count: counts.create },
              { label: "People to merge", count: counts.merge },
              { label: "Rows to skip", count: counts.skip },
              { label: "Invalid rows", count: counts.invalid },
            ],
            exclusions: [
              ...(counts.skip
                ? [
                    {
                      reason: "Duplicate rows explicitly marked skip",
                      count: counts.skip,
                    },
                  ]
                : []),
              ...(counts.invalid
                ? [{ reason: "Invalid CSV rows", count: counts.invalid }]
                : []),
            ],
            dateTime: null,
            contentPreviews: [
              { label: "CSV SHA-256", content: args.attachmentDigest },
              ...rows.flatMap(exactImportRowPages),
            ],
            beforeAfter: rows.map((row) => ({
              label: `Row ${row.rowNumber}: ${row.firstName} ${row.lastName}`,
              before:
                row.disposition === "create"
                  ? "No person"
                  : "Exact existing merge target shown below",
              after:
                row.disposition === "create"
                  ? "Person created from the exact reviewed row"
                  : "Existing person receives only the exact reviewed merge fields",
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
  const plannedRows = importRowsSchema.safeParse(allRows);
  const snapshot = importSnapshotSchema.safeParse(
    duplicateSnapshot(preview, input.duplicateResolutions)
  );
  if (!plannedRows.success || !snapshot.success) return null;
  if (
    !plannedImportMatchesPreview({
      actor: input.actor,
      digest: opened.digest,
      preview,
      rows: plannedRows.data,
      snapshot: snapshot.data,
    })
  )
    return null;
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
      duplicateSnapshotJson: JSON.stringify(snapshot.data),
      rowsJson: JSON.stringify(plannedRows.data),
      totalRows: preview.totalRows,
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
  const preview = await parseCsvImport(
    attachment.bytes.toString("utf8"),
    input.actor.plantId
  );
  return (
    fingerprint(preview) === args.data.previewFingerprint &&
    preview.totalRows === args.data.totalRows &&
    plannedImportMatchesPreview({
      actor: input.actor,
      digest: args.data.attachmentDigest,
      preview,
      rows: parseRows(args.data.rowsJson),
      snapshot: parseImportSnapshot(args.data.duplicateSnapshotJson),
    })
  );
}
