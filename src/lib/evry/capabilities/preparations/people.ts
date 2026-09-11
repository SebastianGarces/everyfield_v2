import { z } from "zod";
import {
  backgroundCheckStatuses,
  householdRoles,
  personSources,
  personStatuses,
  interviewStatuses,
  interviewResults,
  commitmentTypes,
  skillCategories,
  skillProficiencies,
} from "@/db/schema/people";
import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  deriveEvryPlanRequestKey,
  parseStoredEvryActionPlan,
  type EvryPlanCapabilityRegistry,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { findEvryActionPlanByRequestKey } from "@/lib/evry/plans/repository";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import {
  trustedReviewForEvryPlanDocument,
  type EvryArtifactReviewRegistry,
} from "@/lib/evry/artifacts/trusted-plan-review";
import { resolveAuthorizedEvryPageContext } from "@/lib/evry/resolvers/page-context";
import type { EvryResolvedPageContext } from "@/lib/evry/resolvers/contract";
import type {
  EvryCapabilityConversationSelectionInput,
  EvryCapabilityConversationResult,
} from "../conversation";
import {
  defineEvryModelPreparation,
  type EvryModelPreparation,
} from "../model-preparation";
import {
  proposePeopleCoreEffect,
  PEOPLE_CORE_IDENTITIES,
  PEOPLE_CORE_PLAN_REGISTRY,
  PEOPLE_CORE_REVIEW_REGISTRY,
} from "../people/core";
import {
  proposeMilestoneEffect,
  MILESTONE_IDENTITIES,
  MILESTONE_PLAN_REGISTRY,
  MILESTONE_REVIEW_REGISTRY,
} from "../people/milestones";
import {
  proposeTaxonomyEffect,
  TAXONOMY_IDENTITIES,
  TAXONOMY_PLAN_REGISTRY,
  TAXONOMY_REVIEW_REGISTRY,
} from "../people/taxonomies";
import {
  proposeHouseholdEffect,
  HOUSEHOLD_IDENTITIES,
  HOUSEHOLD_PLAN_REGISTRY,
  HOUSEHOLD_REVIEW_REGISTRY,
} from "../people/households";
import {
  proposePeopleEvryNote,
  proposePeopleEvryNoteChange,
  PEOPLE_EVRY_ADD_NOTE_IDENTITY,
  PEOPLE_EVRY_EDIT_NOTE_IDENTITY,
  PEOPLE_EVRY_DELETE_NOTE_IDENTITY,
  PEOPLE_EVRY_PLAN_REGISTRY,
  PEOPLE_EVRY_REVIEW_REGISTRY,
} from "../people/runtime";
import {
  proposePeopleImport,
  PEOPLE_FILE_IDENTITIES,
  PEOPLE_FILE_PLAN_REGISTRY,
  PEOPLE_FILE_REVIEW_REGISTRY,
} from "../people/files";
import { EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH } from "../people/attachment-contract";

const personId = z
  .string()
  .uuid()
  .describe(
    "Resolve the person from authorized query results. A person ID is not an account ID."
  );
