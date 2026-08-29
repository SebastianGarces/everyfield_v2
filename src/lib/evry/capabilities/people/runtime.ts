import { z } from "zod";

import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  trustedReviewForEvryPlanDocument,
  type EvryArtifactReviewRegistry,
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
  type EvryExecutionCapabilityRegistry,
} from "@/lib/evry/executor";
import {
  parseEvryActionPlanCandidate,
  type EvryActionStep,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { createEvryActionPlanRecord } from "@/lib/evry/plans/repository";
import { defineEvryPlanCapability } from "@/lib/evry/plans/registry";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { createEvryReadContinuation } from "@/lib/evry/reads/core";
import type { EvryResolvedPageContext } from "@/lib/evry/resolvers/contract";
import {
  claimEvryPersonNote,
  claimEvryPersonNoteDelete,
  claimEvryPersonNoteEdit,
  formatActivityMessage,
  getActivities,
  getEvryAuthoredNote,
} from "@/lib/people/activity";
import { listPeople, getPerson } from "@/lib/people/service";

export const PEOPLE_EVRY_LIST_IDENTITY = "people.crm.people.list-people";
export const PEOPLE_EVRY_ADD_NOTE_IDENTITY = "people.crm.notes.add-note";
export const PEOPLE_EVRY_EDIT_NOTE_IDENTITY = "people.crm.notes.edit-note";
export const PEOPLE_EVRY_DELETE_NOTE_IDENTITY = "people.crm.notes.delete-note";
export const PEOPLE_EVRY_ACTIVITIES_IDENTITY =
  "people.crm.notes.get-activities";
export const PEOPLE_EVRY_MORE_ACTIVITIES_IDENTITY =
  "people.crm.notes.get-more-activities";

const peopleListInputSchema = z.strictObject({
  search: z.string().trim().max(160),
});

const peopleAddNoteArgumentsSchema = z.strictObject({
  personId: z.string().uuid(),
  firstName: z.string().min(1).max(255),
  lastName: z.string().max(255),
  note: z.string().trim().min(1).max(4_000),
});

const noteMetadataJsonSchema = z
  .string()
  .min(2)
  .max(8_000)
  .refine((value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return (
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      );
    } catch {
      return false;
    }
  }, "Expected an exact note metadata object");

const peopleEditNoteArgumentsSchema = z.strictObject({
  personId: z.string().uuid(),
  personLabel: z.string().min(1).max(511),
  activityId: z.string().uuid(),
  expectedMetadataJson: noteMetadataJsonSchema,
  note: z.string().trim().min(1).max(4_000),
  editedAt: z.string().datetime(),
});

const peopleDeleteNoteArgumentsSchema = z.strictObject({
  personId: z.string().uuid(),
  personLabel: z.string().min(1).max(511),
  activityId: z.string().uuid(),
  expectedMetadataJson: noteMetadataJsonSchema,
});

const peopleActivitiesInputSchema = z.strictObject({
  personId: z.string().uuid(),
  cursor: z.string().datetime().nullable(),
});

export type PeopleEvryRequestSelection =
  | Readonly<{ kind: "list_people"; search: string }>
  | Readonly<{ kind: "list_activity"; cursor: string | null }>
  | Readonly<{ kind: "add_note"; note: string }>
  | Readonly<{ kind: "edit_note"; activityId: string; note: string }>
  | Readonly<{ kind: "delete_note"; activityId: string }>;

