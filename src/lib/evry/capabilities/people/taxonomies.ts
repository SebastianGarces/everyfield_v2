import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { personTags, skillCategories, skillProficiencies } from "@/db/schema";
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
  claimEvryAddSkill,
  claimEvryAssignTag,
  claimEvryCreateTag,
  claimEvryDeleteTag,
  claimEvryRemoveSkill,
  claimEvryRemoveTag,
  claimEvryUpdateSkill,
  claimEvryUpdateTag,
} from "@/lib/people/evry-taxonomies";
import { getPerson } from "@/lib/people/service";
import { getSkill } from "@/lib/people/skills";
import { getTag } from "@/lib/people/tags";

export const TAXONOMY_IDENTITIES = {
  createTag: "people.crm.tags.create-tag",
  updateTag: "people.crm.tags.update-tag",
  deleteTag: "people.crm.tags.delete-tag",
  assignTag: "people.crm.tags.assign-tag",
  removeTag: "people.crm.tags.remove-tag",
  addSkill: "people.crm.skills.add-skill",
  updateSkill: "people.crm.skills.update-skill",
  removeSkill: "people.crm.skills.remove-skill",
} as const;

const uuid = z.string().uuid();
const nullableText = z.string().max(4_000).nullable();
const color = z
  .string()
  .max(20)
  .refine(
    (value) =>
      ["blue", "green", "red", "yellow", "purple", "pink", "orange"].includes(
        value
      ) || /^#[0-9a-f]{6}$/i.test(value)
  )
  .nullable();
const personBaseline = {
  personId: uuid,
  expectedFirstName: z.string().min(1).max(255),
  expectedLastName: z.string().max(255),
};
const tagBaseline = {
  tagId: uuid,
  expectedTagName: z.string().min(1).max(100),
  expectedTagColor: color,
};
const createTagSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  color,
});
const updateTagSchema = z.strictObject({
  ...tagBaseline,
  name: z.string().trim().min(1).max(100),
  color,
});
const deleteTagSchema = z.strictObject({
  ...tagBaseline,
  expectedPersonIds: z.array(uuid).max(99),
});
const tagMembershipSchema = z.strictObject({
  ...personBaseline,
  ...tagBaseline,
});
const skillValueShape = {
  category: z.enum(skillCategories),
  name: z.string().trim().min(1).max(100),
  proficiency: z.enum(skillProficiencies).nullable(),
  notes: nullableText,
};
const addSkillSchema = z.strictObject({
  ...personBaseline,
  ...skillValueShape,
});
const skillBaseline = {
  skillId: uuid,
  ...personBaseline,
  expectedCategory: z.enum(skillCategories),
  expectedName: z.string().min(1).max(100),
  expectedProficiency: z.enum(skillProficiencies).nullable(),
  expectedNotes: nullableText,
};
const updateSkillSchema = z.strictObject({
  ...skillBaseline,
  ...skillValueShape,
});
const removeSkillSchema = z.strictObject(skillBaseline);

export type TaxonomySelection =
  | Readonly<{ kind: "create_tag"; name: string; color: string | null }>
  | Readonly<{
      kind: "update_tag";
      tagId: string;
      name: string;
      color: string | null;
    }>
  | Readonly<{
      kind: "delete_tag" | "assign_tag" | "remove_tag";
      tagId: string;
    }>
  | Readonly<{
      kind: "add_skill";
      category: string;
      name: string;
      proficiency: string | null;
      notes: string | null;
    }>
  | Readonly<{
      kind: "update_skill";
      skillId: string;
      category: string;
      name: string;
      proficiency: string | null;
      notes: string | null;
    }>
  | Readonly<{ kind: "remove_skill"; skillId: string }>;

function fields(value: string): string[] {
  return value.split("|").map((part) => part.trim());
}