const target = { personId };
const note = z.string().trim().max(4000);
const nullableNote = note.nullable().default(null);
const color = z
  .union([
    z.enum(["blue", "green", "red", "yellow", "purple", "pink", "orange"]),
    z.string().regex(/^#[0-9a-f]{6}$/i),
  ])
  .nullable()
  .default(null);
const fields = z.strictObject({
  first: z.string().trim().min(1).max(255).optional().describe("First name"),
  last: z.string().trim().min(1).max(255).optional().describe("Last name"),
  email: z.email().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  address1: z.string().max(255).nullable().optional(),
  address2: z.string().max(255).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  postal: z.string().max(20).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  background: z.enum(backgroundCheckStatuses).optional(),
  source: z.enum(personSources).nullable().optional(),
  sourceDetails: z.string().max(4000).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  household: z.string().uuid().nullable().optional(),
  role: z.enum(householdRoles).nullable().optional(),
});
function recordedValues(
  input: Record<string, string | number | null | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
}
const personCreate = fields.extend({
  first: z.string().trim().min(1).max(255),
  last: z.string().trim().min(1).max(255),
});
const core = {
  planRegistry: PEOPLE_CORE_PLAN_REGISTRY,
  reviewRegistry: PEOPLE_CORE_REVIEW_REGISTRY,
};
const milestones = {
  planRegistry: MILESTONE_PLAN_REGISTRY,
  reviewRegistry: MILESTONE_REVIEW_REGISTRY,
};
const taxonomy = {
  planRegistry: TAXONOMY_PLAN_REGISTRY,
  reviewRegistry: TAXONOMY_REVIEW_REGISTRY,
};
const households = {
  planRegistry: HOUSEHOLD_PLAN_REGISTRY,
  reviewRegistry: HOUSEHOLD_REVIEW_REGISTRY,
};
const notes = {
  planRegistry: PEOPLE_EVRY_PLAN_REGISTRY,
  reviewRegistry: PEOPLE_EVRY_REVIEW_REGISTRY,
};
type Proposal = Awaited<ReturnType<typeof proposePeopleCoreEffect>>;
type PreparationContext = {
  input: EvryCapabilityConversationSelectionInput;
  pageContext: EvryResolvedPageContext | null;
  requestKey: EvryPlanRequestKey;
};

/** Recovery precedes record reads, so retrying cannot re-plan against changed data. */
function preparation<S extends z.ZodType>(config: {
  id: string;
  identity: string;
  inputSchema: S;
  planRegistry: EvryPlanCapabilityRegistry;
  reviewRegistry: EvryArtifactReviewRegistry;
  person?(args: z.output<S>): string;
  propose(context: PreparationContext, args: z.output<S>): Promise<Proposal>;
}): EvryModelPreparation {
  return defineEvryModelPreparation({
    id: config.id,
    capabilityIdentities: [config.identity],
    inputSchema: config.inputSchema,
    async run(input, args): Promise<EvryCapabilityConversationResult | null> {
      const requestKey = deriveEvryPlanRequestKey(`model-${config.id}`, [
        input.actor.userId,
        input.actor.plantId,
        input.conversation.id,
        input.userRequestKey,
      ]);
      const stored = await findEvryActionPlanByRequestKey({
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        requestKey,
      });
      if (stored) {
        if (!validateStoredEvryActionPlan(stored, config.planRegistry))
          throw new Error("Stored People plan failed integrity validation");
        const document = parseStoredEvryActionPlan({
          document: stored.document,
          registry: config.planRegistry,
        });
        if (
          document.steps.length !== 1 ||
          document.steps[0]?.capabilityIdentity !== config.identity
        )
          throw new Error("Stored People plan does not match this request");
        const plan = evryConversationPlanIdentitySchema.parse({
          planId: stored.id,
          fingerprint: stored.fingerprint,
        });
        const review = trustedReviewForEvryPlanDocument({
          plan,
          document,
          reviewRegistry: config.reviewRegistry,
        });
        if (!review)
          throw new Error("Stored People plan has no trusted review");
        return {
          body: "Review this change before anything is saved.",
          artifacts: [
            parseEvryConversationArtifactDocument(review.confirmation),
          ],
          activePlan: { mode: "set", plan },
        };
      }
      const selectedPerson = config.person?.(args);
      const pageContext = selectedPerson
        ? await resolveAuthorizedEvryPageContext({
            actor: input.actor,
            pageContext: { kind: "person", recordId: selectedPerson },
          })
        : null;
      if (selectedPerson && pageContext?.kind !== "person") {
        const clarification = {
          kind: "clarification" as const,
          mode: "missing" as const,
          entityType: "person",
          prompt:
            "That person is unavailable. Choose a current person record and try again.",
        };
        return {
          body: clarification.prompt,
          artifacts: [storedEvryClarificationArtifactDocument(clarification)],
        };
      }
      const proposal = await config.propose(
        { input, pageContext, requestKey },
        args
      );
      return proposal
        ? {
            body: "Review this change before anything is saved.",
            artifacts: [
              parseEvryConversationArtifactDocument(proposal.confirmation),
            ],
            activePlan: { mode: "set", plan: proposal.plan },
          }
        : null;
    },
  });
}

export const PEOPLE_MODEL_PREPARATIONS: readonly EvryModelPreparation[] = [
  preparation({
    id: "people.import_file",
    identity: PEOPLE_FILE_IDENTITIES.import,
    planRegistry: PEOPLE_FILE_PLAN_REGISTRY,
    reviewRegistry: PEOPLE_FILE_REVIEW_REGISTRY,
    inputSchema: z.strictObject({
      reference: z
        .string()
        .min(1)
        .max(EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH)
        .describe(
          "Exact server-issued attachment reference returned by the file workflow. Never a URL, path, CSV body or invented reference."
        ),
      duplicateResolutions: z
        .array(
          z.strictObject({
            rowNumber: z.number().int().min(2).max(27),
            resolution: z.enum(["skip", "create", "merge"]),
          })
        )
        .max(26)
        .default([])
        .refine(
          (entries) =>
            new Set(entries.map((entry) => entry.rowNumber)).size ===
            entries.length,
          "Resolve each duplicate row only once"
        )
        .describe(
          "Explicit choices for duplicate rows identified by files.inspect. Do not silently merge or create duplicate records."
        ),
    }),
    propose: ({ input, requestKey }, args) =>
      proposePeopleImport({
        actor: input.actor,
        requestKey,
        reference: args.reference,
        duplicateResolutions: Object.fromEntries(
          args.duplicateResolutions.map((entry) => [
            String(entry.rowNumber),
            entry.resolution,
          ])
        ),
      }),
  }),
  preparation({
    id: "people.reorder_pipeline",
    identity: PEOPLE_CORE_IDENTITIES.reorder,
    ...core,
    inputSchema: z.strictObject({
      personIds: z
        .array(personId)
        .min(1)
        .max(32)
        .refine(
          (ids) => new Set(ids).size === ids.length,
          "List each person once"
        )
        .describe("Ordered person IDs from the same intended pipeline cohort"),
    }),
    propose: ({ input, pageContext, requestKey }, args) =>
      proposePeopleCoreEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "reorder", personIds: args.personIds },
      }),
  }),
  preparation({
    id: "people.create",
    identity: PEOPLE_CORE_IDENTITIES.create,
    ...core,
    inputSchema: personCreate,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposePeopleCoreEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "create", values: args },
      }),
  }),
  preparation({
    id: "people.update",
    identity: PEOPLE_CORE_IDENTITIES.update,
    ...core,
    inputSchema: z.strictObject({
      ...target,
      changes: fields.refine(
        (v) => Object.keys(v).length > 0,
        "Specify at least one change"
      ),
    }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposePeopleCoreEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "update", values: args.changes },
      }),
  }),
  preparation({
    id: "people.delete",
    identity: PEOPLE_CORE_IDENTITIES.delete,
    ...core,
    inputSchema: z.strictObject(target),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }) =>
      proposePeopleCoreEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "delete" },
      }),
  }),
  preparation({
    id: "people.change_stage",
    identity: PEOPLE_CORE_IDENTITIES.status,
    ...core,
    inputSchema: z.strictObject({ ...target, stage: z.enum(personStatuses) }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposePeopleCoreEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "status", status: args.stage, reason: null },
      }),
  }),
  preparation({
    id: "people.change_stage_with_reason",
    identity: PEOPLE_CORE_IDENTITIES.statusReason,
    ...core,
    inputSchema: z.strictObject({
      ...target,
      stage: z.enum(personStatuses),
      reason: z.string().trim().min(1).max(2000),
    }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposePeopleCoreEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "status", status: args.stage, reason: args.reason },
      }),
  }),
  preparation({
    id: "people.remove_photo",
    identity: PEOPLE_CORE_IDENTITIES.removePhoto,
    ...core,
    inputSchema: z.strictObject(target),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }) =>
      proposePeopleCoreEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "remove_photo" },
      }),
  }),
  preparation({
    id: "people.add_note",
    identity: PEOPLE_EVRY_ADD_NOTE_IDENTITY,
    ...notes,
    inputSchema: z.strictObject({ ...target, note: note.min(1) }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposePeopleEvryNote({
        actor: input.actor,
        pageContext,
        requestKey,
        note: args.note,
      }),
  }),
  preparation({
    id: "people.edit_note",
    identity: PEOPLE_EVRY_EDIT_NOTE_IDENTITY,
    ...notes,
    inputSchema: z.strictObject({
      ...target,
      activityId: z.string().uuid(),
      note: note.min(1),
    }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposePeopleEvryNoteChange({
        actor: input.actor,
        pageContext,
        requestKey,
        now: input.now,
        selection: {
          kind: "edit_note",
          activityId: args.activityId,
          note: args.note,
        },
      }),
  }),
  preparation({
    id: "people.delete_note",
    identity: PEOPLE_EVRY_DELETE_NOTE_IDENTITY,
    ...notes,
    inputSchema: z.strictObject({ ...target, activityId: z.string().uuid() }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposePeopleEvryNoteChange({
        actor: input.actor,
        pageContext,
        requestKey,
        now: input.now,
        selection: { kind: "delete_note", activityId: args.activityId },
      }),
  }),
  preparation({
    id: "people.record_assessment",
    identity: MILESTONE_IDENTITIES.assessment,
    ...milestones,
    inputSchema: z
      .strictObject({
        ...target,
        date: z.iso.date(),
        committed: z.number().int().min(1).max(5),
        compelled: z.number().int().min(1).max(5),
        contagious: z.number().int().min(1).max(5),
        courageous: z.number().int().min(1).max(5),
        committedNotes: nullableNote,
        compelledNotes: nullableNote,
        contagiousNotes: nullableNote,
        courageousNotes: nullableNote,
      })
      .describe(
        "Record scores and notes supplied by the user. Never invent an assessment or judge spiritual suitability."
      ),
    person: (args) => args.personId,
    propose: (
      { input, pageContext, requestKey },
      { personId: _personId, ...args }
    ) =>
      proposeMilestoneEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "assessment", values: recordedValues(args) },
      }),
  }),
  preparation({
    id: "people.record_interview",
    identity: MILESTONE_IDENTITIES.interview,
    ...milestones,
    inputSchema: z
      .strictObject({
        ...target,
        date: z.iso.date(),
        maturity: z.enum(interviewStatuses),
        gifted: z.enum(interviewStatuses),
        chemistry: z.enum(interviewStatuses),
        rightReasons: z.enum(interviewStatuses),
        season: z.enum(interviewStatuses),
        result: z.enum(interviewResults),
        maturityNotes: nullableNote,
        giftedNotes: nullableNote,
        chemistryNotes: nullableNote,
        rightReasonsNotes: nullableNote,
        seasonNotes: nullableNote,
        next: nullableNote,
      })
      .describe(
        "Record the user's interview findings. Required ratings must be supplied, not inferred by the model."
      ),
    person: (args) => args.personId,
    propose: (
      { input, pageContext, requestKey },
      { personId: _personId, ...args }
    ) =>
      proposeMilestoneEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "interview", values: recordedValues(args) },
      }),
  }),
  preparation({
    id: "people.record_commitment",
    identity: MILESTONE_IDENTITIES.commitment,
    ...milestones,
    inputSchema: z.strictObject({
      ...target,
      date: z.iso.date(),
      type: z.enum(commitmentTypes),
      witness: z
        .string()
        .uuid()
        .nullable()
        .default(null)
        .describe("Optional witness account ID, not person ID"),
      notes: nullableNote,
    }),
    person: (args) => args.personId,
    propose: (
      { input, pageContext, requestKey },
      { personId: _personId, ...args }
    ) =>
      proposeMilestoneEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "commitment", values: recordedValues(args) },
      }),
  }),
  preparation({
    id: "people.create_tag",
    identity: TAXONOMY_IDENTITIES.createTag,
    ...taxonomy,
    inputSchema: z.strictObject({
      name: z.string().trim().min(1).max(100),
      color: color.default(null),
    }),
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeTaxonomyEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "create_tag", ...args },
      }),
  }),
  preparation({
    id: "people.update_tag",
    identity: TAXONOMY_IDENTITIES.updateTag,
    ...taxonomy,
    inputSchema: z.strictObject({
      tagId: z.string().uuid(),
      name: z.string().trim().min(1).max(100),
      color: color
        .removeDefault()
        .describe(
          "Supply the current color unless the user explicitly changes or clears it."
        ),
    }),
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeTaxonomyEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "update_tag", ...args },
      }),
  }),
  preparation({
    id: "people.delete_tag",
    identity: TAXONOMY_IDENTITIES.deleteTag,
    ...taxonomy,
    inputSchema: z.strictObject({ tagId: z.string().uuid() }),
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeTaxonomyEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "delete_tag", ...args },
      }),
  }),
  preparation({
    id: "people.assign_tag",
    identity: TAXONOMY_IDENTITIES.assignTag,
    ...taxonomy,
    inputSchema: z.strictObject({ ...target, tagId: z.string().uuid() }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeTaxonomyEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "assign_tag", tagId: args.tagId },
      }),
  }),
  preparation({
    id: "people.remove_tag",
    identity: TAXONOMY_IDENTITIES.removeTag,
    ...taxonomy,
    inputSchema: z.strictObject({ ...target, tagId: z.string().uuid() }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeTaxonomyEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "remove_tag", tagId: args.tagId },
      }),
  }),
  preparation({
    id: "people.add_skill",
    identity: TAXONOMY_IDENTITIES.addSkill,
    ...taxonomy,
    inputSchema: z.strictObject({
      ...target,
      category: z.enum(skillCategories),
      name: z.string().trim().min(1).max(100),
      proficiency: z.enum(skillProficiencies).nullable().default(null),
      notes: nullableNote,
    }),
    person: (args) => args.personId,
    propose: (
      { input, pageContext, requestKey },
      { personId: _personId, ...args }
    ) =>
      proposeTaxonomyEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "add_skill", ...args },
      }),
  }),
  preparation({
    id: "people.update_skill",
    identity: TAXONOMY_IDENTITIES.updateSkill,
    ...taxonomy,
    inputSchema: z.strictObject({
      ...target,
      skillId: z.string().uuid(),
      category: z.enum(skillCategories),
      name: z.string().trim().min(1).max(100),
      proficiency: z
        .enum(skillProficiencies)
        .nullable()
        .describe(
          "Keep the current value unless the user explicitly changes it."
        ),
      notes: note
        .nullable()
        .describe(
          "Keep the current notes unless the user explicitly changes or clears them."
        ),
    }),
    person: (args) => args.personId,
    propose: (
      { input, pageContext, requestKey },
      { personId: _personId, ...args }
    ) =>
      proposeTaxonomyEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "update_skill", ...args },
      }),
  }),
  preparation({
    id: "people.remove_skill",
    identity: TAXONOMY_IDENTITIES.removeSkill,
    ...taxonomy,
    inputSchema: z.strictObject({ ...target, skillId: z.string().uuid() }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeTaxonomyEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "remove_skill", skillId: args.skillId },
      }),
  }),
  preparation({
    id: "people.create_household",
    identity: HOUSEHOLD_IDENTITIES.create,
    ...households,
    inputSchema: z.strictObject({
      ...target,
      name: z.string().trim().min(1).max(255),
      usePersonAddress: z.boolean().default(false),
    }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeHouseholdEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: {
          kind: "create",
          name: args.name,
          usePersonAddress: args.usePersonAddress,
        },
      }),
  }),
  preparation({
    id: "people.update_household",
    identity: HOUSEHOLD_IDENTITIES.update,
    ...households,
    inputSchema: z.strictObject({
      householdId: z.string().uuid(),
      changes: z
        .strictObject({
          name: z.string().trim().min(1).max(255).optional(),
          address1: z.string().max(255).nullable().optional(),
          address2: z.string().max(255).nullable().optional(),
          city: z.string().max(100).nullable().optional(),
          state: z.string().max(100).nullable().optional(),
          postal: z.string().max(20).nullable().optional(),
          country: z.string().max(100).nullable().optional(),
        })
        .refine(
          (v) => Object.keys(v).length > 0,
          "Specify at least one change"
        ),
    }),
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeHouseholdEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: {
          kind: "update",
          householdId: args.householdId,
          values: args.changes,
        },
      }),
  }),
  preparation({
    id: "people.delete_household",
    identity: HOUSEHOLD_IDENTITIES.delete,
    ...households,
    inputSchema: z.strictObject({ householdId: z.string().uuid() }),
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeHouseholdEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "delete", householdId: args.householdId },
      }),
  }),
  preparation({
    id: "people.add_to_household",
    identity: HOUSEHOLD_IDENTITIES.add,
    ...households,
    inputSchema: z.strictObject({
      ...target,
      householdId: z.string().uuid(),
      role: z.enum(householdRoles),
    }),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeHouseholdEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: {
          kind: "add",
          householdId: args.householdId,
          role: args.role,
        },
      }),
  }),
  preparation({
    id: "people.remove_from_household",
    identity: HOUSEHOLD_IDENTITIES.remove,
    ...households,
    inputSchema: z.strictObject(target),
    person: (args) => args.personId,
    propose: ({ input, pageContext, requestKey }) =>
      proposeHouseholdEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "remove" },
      }),
  }),
  preparation({
    id: "people.propagate_household_address",
    identity: HOUSEHOLD_IDENTITIES.propagate,
    ...households,
    inputSchema: z.strictObject({ householdId: z.string().uuid() }),
    propose: ({ input, pageContext, requestKey }, args) =>
      proposeHouseholdEffect({
        actor: input.actor,
        pageContext,
        requestKey,
        selection: { kind: "propagate", householdId: args.householdId },
      }),
  }),
];