/** A deliberately small deterministic selector; arbitrary prose is not a tool. */
export function selectPeopleEvryRequest(
  literalUserText: string
): PeopleEvryRequestSelection | null {
  const normalized = literalUserText.normalize("NFKC").trim();
  if (/^(?:show|list)(?: me)?(?: all)? people[.!?]*$/i.test(normalized)) {
    return { kind: "list_people", search: "" };
  }
  const search = /^find people(?: matching| named)?\s+(.+?)[.!?]*$/i.exec(
    normalized
  )?.[1];
  if (search) return { kind: "list_people", search: search.trim() };

  const note = /^add (?:a )?note:\s*([\s\S]+)$/i.exec(normalized)?.[1];
  if (note) return { kind: "add_note", note: note.trim() };
  if (
    /^(?:show|list)(?: this person(?:'s)?)? activity[.!?]*$/i.test(normalized)
  ) {
    return { kind: "list_activity", cursor: null };
  }
  const cursor = /^show more activity before\s+(\S+)[.!?]*$/i.exec(
    normalized
  )?.[1];
  if (cursor && z.string().datetime().safeParse(cursor).success) {
    return { kind: "list_activity", cursor };
  }
  const edit = /^edit note\s+([0-9a-f-]{36}):\s*([\s\S]+)$/i.exec(normalized);
  if (edit && z.string().uuid().safeParse(edit[1]).success && edit[2]?.trim()) {
    return {
      kind: "edit_note",
      activityId: edit[1],
      note: edit[2].trim(),
    };
  }
  const deletion = /^delete note\s+([0-9a-f-]{36})[.!?]*$/i.exec(normalized);
  return deletion && z.string().uuid().safeParse(deletion[1]).success
    ? { kind: "delete_note", activityId: deletion[1] }
    : null;
}

function personLabel(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ") || "Person";
}

function noteFromMetadataJson(value: string): string {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected note metadata");
  }
  const note = (parsed as Record<string, unknown>).note;
  if (typeof note !== "string") throw new Error("Expected note content");
  return note;
}

function displayToken(value: string | null): string {
  if (!value) return "Not set";
  return value
    .split("_")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export const PEOPLE_EVRY_LIST_READ = defineEvryReadRegistration({
  id: "people.list",
  capabilityIdentity: PEOPLE_EVRY_LIST_IDENTITY,
  inputShape: peopleListInputSchema.shape,
  async run({ authorization }, input) {
    const page = await listPeople(authorization.actor.plantId, {
      search: input.search || undefined,
      limit: 24,
    });
    const peopleLink = {
      label: "Open People",
      href: input.search
        ? `/people?search=${encodeURIComponent(input.search)}`
        : "/people",
    };
    const sourceLink = trustedEvryApplicationSourceLink(peopleLink);
    const hidden = Math.max(0, page.total - page.people.length);
    return buildEvryReadArtifact({
      title: input.search ? `People matching “${input.search}”` : "People",
      filters: input.search
        ? [{ label: "Search", value: input.search }]
        : [{ label: "Plant", value: "Current plant" }],
      exclusions:
        hidden > 0
          ? [{ reason: "Not shown on this result page", count: hidden }]
          : [],
      items: page.people.map((person) => ({
        id: person.id,
        label: personLabel(person.firstName, person.lastName),
        facts: [
          { label: "Status", value: displayToken(person.status) },
          { label: "Source", value: displayToken(person.source) },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: `Open ${personLabel(person.firstName, person.lastName)}`,
          href: `/people/${person.id}`,
        }),
      })),
      sourceLinks: [sourceLink],
    });
  },
});

function noteFacts(metadata: unknown): { label: string; value: string }[] {
  if (typeof metadata !== "object" || metadata === null) return [];
  const note = (metadata as Record<string, unknown>).note;
  if (typeof note !== "string") return [];
  const chunks = Array.from(
    { length: Math.ceil(note.length / 500) },
    (_, index) => note.slice(index * 500, (index + 1) * 500)
  );
  return chunks.map((value, index) => ({
    label: chunks.length === 1 ? "Note" : `Note ${index + 1}`,
    value,
  }));
}

function peopleActivitiesRead(input: {
  id: string;
  capabilityIdentity: string;
}) {
  return defineEvryReadRegistration({
    id: input.id,
    capabilityIdentity: input.capabilityIdentity,
    inputShape: peopleActivitiesInputSchema.shape,
    async run({ authorization }, readInput) {
      const person = await getPerson(
        authorization.actor.plantId,
        readInput.personId
      );
      const label = person
        ? personLabel(person.firstName, person.lastName)
        : "Person";
      const page = person
        ? await getActivities(authorization.actor.plantId, person.id, {
            cursor: readInput.cursor ? new Date(readInput.cursor) : undefined,
            limit: 20,
          })
        : { activities: [] };
      return buildEvryReadArtifact({
        title: `Activity for ${label}`,
        filters: [
          { label: "Person", value: label },
          ...(readInput.cursor
            ? [{ label: "Before", value: readInput.cursor }]
            : []),
        ],
        exclusions: [],
        items: page.activities.map((activity) => ({
          id: activity.id,
          label: formatActivityMessage(activity),
          facts: [
            { label: "Recorded", value: activity.createdAt.toISOString() },
            ...(activity.performer?.name
              ? [{ label: "By", value: activity.performer.name }]
              : []),
            ...noteFacts(activity.metadata),
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: `Open ${label} activity`,
            href: `/people/${readInput.personId}/activity`,
          }),
        })),
        sourceLinks: [
          trustedEvryApplicationSourceLink({
            label: `Open ${label} activity`,
            href: `/people/${readInput.personId}/activity`,
          }),
        ],
      });
    },
  });
}

