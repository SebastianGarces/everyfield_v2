import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  commitmentTypes,
  interviewResults,
  interviewStatuses,
  personStatuses,
  users,
} from "@/db/schema";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  openEvryPeopleAttachmentReference,
  readExactEvryPeopleAttachment,
} from "@/lib/evry/capabilities/people/attachments";
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
import type { EvryResolvedPageContext } from "@/lib/evry/resolvers/contract";
import {
  claimEvryCreateAssessment,
  claimEvryCreateCommitment,
  claimEvryCreateInterview,
} from "@/lib/people/evry-milestones";
import { recoverCompletedEvryPeopleEffect } from "@/lib/people/evry-effect";
import { getPerson } from "@/lib/people/service";
import {
  commitmentDocumentStorageKey,
  getExtensionFromMimeType,
  uploadFile,
} from "@/lib/storage";

export const MILESTONE_IDENTITIES = {
  assessment: "people.crm.assessments.create-assessment",
  interview: "people.crm.assessments.create-interview",
  commitment: "people.crm.assessments.create-commitment",
} as const;

const nullableNotes = z.string().max(4_000).nullable();
const calendarDate = z.string().refine((value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
});
const personBaseline = {
  personId: z.string().uuid(),
  personLabel: z.string().min(1).max(511),
  expectedFirstName: z.string().min(1).max(255),
  expectedLastName: z.string().max(255),
  expectedStatus: z.enum(personStatuses),
};
const assessmentSchema = z.strictObject({
  ...personBaseline,
  assessmentDate: calendarDate,
  committedScore: z.number().int().min(1).max(5),
  committedNotes: nullableNotes,
  compelledScore: z.number().int().min(1).max(5),
  compelledNotes: nullableNotes,
  contagiousScore: z.number().int().min(1).max(5),
  contagiousNotes: nullableNotes,
  courageousScore: z.number().int().min(1).max(5),
  courageousNotes: nullableNotes,
});
const interviewSchema = z.strictObject({
  ...personBaseline,
  interviewDate: calendarDate,
  maturityStatus: z.enum(interviewStatuses),
  maturityNotes: nullableNotes,
  giftedStatus: z.enum(interviewStatuses),
  giftedNotes: nullableNotes,
  chemistryStatus: z.enum(interviewStatuses),
  chemistryNotes: nullableNotes,
  rightReasonsStatus: z.enum(interviewStatuses),
  rightReasonsNotes: nullableNotes,
  seasonStatus: z.enum(interviewStatuses),
  seasonNotes: nullableNotes,
  overallResult: z.enum(interviewResults),
  nextSteps: nullableNotes,
  resultingStatus: z.literal("interviewed"),
});
const witnessSchema = z
  .strictObject({
    id: z.string().uuid(),
    label: z.string().min(1).max(255),
  })
  .nullable();
const witnessJson = z.string().refine((value) => {
  try {
    return witnessSchema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
});
const commitmentAttachmentSchema = z
  .strictObject({
    reference: z.string().min(1).max(4_000),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    contentType: z.enum([
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ]),
    size: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    originalName: z.string().min(1).max(255),
  })
  .nullable();
const attachmentJson = z.string().refine((value) => {
  try {
    return commitmentAttachmentSchema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
});
const commitmentShape = {
  ...personBaseline,
  commitmentType: z.enum(commitmentTypes),
  signedDate: calendarDate,
  witnessJson,
  notes: nullableNotes,
  attachmentJson,
  resultingStatus: z.literal("core_group"),
};
const commitmentSchema = z.strictObject(commitmentShape);

type Values = Readonly<Record<string, string>>;
export type MilestoneSelection = Readonly<{
  kind: "assessment" | "interview" | "commitment";
  values: Values;
}>;

const KEYS = {
  assessment: new Set([
    "date",
    "committed",
    "committedNotes",
    "compelled",
    "compelledNotes",
    "contagious",
    "contagiousNotes",
    "courageous",
    "courageousNotes",
  ]),
  interview: new Set([
    "date",
    "maturity",
    "maturityNotes",
    "gifted",
    "giftedNotes",
    "chemistry",
    "chemistryNotes",
    "rightReasons",
    "rightReasonsNotes",
    "season",
    "seasonNotes",
    "result",
    "next",
  ]),
  commitment: new Set(["date", "type", "witness", "notes"]),
} as const;

function keyValues(value: string, allowed: ReadonlySet<string>): Values | null {
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) return null;
    const key = part.slice(0, index).trim();
    if (!allowed.has(key) || key in result) return null;
    result[key] = part.slice(index + 1).trim();
  }
  return Object.keys(result).length ? result : null;
}

