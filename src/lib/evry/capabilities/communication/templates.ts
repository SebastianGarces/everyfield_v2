import { z } from "zod";

import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  assertEvryPlanDocumentReviewable,
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
  communicationChannels,
  templateCategories,
} from "@/db/schema/communication";
import {
  claimEvryCommunicationSystemTemplateUpdate,
  claimEvryCommunicationTemplateCreate,
  claimEvryCommunicationTemplateDelete,
  claimEvryCommunicationTemplateFork,
  claimEvryCommunicationTemplateUpdate,
  getEvryCommunicationTemplateFork,
  getEvryCommunicationTemplateSnapshot,
} from "@/lib/communication/evry-template-effect";
import { communicationEvryEffectUuid } from "@/lib/communication/evry-effect";
import { storedTemplateContent } from "@/lib/communication/templates";

import { communicationEvryUnavailable } from "./refusal";

export const COMMUNICATION_TEMPLATE_CREATE_IDENTITY =
  "communication.templates.create";
export const COMMUNICATION_TEMPLATE_UPDATE_IDENTITY =
  "communication.templates.update";
export const COMMUNICATION_TEMPLATE_DELETE_IDENTITY =
  "communication.templates.delete";
export const COMMUNICATION_TEMPLATE_FORK_IDENTITY =
  "communication.templates.fork";

const contentShape = {
  name: z.string().trim().min(1).max(255),
  description: z.string().max(1_000).nullable(),
  category: z.enum(templateCategories),
  channel: z.enum(communicationChannels),
  subject: z.string().max(500).nullable(),
  body: z.string().min(1).max(100_000),
  bodyHtml: z.string().min(1).max(200_000),
} as const;

/** Canonical rich content: callers cannot confirm one body and store another. */
const contentSchema = z
  .strictObject(contentShape)
  .superRefine((content, ctx) => {
    const canonical = storedTemplateContent(content.bodyHtml);
    if (
      canonical.body !== content.body ||
      canonical.bodyHtml !== content.bodyHtml
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["bodyHtml"],
        message: "Template body and HTML must be one canonical sanitized value",
      });
    }
  });

const snapshotSchema = z.strictObject({
  id: z.string().uuid(),
  name: contentShape.name,
  description: contentShape.description,
  category: contentShape.category,
  channel: contentShape.channel,
  subject: contentShape.subject,
  body: contentShape.body,
  bodyHtml: z.string().min(1).max(200_000).nullable(),
  isSystem: z.boolean(),
  sourceTemplateId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime(),
});

const createArgumentsSchema = z.strictObject({
  templateId: z.string().uuid(),
  content: contentSchema,
});
const updateArgumentsSchema = z.strictObject({
  targetKind: z.enum(["owned", "system"]),
  resultTemplateId: z.string().uuid(),
  expected: snapshotSchema,
  content: contentSchema,
});
const deleteArgumentsSchema = z.strictObject({
  expected: snapshotSchema,
});
const forkArgumentsSchema = z.strictObject({
  forkId: z.string().uuid(),
  source: snapshotSchema,
});

export type CommunicationEvryTemplateSelection =
  | Readonly<{
      kind: "create_template";
      name: string;
      description: string | null;
      category: (typeof templateCategories)[number];
      channel: (typeof communicationChannels)[number];
      subject: string;
      body: string;
    }>
  | Readonly<{
      kind: "update_template";
      templateId: string;
      name: string;
      description?: string | null;
      category?: (typeof templateCategories)[number];
      channel?: (typeof communicationChannels)[number];
      subject: string;
      body: string;
    }>
  | Readonly<{ kind: "delete_template"; templateId: string }>
  | Readonly<{ kind: "fork_template"; templateId: string }>;

const UUID =
  "([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";

function splitFields(value: string, count: number): string[] | null {
  const fields: string[] = [];
  let rest = value;
  for (let index = 1; index < count; index += 1) {
    const delimiter = rest.indexOf("|");
    if (delimiter < 0) return null;
    fields.push(rest.slice(0, delimiter).trim());
    rest = rest.slice(delimiter + 1);
  }
  fields.push(rest.trim());
  return fields;
}

