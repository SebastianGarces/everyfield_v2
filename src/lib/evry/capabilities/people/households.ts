import { randomUUID } from "node:crypto";

import { z } from "zod";

import { householdRoles } from "@/db/schema";
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
  claimEvryAddToHousehold,
  claimEvryCreateHouseholdWithHead,
  claimEvryDeleteHousehold,
  claimEvryPropagateHouseholdAddress,
  claimEvryRemoveFromHousehold,
  claimEvryUpdateHousehold,
  type EvryAddressSnapshot,
  type EvryHouseholdMemberSnapshot,
  type EvryHouseholdSnapshot,
} from "@/lib/people/evry-households";
import { getHousehold, getHouseholdMembers } from "@/lib/people/household";
import { getPerson } from "@/lib/people/service";

export const HOUSEHOLD_IDENTITIES = {
  create: "people.crm.households.create-household-with-head",
  update: "people.crm.households.update-household",
  delete: "people.crm.households.delete-household",
  add: "people.crm.households.add-to-household",
  remove: "people.crm.households.remove-from-household",
  propagate: "people.crm.households.propagate-address",
} as const;

const uuid = z.string().uuid();
const addressSchema = z.strictObject({
  addressLine1: z.string().max(255).nullable(),
  addressLine2: z.string().max(255).nullable(),
  city: z.string().max(100).nullable(),
  state: z.string().max(100).nullable(),
  postalCode: z.string().max(20).nullable(),
  country: z.string().max(100).nullable(),
});
const householdSnapshotSchema = addressSchema.extend({
  name: z.string().trim().min(1).max(255),
});
const memberSnapshotSchema = addressSchema.extend({
  personId: uuid,
  firstName: z.string().min(1).max(255),
  lastName: z.string().max(255),
  householdId: uuid.nullable(),
  householdRole: z.enum(householdRoles).nullable(),
});
function jsonSchema(schema: z.ZodType) {
  return z.string().refine((value) => {
    try {
      return schema.safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  });
}
const householdJson = jsonSchema(householdSnapshotSchema);
const memberJson = jsonSchema(memberSnapshotSchema);
const createSchema = z.strictObject({
  personJson: memberJson,
  householdId: uuid,
  householdName: z.string().trim().min(1).max(255),
  usePersonAddress: z.boolean(),
});
const updateSchema = z.strictObject({
  householdId: uuid,
  beforeJson: householdJson,
  afterJson: householdJson,
});
const deleteSchema = z.strictObject({
  householdId: uuid,
  householdJson,
  expectedMemberIds: z.array(uuid).max(32).length(0),
});
const addSchema = z.strictObject({
  personJson: memberJson,
  householdId: uuid,
  householdJson,
  role: z.enum(householdRoles),
  afterAddressJson: jsonSchema(addressSchema),
});
const removeSchema = z.strictObject({
  personJson: memberJson,
  householdJson,
});
const propagateSchema = z.strictObject({
  householdId: uuid,
  householdJson,
  membersJson: jsonSchema(z.array(memberSnapshotSchema).min(1).max(32)),
});

export type HouseholdSelection =
  | Readonly<{
      kind: "create";
      name: string;
      usePersonAddress: boolean;
    }>
  | Readonly<{
      kind: "update";
      householdId: string;
      values: Readonly<Record<string, string>>;
    }>
  | Readonly<{ kind: "delete" | "propagate"; householdId: string }>
  | Readonly<{ kind: "add"; householdId: string; role: string }>
  | Readonly<{ kind: "remove" }>;

const HOUSEHOLD_FIELDS = new Set([
  "name",
  "address1",
  "address2",
  "city",
  "state",
  "postal",
  "country",
]);

function values(value: string): Readonly<Record<string, string>> | null {
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) return null;
    const key = part.slice(0, index).trim();
    const fieldValue = part.slice(index + 1).trim();
    if (!HOUSEHOLD_FIELDS.has(key) || key in result) return null;
    result[key] = fieldValue;
  }
  return Object.keys(result).length ? result : null;
}

