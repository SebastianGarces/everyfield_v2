import { z } from "zod";

import {
  backgroundCheckStatuses,
  householdRoles,
  personSources,
  personStatuses,
} from "@/db/schema";
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
import type { EvryResolvedPageContext } from "@/lib/evry/resolvers/contract";
import {
  claimEvryChangePersonStatus,
  claimEvryCreatePerson,
  claimEvryDeletePerson,
  claimEvryReorderPeople,
  claimEvryUpdatePerson,
  type EvryPersonPayload,
} from "@/lib/people/evry-core";
import { recoverCompletedEvryPeopleEffect } from "@/lib/people/evry-effect";
import { getHousehold } from "@/lib/people/household";
import {
  claimEvryPersonPhotoMutation,
  getEvryPersonPhotoSnapshot,
} from "@/lib/people/person-photo";
import { getPerson } from "@/lib/people/service";
import { validateStatusTransition } from "@/lib/people/status";

export const PEOPLE_CORE_IDENTITIES = {
  create: "people.crm.people.create-person",
  quickAdd: "people.crm.people.quick-add-person",
  update: "people.crm.people.update-person",
  delete: "people.crm.people.delete-person",
  status: "people.crm.people.change-status",
  statusReason: "people.crm.people.change-status-with-reason",
  reorder: "people.crm.stages.reorder-pipeline",
  removePhoto: "people.crm.people.remove-person-photo",
} as const;

const nullable = (max: number) => z.string().max(max).nullable();
const personPayloadSchema = z.strictObject({
  firstName: z.string().trim().min(1).max(255),
  lastName: z.string().trim().min(1).max(255),
  email: z.string().email().max(255).nullable(),
  phone: nullable(50),
  addressLine1: nullable(255),
  addressLine2: nullable(255),
  city: nullable(100),
  state: nullable(100),
  postalCode: nullable(20),
  country: nullable(100),
  status: z.enum(personStatuses),
  backgroundCheckStatus: z.enum(backgroundCheckStatuses),
  source: z.enum(personSources).nullable(),
  sourceDetails: nullable(4_000),
  notes: nullable(20_000),
  householdId: z.string().uuid().nullable(),
  householdRole: z.enum(householdRoles).nullable(),
});

function jsonSchema<Schema extends z.ZodType>(schema: Schema) {
  return z.string().refine((value) => {
    try {
      return schema.safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  });
}

const personJson = jsonSchema(personPayloadSchema);
const createSchema = z.strictObject({
  personJson,
  activitySource: z.enum(["form", "quick_add"]),
  expectedHouseholdName: z.string().max(255).nullable(),
});
const personChangeSchema = z.strictObject({
  personId: z.string().uuid(),
  personLabel: z.string().min(1).max(511),
  baselineJson: personJson,
  afterJson: personJson,
});
const deleteSchema = personChangeSchema.omit({ afterJson: true });
const statusSchema = z.strictObject({
  personId: z.string().uuid(),
  personLabel: z.string().min(1).max(511),
  expectedFirstName: z.string().min(1).max(255),
  expectedLastName: z.string().max(255),
  expectedStatus: z.enum(personStatuses),
  newStatus: z.enum(personStatuses),
  reason: z.string().trim().min(1).max(2_000).nullable(),
  skippedStatuses: z.array(z.enum(personStatuses)).max(personStatuses.length),
});
const reorderEntry = z.strictObject({
  personId: z.string().uuid(),
  personLabel: z.string().min(1).max(511),
  expectedStatus: z.enum(personStatuses),
  expectedOrder: z.number().int(),
  newOrder: z.number().int().nonnegative(),
});
const reorderSchema = z.strictObject({
  entries: z.array(reorderEntry).min(1).max(32),
});
const removePhotoSchema = z.strictObject({
  personId: z.string().uuid(),
  personLabel: z.string().min(1).max(511),
  photoDigest: z.string().regex(/^[0-9a-f]{64}$/),
});

export type PeopleCoreSelection =
  | Readonly<{
      kind: "create" | "quick_add";
      values: Readonly<Record<string, string>>;
    }>
  | Readonly<{ kind: "update"; values: Readonly<Record<string, string>> }>
  | Readonly<{ kind: "delete" | "remove_photo" }>
  | Readonly<{ kind: "status"; status: string; reason: string | null }>
  | Readonly<{ kind: "reorder"; personIds: readonly string[] }>;

const ALLOWED_FIELDS = new Set([
  "first",
  "last",
  "email",
  "phone",
  "address1",
  "address2",
  "city",
  "state",
  "postal",
  "country",
  "background",
  "source",
  "sourceDetails",
  "notes",
  "household",
  "role",
]);

function keyValues(value: string): Readonly<Record<string, string>> | null {
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) return null;
    const key = part.slice(0, index).trim();
    const fieldValue = part.slice(index + 1).trim();
    if (!ALLOWED_FIELDS.has(key) || key in result) return null;
    result[key] = fieldValue;
  }
  return Object.keys(result).length ? result : null;
}