export function selectMilestoneRequest(
  textValue: string
): MilestoneSelection | null {
  const match = /^record (assessment|interview|commitment):\s*([\s\S]+)$/i.exec(
    textValue.normalize("NFKC").trim()
  );
  if (!match) return null;
  const kind = match[1]!.toLowerCase() as MilestoneSelection["kind"];
  const values = keyValues(match[2]!, KEYS[kind]);
  return values ? { kind, values } : null;
}

const PLANS = {
  assessment: defineEvryPlanCapability({
    identity: MILESTONE_IDENTITIES.assessment,
    effectClass: "database_write",
    arguments: assessmentSchema.shape,
  }),
  interview: defineEvryPlanCapability({
    identity: MILESTONE_IDENTITIES.interview,
    effectClass: "database_write",
    arguments: interviewSchema.shape,
  }),
  commitment: defineEvryPlanCapability({
    identity: MILESTONE_IDENTITIES.commitment,
    effectClass: "database_write",
    arguments: commitmentShape,
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

function baseline(args: {
  personId: string;
  expectedFirstName: string;
  expectedLastName: string;
  expectedStatus: string;
}) {
  return {
    personId: args.personId,
    firstName: args.expectedFirstName,
    lastName: args.expectedLastName,
    status: args.expectedStatus,
  };
}

export const MILESTONE_EXECUTIONS = [
  defineEvryExecutionCapability({
    planCapability: PLANS.assessment,
    async executeIfCurrent(input) {
      const args = assessmentSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.assessment.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryCreateAssessment({
        execution: input.execution,
        effectKey: input.effectKey,
        person: baseline(args.data),
        values: {
          assessmentDate: args.data.assessmentDate,
          committedScore: args.data.committedScore,
          committedNotes: args.data.committedNotes,
          compelledScore: args.data.compelledScore,
          compelledNotes: args.data.compelledNotes,
          contagiousScore: args.data.contagiousScore,
          contagiousNotes: args.data.contagiousNotes,
          courageousScore: args.data.courageousScore,
          courageousNotes: args.data.courageousNotes,
        },
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.interview,
    async executeIfCurrent(input) {
      const args = interviewSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.interview.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryCreateInterview({
        execution: input.execution,
        effectKey: input.effectKey,
        person: baseline(args.data),
        values: {
          interviewDate: args.data.interviewDate,
          maturityStatus: args.data.maturityStatus,
          maturityNotes: args.data.maturityNotes,
          giftedStatus: args.data.giftedStatus,
          giftedNotes: args.data.giftedNotes,
          chemistryStatus: args.data.chemistryStatus,
          chemistryNotes: args.data.chemistryNotes,
          rightReasonsStatus: args.data.rightReasonsStatus,
          rightReasonsNotes: args.data.rightReasonsNotes,
          seasonStatus: args.data.seasonStatus,
          seasonNotes: args.data.seasonNotes,
          overallResult: args.data.overallResult,
          nextSteps: args.data.nextSteps,
        },
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.commitment,
    async executeIfCurrent(input) {
      const args = commitmentSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.commitment.identity))
        return { status: "refused", excludedCount: 1 };
      const replay = await recoverCompletedEvryPeopleEffect(input);
      if (replay) return replay;
      const plannedAttachment = commitmentAttachmentOf(
        args.data.attachmentJson
      );
      let documentKey: string | null = null;
      if (plannedAttachment) {
        const attachment = await readExactEvryPeopleAttachment({
          reference: plannedAttachment.reference,
          actor: input.authorization.actor,
          expectedKind: "commitment_document",
          expectedDigest: plannedAttachment.digest,
        });
        if (
          !attachment ||
          attachment.document.personId !== args.data.personId ||
          attachment.document.contentType !== plannedAttachment.contentType ||
          attachment.document.size !== plannedAttachment.size ||
          attachment.document.originalName !== plannedAttachment.originalName
        )
          return { status: "refused", excludedCount: 1 };
        const objectId = objectIdFor(
          `${input.effectKey}:${plannedAttachment.digest}`
        );
        documentKey = commitmentDocumentStorageKey(
          input.authorization.actor.plantId,
          args.data.personId,
          getExtensionFromMimeType(plannedAttachment.contentType),
          objectId
        );
        await uploadFile(
          documentKey,
          attachment.bytes,
          plannedAttachment.contentType
        );
      }
      return claimEvryCreateCommitment({
        execution: input.execution,
        effectKey: input.effectKey,
        person: baseline(args.data),
        values: {
          commitmentType: args.data.commitmentType,
          signedDate: args.data.signedDate,
          witnessedBy: witnessOf(args.data.witnessJson)?.id ?? null,
          witnessLabel: witnessOf(args.data.witnessJson)?.label ?? null,
          notes: args.data.notes,
          documentKey,
        },
      });
    },
  }),
] as const;
export const MILESTONE_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(MILESTONE_EXECUTIONS);
export const MILESTONE_PLAN_REGISTRY =
  MILESTONE_EXECUTION_REGISTRY.planRegistry;

function target(label: string, value: string, href?: string) {
  return {
    label,
    value,
    sourceLink: href ? { label: `Open ${value}`, href } : null,
  };
}
function preview(label: string, content: string | null) {
  return content ? [{ label, content }] : [];
}

function witnessOf(value: string): z.infer<typeof witnessSchema> {
  return witnessSchema.parse(JSON.parse(value));
}

function commitmentAttachmentOf(
  value: string
): z.infer<typeof commitmentAttachmentSchema> {
  return commitmentAttachmentSchema.parse(JSON.parse(value));
}

function objectIdFor(value: string): string {
  const hex = createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = "8";
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

export const MILESTONE_REVIEWS = Object.values(MILESTONE_IDENTITIES).map(
  (identity) =>
    defineEvryArtifactReview({
      source: { kind: "generic", capabilityIdentities: [identity] },
      build({ plan, document }) {
        const step = document.steps[0]!;
        if (identity === MILESTONE_IDENTITIES.assessment) {
          const args = assessmentSchema.parse(step.arguments);
          const scores = [
            ["Committed", args.committedScore, args.committedNotes],
            ["Compelled", args.compelledScore, args.compelledNotes],
            ["Contagious", args.contagiousScore, args.contagiousNotes],
            ["Courageous", args.courageousScore, args.courageousNotes],
          ] as const;
          return buildEvryConfirmationArtifact({
            kind: "confirmation",
            artifactVersion: 1,
            plan,
            title: `Record assessment for ${args.personLabel}`,
            actionLabel: "Record assessment",
            consequences: [
              "Creates one permanent 4 C's assessment and timeline entry.",
            ],
            steps: [
              {
                stepId: step.id,
                title: "Create assessment",
                effectKind: "other",
                reversibility: "irreversible",
                resolvedTargets: [
                  target(
                    "Person",
                    args.personLabel,
                    `/people/${args.personId}`
                  ),
                ],
                counts: [
                  { label: "Assessments to create", count: 1 },
                  {
                    label: "Total score",
                    count: scores.reduce((sum, [, score]) => sum + score, 0),
                  },
                ],
                exclusions: [],
                dateTime: null,
                contentPreviews: scores.flatMap(([label, , notes]) =>
                  preview(`${label} notes`, notes)
                ),
                beforeAfter: [
                  {
                    label: "Assessment date",
                    before: "No new assessment",
                    after: args.assessmentDate,
                    count: 1,
                  },
                  ...scores.map(([label, score]) => ({
                    label,
                    before: "Not recorded",
                    after: `${score}/5`,
                    count: 1,
                  })),
                ],
              },
            ],
          });
        }
        if (identity === MILESTONE_IDENTITIES.interview) {
          const args = interviewSchema.parse(step.arguments);
          const criteria = [
            ["Maturity", args.maturityStatus, args.maturityNotes],
            ["Gifted", args.giftedStatus, args.giftedNotes],
            ["Chemistry", args.chemistryStatus, args.chemistryNotes],
            ["Right reasons", args.rightReasonsStatus, args.rightReasonsNotes],
            ["Season", args.seasonStatus, args.seasonNotes],
          ] as const;
          return buildEvryConfirmationArtifact({
            kind: "confirmation",
            artifactVersion: 1,
            plan,
            title: `Record interview for ${args.personLabel}`,
            actionLabel: "Record interview",
            consequences: [
              "Creates one permanent interview and advances the person to interviewed status.",
            ],
            steps: [
              {
                stepId: step.id,
                title: "Create interview and update status",
                effectKind: "other",
                reversibility: "irreversible",
                resolvedTargets: [
                  target(
                    "Person",
                    args.personLabel,
                    `/people/${args.personId}`
                  ),
                ],
                counts: [{ label: "Interviews to create", count: 1 }],
                exclusions: [],
                dateTime: null,
                contentPreviews: [
                  ...criteria.flatMap(([label, , notes]) =>
                    preview(`${label} notes`, notes)
                  ),
                  ...preview("Next steps", args.nextSteps),
                ],
                beforeAfter: [
                  {
                    label: "Interview date",
                    before: "No new interview",
                    after: args.interviewDate,
                    count: 1,
                  },
                  ...criteria.map(([label, status]) => ({
                    label,
                    before: "Not recorded",
                    after: status,
                    count: 1,
                  })),
                  {
                    label: "Overall result",
                    before: "Not recorded",
                    after: args.overallResult,
                    count: 1,
                  },
                  {
                    label: "Person status",
                    before: args.expectedStatus,
                    after: args.resultingStatus,
                    count: 1,
                  },
                ],
              },
            ],
          });
        }
        const args = commitmentSchema.parse(step.arguments);
        const attachment = commitmentAttachmentOf(args.attachmentJson);
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Record commitment for ${args.personLabel}`,
          actionLabel: "Record commitment",
          consequences: [
            `Creates one permanent commitment${attachment ? " with the exact staged attachment" : " without an attachment"} and advances the person to core group status.`,
          ],
          steps: [
            {
              stepId: step.id,
              title: "Create commitment and update status",
              effectKind: "other",
              reversibility: "irreversible",
              resolvedTargets: [
                target("Person", args.personLabel, `/people/${args.personId}`),
                ...(witnessOf(args.witnessJson)
                  ? [target("Witness", witnessOf(args.witnessJson)!.label)]
                  : []),
                ...(attachment
                  ? [target("File", attachment.originalName)]
                  : []),
              ],
              counts: [
                { label: "Commitments to create", count: 1 },
                { label: "Attachments", count: attachment ? 1 : 0 },
              ],
              exclusions: [],
              dateTime: null,
              contentPreviews: [
                ...preview("Notes", args.notes),
                ...(attachment
                  ? [
                      {
                        label: "Attachment SHA-256",
                        content: attachment.digest,
                      },
                    ]
                  : []),
              ],
              beforeAfter: [
                {
                  label: "Commitment type",
                  before: "Not recorded",
                  after: args.commitmentType,
                  count: 1,
                },
                {
                  label: "Signed date",
                  before: "Not recorded",
                  after: args.signedDate,
                  count: 1,
                },
                {
                  label: "Person status",
                  before: args.expectedStatus,
                  after: args.resultingStatus,
                  count: 1,
                },
              ],
            },
          ],
        });
      },
    })
);
export const MILESTONE_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(MILESTONE_REVIEWS);

function required(values: Values, keys: readonly string[]): boolean {
  return keys.every((key) => values[key] !== undefined);
}
function note(values: Values, key: string) {
  const value = values[key];
  return value ? value : null;
}

export async function proposeMilestoneEffect(input: {
  actor: EvryPlantActor;
  pageContext: EvryResolvedPageContext | null;
  selection: MilestoneSelection;
  requestKey: EvryPlanRequestKey;
  attachmentReference?: string;
}) {
  const identity = MILESTONE_IDENTITIES[input.selection.kind];
  const authorization = await authorizeEvryEffectCapability(identity);
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId ||
    input.pageContext?.kind !== "person"
  )
    return null;
  const person = await getPerson(
    input.actor.plantId,
    input.pageContext.recordId
  );
  if (!person) return null;
  const base = {
    personId: person.id,
    personLabel: `${person.firstName} ${person.lastName}`.trim(),
    expectedFirstName: person.firstName,
    expectedLastName: person.lastName,
    expectedStatus: person.status,
  };
  const value = input.selection.values;
  let args: Record<string, unknown> | null = null;
  if (input.selection.kind === "assessment") {
    if (
      !required(value, [
        "date",
        "committed",
        "compelled",
        "contagious",
        "courageous",
      ])
    )
      return null;
    args = {
      ...base,
      assessmentDate: value.date,
      committedScore: Number(value.committed),
      committedNotes: note(value, "committedNotes"),
      compelledScore: Number(value.compelled),
      compelledNotes: note(value, "compelledNotes"),
      contagiousScore: Number(value.contagious),
      contagiousNotes: note(value, "contagiousNotes"),
      courageousScore: Number(value.courageous),
      courageousNotes: note(value, "courageousNotes"),
    };
  } else if (input.selection.kind === "interview") {
    if (
      !required(value, [
        "date",
        "maturity",
        "gifted",
        "chemistry",
        "rightReasons",
        "season",
        "result",
      ])
    )
      return null;
    args = {
      ...base,
      interviewDate: value.date,
      maturityStatus: value.maturity,
      maturityNotes: note(value, "maturityNotes"),
      giftedStatus: value.gifted,
      giftedNotes: note(value, "giftedNotes"),
      chemistryStatus: value.chemistry,
      chemistryNotes: note(value, "chemistryNotes"),
      rightReasonsStatus: value.rightReasons,
      rightReasonsNotes: note(value, "rightReasonsNotes"),
      seasonStatus: value.season,
      seasonNotes: note(value, "seasonNotes"),
      overallResult: value.result,
      nextSteps: note(value, "next"),
      resultingStatus: "interviewed",
    };
  } else {
    if (!required(value, ["date", "type"])) return null;
    const witnessedBy = value.witness || null;
    let witnessLabel: string | null = null;
    if (witnessedBy) {
      if (!z.string().uuid().safeParse(witnessedBy).success) return null;
      const [witness] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(
          and(
            eq(users.churchId, input.actor.plantId),
            eq(users.id, witnessedBy)
          )
        )
        .limit(1);
      if (!witness) return null;
      witnessLabel = witness.name ?? witness.email;
    }
    let attachment: z.infer<typeof commitmentAttachmentSchema> = null;
    if (input.attachmentReference) {
      const opened = openEvryPeopleAttachmentReference({
        reference: input.attachmentReference,
        actor: input.actor,
        expectedKind: "commitment_document",
      });
      if (!opened || opened.personId !== person.id) return null;
      attachment = commitmentAttachmentSchema.parse({
        reference: input.attachmentReference,
        digest: opened.digest,
        contentType: opened.contentType,
        size: opened.size,
        originalName: opened.originalName,
      });
    }
    args = {
      ...base,
      commitmentType: value.type,
      signedDate: value.date,
      witnessJson: JSON.stringify(
        witnessedBy ? { id: witnessedBy, label: witnessLabel } : null
      ),
      notes: note(value, "notes"),
      attachmentJson: JSON.stringify(attachment),
      resultingStatus: "core_group",
    };
  }
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: input.selection.kind,
          capabilityIdentity: identity,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: MILESTONE_PLAN_REGISTRY,
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
    reviewRegistry: MILESTONE_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

export async function milestoneTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}): Promise<boolean> {
  const schema =
    input.step.capabilityIdentity === MILESTONE_IDENTITIES.assessment
      ? assessmentSchema
      : input.step.capabilityIdentity === MILESTONE_IDENTITIES.interview
        ? interviewSchema
        : commitmentSchema;
  const parsed = schema.safeParse(input.step.arguments);
  if (!parsed.success) return false;
  const person = await getPerson(input.actor.plantId, parsed.data.personId);
  if (
    !person ||
    person.firstName !== parsed.data.expectedFirstName ||
    person.lastName !== parsed.data.expectedLastName ||
    person.status !== parsed.data.expectedStatus
  )
    return false;
  if (input.step.capabilityIdentity !== MILESTONE_IDENTITIES.commitment)
    return true;
  const args = commitmentSchema.parse(parsed.data);
  const expectedWitness = witnessOf(args.witnessJson);
  if (expectedWitness) {
    const [witness] = await db
      .select({ label: users.name, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.churchId, input.actor.plantId),
          eq(users.id, expectedWitness.id)
        )
      )
      .limit(1);
    if (!witness || (witness.label ?? witness.email) !== expectedWitness.label)
      return false;
  }
  const expectedAttachment = commitmentAttachmentOf(args.attachmentJson);
  if (!expectedAttachment) return true;
  const attachment = await readExactEvryPeopleAttachment({
    reference: expectedAttachment.reference,
    actor: input.actor,
    expectedKind: "commitment_document",
    expectedDigest: expectedAttachment.digest,
  });
  return Boolean(
    attachment &&
    attachment.document.personId === args.personId &&
    attachment.document.contentType === expectedAttachment.contentType &&
    attachment.document.size === expectedAttachment.size &&
    attachment.document.originalName === expectedAttachment.originalName
  );
}