function parsedTemplateContent(value: string) {
  const extended = splitFields(value, 6);
  if (extended) {
    const [name, description, category, channel, subject, body] = extended;
    const parsedCategory = z.enum(templateCategories).safeParse(category);
    const parsedChannel = z.enum(communicationChannels).safeParse(channel);
    if (name && body && parsedCategory.success && parsedChannel.success) {
      return {
        name,
        description: description || null,
        category: parsedCategory.data,
        channel: parsedChannel.data,
        subject: subject ?? "",
        body,
        extended: true as const,
      };
    }
  }
  const basic = splitFields(value, 3);
  const [name, subject, body] = basic ?? [];
  return name && body
    ? {
        name,
        description: null,
        category: "other" as const,
        channel: "email" as const,
        subject: subject ?? "",
        body,
        extended: false as const,
      }
    : null;
}

export function selectCommunicationEvryTemplateEffect(
  literalUserText: string
): CommunicationEvryTemplateSelection | null {
  const text = literalUserText.normalize("NFKC").trim();
  const create = /^create (?:an? )?(?:email )?template\s+([\s\S]+)$/i.exec(
    text
  );
  const createContent = create?.[1] ? parsedTemplateContent(create[1]) : null;
  if (createContent) {
    return {
      kind: "create_template",
      name: createContent.name,
      description: createContent.description,
      category: createContent.category,
      channel: createContent.channel,
      subject: createContent.subject,
      body: createContent.body,
    };
  }
  const update = new RegExp(
    `^update template\\s+${UUID}\\s*\\|([\\s\\S]+)$`,
    "i"
  ).exec(text);
  const updateContent = update?.[2] ? parsedTemplateContent(update[2]) : null;
  if (update?.[1] && updateContent) {
    return {
      kind: "update_template",
      templateId: update[1],
      name: updateContent.name,
      ...(updateContent.extended
        ? {
            description: updateContent.description,
            category: updateContent.category,
            channel: updateContent.channel,
          }
        : {}),
      subject: updateContent.subject,
      body: updateContent.body,
    };
  }
  const deletion = new RegExp(`^delete template\\s+${UUID}[.!?]*$`, "i").exec(
    text
  );
  if (deletion?.[1]) {
    return { kind: "delete_template", templateId: deletion[1] };
  }
  const fork = new RegExp(`^fork template\\s+${UUID}[.!?]*$`, "i").exec(text);
  return fork?.[1] ? { kind: "fork_template", templateId: fork[1] } : null;
}

export const COMMUNICATION_TEMPLATE_CREATE_PLAN = defineEvryPlanCapability({
  identity: COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
  effectClass: "database_write",
  arguments: createArgumentsSchema.shape,
});
export const COMMUNICATION_TEMPLATE_UPDATE_PLAN = defineEvryPlanCapability({
  identity: COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
  effectClass: "database_write",
  arguments: updateArgumentsSchema.shape,
});
export const COMMUNICATION_TEMPLATE_DELETE_PLAN = defineEvryPlanCapability({
  identity: COMMUNICATION_TEMPLATE_DELETE_IDENTITY,
  effectClass: "database_write",
  arguments: deleteArgumentsSchema.shape,
});
export const COMMUNICATION_TEMPLATE_FORK_PLAN = defineEvryPlanCapability({
  identity: COMMUNICATION_TEMPLATE_FORK_IDENTITY,
  effectClass: "database_write",
  arguments: forkArgumentsSchema.shape,
});

function exactExecutionTuple(input: EvryEffectInput, identity: string) {
  const actor = input.authorization.actor;
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === actor.userId &&
    input.execution.plantId === actor.plantId
  );
}

export const COMMUNICATION_TEMPLATE_CREATE_EXECUTION =
  defineEvryExecutionCapability({
    planCapability: COMMUNICATION_TEMPLATE_CREATE_PLAN,
    async executeIfCurrent(input) {
      const parsed = createArgumentsSchema.safeParse(input.arguments);
      if (
        !parsed.success ||
        !exactExecutionTuple(input, COMMUNICATION_TEMPLATE_CREATE_IDENTITY)
      ) {
        return { status: "refused", excludedCount: 1 };
      }
      try {
        return await claimEvryCommunicationTemplateCreate({
          effect: input,
          identity: COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
          templateId: parsed.data.templateId,
          content: parsed.data.content,
        });
      } catch {
        return { status: "retryable" };
      }
    },
  });