function idCommand(
  text: string,
  verb: string
): { id: string; rest: string | null } | null {
  const match = new RegExp(
    `^${verb}\\s+([0-9a-f]{8}-[0-9a-f-]{27})(?::\\s*([\\s\\S]+))?[.!?]*$`,
    "i"
  ).exec(text);
  return match && uuid.safeParse(match[1]).success
    ? { id: match[1]!, rest: match[2]?.trim() ?? null }
    : null;
}

export function selectTaxonomyRequest(
  textValue: string
): TaxonomySelection | null {
  const text = textValue.normalize("NFKC").trim();
  const createTag = /^create tag:\s*([\s\S]+)$/i.exec(text)?.[1];
  if (createTag) {
    const [name, colorValue = ""] = fields(createTag);
    const parsed = createTagSchema.safeParse({
      name,
      color: colorValue || null,
    });
    if (parsed.success) return { kind: "create_tag", ...parsed.data };
  }
  const updateTag = idCommand(text, "update tag");
  if (updateTag?.rest) {
    const [name, colorValue = ""] = fields(updateTag.rest);
    const parsed = createTagSchema.safeParse({
      name,
      color: colorValue || null,
    });
    if (parsed.success)
      return { kind: "update_tag", tagId: updateTag.id, ...parsed.data };
  }
  for (const [verb, kind] of [
    ["delete tag", "delete_tag"],
    ["assign tag", "assign_tag"],
    ["remove tag", "remove_tag"],
  ] as const) {
    const command = idCommand(text, verb);
    if (command && !command.rest) return { kind, tagId: command.id };
  }
  const addSkill = /^add skill:\s*([\s\S]+)$/i.exec(text)?.[1];
  if (addSkill) {
    const [category, name, proficiency = "", notes = ""] = fields(addSkill);
    const parsed = z.strictObject(skillValueShape).safeParse({
      category,
      name,
      proficiency: proficiency || null,
      notes: notes || null,
    });
    if (parsed.success) return { kind: "add_skill", ...parsed.data };
  }
  const updateSkill = idCommand(text, "update skill");
  if (updateSkill?.rest) {
    const [category, name, proficiency = "", notes = ""] = fields(
      updateSkill.rest
    );
    const parsed = z.strictObject(skillValueShape).safeParse({
      category,
      name,
      proficiency: proficiency || null,
      notes: notes || null,
    });
    if (parsed.success)
      return { kind: "update_skill", skillId: updateSkill.id, ...parsed.data };
  }
  const removeSkill = idCommand(text, "remove skill");
  return removeSkill && !removeSkill.rest
    ? { kind: "remove_skill", skillId: removeSkill.id }
    : null;
}

const PLANS = {
  createTag: defineEvryPlanCapability({
    identity: TAXONOMY_IDENTITIES.createTag,
    effectClass: "database_write",
    arguments: createTagSchema.shape,
  }),
  updateTag: defineEvryPlanCapability({
    identity: TAXONOMY_IDENTITIES.updateTag,
    effectClass: "database_write",
    arguments: updateTagSchema.shape,
  }),
  deleteTag: defineEvryPlanCapability({
    identity: TAXONOMY_IDENTITIES.deleteTag,
    effectClass: "database_write",
    arguments: deleteTagSchema.shape,
  }),
  assignTag: defineEvryPlanCapability({
    identity: TAXONOMY_IDENTITIES.assignTag,
    effectClass: "database_write",
    arguments: tagMembershipSchema.shape,
  }),
  removeTag: defineEvryPlanCapability({
    identity: TAXONOMY_IDENTITIES.removeTag,
    effectClass: "database_write",
    arguments: tagMembershipSchema.shape,
  }),
  addSkill: defineEvryPlanCapability({
    identity: TAXONOMY_IDENTITIES.addSkill,
    effectClass: "database_write",
    arguments: addSkillSchema.shape,
  }),
  updateSkill: defineEvryPlanCapability({
    identity: TAXONOMY_IDENTITIES.updateSkill,
    effectClass: "database_write",
    arguments: updateSkillSchema.shape,
  }),
  removeSkill: defineEvryPlanCapability({
    identity: TAXONOMY_IDENTITIES.removeSkill,
    effectClass: "database_write",
    arguments: removeSkillSchema.shape,
  }),
} as const;