export const PEOPLE_EVRY_ACTIVITIES_READ = peopleActivitiesRead({
  id: "people.activities",
  capabilityIdentity: PEOPLE_EVRY_ACTIVITIES_IDENTITY,
});

export const PEOPLE_EVRY_MORE_ACTIVITIES_READ = peopleActivitiesRead({
  id: "people.activities.more",
  capabilityIdentity: PEOPLE_EVRY_MORE_ACTIVITIES_IDENTITY,
});

export const continuePeopleEvryRead = createEvryReadContinuation({
  registrations: [
    PEOPLE_EVRY_LIST_READ,
    PEOPLE_EVRY_ACTIVITIES_READ,
    PEOPLE_EVRY_MORE_ACTIVITIES_READ,
  ],
  async select({ literalUserText, pageContext, eligibleReadIds }) {
    const selection = selectPeopleEvryRequest(literalUserText);
    if (
      selection?.kind === "list_people" &&
      eligibleReadIds.includes(PEOPLE_EVRY_LIST_READ.id)
    ) {
      return {
        readId: PEOPLE_EVRY_LIST_READ.id,
        input: { search: selection.search },
      };
    }
    if (selection?.kind !== "list_activity" || pageContext?.kind !== "person") {
      return null;
    }
    const registration = selection.cursor
      ? PEOPLE_EVRY_MORE_ACTIVITIES_READ
      : PEOPLE_EVRY_ACTIVITIES_READ;
    return eligibleReadIds.includes(registration.id)
      ? {
          readId: registration.id,
          input: { personId: pageContext.recordId, cursor: selection.cursor },
        }
      : null;
  },
});

export const PEOPLE_EVRY_ADD_NOTE_PLAN = defineEvryPlanCapability({
  identity: PEOPLE_EVRY_ADD_NOTE_IDENTITY,
  effectClass: "database_write",
  arguments: peopleAddNoteArgumentsSchema.shape,
});

export const PEOPLE_EVRY_EDIT_NOTE_PLAN = defineEvryPlanCapability({
  identity: PEOPLE_EVRY_EDIT_NOTE_IDENTITY,
  effectClass: "database_write",
  arguments: peopleEditNoteArgumentsSchema.shape,
});

export const PEOPLE_EVRY_DELETE_NOTE_PLAN = defineEvryPlanCapability({
  identity: PEOPLE_EVRY_DELETE_NOTE_IDENTITY,
  effectClass: "database_write",
  arguments: peopleDeleteNoteArgumentsSchema.shape,
});