export const COMMUNICATION_TEMPLATE_UPDATE_EXECUTION =
  defineEvryExecutionCapability({
    planCapability: COMMUNICATION_TEMPLATE_UPDATE_PLAN,
    async executeIfCurrent(input) {
      const parsed = updateArgumentsSchema.safeParse(input.arguments);
      if (
        !parsed.success ||
        !exactExecutionTuple(input, COMMUNICATION_TEMPLATE_UPDATE_IDENTITY) ||
        (parsed.data.targetKind === "owned") !== !parsed.data.expected.isSystem
      ) {
        return { status: "refused", excludedCount: 1 };
      }
      try {
        return parsed.data.targetKind === "owned"
          ? await claimEvryCommunicationTemplateUpdate({
              effect: input,
              identity: COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
              templateId: parsed.data.expected.id,
              expectedUpdatedAt: parsed.data.expected.updatedAt,
              content: parsed.data.content,
            })
          : await claimEvryCommunicationSystemTemplateUpdate({
              effect: input,
              identity: COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
              source: parsed.data.expected,
              forkId: parsed.data.resultTemplateId,
              content: parsed.data.content,
            });
      } catch {
        return { status: "retryable" };
      }
    },
  });

export const COMMUNICATION_TEMPLATE_DELETE_EXECUTION =
  defineEvryExecutionCapability({
    planCapability: COMMUNICATION_TEMPLATE_DELETE_PLAN,
    async executeIfCurrent(input) {
      const parsed = deleteArgumentsSchema.safeParse(input.arguments);
      if (
        !parsed.success ||
        parsed.data.expected.isSystem ||
        !exactExecutionTuple(input, COMMUNICATION_TEMPLATE_DELETE_IDENTITY)
      ) {
        return { status: "refused", excludedCount: 1 };
      }
      try {
        return await claimEvryCommunicationTemplateDelete({
          effect: input,
          identity: COMMUNICATION_TEMPLATE_DELETE_IDENTITY,
          templateId: parsed.data.expected.id,
          expectedUpdatedAt: parsed.data.expected.updatedAt,
        });
      } catch {
        return { status: "retryable" };
      }
    },
  });

export const COMMUNICATION_TEMPLATE_FORK_EXECUTION =
  defineEvryExecutionCapability({
    planCapability: COMMUNICATION_TEMPLATE_FORK_PLAN,
    async executeIfCurrent(input) {
      const parsed = forkArgumentsSchema.safeParse(input.arguments);
      if (
        !parsed.success ||
        !parsed.data.source.isSystem ||
        !exactExecutionTuple(input, COMMUNICATION_TEMPLATE_FORK_IDENTITY)
      ) {
        return { status: "refused", excludedCount: 1 };
      }
      try {
        return await claimEvryCommunicationTemplateFork({
          effect: input,
          identity: COMMUNICATION_TEMPLATE_FORK_IDENTITY,
          source: parsed.data.source,
          forkId: parsed.data.forkId,
        });
      } catch {
        return { status: "retryable" };
      }
    },
  });

export const COMMUNICATION_TEMPLATE_EXECUTIONS = [
  COMMUNICATION_TEMPLATE_CREATE_EXECUTION,
  COMMUNICATION_TEMPLATE_UPDATE_EXECUTION,
  COMMUNICATION_TEMPLATE_DELETE_EXECUTION,
  COMMUNICATION_TEMPLATE_FORK_EXECUTION,
] as const;

export const COMMUNICATION_TEMPLATE_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(COMMUNICATION_TEMPLATE_EXECUTIONS);
export const COMMUNICATION_TEMPLATE_PLAN_REGISTRY =
  COMMUNICATION_TEMPLATE_EXECUTION_REGISTRY.planRegistry;

function templateHref(templateId: string) {
  return `/communication/templates/${templateId}/edit`;
}

function effectiveSnapshotContent(snapshot: z.infer<typeof snapshotSchema>) {
  return storedTemplateContent(snapshot.bodyHtml ?? snapshot.body);
}

function reviewText(
  value: string | null | undefined,
  fallback: string,
  maximum = 4_000
) {
  return (value?.trim() || fallback).slice(0, maximum);
}

function templateReviewTitle(verb: string, name: string) {
  const prefix = `${verb} template “`;
  const suffix = "”";
  return `${prefix}${reviewText(
    name,
    "Unnamed template",
    200 - prefix.length - suffix.length
  )}${suffix}`;
}