type EffectIdentity = Pick<EvryEffectInput, "execution" | "effectKey">;

function exactTuple(input: EvryEffectInput, identity: string): boolean {
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === input.authorization.actor.userId &&
    input.execution.plantId === input.authorization.actor.plantId
  );
}

function execution<Schema extends z.ZodObject<z.ZodRawShape>>(input: {
  plan: (typeof PLANS)[keyof typeof PLANS];
  schema: Schema;
  run(
    value: z.infer<Schema> & EffectIdentity
  ): Promise<
    ReturnType<typeof claimEvryCreateTag> extends Promise<infer R> ? R : never
  >;
}) {
  return defineEvryExecutionCapability({
    planCapability: input.plan,
    async executeIfCurrent(effectInput) {
      const parsed = input.schema.safeParse(effectInput.arguments);
      return parsed.success && exactTuple(effectInput, input.plan.identity)
        ? input.run({
            ...parsed.data,
            execution: effectInput.execution,
            effectKey: effectInput.effectKey,
          })
        : { status: "refused", excludedCount: 1 };
    },
  });
}

export const TAXONOMY_EXECUTIONS = [
  execution({
    plan: PLANS.createTag,
    schema: createTagSchema,
    run: claimEvryCreateTag,
  }),
  execution({
    plan: PLANS.updateTag,
    schema: updateTagSchema,
    run: (value) =>
      claimEvryUpdateTag({
        ...value,
        expectedName: value.expectedTagName,
        expectedColor: value.expectedTagColor,
      }),
  }),
  execution({
    plan: PLANS.deleteTag,
    schema: deleteTagSchema,
    run: (value) =>
      claimEvryDeleteTag({
        ...value,
        expectedName: value.expectedTagName,
        expectedColor: value.expectedTagColor,
      }),
  }),
  execution({
    plan: PLANS.assignTag,
    schema: tagMembershipSchema,
    run: claimEvryAssignTag,
  }),
  execution({
    plan: PLANS.removeTag,
    schema: tagMembershipSchema,
    run: claimEvryRemoveTag,
  }),
  execution({
    plan: PLANS.addSkill,
    schema: addSkillSchema,
    run: claimEvryAddSkill,
  }),
  execution({
    plan: PLANS.updateSkill,
    schema: updateSkillSchema,
    run: claimEvryUpdateSkill,
  }),
  execution({
    plan: PLANS.removeSkill,
    schema: removeSkillSchema,
    run: claimEvryRemoveSkill,
  }),
] as const;

export const TAXONOMY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(TAXONOMY_EXECUTIONS);
export const TAXONOMY_PLAN_REGISTRY = TAXONOMY_EXECUTION_REGISTRY.planRegistry;

function target(label: string, value: string, href?: string) {
  return {
    label,
    value,
    sourceLink: href ? { label: `Open ${value}`, href } : null,
  };
}