export function selectHouseholdRequest(
  textValue: string
): HouseholdSelection | null {
  const text = textValue.normalize("NFKC").trim();
  const create =
    /^create household:\s*name=([^;]{1,255});\s*usePersonAddress=(true|false)[.!?]*$/i.exec(
      text
    );
  if (create)
    return {
      kind: "create",
      name: create[1]!.trim(),
      usePersonAddress: create[2]!.toLowerCase() === "true",
    };
  const update = /^update household ([0-9a-f-]{36}):\s*([\s\S]+)$/i.exec(text);
  if (update && uuid.safeParse(update[1]).success) {
    const parsedValues = values(update[2]!);
    return parsedValues
      ? { kind: "update", householdId: update[1]!, values: parsedValues }
      : null;
  }
  const remove = /^remove (?:this )?person from household[.!?]*$/i;
  if (remove.test(text)) return { kind: "remove" };
  const add =
    /^add (?:this )?person to household ([0-9a-f-]{36}) as ([a-z_]+)[.!?]*$/i.exec(
      text
    );
  if (
    add &&
    uuid.safeParse(add[1]).success &&
    z.enum(householdRoles).safeParse(add[2]).success
  )
    return { kind: "add", householdId: add[1]!, role: add[2]! };
  for (const [kind, expression] of [
    ["delete", /^delete household ([0-9a-f-]{36})[.!?]*$/i],
    ["propagate", /^propagate address for household ([0-9a-f-]{36})[.!?]*$/i],
  ] as const) {
    const match = expression.exec(text);
    if (match && uuid.safeParse(match[1]).success)
      return { kind, householdId: match[1]! };
  }
  return null;
}

function addressOf(value: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}): EvryAddressSnapshot {
  return addressSchema.parse(value);
}

function householdOf(
  value: NonNullable<Awaited<ReturnType<typeof getHousehold>>>
): EvryHouseholdSnapshot {
  return householdSnapshotSchema.parse({
    name: value.name,
    ...addressOf(value),
  });
}

function memberOf(value: {
  id: string;
  firstName: string;
  lastName: string;
  householdId: string | null;
  householdRole: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}): EvryHouseholdMemberSnapshot {
  return memberSnapshotSchema.parse({
    personId: value.id,
    firstName: value.firstName,
    lastName: value.lastName,
    householdId: value.householdId,
    householdRole: value.householdRole,
    ...addressOf(value),
  });
}

function parseJson<Schema extends z.ZodType>(schema: Schema, value: string) {
  return schema.parse(JSON.parse(value)) as z.infer<Schema>;
}