function exactExecutionTuple(
  input: EvryEffectInput,
  identity: string
): boolean {
  const actor = input.authorization.actor;
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === actor.userId &&
    input.execution.plantId === actor.plantId
  );
}

export const PEOPLE_EVRY_ADD_NOTE_EXECUTION = defineEvryExecutionCapability({
  planCapability: PEOPLE_EVRY_ADD_NOTE_PLAN,
  async executeIfCurrent(input) {
    const parsed = peopleAddNoteArgumentsSchema.safeParse(input.arguments);
    if (
      !parsed.success ||
      !exactExecutionTuple(input, PEOPLE_EVRY_ADD_NOTE_IDENTITY)
    ) {
      return { status: "refused", excludedCount: 1 };
    }

    const result = await claimEvryPersonNote({
      execution: input.execution,
      effectKey: input.effectKey,
      personId: parsed.data.personId,
      expectedFirstName: parsed.data.firstName,
      expectedLastName: parsed.data.lastName,
      note: parsed.data.note,
    });
    return result.status === "completed"
      ? {
          status: "completed",
          affectedCount: result.affectedCount,
          excludedCount: result.excludedCount,
        }
      : result;
  },
});

export const PEOPLE_EVRY_EDIT_NOTE_EXECUTION = defineEvryExecutionCapability({
  planCapability: PEOPLE_EVRY_EDIT_NOTE_PLAN,
  async executeIfCurrent(input) {
    const parsed = peopleEditNoteArgumentsSchema.safeParse(input.arguments);
    if (
      !parsed.success ||
      !exactExecutionTuple(input, PEOPLE_EVRY_EDIT_NOTE_IDENTITY)
    ) {
      return { status: "refused", excludedCount: 1 };
    }
    return claimEvryPersonNoteEdit({
      execution: input.execution,
      effectKey: input.effectKey,
      personId: parsed.data.personId,
      activityId: parsed.data.activityId,
      expectedMetadataJson: parsed.data.expectedMetadataJson,
      note: parsed.data.note,
      editedAt: parsed.data.editedAt,
    });
  },
});

export const PEOPLE_EVRY_DELETE_NOTE_EXECUTION = defineEvryExecutionCapability({
  planCapability: PEOPLE_EVRY_DELETE_NOTE_PLAN,
  async executeIfCurrent(input) {
    const parsed = peopleDeleteNoteArgumentsSchema.safeParse(input.arguments);
    if (
      !parsed.success ||
      !exactExecutionTuple(input, PEOPLE_EVRY_DELETE_NOTE_IDENTITY)
    ) {
      return { status: "refused", excludedCount: 1 };
    }
    return claimEvryPersonNoteDelete({
      execution: input.execution,
      effectKey: input.effectKey,
      personId: parsed.data.personId,
      activityId: parsed.data.activityId,
      expectedMetadataJson: parsed.data.expectedMetadataJson,
    });
  },
});

export const PEOPLE_EVRY_EXECUTION_REGISTRY: EvryExecutionCapabilityRegistry =
  createEvryExecutionCapabilityRegistry([
    PEOPLE_EVRY_ADD_NOTE_EXECUTION,
    PEOPLE_EVRY_EDIT_NOTE_EXECUTION,
    PEOPLE_EVRY_DELETE_NOTE_EXECUTION,
  ]);
export const PEOPLE_EVRY_PLAN_REGISTRY =
  PEOPLE_EVRY_EXECUTION_REGISTRY.planRegistry;