export const TAXONOMY_REVIEWS = [
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [TAXONOMY_IDENTITIES.createTag],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = createTagSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Create tag “${args.name}”`,
        actionLabel: "Create tag",
        consequences: ["This adds one tag to the current plant."],
        steps: [
          {
            stepId: step.id,
            title: "Create tag",
            effectKind: "other",
            reversibility: "reversible",
            resolvedTargets: [target("Tag", args.name)],
            counts: [{ label: "Tags to create", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [],
            beforeAfter: [
              {
                label: "Color",
                before: "No tag",
                after: args.color ?? "Not set",
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
      capabilityIdentities: [TAXONOMY_IDENTITIES.updateTag],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = updateTagSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Update tag “${args.expectedTagName}”`,
        actionLabel: "Update tag",
        consequences: ["This changes one tag everywhere it is shown."],
        steps: [
          {
            stepId: step.id,
            title: "Update tag",
            effectKind: "other",
            reversibility: "reversible",
            resolvedTargets: [target("Tag", args.expectedTagName)],
            counts: [{ label: "Tags to update", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [],
            beforeAfter: [
              {
                label: "Name",
                before: args.expectedTagName,
                after: args.name,
                count: 1,
              },
              {
                label: "Color",
                before: args.expectedTagColor ?? "Not set",
                after: args.color ?? "Not set",
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
      capabilityIdentities: [TAXONOMY_IDENTITIES.deleteTag],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = deleteTagSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Delete tag “${args.expectedTagName}”`,
        actionLabel: "Delete tag",
        consequences: [
          `This permanently deletes the tag and removes it from ${args.expectedPersonIds.length} people.`,
        ],
        steps: [
          {
            stepId: step.id,
            title: "Delete tag",
            effectKind: "destructive",
            reversibility: "irreversible",
            resolvedTargets: [
              target("Tag", args.expectedTagName),
              ...args.expectedPersonIds.map((id) =>
                target("Assigned person", id, `/people/${id}`)
              ),
            ],
            counts: [
              { label: "Tags to delete", count: 1 },
              {
                label: "Assignments to remove",
                count: args.expectedPersonIds.length,
              },
            ],
            exclusions: [],
            dateTime: null,
            contentPreviews: [],
            beforeAfter: [
              {
                label: "Tag",
                before: args.expectedTagName,
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
    [TAXONOMY_IDENTITIES.assignTag, TAXONOMY_IDENTITIES.removeTag] as const
  ).map((identity) =>
    defineEvryArtifactReview({
      source: { kind: "generic", capabilityIdentities: [identity] },
      build({ plan, document }) {
        const step = document.steps[0]!;
        const args = tagMembershipSchema.parse(step.arguments);
        const add = identity === TAXONOMY_IDENTITIES.assignTag;
        const person =
          `${args.expectedFirstName} ${args.expectedLastName}`.trim();
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `${add ? "Assign" : "Remove"} tag “${args.expectedTagName}” ${add ? "to" : "from"} ${person}`,
          actionLabel: add ? "Assign tag" : "Remove tag",
          consequences: [
            `This ${add ? "adds" : "removes"} one tag ${add ? "to" : "from"} the person and records it in activity.`,
          ],
          steps: [
            {
              stepId: step.id,
              title: add ? "Assign tag" : "Remove tag",
              effectKind: "other",
              reversibility: "reversible",
              resolvedTargets: [
                target("Person", person, `/people/${args.personId}`),
                target("Tag", args.expectedTagName),
              ],
              counts: [{ label: "Tag assignments", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [],
              beforeAfter: [
                {
                  label: "Tag",
                  before: add ? "Not assigned" : args.expectedTagName,
                  after: add ? args.expectedTagName : "Not assigned",
                  count: 1,
                },
              ],
            },
          ],
        });
      },
    })
  ),
  ...(
    [
      TAXONOMY_IDENTITIES.addSkill,
      TAXONOMY_IDENTITIES.updateSkill,
      TAXONOMY_IDENTITIES.removeSkill,
    ] as const
  ).map((identity) =>
    defineEvryArtifactReview({
      source: { kind: "generic", capabilityIdentities: [identity] },
      build({ plan, document }) {
        const step = document.steps[0]!;
        const mode =
          identity === TAXONOMY_IDENTITIES.addSkill
            ? "add"
            : identity === TAXONOMY_IDENTITIES.updateSkill
              ? "update"
              : "remove";
        const args = (
          mode === "add"
            ? addSkillSchema
            : mode === "update"
              ? updateSkillSchema
              : removeSkillSchema
        ).parse(step.arguments);
        const person =
          `${args.expectedFirstName} ${args.expectedLastName}`.trim();
        const oldName =
          "expectedName" in args ? args.expectedName : "Not present";
        const newName = "name" in args ? args.name : "Removed";
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `${mode === "add" ? "Add" : mode === "update" ? "Update" : "Remove"} skill for ${person}`,
          actionLabel: `${mode === "add" ? "Add" : mode === "update" ? "Update" : "Remove"} skill`,
          consequences: [
            `This ${mode === "remove" ? "removes" : mode === "add" ? "adds" : "changes"} one skill and records it in activity.`,
          ],
          steps: [
            {
              stepId: step.id,
              title: `${mode} skill`,
              effectKind: mode === "remove" ? "destructive" : "other",
              reversibility: mode === "remove" ? "irreversible" : "reversible",
              resolvedTargets: [
                target("Person", person, `/people/${args.personId}`),
                ...("skillId" in args ? [target("Skill", args.skillId)] : []),
              ],
              counts: [{ label: "Skills affected", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [],
              beforeAfter: [
                { label: "Skill", before: oldName, after: newName, count: 1 },
              ],
            },
          ],
        });
      },
    })
  ),
] as const;

export const TAXONOMY_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(TAXONOMY_REVIEWS);

async function tagSnapshot(plantId: string, tagId: string) {
  const tag = await getTag(plantId, tagId);
  if (!tag) return null;
  const assignments = await db
    .select({ personId: personTags.personId })
    .from(personTags)
    .where(and(eq(personTags.churchId, plantId), eq(personTags.tagId, tagId)));
  return {
    ...tag,
    personIds: assignments.map(({ personId }) => personId).sort(),
  };
}

function selectionIdentity(selection: TaxonomySelection): string {
  return TAXONOMY_IDENTITIES[
    selection.kind.replace(/_([a-z])/g, (_, letter: string) =>
      letter.toUpperCase()
    ) as keyof typeof TAXONOMY_IDENTITIES
  ];
}

export async function proposeTaxonomyEffect(input: {
  actor: EvryPlantActor;
  pageContext: EvryResolvedPageContext | null;
  selection: TaxonomySelection;
  requestKey: EvryPlanRequestKey;
}) {
  const identity = selectionIdentity(input.selection);
  const authorization = await authorizeEvryEffectCapability(identity);
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  )
    return null;
  const personRequired = [
    "assign_tag",
    "remove_tag",
    "add_skill",
    "update_skill",
    "remove_skill",
  ].includes(input.selection.kind);
  if (personRequired && input.pageContext?.kind !== "person") return null;
  const person = personRequired
    ? await getPerson(input.actor.plantId, input.pageContext!.recordId)
    : null;
  if (personRequired && !person) return null;
  const personArgs = person
    ? {
        personId: person.id,
        expectedFirstName: person.firstName,
        expectedLastName: person.lastName,
      }
    : {};
  let args: Record<string, unknown> | null = null;
  if (input.selection.kind === "create_tag")
    args = { name: input.selection.name, color: input.selection.color };
  if (
    ["update_tag", "delete_tag", "assign_tag", "remove_tag"].includes(
      input.selection.kind
    )
  ) {
    const tagId = "tagId" in input.selection ? input.selection.tagId : "";
    const tag = await tagSnapshot(input.actor.plantId, tagId);
    if (!tag) return null;
    const baseline = {
      tagId: tag.id,
      expectedTagName: tag.name,
      expectedTagColor: tag.color,
    };
    if (input.selection.kind === "update_tag")
      args = {
        ...baseline,
        name: input.selection.name,
        color: input.selection.color,
      };
    if (input.selection.kind === "delete_tag") {
      if (tag.personIds.length > 99) return null;
      args = { ...baseline, expectedPersonIds: tag.personIds };
    }
    if (
      input.selection.kind === "assign_tag" ||
      input.selection.kind === "remove_tag"
    ) {
      const assigned = tag.personIds.includes(person!.id);
      if (assigned !== (input.selection.kind === "remove_tag")) return null;
      args = { ...personArgs, ...baseline };
    }
  }
  if (
    input.selection.kind === "add_skill" ||
    input.selection.kind === "update_skill" ||
    input.selection.kind === "remove_skill"
  ) {
    if (input.selection.kind === "add_skill")
      args = {
        ...personArgs,
        category: input.selection.category,
        name: input.selection.name,
        proficiency: input.selection.proficiency,
        notes: input.selection.notes,
      };
    else {
      const skill = await getSkill(
        input.actor.plantId,
        input.selection.skillId
      );
      if (!skill || skill.personId !== person!.id) return null;
      const baseline = {
        ...personArgs,
        skillId: skill.id,
        expectedCategory: skill.skillCategory,
        expectedName: skill.skillName,
        expectedProficiency: skill.proficiency,
        expectedNotes: skill.notes,
      };
      args =
        input.selection.kind === "update_skill"
          ? {
              ...baseline,
              category: input.selection.category,
              name: input.selection.name,
              proficiency: input.selection.proficiency,
              notes: input.selection.notes,
            }
          : baseline;
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
    registry: TAXONOMY_PLAN_REGISTRY,
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
    reviewRegistry: TAXONOMY_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

export async function taxonomyTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}): Promise<boolean> {
  const identity = input.step.capabilityIdentity;
  if (identity === TAXONOMY_IDENTITIES.createTag)
    return createTagSchema.safeParse(input.step.arguments).success;
  if (
    [
      TAXONOMY_IDENTITIES.updateTag,
      TAXONOMY_IDENTITIES.deleteTag,
      TAXONOMY_IDENTITIES.assignTag,
      TAXONOMY_IDENTITIES.removeTag,
    ].includes(identity as never)
  ) {
    const schema =
      identity === TAXONOMY_IDENTITIES.updateTag
        ? updateTagSchema
        : identity === TAXONOMY_IDENTITIES.deleteTag
          ? deleteTagSchema
          : tagMembershipSchema;
    const parsed = schema.safeParse(input.step.arguments);
    if (!parsed.success) return false;
    const tag = await tagSnapshot(input.actor.plantId, parsed.data.tagId);
    if (
      !tag ||
      tag.name !== parsed.data.expectedTagName ||
      tag.color !== parsed.data.expectedTagColor
    )
      return false;
    if (identity === TAXONOMY_IDENTITIES.deleteTag)
      return (
        JSON.stringify(tag.personIds) ===
        JSON.stringify(
          (parsed.data as z.infer<typeof deleteTagSchema>).expectedPersonIds
        )
      );
    if (
      identity === TAXONOMY_IDENTITIES.assignTag ||
      identity === TAXONOMY_IDENTITIES.removeTag
    ) {
      const args = parsed.data as z.infer<typeof tagMembershipSchema>;
      const person = await getPerson(input.actor.plantId, args.personId);
      const assigned = tag.personIds.includes(args.personId);
      return Boolean(
        person &&
        person.firstName === args.expectedFirstName &&
        person.lastName === args.expectedLastName &&
        assigned === (identity === TAXONOMY_IDENTITIES.removeTag)
      );
    }
    return true;
  }
  const schema =
    identity === TAXONOMY_IDENTITIES.addSkill
      ? addSkillSchema
      : identity === TAXONOMY_IDENTITIES.updateSkill
        ? updateSkillSchema
        : identity === TAXONOMY_IDENTITIES.removeSkill
          ? removeSkillSchema
          : null;
  const parsed = schema?.safeParse(input.step.arguments);
  if (!parsed?.success) return false;
  const person = await getPerson(input.actor.plantId, parsed.data.personId);
  if (
    !person ||
    person.firstName !== parsed.data.expectedFirstName ||
    person.lastName !== parsed.data.expectedLastName
  )
    return false;
  if (identity === TAXONOMY_IDENTITIES.addSkill) return true;
  const args = parsed.data as z.infer<typeof updateSkillSchema>;
  const skill = await getSkill(input.actor.plantId, args.skillId);
  return Boolean(
    skill &&
    skill.personId === args.personId &&
    skill.skillCategory === args.expectedCategory &&
    skill.skillName === args.expectedName &&
    skill.proficiency === args.expectedProficiency &&
    skill.notes === args.expectedNotes
  );
}