function templateSourceLink(templateId: string, name: string) {
  return {
    label: reviewText(`Open ${name}`, "Open template", 160),
    href: templateHref(templateId),
  };
}

export const COMMUNICATION_TEMPLATE_REVIEWS = [
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [COMMUNICATION_TEMPLATE_CREATE_IDENTITY],
    },
    build({ plan, document }) {
      const step = document.steps[0];
      const parsed = createArgumentsSchema.parse(step?.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: templateReviewTitle("Create", parsed.content.name),
        actionLabel: "Create template",
        consequences: ["This adds one reusable template to this plant."],
        steps: [
          {
            stepId: step?.id ?? "create-template",
            title: "Create communication template",
            effectKind: "other",
            reversibility: "reversible",
            resolvedTargets: [
              {
                label: "Template",
                value: parsed.content.name,
                sourceLink: null,
              },
            ],
            counts: [{ label: "Templates to create", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [
              {
                label: "Subject",
                content: reviewText(parsed.content.subject, "(No subject)"),
              },
              {
                label: "Body",
                content: reviewText(parsed.content.body, "(Empty template)"),
              },
            ],
            beforeAfter: [],
          },
        ],
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [COMMUNICATION_TEMPLATE_UPDATE_IDENTITY],
    },
    build({ plan, document }) {
      const step = document.steps[0];
      const parsed = updateArgumentsSchema.parse(step?.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: templateReviewTitle("Update", parsed.expected.name),
        actionLabel: parsed.expected.isSystem
          ? "Create edited copy"
          : "Save template",
        consequences: [
          parsed.expected.isSystem
            ? "This creates one plant-owned edited copy; the system template remains unchanged."
            : "This replaces the selected plant template content.",
        ],
        steps: [
          {
            stepId: step?.id ?? "update-template",
            title: "Update communication template",
            effectKind: "other",
            reversibility: "reversible",
            resolvedTargets: [
              {
                label: "Template",
                value: parsed.expected.name,
                sourceLink: templateSourceLink(
                  parsed.expected.id,
                  parsed.expected.name
                ),
              },
            ],
            counts: [{ label: "Templates to update", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [],
            beforeAfter: [
              {
                label: "Name",
                before: parsed.expected.name,
                after: parsed.content.name,
                count: 1,
              },
              {
                label: "Subject",
                before: reviewText(parsed.expected.subject, "(No subject)"),
                after: reviewText(parsed.content.subject, "(No subject)"),
                count: 1,
              },
              {
                label: "Body",
                before: reviewText(
                  effectiveSnapshotContent(parsed.expected).body,
                  "(Empty template)"
                ),
                after: reviewText(parsed.content.body, "(Empty template)"),
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
      capabilityIdentities: [COMMUNICATION_TEMPLATE_DELETE_IDENTITY],
    },
    build({ plan, document }) {
      const step = document.steps[0];
      const parsed = deleteArgumentsSchema.parse(step?.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: templateReviewTitle("Delete", parsed.expected.name),
        actionLabel: "Delete template",
        consequences: ["This permanently removes the selected plant template."],
        steps: [
          {
            stepId: step?.id ?? "delete-template",
            title: "Delete communication template",
            effectKind: "destructive",
            reversibility: "irreversible",
            resolvedTargets: [
              {
                label: "Template",
                value: parsed.expected.name,
                sourceLink: templateSourceLink(
                  parsed.expected.id,
                  parsed.expected.name
                ),
              },
            ],
            counts: [{ label: "Templates to delete", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [
              {
                label: "Subject",
                content: reviewText(parsed.expected.subject, "(No subject)"),
              },
              {
                label: "Body",
                content: reviewText(
                  effectiveSnapshotContent(parsed.expected).body,
                  "(Empty template)"
                ),
              },
            ],
            beforeAfter: [
              {
                label: "Template",
                before: parsed.expected.name,
                after: "Deleted",
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
      capabilityIdentities: [COMMUNICATION_TEMPLATE_FORK_IDENTITY],
    },
    build({ plan, document }) {
      const step = document.steps[0];
      const parsed = forkArgumentsSchema.parse(step?.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: templateReviewTitle("Copy", parsed.source.name),
        actionLabel: "Create copy",
        consequences: [
          "This adds one plant-owned copy; the system template remains unchanged.",
        ],
        steps: [
          {
            stepId: step?.id ?? "fork-template",
            title: "Copy system template",
            effectKind: "other",
            reversibility: "reversible",
            resolvedTargets: [
              {
                label: "System template",
                value: parsed.source.name,
                sourceLink: templateSourceLink(
                  parsed.source.id,
                  parsed.source.name
                ),
              },
            ],
            counts: [{ label: "Plant copies to create", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [
              {
                label: "Subject",
                content: reviewText(parsed.source.subject, "(No subject)"),
              },
              {
                label: "Body",
                content: reviewText(
                  effectiveSnapshotContent(parsed.source).body,
                  "(Empty template)"
                ),
              },
            ],
            beforeAfter: [],
          },
        ],
      });
    },
  }),
] as const;

export const COMMUNICATION_TEMPLATE_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(COMMUNICATION_TEMPLATE_REVIEWS);

function exactContent(input: {
  name: string;
  description: string | null;
  category: (typeof templateCategories)[number];
  channel: (typeof communicationChannels)[number];
  subject: string | null;
  body: string;
}) {
  return contentSchema.parse({
    name: input.name,
    description: input.description,
    category: input.category,
    channel: input.channel,
    subject: input.subject,
    ...storedTemplateContent(input.body),
  });
}

async function storeTemplatePlan(input: {
  actor: EvryPlantActor;
  identity: string;
  requestKey: EvryPlanRequestKey;
  stepId: string;
  arguments: Record<string, unknown>;
}) {
  const authorization = await authorizeEvryEffectCapability(input.identity);
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  ) {
    return communicationEvryUnavailable("Communication change");
  }
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: input.stepId,
          capabilityIdentity: input.identity,
          arguments: input.arguments,
          dependsOn: [],
        },
      ],
    },
    registry: COMMUNICATION_TEMPLATE_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(authorization.actor),
  });
  assertEvryPlanDocumentReviewable({
    document,
    reviewRegistry: COMMUNICATION_TEMPLATE_REVIEW_REGISTRY,
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
    reviewRegistry: COMMUNICATION_TEMPLATE_REVIEW_REGISTRY,
  });
  if (!review) {
    throw new Error("Stored Communication plan has no complete trusted review");
  }
  return { kind: "plan" as const, plan, confirmation: review.confirmation };
}

export async function proposeCommunicationEvryTemplateEffect(input: {
  actor: EvryPlantActor;
  selection: CommunicationEvryTemplateSelection;
  requestKey: EvryPlanRequestKey;
}) {
  if (input.selection.kind === "create_template") {
    return storeTemplatePlan({
      actor: input.actor,
      identity: COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
      requestKey: input.requestKey,
      stepId: "create-template",
      arguments: createArgumentsSchema.parse({
        templateId: communicationEvryEffectUuid(
          input.requestKey,
          "created-template"
        ),
        content: exactContent({
          name: input.selection.name,
          description: input.selection.description,
          category: input.selection.category,
          channel: input.selection.channel,
          subject: input.selection.subject || null,
          body: input.selection.body,
        }),
      }),
    });
  }

  const identity =
    input.selection.kind === "update_template"
      ? COMMUNICATION_TEMPLATE_UPDATE_IDENTITY
      : input.selection.kind === "delete_template"
        ? COMMUNICATION_TEMPLATE_DELETE_IDENTITY
        : COMMUNICATION_TEMPLATE_FORK_IDENTITY;
  const authorization = await authorizeEvryEffectCapability(identity);
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  ) {
    return communicationEvryUnavailable("Communication change");
  }
  const snapshot = await getEvryCommunicationTemplateSnapshot({
    churchId: authorization.actor.plantId,
    templateId: input.selection.templateId,
  });
  if (!snapshot) return communicationEvryUnavailable("Communication template");

  if (input.selection.kind === "delete_template") {
    if (snapshot.isSystem) {
      return communicationEvryUnavailable("Template deletion");
    }
    return storeTemplatePlan({
      actor: input.actor,
      identity,
      requestKey: input.requestKey,
      stepId: "delete-template",
      arguments: deleteArgumentsSchema.parse({ expected: snapshot }),
    });
  }
  if (input.selection.kind === "fork_template") {
    if (!snapshot.isSystem) {
      return communicationEvryUnavailable("Template fork");
    }
    return storeTemplatePlan({
      actor: input.actor,
      identity,
      requestKey: input.requestKey,
      stepId: "fork-template",
      arguments: forkArgumentsSchema.parse({
        source: snapshot,
        forkId: communicationEvryEffectUuid(
          input.requestKey,
          "forked-template"
        ),
      }),
    });
  }

  return storeTemplatePlan({
    actor: input.actor,
    identity,
    requestKey: input.requestKey,
    stepId: "update-template",
    arguments: updateArgumentsSchema.parse({
      targetKind: snapshot.isSystem ? "system" : "owned",
      resultTemplateId: snapshot.isSystem
        ? communicationEvryEffectUuid(input.requestKey, "edited-template")
        : snapshot.id,
      expected: snapshot,
      content: exactContent({
        name: input.selection.name,
        description:
          input.selection.description === undefined
            ? snapshot.description
            : input.selection.description,
        category:
          input.selection.category ??
          (snapshot.category as (typeof templateCategories)[number]),
        channel:
          input.selection.channel ??
          (snapshot.channel as (typeof communicationChannels)[number]),
        subject: input.selection.subject || null,
        body: input.selection.body,
      }),
    }),
  });
}

export async function communicationEvryTemplateTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}): Promise<boolean> {
  if (
    input.step.capabilityIdentity === COMMUNICATION_TEMPLATE_CREATE_IDENTITY
  ) {
    const parsed = createArgumentsSchema.safeParse(input.step.arguments);
    if (!parsed.success) return false;
    return (
      (await getEvryCommunicationTemplateSnapshot({
        churchId: input.actor.plantId,
        templateId: parsed.data.templateId,
      })) === null
    );
  }
  if (
    input.step.capabilityIdentity === COMMUNICATION_TEMPLATE_UPDATE_IDENTITY
  ) {
    const parsed = updateArgumentsSchema.safeParse(input.step.arguments);
    if (!parsed.success) return false;
    const current = await getEvryCommunicationTemplateSnapshot({
      churchId: input.actor.plantId,
      templateId: parsed.data.expected.id,
    });
    if (!sameSnapshot(current, parsed.data.expected)) return false;
    if (parsed.data.targetKind === "owned") {
      return parsed.data.resultTemplateId === parsed.data.expected.id;
    }
    const [fork, result] = await Promise.all([
      getEvryCommunicationTemplateFork({
        churchId: input.actor.plantId,
        sourceTemplateId: parsed.data.expected.id,
      }),
      getEvryCommunicationTemplateSnapshot({
        churchId: input.actor.plantId,
        templateId: parsed.data.resultTemplateId,
      }),
    ]);
    return fork === null && result === null;
  }
  if (
    input.step.capabilityIdentity === COMMUNICATION_TEMPLATE_DELETE_IDENTITY
  ) {
    const parsed = deleteArgumentsSchema.safeParse(input.step.arguments);
    if (!parsed.success || parsed.data.expected.isSystem) return false;
    return sameSnapshot(
      await getEvryCommunicationTemplateSnapshot({
        churchId: input.actor.plantId,
        templateId: parsed.data.expected.id,
      }),
      parsed.data.expected
    );
  }
  if (input.step.capabilityIdentity === COMMUNICATION_TEMPLATE_FORK_IDENTITY) {
    const parsed = forkArgumentsSchema.safeParse(input.step.arguments);
    if (!parsed.success || !parsed.data.source.isSystem) return false;
    const [source, fork, result] = await Promise.all([
      getEvryCommunicationTemplateSnapshot({
        churchId: input.actor.plantId,
        templateId: parsed.data.source.id,
      }),
      getEvryCommunicationTemplateFork({
        churchId: input.actor.plantId,
        sourceTemplateId: parsed.data.source.id,
      }),
      getEvryCommunicationTemplateSnapshot({
        churchId: input.actor.plantId,
        templateId: parsed.data.forkId,
      }),
    ]);
    return (
      sameSnapshot(source, parsed.data.source) &&
      fork === null &&
      result === null
    );
  }
  return false;
}

function sameSnapshot(
  current: Awaited<ReturnType<typeof getEvryCommunicationTemplateSnapshot>>,
  expected: z.infer<typeof snapshotSchema>
) {
  const parsed = snapshotSchema.safeParse(current);
  return (
    parsed.success && JSON.stringify(parsed.data) === JSON.stringify(expected)
  );
}