export function selectPeopleCoreRequest(
  textValue: string
): PeopleCoreSelection | null {
  const text = textValue.normalize("NFKC").trim();
  const create = /^(create|quick add) person:\s*([\s\S]+)$/i.exec(text);
  if (create) {
    const values = keyValues(create[2]!);
    return values
      ? {
          kind: create[1]!.toLowerCase() === "create" ? "create" : "quick_add",
          values,
        }
      : null;
  }
  const update = /^update (?:this )?person:\s*([\s\S]+)$/i.exec(text)?.[1];
  if (update) {
    const values = keyValues(update);
    return values ? { kind: "update", values } : null;
  }
  if (/^delete (?:this )?person[.!?]*$/i.test(text)) return { kind: "delete" };
  if (/^remove (?:this )?person(?:'s)? photo[.!?]*$/i.test(text))
    return { kind: "remove_photo" };
  const status =
    /^change (?:this )?person(?:'s)? status to\s+([a-z_]+)(?::\s*([\s\S]+))?[.!?]*$/i.exec(
      text
    );
  if (status && z.enum(personStatuses).safeParse(status[1]).success) {
    return {
      kind: "status",
      status: status[1]!,
      reason: status[2]?.trim() || null,
    };
  }
  const reorder = /^reorder pipeline:\s*([0-9a-f,\s-]+)$/i.exec(text)?.[1];
  if (reorder) {
    const personIds = reorder.split(",").map((id) => id.trim());
    if (
      personIds.length > 0 &&
      personIds.length <= 32 &&
      new Set(personIds).size === personIds.length &&
      personIds.every((id) => z.string().uuid().safeParse(id).success)
    )
      return { kind: "reorder", personIds };
  }
  return null;
}

function payloadOf(
  person: NonNullable<Awaited<ReturnType<typeof getPerson>>>
): EvryPersonPayload {
  return personPayloadSchema.parse({
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
  });
}

function applyValues(
  base: EvryPersonPayload,
  values: Readonly<Record<string, string>>,
  creation: boolean
): EvryPersonPayload | null {
  const map: Record<string, keyof EvryPersonPayload> = {
    first: "firstName",
    last: "lastName",
    email: "email",
    phone: "phone",
    address1: "addressLine1",
    address2: "addressLine2",
    city: "city",
    state: "state",
    postal: "postalCode",
    country: "country",
    background: "backgroundCheckStatus",
    source: "source",
    sourceDetails: "sourceDetails",
    notes: "notes",
    household: "householdId",
    role: "householdRole",
  };
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(values)) {
    const field = map[key];
    if (!field) return null;
    next[field] = value === "-" ? null : value;
  }
  if (creation && (!values.first || !values.last)) return null;
  const parsed = personPayloadSchema.safeParse(next);
  return parsed.success ? parsed.data : null;
}

const PLANS = {
  create: defineEvryPlanCapability({
    identity: PEOPLE_CORE_IDENTITIES.create,
    effectClass: "database_write",
    arguments: createSchema.shape,
  }),
  quickAdd: defineEvryPlanCapability({
    identity: PEOPLE_CORE_IDENTITIES.quickAdd,
    effectClass: "database_write",
    arguments: createSchema.shape,
  }),
  update: defineEvryPlanCapability({
    identity: PEOPLE_CORE_IDENTITIES.update,
    effectClass: "database_write",
    arguments: personChangeSchema.shape,
  }),
  delete: defineEvryPlanCapability({
    identity: PEOPLE_CORE_IDENTITIES.delete,
    effectClass: "database_write",
    arguments: deleteSchema.shape,
  }),
  status: defineEvryPlanCapability({
    identity: PEOPLE_CORE_IDENTITIES.status,
    effectClass: "database_write",
    arguments: statusSchema.shape,
  }),
  statusReason: defineEvryPlanCapability({
    identity: PEOPLE_CORE_IDENTITIES.statusReason,
    effectClass: "database_write",
    arguments: statusSchema.shape,
  }),
  reorder: defineEvryPlanCapability({
    identity: PEOPLE_CORE_IDENTITIES.reorder,
    effectClass: "database_write",
    arguments: reorderSchema.shape,
  }),
  removePhoto: defineEvryPlanCapability({
    identity: PEOPLE_CORE_IDENTITIES.removePhoto,
    effectClass: "file_storage_write",
    arguments: removePhotoSchema.shape,
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

function parseJson(value: string): EvryPersonPayload {
  return personPayloadSchema.parse(JSON.parse(value));
}

export const PEOPLE_CORE_EXECUTIONS = [
  ...([PLANS.create, PLANS.quickAdd] as const).map((plan) =>
    defineEvryExecutionCapability({
      planCapability: plan,
      async executeIfCurrent(input) {
        const args = createSchema.safeParse(input.arguments);
        if (!args.success || !exactTuple(input, plan.identity))
          return { status: "refused", excludedCount: 1 };
        return claimEvryCreatePerson({
          execution: input.execution,
          effectKey: input.effectKey,
          person: parseJson(args.data.personJson),
          activitySource: args.data.activitySource,
          expectedHouseholdName: args.data.expectedHouseholdName,
        });
      },
    })
  ),
  defineEvryExecutionCapability({
    planCapability: PLANS.update,
    async executeIfCurrent(input) {
      const args = personChangeSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.update.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryUpdatePerson({
        execution: input.execution,
        effectKey: input.effectKey,
        personId: args.data.personId,
        baselineJson: args.data.baselineJson,
        after: parseJson(args.data.afterJson),
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.delete,
    async executeIfCurrent(input) {
      const args = deleteSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.delete.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryDeletePerson({
        execution: input.execution,
        effectKey: input.effectKey,
        personId: args.data.personId,
        baselineJson: args.data.baselineJson,
      });
    },
  }),
  ...([PLANS.status, PLANS.statusReason] as const).map((plan) =>
    defineEvryExecutionCapability({
      planCapability: plan,
      async executeIfCurrent(input) {
        const args = statusSchema.safeParse(input.arguments);
        if (
          !args.success ||
          !exactTuple(input, plan.identity) ||
          (plan.identity === PEOPLE_CORE_IDENTITIES.status) !==
            (args.data.reason === null)
        )
          return { status: "refused", excludedCount: 1 };
        return claimEvryChangePersonStatus({
          execution: input.execution,
          effectKey: input.effectKey,
          ...args.data,
        });
      },
    })
  ),
  defineEvryExecutionCapability({
    planCapability: PLANS.reorder,
    async executeIfCurrent(input) {
      const args = reorderSchema.safeParse(input.arguments);
      if (
        !args.success ||
        !exactTuple(input, PLANS.reorder.identity) ||
        new Set(args.data.entries.map(({ personId }) => personId)).size !==
          args.data.entries.length
      )
        return { status: "refused", excludedCount: 1 };
      return claimEvryReorderPeople({
        execution: input.execution,
        effectKey: input.effectKey,
        entries: args.data.entries,
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.removePhoto,
    async executeIfCurrent(input) {
      const args = removePhotoSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.removePhoto.identity))
        return { status: "refused", excludedCount: 1 };
      const replay = await recoverCompletedEvryPeopleEffect(input);
      if (replay) return replay;
      return claimEvryPersonPhotoMutation({
        execution: input.execution,
        effectKey: input.effectKey,
        personId: args.data.personId,
        expectedDigest: args.data.photoDigest,
        mutation: { kind: "remove" },
      });
    },
  }),
] as const;

export const PEOPLE_CORE_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(PEOPLE_CORE_EXECUTIONS);
export const PEOPLE_CORE_PLAN_REGISTRY =
  PEOPLE_CORE_EXECUTION_REGISTRY.planRegistry;

function target(label: string, value: string, href?: string) {
  return {
    label,
    value,
    sourceLink: href ? { label: `Open ${value}`, href } : null,
  };
}
const fieldLabels: Record<keyof EvryPersonPayload, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  city: "City",
  state: "State",
  postalCode: "Postal code",
  country: "Country",
  status: "Status",
  backgroundCheckStatus: "Background check",
  source: "Source",
  sourceDetails: "Source details",
  notes: "Notes",
  householdId: "Household",
  householdRole: "Household role",
};
function changes(
  before: EvryPersonPayload | null,
  after: EvryPersonPayload | null
) {
  return (Object.keys(fieldLabels) as (keyof EvryPersonPayload)[]).flatMap(
    (key) =>
      before?.[key] === after?.[key]
        ? []
        : [
            {
              label: fieldLabels[key],
              before:
                key === "notes"
                  ? noteDisclosureSummary(before?.notes ?? null)
                  : (before?.[key] ?? "Not set"),
              after:
                key === "notes"
                  ? noteDisclosureSummary(after?.notes ?? null)
                  : (after?.[key] ?? "Not set"),
              count: 1,
            },
          ]
  );
}

function noteDisclosureSummary(value: string | null): string {
  if (value === null) return "Not set";
  const pages = exactEvryContentPages(value).length;
  return `Exact content shown in ${pages} ${pages === 1 ? "page" : "pages"} below`;
}

function noteDisclosurePages(phase: "before" | "after", value: string | null) {
  if (value === null) return [];
  const pages = exactEvryContentPages(value);
  return pages.map((content, index) => ({
    label: `Notes ${phase} · page ${index + 1} of ${pages.length}`,
    content,
  }));
}

export const PEOPLE_CORE_REVIEWS = [
  ...(
    [PEOPLE_CORE_IDENTITIES.create, PEOPLE_CORE_IDENTITIES.quickAdd] as const
  ).map((identity) =>
    defineEvryArtifactReview({
      source: { kind: "generic", capabilityIdentities: [identity] },
      build({ plan, document }) {
        const step = document.steps[0]!;
        const args = createSchema.parse(step.arguments);
        const person = parseJson(args.personJson);
        const label = `${person.firstName} ${person.lastName}`.trim();
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Create ${label}`,
          actionLabel: "Create person",
          consequences: [
            "This creates one People record and its creation activity.",
          ],
          steps: [
            {
              stepId: step.id,
              title: "Create person",
              effectKind: "other",
              reversibility: "reversible",
              resolvedTargets: [
                target("New person", label),
                ...(person.householdId
                  ? [
                      target(
                        "Household",
                        args.expectedHouseholdName ?? person.householdId
                      ),
                    ]
                  : []),
              ],
              counts: [
                { label: "People to create", count: 1 },
                { label: "Activity entries", count: 1 },
              ],
              exclusions: [],
              dateTime: null,
              contentPreviews: noteDisclosurePages("after", person.notes),
              beforeAfter: changes(null, person),
            },
          ],
        });
      },
    })
  ),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [PEOPLE_CORE_IDENTITIES.update],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = personChangeSchema.parse(step.arguments);
      const before = parseJson(args.baselineJson);
      const after = parseJson(args.afterJson);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Update ${args.personLabel}`,
        actionLabel: "Update person",
        consequences: ["This changes the listed fields on one People record."],
        steps: [
          {
            stepId: step.id,
            title: "Update person",
            effectKind: "other",
            reversibility: "reversible",
            resolvedTargets: [
              target("Person", args.personLabel, `/people/${args.personId}`),
            ],
            counts: [{ label: "People to update", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews:
              before.notes === after.notes
                ? []
                : [
                    ...noteDisclosurePages("before", before.notes),
                    ...noteDisclosurePages("after", after.notes),
                  ],
            beforeAfter: changes(before, after),
          },
        ],
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [PEOPLE_CORE_IDENTITIES.delete],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = deleteSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Delete ${args.personLabel}`,
        actionLabel: "Delete person",
        consequences: [
          "This removes the person from active People views. The record is retained for restoration.",
        ],
        steps: [
          {
            stepId: step.id,
            title: "Soft-delete person",
            effectKind: "destructive",
            reversibility: "reversible",
            resolvedTargets: [
              target("Person", args.personLabel, `/people/${args.personId}`),
            ],
            counts: [{ label: "People to delete", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [],
            beforeAfter: [
              {
                label: "Visibility",
                before: "Active",
                after: "Deleted",
                count: 1,
              },
            ],
          },
        ],
      });
    },
  }),
  ...(
    [
      PEOPLE_CORE_IDENTITIES.status,
      PEOPLE_CORE_IDENTITIES.statusReason,
    ] as const
  ).map((identity) =>
    defineEvryArtifactReview({
      source: { kind: "generic", capabilityIdentities: [identity] },
      build({ plan, document }) {
        const step = document.steps[0]!;
        const args = statusSchema.parse(step.arguments);
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Change ${args.personLabel} to ${args.newStatus}`,
          actionLabel: "Change status",
          consequences: [
            `This changes one pipeline status${args.skippedStatuses.length ? ` and skips ${args.skippedStatuses.join(", ")}` : ""}.`,
          ],
          steps: [
            {
              stepId: step.id,
              title: "Change status",
              effectKind: "other",
              reversibility: "reversible",
              resolvedTargets: [
                target("Person", args.personLabel, `/people/${args.personId}`),
              ],
              counts: [{ label: "People to update", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: args.reason
                ? [{ label: "Reason", content: args.reason }]
                : [],
              beforeAfter: [
                {
                  label: "Status",
                  before: args.expectedStatus,
                  after: args.newStatus,
                  count: 1,
                },
              ],
            },
          ],
        });
      },
    })
  ),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [PEOPLE_CORE_IDENTITIES.reorder],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = reorderSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Reorder ${args.entries.length} people`,
        actionLabel: "Save order",
        consequences: [
          "This changes the display order for exactly the listed people.",
        ],
        steps: [
          {
            stepId: step.id,
            title: "Reorder pipeline",
            effectKind: "other",
            reversibility: "reversible",
            resolvedTargets: args.entries.map((entry) =>
              target("Person", entry.personLabel, `/people/${entry.personId}`)
            ),
            counts: [
              { label: "People to reorder", count: args.entries.length },
            ],
            exclusions: [],
            dateTime: null,
            contentPreviews: [],
            beforeAfter: args.entries.map((entry) => ({
              label: entry.personLabel,
              before: String(entry.expectedOrder),
              after: String(entry.newOrder),
              count: 1,
            })),
          },
        ],
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [PEOPLE_CORE_IDENTITIES.removePhoto],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = removePhotoSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Remove ${args.personLabel}’s photo`,
        actionLabel: "Remove photo",
        consequences: ["This removes the current private person photo."],
        steps: [
          {
            stepId: step.id,
            title: "Remove person photo",
            effectKind: "destructive",
            reversibility: "irreversible",
            resolvedTargets: [
              target("Person", args.personLabel, `/people/${args.personId}`),
            ],
            counts: [{ label: "Photos to remove", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [],
            beforeAfter: [
              {
                label: "Photo",
                before: "Current photo",
                after: "No photo",
                count: 1,
              },
            ],
          },
        ],
      });
    },
  }),
] as const;
export const PEOPLE_CORE_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(PEOPLE_CORE_REVIEWS);

function identityFor(selection: PeopleCoreSelection): string {
  if (selection.kind === "create") return PEOPLE_CORE_IDENTITIES.create;
  if (selection.kind === "quick_add") return PEOPLE_CORE_IDENTITIES.quickAdd;
  if (selection.kind === "update") return PEOPLE_CORE_IDENTITIES.update;
  if (selection.kind === "delete") return PEOPLE_CORE_IDENTITIES.delete;
  if (selection.kind === "reorder") return PEOPLE_CORE_IDENTITIES.reorder;
  if (selection.kind === "remove_photo")
    return PEOPLE_CORE_IDENTITIES.removePhoto;
  return "reason" in selection && selection.reason
    ? PEOPLE_CORE_IDENTITIES.statusReason
    : PEOPLE_CORE_IDENTITIES.status;
}

export async function proposePeopleCoreEffect(input: {
  actor: EvryPlantActor;
  pageContext: EvryResolvedPageContext | null;
  selection: PeopleCoreSelection;
  requestKey: EvryPlanRequestKey;
}) {
  const identity = identityFor(input.selection);
  const authorization = await authorizeEvryEffectCapability(identity);
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  )
    return null;
  const contextRequired = !["create", "quick_add", "reorder"].includes(
    input.selection.kind
  );
  if (contextRequired && input.pageContext?.kind !== "person") return null;
  let args: Record<string, unknown> | null = null;
  if (
    input.selection.kind === "create" ||
    input.selection.kind === "quick_add"
  ) {
    if (
      input.selection.kind === "quick_add" &&
      Object.keys(input.selection.values).some(
        (key) => !["first", "last", "email", "phone", "source"].includes(key)
      )
    )
      return null;
    const empty = personPayloadSchema.parse({
      firstName: "Placeholder",
      lastName: "Placeholder",
      email: null,
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: "US",
      status: "prospect",
      backgroundCheckStatus: "not_started",
      source: null,
      sourceDetails: null,
      notes: null,
      householdId: null,
      householdRole: null,
    });
    const person = applyValues(empty, input.selection.values, true);
    if (!person) return null;
    let expectedHouseholdName: string | null = null;
    if (person.householdId) {
      const household = await getHousehold(
        input.actor.plantId,
        person.householdId
      );
      if (!household) return null;
      expectedHouseholdName = household.name;
    }
    args = {
      personJson: JSON.stringify(person),
      activitySource: input.selection.kind === "create" ? "form" : "quick_add",
      expectedHouseholdName,
    };
  } else if (input.selection.kind === "reorder") {
    const people = await Promise.all(
      input.selection.personIds.map((id) => getPerson(input.actor.plantId, id))
    );
    if (people.some((person) => !person)) return null;
    args = {
      entries: people.map((person, index) => ({
        personId: person!.id,
        personLabel: `${person!.firstName} ${person!.lastName}`.trim(),
        expectedStatus: person!.status,
        expectedOrder: person!.pipelineSortOrder,
        newOrder: index,
      })),
    };
  } else {
    const person = await getPerson(
      input.actor.plantId,
      input.pageContext!.recordId
    );
    if (!person) return null;
    const label = `${person.firstName} ${person.lastName}`.trim();
    if (input.selection.kind === "update") {
      const before = payloadOf(person);
      const after = applyValues(before, input.selection.values, false);
      if (!after || after.status !== before.status) return null;
      if (after.householdId) {
        const household = await getHousehold(
          input.actor.plantId,
          after.householdId
        );
        if (!household) return null;
      }
      args = {
        personId: person.id,
        personLabel: label,
        baselineJson: JSON.stringify(before),
        afterJson: JSON.stringify(after),
      };
    }
    if (input.selection.kind === "delete")
      args = {
        personId: person.id,
        personLabel: label,
        baselineJson: JSON.stringify(payloadOf(person)),
      };
    if (input.selection.kind === "status") {
      if (person.status === input.selection.status) return null;
      const transition = validateStatusTransition(
        person.status,
        input.selection.status as typeof person.status
      );
      args = {
        personId: person.id,
        personLabel: label,
        expectedFirstName: person.firstName,
        expectedLastName: person.lastName,
        expectedStatus: person.status,
        newStatus: input.selection.status,
        reason: input.selection.reason,
        skippedStatuses: transition.skippedStatuses,
      };
    }
    if (input.selection.kind === "remove_photo") {
      const photo = await getEvryPersonPhotoSnapshot(
        input.actor.plantId,
        person.id
      );
      if (!photo?.present || !photo.digest) return null;
      args = {
        personId: person.id,
        personLabel: label,
        photoDigest: photo.digest,
      };
    }
  }
  if (!args) return null;
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: input.selection.kind.replaceAll("_", "-"),
          capabilityIdentity: identity,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: PEOPLE_CORE_PLAN_REGISTRY,
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
    reviewRegistry: PEOPLE_CORE_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

export async function peopleCoreTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}): Promise<boolean> {
  const identity = input.step.capabilityIdentity;
  if (
    identity === PEOPLE_CORE_IDENTITIES.create ||
    identity === PEOPLE_CORE_IDENTITIES.quickAdd
  ) {
    const args = createSchema.safeParse(input.step.arguments);
    if (!args.success) return false;
    const person = parseJson(args.data.personJson);
    if (!person.householdId) return true;
    const household = await getHousehold(
      input.actor.plantId,
      person.householdId
    );
    return household?.name === args.data.expectedHouseholdName;
  }
  if (identity === PEOPLE_CORE_IDENTITIES.reorder) {
    const args = reorderSchema.safeParse(input.step.arguments);
    if (
      !args.success ||
      new Set(args.data.entries.map(({ personId }) => personId)).size !==
        args.data.entries.length
    )
      return false;
    const people = await Promise.all(
      args.data.entries.map(({ personId }) =>
        getPerson(input.actor.plantId, personId)
      )
    );
    return people.every(
      (person, index) =>
        person &&
        person.status === args.data.entries[index]!.expectedStatus &&
        person.pipelineSortOrder === args.data.entries[index]!.expectedOrder
    );
  }
  const personIdValue =
    typeof input.step.arguments.personId === "string"
      ? input.step.arguments.personId
      : null;
  if (!personIdValue) return false;
  const personId = personIdValue;
  const person = await getPerson(input.actor.plantId, personId);
  if (!person) return false;
  if (identity === PEOPLE_CORE_IDENTITIES.update) {
    const parsed = personChangeSchema.safeParse(input.step.arguments);
    return Boolean(
      parsed.success &&
      JSON.stringify(payloadOf(person)) === parsed.data.baselineJson
    );
  }
  if (identity === PEOPLE_CORE_IDENTITIES.delete) {
    const parsed = deleteSchema.safeParse(input.step.arguments);
    return Boolean(
      parsed.success &&
      JSON.stringify(payloadOf(person)) === parsed.data.baselineJson
    );
  }
  if (
    identity === PEOPLE_CORE_IDENTITIES.status ||
    identity === PEOPLE_CORE_IDENTITIES.statusReason
  ) {
    const parsed = statusSchema.safeParse(input.step.arguments);
    return Boolean(
      parsed.success && person.status === parsed.data.expectedStatus
    );
  }
  const parsed = removePhotoSchema.safeParse(input.step.arguments);
  if (!parsed.success) return false;
  const photo = await getEvryPersonPhotoSnapshot(input.actor.plantId, personId);
  return Boolean(photo?.present && photo.digest === parsed.data.photoDigest);
}