const PLANS = {
  create: defineEvryPlanCapability({
    identity: HOUSEHOLD_IDENTITIES.create,
    effectClass: "database_write",
    arguments: createSchema.shape,
  }),
  update: defineEvryPlanCapability({
    identity: HOUSEHOLD_IDENTITIES.update,
    effectClass: "database_write",
    arguments: updateSchema.shape,
  }),
  delete: defineEvryPlanCapability({
    identity: HOUSEHOLD_IDENTITIES.delete,
    effectClass: "database_write",
    arguments: deleteSchema.shape,
  }),
  add: defineEvryPlanCapability({
    identity: HOUSEHOLD_IDENTITIES.add,
    effectClass: "database_write",
    arguments: addSchema.shape,
  }),
  remove: defineEvryPlanCapability({
    identity: HOUSEHOLD_IDENTITIES.remove,
    effectClass: "database_write",
    arguments: removeSchema.shape,
  }),
  propagate: defineEvryPlanCapability({
    identity: HOUSEHOLD_IDENTITIES.propagate,
    effectClass: "database_write",
    arguments: propagateSchema.shape,
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

export const HOUSEHOLD_EXECUTIONS = [
  defineEvryExecutionCapability({
    planCapability: PLANS.create,
    async executeIfCurrent(input) {
      const args = createSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.create.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryCreateHouseholdWithHead({
        execution: input.execution,
        effectKey: input.effectKey,
        person: parseJson(memberSnapshotSchema, args.data.personJson),
        householdId: args.data.householdId,
        householdName: args.data.householdName,
        usePersonAddress: args.data.usePersonAddress,
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.update,
    async executeIfCurrent(input) {
      const args = updateSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.update.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryUpdateHousehold({
        execution: input.execution,
        effectKey: input.effectKey,
        householdId: args.data.householdId,
        before: parseJson(householdSnapshotSchema, args.data.beforeJson),
        after: parseJson(householdSnapshotSchema, args.data.afterJson),
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.delete,
    async executeIfCurrent(input) {
      const args = deleteSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.delete.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryDeleteHousehold({
        execution: input.execution,
        effectKey: input.effectKey,
        householdId: args.data.householdId,
        household: parseJson(householdSnapshotSchema, args.data.householdJson),
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.add,
    async executeIfCurrent(input) {
      const args = addSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.add.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryAddToHousehold({
        execution: input.execution,
        effectKey: input.effectKey,
        person: parseJson(memberSnapshotSchema, args.data.personJson),
        householdId: args.data.householdId,
        household: parseJson(householdSnapshotSchema, args.data.householdJson),
        role: args.data.role,
        afterAddress: parseJson(addressSchema, args.data.afterAddressJson),
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.remove,
    async executeIfCurrent(input) {
      const args = removeSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.remove.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryRemoveFromHousehold({
        execution: input.execution,
        effectKey: input.effectKey,
        person: parseJson(memberSnapshotSchema, args.data.personJson),
        household: parseJson(householdSnapshotSchema, args.data.householdJson),
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.propagate,
    async executeIfCurrent(input) {
      const args = propagateSchema.safeParse(input.arguments);
      if (!args.success || !exactTuple(input, PLANS.propagate.identity))
        return { status: "refused", excludedCount: 1 };
      return claimEvryPropagateHouseholdAddress({
        execution: input.execution,
        effectKey: input.effectKey,
        householdId: args.data.householdId,
        household: parseJson(householdSnapshotSchema, args.data.householdJson),
        members: parseJson(
          z.array(memberSnapshotSchema),
          args.data.membersJson
        ),
      });
    },
  }),
] as const;

export const HOUSEHOLD_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(HOUSEHOLD_EXECUTIONS);
export const HOUSEHOLD_PLAN_REGISTRY =
  HOUSEHOLD_EXECUTION_REGISTRY.planRegistry;
const definitions = Object.values(HOUSEHOLD_IDENTITIES);

function target(label: string, value: string, href: string | null = null) {
  return {
    label,
    value,
    sourceLink: href ? { href, label: `Open ${value}` } : null,
  };
}

function addressText(address: EvryAddressSnapshot): string {
  return (
    [
      address.addressLine1,
      address.addressLine2,
      address.city,
      address.state,
      address.postalCode,
      address.country,
    ]
      .filter(Boolean)
      .join(", ") || "No address"
  );
}

function changedHousehold(
  before: EvryHouseholdSnapshot,
  after: EvryHouseholdSnapshot
) {
  return [
    before.name === after.name
      ? null
      : { label: "Name", before: before.name, after: after.name, count: 1 },
    addressText(before) === addressText(after)
      ? null
      : {
          label: "Address",
          before: addressText(before),
          after: addressText(after),
          count: 1,
        },
  ].filter((value): value is NonNullable<typeof value> => value !== null);
}

export const HOUSEHOLD_REVIEWS = definitions.map((identity) =>
  defineEvryArtifactReview({
    source: { kind: "generic", capabilityIdentities: [identity] },
    build({ plan, document }) {
      const step = document.steps[0]!;
      if (identity === HOUSEHOLD_IDENTITIES.create) {
        const args = createSchema.parse(step.arguments);
        const person = parseJson(memberSnapshotSchema, args.personJson);
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Create ${args.householdName}`,
          actionLabel: "Create household",
          consequences: [
            "Creates one household and makes this person its head atomically.",
          ],
          steps: [
            {
              stepId: step.id,
              title: "Create household with head",
              effectKind: "other",
              reversibility: "reversible",
              resolvedTargets: [
                target(
                  "Person",
                  `${person.firstName} ${person.lastName}`,
                  `/people/${person.personId}`
                ),
                target("Household", args.householdName),
              ],
              counts: [{ label: "Records to change", count: 2 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [],
              beforeAfter: [
                {
                  label: "Household",
                  before: "Does not exist",
                  after: args.householdName,
                  count: 1,
                },
                {
                  label: "Person role",
                  before: person.householdRole ?? "None",
                  after: "head",
                  count: 1,
                },
                {
                  label: "Household address",
                  before: "Does not exist",
                  after: args.usePersonAddress
                    ? addressText(person)
                    : "No address",
                  count: 1,
                },
              ],
            },
          ],
        });
      }
      if (identity === HOUSEHOLD_IDENTITIES.update) {
        const args = updateSchema.parse(step.arguments);
        const before = parseJson(householdSnapshotSchema, args.beforeJson);
        const after = parseJson(householdSnapshotSchema, args.afterJson);
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Update ${before.name}`,
          actionLabel: "Update household",
          consequences: ["Changes the listed household fields."],
          steps: [
            {
              stepId: step.id,
              title: "Update household",
              effectKind: "other",
              reversibility: "reversible",
              resolvedTargets: [target("Household", before.name)],
              counts: [{ label: "Households to update", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [],
              beforeAfter: changedHousehold(before, after),
            },
          ],
        });
      }
      if (identity === HOUSEHOLD_IDENTITIES.delete) {
        const args = deleteSchema.parse(step.arguments);
        const household = parseJson(
          householdSnapshotSchema,
          args.householdJson
        );
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Delete ${household.name}`,
          actionLabel: "Delete household",
          consequences: [
            "Permanently deletes this empty household. No people are removed.",
          ],
          steps: [
            {
              stepId: step.id,
              title: "Delete empty household",
              effectKind: "destructive",
              reversibility: "irreversible",
              resolvedTargets: [target("Household", household.name)],
              counts: [
                { label: "Households to delete", count: 1 },
                {
                  label: "Members affected",
                  count: args.expectedMemberIds.length,
                },
              ],
              exclusions: [
                {
                  reason: "The action refuses if any member is present.",
                  count: 0,
                },
              ],
              dateTime: null,
              contentPreviews: [],
              beforeAfter: [
                {
                  label: "Household",
                  before: household.name,
                  after: "Deleted",
                  count: 1,
                },
              ],
            },
          ],
        });
      }
      if (identity === HOUSEHOLD_IDENTITIES.add) {
        const args = addSchema.parse(step.arguments);
        const person = parseJson(memberSnapshotSchema, args.personJson);
        const household = parseJson(
          householdSnapshotSchema,
          args.householdJson
        );
        const after = parseJson(addressSchema, args.afterAddressJson);
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Add ${person.firstName} ${person.lastName} to ${household.name}`,
          actionLabel: "Add to household",
          consequences: [
            "Assigns the role and copies the household address only when the person currently has no address.",
          ],
          steps: [
            {
              stepId: step.id,
              title: "Add person to household",
              effectKind: "other",
              reversibility: "reversible",
              resolvedTargets: [
                target(
                  "Person",
                  `${person.firstName} ${person.lastName}`,
                  `/people/${person.personId}`
                ),
                target("Household", household.name),
              ],
              counts: [{ label: "People to update", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [],
              beforeAfter: [
                {
                  label: "Household",
                  before: person.householdId ?? "None",
                  after: household.name,
                  count: 1,
                },
                {
                  label: "Role",
                  before: person.householdRole ?? "None",
                  after: args.role,
                  count: 1,
                },
                {
                  label: "Address",
                  before: addressText(person),
                  after: addressText(after),
                  count: 1,
                },
              ],
            },
          ],
        });
      }
      if (identity === HOUSEHOLD_IDENTITIES.remove) {
        const args = removeSchema.parse(step.arguments);
        const person = parseJson(memberSnapshotSchema, args.personJson);
        const household = parseJson(
          householdSnapshotSchema,
          args.householdJson
        );
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Remove ${person.firstName} ${person.lastName} from ${household.name}`,
          actionLabel: "Remove from household",
          consequences: [
            "Clears the household and role. The person's address is unchanged.",
          ],
          steps: [
            {
              stepId: step.id,
              title: "Remove person from household",
              effectKind: "destructive",
              reversibility: "reversible",
              resolvedTargets: [
                target(
                  "Person",
                  `${person.firstName} ${person.lastName}`,
                  `/people/${person.personId}`
                ),
                target("Household", household.name),
              ],
              counts: [{ label: "People to update", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [],
              beforeAfter: [
                {
                  label: "Household",
                  before: household.name,
                  after: "None",
                  count: 1,
                },
                {
                  label: "Role",
                  before: person.householdRole ?? "None",
                  after: "None",
                  count: 1,
                },
              ],
            },
          ],
        });
      }
      const args = propagateSchema.parse(step.arguments);
      const household = parseJson(householdSnapshotSchema, args.householdJson);
      const members = parseJson(
        z.array(memberSnapshotSchema),
        args.membersJson
      );
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Copy ${household.name}'s address`,
        actionLabel: "Copy household address",
        consequences: [
          "Overwrites the address on every listed current household member.",
        ],
        steps: [
          {
            stepId: step.id,
            title: "Propagate household address",
            effectKind: "destructive",
            reversibility: "reversible",
            resolvedTargets: [
              target("Household", household.name),
              ...members.map((member) =>
                target(
                  "Person",
                  `${member.firstName} ${member.lastName}`,
                  `/people/${member.personId}`
                )
              ),
            ],
            counts: [{ label: "People to update", count: members.length }],
            exclusions: [
              {
                reason:
                  "The action refuses if household membership or any listed address changes.",
                count: 0,
              },
            ],
            dateTime: null,
            contentPreviews: [],
            beforeAfter: members.map((member) => ({
              label: `${member.firstName} ${member.lastName}`,
              before: addressText(member),
              after: addressText(household),
              count: 1,
            })),
          },
        ],
      });
    },
  })
);
export const HOUSEHOLD_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(HOUSEHOLD_REVIEWS);

function applyHouseholdValues(
  before: EvryHouseholdSnapshot,
  valuesValue: Readonly<Record<string, string>>
): EvryHouseholdSnapshot | null {
  const next: Record<string, string | null> = { ...before };
  const mapping = {
    name: "name",
    address1: "addressLine1",
    address2: "addressLine2",
    city: "city",
    state: "state",
    postal: "postalCode",
    country: "country",
  } as const;
  for (const [key, value] of Object.entries(valuesValue)) {
    const field = mapping[key as keyof typeof mapping];
    if (!field) return null;
    next[field] = value || null;
  }
  return householdSnapshotSchema.safeParse(next).success
    ? householdSnapshotSchema.parse(next)
    : null;
}

function hasAddress(value: EvryAddressSnapshot): boolean {
  return Boolean(
    value.addressLine1 || value.city || value.state || value.postalCode
  );
}

function identityFor(selection: HouseholdSelection): string {
  return HOUSEHOLD_IDENTITIES[selection.kind];
}

export async function proposeHouseholdEffect(input: {
  actor: EvryPlantActor;
  pageContext: EvryResolvedPageContext | null;
  selection: HouseholdSelection;
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
  let args: Record<string, unknown> | null = null;
  if (["create", "add", "remove"].includes(input.selection.kind)) {
    if (input.pageContext?.kind !== "person") return null;
  }
  if (input.selection.kind === "create") {
    const person = await getPerson(
      input.actor.plantId,
      input.pageContext!.recordId
    );
    if (!person || person.householdId) return null;
    args = {
      personJson: JSON.stringify(memberOf(person)),
      householdId: randomUUID(),
      householdName: input.selection.name,
      usePersonAddress: input.selection.usePersonAddress,
    };
  } else if (input.selection.kind === "update") {
    const household = await getHousehold(
      input.actor.plantId,
      input.selection.householdId
    );
    if (!household) return null;
    const before = householdOf(household);
    const after = applyHouseholdValues(before, input.selection.values);
    if (!after || JSON.stringify(after) === JSON.stringify(before)) return null;
    args = {
      householdId: household.id,
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify(after),
    };
  } else if (input.selection.kind === "delete") {
    const household = await getHousehold(
      input.actor.plantId,
      input.selection.householdId
    );
    if (!household) return null;
    const members = await getHouseholdMembers(
      input.actor.plantId,
      household.id
    );
    if (members.length) return null;
    args = {
      householdId: household.id,
      householdJson: JSON.stringify(householdOf(household)),
      expectedMemberIds: [],
    };
  } else if (input.selection.kind === "add") {
    const [person, household] = await Promise.all([
      getPerson(input.actor.plantId, input.pageContext!.recordId),
      getHousehold(input.actor.plantId, input.selection.householdId),
    ]);
    if (!person || !household) return null;
    const personSnapshot = memberOf(person);
    const householdSnapshot = householdOf(household);
    const afterAddress =
      !hasAddress(personSnapshot) && hasAddress(householdSnapshot)
        ? addressOf(householdSnapshot)
        : addressOf(personSnapshot);
    args = {
      personJson: JSON.stringify(personSnapshot),
      householdId: household.id,
      householdJson: JSON.stringify(householdSnapshot),
      role: input.selection.role,
      afterAddressJson: JSON.stringify(afterAddress),
    };
  } else if (input.selection.kind === "remove") {
    const person = await getPerson(
      input.actor.plantId,
      input.pageContext!.recordId
    );
    if (!person?.householdId) return null;
    const household = await getHousehold(
      input.actor.plantId,
      person.householdId
    );
    if (!household) return null;
    args = {
      personJson: JSON.stringify(memberOf(person)),
      householdJson: JSON.stringify(householdOf(household)),
    };
  } else {
    const household = await getHousehold(
      input.actor.plantId,
      input.selection.householdId
    );
    if (!household) return null;
    const members = await getHouseholdMembers(
      input.actor.plantId,
      household.id
    );
    if (!members.length || members.length > 32) return null;
    args = {
      householdId: household.id,
      householdJson: JSON.stringify(householdOf(household)),
      membersJson: JSON.stringify(members.map(memberOf)),
    };
  }
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
    registry: HOUSEHOLD_PLAN_REGISTRY,
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
    reviewRegistry: HOUSEHOLD_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

export async function householdTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}): Promise<boolean> {
  const identity = input.step.capabilityIdentity;
  if (identity === HOUSEHOLD_IDENTITIES.create) {
    const args = createSchema.safeParse(input.step.arguments);
    if (!args.success) return false;
    const person = await getPerson(
      input.actor.plantId,
      parseJson(memberSnapshotSchema, args.data.personJson).personId
    );
    return Boolean(
      person &&
      JSON.stringify(memberOf(person)) === args.data.personJson &&
      !person.householdId &&
      !(await getHousehold(input.actor.plantId, args.data.householdId))
    );
  }
  if (
    identity === HOUSEHOLD_IDENTITIES.add ||
    identity === HOUSEHOLD_IDENTITIES.remove
  ) {
    const schema =
      identity === HOUSEHOLD_IDENTITIES.add ? addSchema : removeSchema;
    const args = schema.safeParse(input.step.arguments);
    if (!args.success) return false;
    const personSnapshot = parseJson(
      memberSnapshotSchema,
      args.data.personJson
    );
    const householdId =
      identity === HOUSEHOLD_IDENTITIES.add
        ? addSchema.parse(args.data).householdId
        : personSnapshot.householdId;
    if (!householdId) return false;
    const [person, household] = await Promise.all([
      getPerson(input.actor.plantId, personSnapshot.personId),
      getHousehold(input.actor.plantId, householdId),
    ]);
    return Boolean(
      person &&
      household &&
      JSON.stringify(memberOf(person)) === args.data.personJson &&
      JSON.stringify(householdOf(household)) === args.data.householdJson
    );
  }
  const householdIdValue =
    typeof input.step.arguments.householdId === "string"
      ? input.step.arguments.householdId
      : null;
  if (!householdIdValue) return false;
  const household = await getHousehold(input.actor.plantId, householdIdValue);
  if (!household) return false;
  if (identity === HOUSEHOLD_IDENTITIES.update) {
    const args = updateSchema.safeParse(input.step.arguments);
    return Boolean(
      args.success &&
      JSON.stringify(householdOf(household)) === args.data.beforeJson
    );
  }
  if (identity === HOUSEHOLD_IDENTITIES.delete) {
    const args = deleteSchema.safeParse(input.step.arguments);
    if (
      !args.success ||
      JSON.stringify(householdOf(household)) !== args.data.householdJson
    )
      return false;
    return (
      (await getHouseholdMembers(input.actor.plantId, household.id)).length ===
      0
    );
  }
  const args = propagateSchema.safeParse(input.step.arguments);
  if (
    !args.success ||
    JSON.stringify(householdOf(household)) !== args.data.householdJson
  )
    return false;
  const members = await getHouseholdMembers(input.actor.plantId, household.id);
  return JSON.stringify(members.map(memberOf)) === args.data.membersJson;
}