export const PEOPLE_EVRY_REVIEW_REGISTRY: EvryArtifactReviewRegistry =
  createEvryArtifactReviewRegistry([
    defineEvryArtifactReview({
      source: {
        kind: "generic",
        capabilityIdentities: [PEOPLE_EVRY_ADD_NOTE_IDENTITY],
      },
      build({ plan, document }) {
        const step = document.steps[0];
        const parsed = peopleAddNoteArgumentsSchema.parse(step?.arguments);
        const label = personLabel(parsed.firstName, parsed.lastName);
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Add a note for ${label}`,
          actionLabel: "Add note",
          consequences: [
            "This adds one note to the person’s activity timeline.",
          ],
          steps: [
            {
              stepId: step?.id ?? "add-note",
              title: "Add activity note",
              effectKind: "other",
              reversibility: "reversible",
              resolvedTargets: [
                {
                  label: "Person",
                  value: label,
                  sourceLink: {
                    label: `Open ${label}`,
                    href: `/people/${parsed.personId}`,
                  },
                },
              ],
              counts: [{ label: "Notes to add", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [{ label: "Note", content: parsed.note }],
              beforeAfter: [],
            },
          ],
        });
      },
    }),
    defineEvryArtifactReview({
      source: {
        kind: "generic",
        capabilityIdentities: [PEOPLE_EVRY_EDIT_NOTE_IDENTITY],
      },
      build({ plan, document }) {
        const step = document.steps[0];
        const parsed = peopleEditNoteArgumentsSchema.parse(step?.arguments);
        const expectedNote = noteFromMetadataJson(parsed.expectedMetadataJson);
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Edit a note for ${parsed.personLabel}`,
          actionLabel: "Save note edit",
          consequences: [
            "This replaces the selected activity note and records an edit time.",
          ],
          steps: [
            {
              stepId: step?.id ?? "edit-note",
              title: "Edit activity note",
              effectKind: "other",
              reversibility: "reversible",
              resolvedTargets: [
                {
                  label: "Person",
                  value: parsed.personLabel,
                  sourceLink: {
                    label: `Open ${parsed.personLabel}`,
                    href: `/people/${parsed.personId}/activity`,
                  },
                },
                { label: "Note", value: parsed.activityId, sourceLink: null },
              ],
              counts: [{ label: "Notes to edit", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [],
              beforeAfter: [
                {
                  label: "Note",
                  before: expectedNote,
                  after: parsed.note,
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
        capabilityIdentities: [PEOPLE_EVRY_DELETE_NOTE_IDENTITY],
      },
      build({ plan, document }) {
        const step = document.steps[0];
        const parsed = peopleDeleteNoteArgumentsSchema.parse(step?.arguments);
        const expectedNote = noteFromMetadataJson(parsed.expectedMetadataJson);
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Delete a note for ${parsed.personLabel}`,
          actionLabel: "Delete note",
          consequences: [
            "This permanently removes the selected activity note.",
          ],
          steps: [
            {
              stepId: step?.id ?? "delete-note",
              title: "Delete activity note",
              effectKind: "destructive",
              reversibility: "irreversible",
              resolvedTargets: [
                {
                  label: "Person",
                  value: parsed.personLabel,
                  sourceLink: {
                    label: `Open ${parsed.personLabel}`,
                    href: `/people/${parsed.personId}/activity`,
                  },
                },
                { label: "Note", value: parsed.activityId, sourceLink: null },
              ],
              counts: [{ label: "Notes to delete", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [
                { label: "Note to delete", content: expectedNote },
              ],
              beforeAfter: [
                {
                  label: "Note",
                  before: expectedNote,
                  after: "Deleted",
                  count: 1,
                },
              ],
            },
          ],
        });
      },
    }),
  ]);

export async function proposePeopleEvryNote(input: {
  actor: EvryPlantActor;
  pageContext: EvryResolvedPageContext | null;
  note: string;
  requestKey: EvryPlanRequestKey;
}) {
  if (input.pageContext?.kind !== "person") return null;
  const authorization = await authorizeEvryEffectCapability(
    PEOPLE_EVRY_ADD_NOTE_IDENTITY
  );
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  ) {
    return null;
  }
  const person = await getPerson(
    authorization.actor.plantId,
    input.pageContext.recordId
  );
  if (!person) return null;
  const args = peopleAddNoteArgumentsSchema.safeParse({
    personId: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    note: input.note,
  });
  if (!args.success) return null;

  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "add-note",
          capabilityIdentity: PEOPLE_EVRY_ADD_NOTE_IDENTITY,
          arguments: args.data,
          dependsOn: [],
        },
      ],
    },
    registry: PEOPLE_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(authorization.actor),
  });
  const stored = await createEvryActionPlanRecord({
    actorUserId: authorization.actor.userId,
    plantId: authorization.actor.plantId,
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
    reviewRegistry: PEOPLE_EVRY_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

export async function proposePeopleEvryNoteChange(input: {
  actor: EvryPlantActor;
  pageContext: EvryResolvedPageContext | null;
  selection: Extract<
    PeopleEvryRequestSelection,
    { kind: "edit_note" | "delete_note" }
  >;
  requestKey: EvryPlanRequestKey;
  now: Date;
}) {
  if (input.pageContext?.kind !== "person") return null;
  const identity =
    input.selection.kind === "edit_note"
      ? PEOPLE_EVRY_EDIT_NOTE_IDENTITY
      : PEOPLE_EVRY_DELETE_NOTE_IDENTITY;
  const authorization = await authorizeEvryEffectCapability(identity);
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  ) {
    return null;
  }
  const [person, note] = await Promise.all([
    getPerson(authorization.actor.plantId, input.pageContext.recordId),
    getEvryAuthoredNote({
      churchId: authorization.actor.plantId,
      actorUserId: authorization.actor.userId,
      personId: input.pageContext.recordId,
      activityId: input.selection.activityId,
    }),
  ]);
  if (!person || !note) return null;
  const label = personLabel(person.firstName, person.lastName);
  const parsed =
    input.selection.kind === "edit_note"
      ? peopleEditNoteArgumentsSchema.safeParse({
          personId: person.id,
          personLabel: label,
          activityId: note.id,
          expectedMetadataJson: note.metadataJson,
          note: input.selection.note,
          editedAt: input.now.toISOString(),
        })
      : peopleDeleteNoteArgumentsSchema.safeParse({
          personId: person.id,
          personLabel: label,
          activityId: note.id,
          expectedMetadataJson: note.metadataJson,
        });
  if (!parsed.success) return null;
  const stepId =
    input.selection.kind === "edit_note" ? "edit-note" : "delete-note";
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: stepId,
          capabilityIdentity: identity,
          arguments: parsed.data,
          dependsOn: [],
        },
      ],
    },
    registry: PEOPLE_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(authorization.actor),
  });
  const stored = await createEvryActionPlanRecord({
    actorUserId: authorization.actor.userId,
    plantId: authorization.actor.plantId,
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
    reviewRegistry: PEOPLE_EVRY_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

export async function peopleEvryPlanTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}): Promise<boolean> {
  if (input.step.capabilityIdentity === PEOPLE_EVRY_ADD_NOTE_IDENTITY) {
    const parsed = peopleAddNoteArgumentsSchema.safeParse(input.step.arguments);
    if (!parsed.success) return false;
    const person = await getPerson(input.actor.plantId, parsed.data.personId);
    return Boolean(
      person &&
      person.firstName === parsed.data.firstName &&
      person.lastName === parsed.data.lastName
    );
  }
  const parsed =
    input.step.capabilityIdentity === PEOPLE_EVRY_EDIT_NOTE_IDENTITY
      ? peopleEditNoteArgumentsSchema.safeParse(input.step.arguments)
      : input.step.capabilityIdentity === PEOPLE_EVRY_DELETE_NOTE_IDENTITY
        ? peopleDeleteNoteArgumentsSchema.safeParse(input.step.arguments)
        : null;
  if (!parsed?.success) return false;
  const note = await getEvryAuthoredNote({
    churchId: input.actor.plantId,
    actorUserId: input.actor.userId,
    personId: parsed.data.personId,
    activityId: parsed.data.activityId,
  });
  return Boolean(
    note && note.metadataJson === parsed.data.expectedMetadataJson
  );
}
