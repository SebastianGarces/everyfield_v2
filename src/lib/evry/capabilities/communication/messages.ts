import { z } from "zod";

import {
  EVRY_COMMUNICATION_MAX_RECIPIENTS,
  frozenEvryCommunicationState,
  reconcileFrozenEvryCommunication,
  type EvryCommunicationAudienceSnapshot,
  type EvryCommunicationMailer,
  resolveEvryCommunicationAudience,
  sendFrozenEvryCommunication,
} from "@/lib/communication/evry-send";
import { communicationEvryEffectUuid } from "@/lib/communication/evry-effect";
import {
  getGroupRecipients,
  isRecipientGroupSelector,
} from "@/lib/communication/recipient-groups";
import {
  evaluateResendEligibility,
  resendBlockedHint,
} from "@/lib/communication/resend-policy";
import { getCommunication } from "@/lib/communication/service";
import { getNonOpenerSummary } from "@/lib/communication/send";
import { getTemplate } from "@/lib/communication/templates";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  assertEvryPlanDocumentReviewable,
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
  communicationEvryRefusal,
  communicationEvryUnavailable,
  type CommunicationEvryRefusal,
} from "./refusal";

export const COMMUNICATION_MESSAGE_SEND_IDENTITY =
  "communication.messages.send";
export const COMMUNICATION_RESEND_NON_OPENERS_IDENTITY =
  "communication.resends.send-to-non-openers";

const recipientSchema = z.strictObject({
  personId: z.string().uuid(),
  label: z.string().trim().min(1).max(511),
  email: z.string().trim().min(1).max(255),
  subject: z.string().max(500),
  bodyHtml: z.string().min(1).max(200_000),
  bodyText: z.string().min(1).max(100_000),
});

const audienceSchema = z.strictObject({
  subject: z.string().max(500),
  body: z.string().min(1).max(100_000),
  bodyHtml: z.string().min(1).max(200_000),
  channel: z.literal("email"),
  templateId: z.string().uuid().nullable(),
  meetingId: z.string().uuid().nullable(),
  messageClass: z.enum(["transactional_meeting", "relationship_message"]),
  recipients: z
    .array(recipientSchema)
    .min(1)
    .max(EVRY_COMMUNICATION_MAX_RECIPIENTS),
  exclusions: z
    .array(
      z.strictObject({
        reason: z.string().trim().min(1).max(500),
        count: z.number().int().positive(),
      })
    )
    .max(16),
});

const resolvedRecipientSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("page_person"),
    personId: z.string().uuid(),
  }),
  z.strictObject({
    kind: z.literal("people"),
    recipientIds: z
      .array(z.string().uuid())
      .min(1)
      .max(EVRY_COMMUNICATION_MAX_RECIPIENTS),
  }),
  z.strictObject({
    kind: z.literal("group"),
    selector: z
      .string()
      .trim()
      .min(1)
      .refine(isRecipientGroupSelector, "Unknown recipient group selector"),
  }),
]);

const sourceMessageSchema = z.strictObject({
  id: z.string().uuid(),
  subject: z.string().max(500),
  body: z.string().min(1).max(100_000),
  bodyHtml: z.string().min(1).max(200_000).nullable(),
  channel: z.literal("email"),
  templateId: z.string().uuid().nullable(),
  meetingId: z.string().uuid().nullable(),
  status: z.literal("sent"),
  sentAt: z.string().datetime(),
  recipientCount: z.number().int().nonnegative().nullable(),
});

export const COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA = z.strictObject({
  communicationId: z.string().uuid(),
  recipientSource: resolvedRecipientSourceSchema,
  audience: audienceSchema,
});
const sendArgumentsSchema = COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA;

const resendArgumentsSchema = z.strictObject({
  source: sourceMessageSchema,
  nonOpenerPersonIds: z
    .array(z.string().uuid())
    .min(1)
    .max(EVRY_COMMUNICATION_MAX_RECIPIENTS),
  communicationId: z.string().uuid(),
  audience: audienceSchema,
});

export type CommunicationEvryAudienceSelection =
  | Readonly<{ kind: "page_person" }>
  | Readonly<{ kind: "people"; recipientIds: readonly string[] }>
  | Readonly<{ kind: "group"; selector: string }>;

export type CommunicationEvryDraftSelection =
  | Readonly<{ kind: "inline"; subject: string; body: string }>
  | Readonly<{ kind: "template"; templateId: string }>;

export type CommunicationEvryMessageSelection =
  | Readonly<{
      kind: "send";
      audience: CommunicationEvryAudienceSelection;
      draft: CommunicationEvryDraftSelection;
      meetingId: string | null;
    }>
  | Readonly<{ kind: "resend"; communicationId: string }>;

type CommunicationEvrySendSelection = Extract<
  CommunicationEvryMessageSelection,
  { kind: "send" }
>;

type CommunicationEvrySendAudienceDependencies = Readonly<{
  getGroupRecipients: typeof getGroupRecipients;
  getTemplate: typeof getTemplate;
  resolveAudience: typeof resolveEvryCommunicationAudience;
}>;

type CommunicationEvrySendAudienceResolution =
  | Readonly<{
      kind: "resolved";
      recipientSource: z.infer<typeof resolvedRecipientSourceSchema>;
      audience: EvryCommunicationAudienceSnapshot;
    }>
  | CommunicationEvryRefusal;

const productionSendAudienceDependencies: CommunicationEvrySendAudienceDependencies =
  {
    getGroupRecipients,
    getTemplate,
    resolveAudience: resolveEvryCommunicationAudience,
  };

const UUID_VALUE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = `(${UUID_VALUE})`;

function audienceSelection(
  value: string
): CommunicationEvryAudienceSelection | null {
  const target = value.trim();
  if (/^this person$/i.test(target)) return { kind: "page_person" };
  const people = /^people\s+([\s\S]+)$/i.exec(target);
  if (people?.[1]) {
    const recipientIds = people[1].split(",").map((id) => id.trim());
    return recipientIds.length > 0 &&
      recipientIds.length <= EVRY_COMMUNICATION_MAX_RECIPIENTS &&
      recipientIds.every((id) => z.string().uuid().safeParse(id).success)
      ? { kind: "people", recipientIds }
      : null;
  }
  const group = /^group\s+([\s\S]+)$/i.exec(target);
  const selector = group?.[1]?.trim();
  return selector && isRecipientGroupSelector(selector)
    ? { kind: "group", selector }
    : null;
}

function targetAndMeeting(value: string): Readonly<{
  audience: CommunicationEvryAudienceSelection;
  meetingId: string | null;
}> | null {
  const meeting = new RegExp(
    `^(.*)\\s+for meeting\\s+(${UUID_VALUE})$`,
    "i"
  ).exec(value.trim());
  const audience = audienceSelection(meeting?.[1] ?? value);
  return audience ? { audience, meetingId: meeting?.[2] ?? null } : null;
}

/** Closed message grammar. Arbitrary URLs, addresses and provider inputs do not match. */
export function selectCommunicationEvryMessageEffect(
  literalUserText: string
): CommunicationEvryMessageSelection | null {
  const text = literalUserText.normalize("NFKC").trim();
  const inline = /^(?:send|draft) email to\s+([\s\S]+)$/i.exec(text);
  if (inline?.[1]) {
    const delimiter = inline[1].indexOf(": ");
    const content = delimiter >= 0 ? inline[1].slice(delimiter + 2) : "";
    const separator = content.indexOf("|");
    const target =
      delimiter >= 0 ? targetAndMeeting(inline[1].slice(0, delimiter)) : null;
    const subject = separator >= 0 ? content.slice(0, separator).trim() : "";
    const body = separator >= 0 ? content.slice(separator + 1).trim() : "";
    if (target && subject && body) {
      return {
        kind: "send",
        ...target,
        draft: { kind: "inline", subject, body },
      };
    }
  }
  const template = new RegExp(
    `^(?:send|draft) template\\s+(${UUID_VALUE})\\s+to\\s+([\\s\\S]+?)[.!?]*$`,
    "i"
  ).exec(text);
  if (template?.[1] && template[2]) {
    const target = targetAndMeeting(template[2]);
    if (target) {
      return {
        kind: "send",
        ...target,
        draft: { kind: "template", templateId: template[1] },
      };
    }
  }
  const resend = new RegExp(
    `^resend message\\s+${UUID}\\s+to non-openers[.!?]*$`,
    "i"
  ).exec(text);
  return resend?.[1] ? { kind: "resend", communicationId: resend[1] } : null;
}

/** Resolve one closed draft and audience through the owning product rules. */
export function createCommunicationEvrySendAudienceResolver(
  dependencies: CommunicationEvrySendAudienceDependencies = productionSendAudienceDependencies
) {
  return async function resolveCommunicationEvrySendAudience(input: {
    actor: EvryPlantActor;
    pageContext: EvryResolvedPageContext | null;
    selection: CommunicationEvrySendSelection;
  }): Promise<CommunicationEvrySendAudienceResolution> {
    const recipientSource =
      input.selection.audience.kind === "people"
        ? {
            kind: "people" as const,
            recipientIds: [...input.selection.audience.recipientIds],
          }
        : input.selection.audience.kind === "group"
          ? {
              kind: "group" as const,
              selector: input.selection.audience.selector,
            }
          : input.pageContext?.kind === "person"
            ? {
                kind: "page_person" as const,
                personId: input.pageContext.recordId,
              }
            : null;
    const recipientIds = recipientSource
      ? recipientSource.kind === "people"
        ? recipientSource.recipientIds
        : recipientSource.kind === "group"
          ? (
              await dependencies.getGroupRecipients(
                input.actor.plantId,
                recipientSource.selector
              )
            ).map(({ id }) => id)
          : [recipientSource.personId]
      : [];
    const template =
      input.selection.draft.kind === "template"
        ? await dependencies.getTemplate(
            input.selection.draft.templateId,
            input.actor.plantId
          )
        : null;
    if (
      input.selection.draft.kind === "template" &&
      (!template || template.channel === "sms" || !template.subject?.trim())
    ) {
      return communicationEvryUnavailable("Communication template");
    }
    if (recipientIds.length === 0) {
      return communicationEvryRefusal({
        title: "No eligible email recipients",
        body: "Evry did not prepare a send because the selected audience has no eligible recipients.",
      });
    }
    if (recipientIds.length > EVRY_COMMUNICATION_MAX_RECIPIENTS) {
      return communicationEvryRefusal({
        title: "Audience is too large for one Evry send",
        body: `Choose at most ${EVRY_COMMUNICATION_MAX_RECIPIENTS} recipients for one reviewable send. Larger audiences can be sent as separate confirmed batches.`,
      });
    }
    const audience = await dependencies.resolveAudience({
      churchId: input.actor.plantId,
      recipientIds,
      subject:
        input.selection.draft.kind === "inline"
          ? input.selection.draft.subject
          : (template?.subject ?? ""),
      body:
        input.selection.draft.kind === "inline"
          ? input.selection.draft.body
          : (template?.bodyHtml ?? template?.body ?? ""),
      channel: "email",
      templateId: template?.id ?? null,
      meetingId: input.selection.meetingId,
    });
    if (!audience) {
      return communicationEvryUnavailable(
        input.selection.meetingId ? "Meeting" : "Recipient selection"
      );
    }
    if (audience.recipients.length === 0) {
      return communicationEvryRefusal({
        title: "No eligible email recipients",
        body: "Evry did not prepare a send because every selected recipient was excluded.",
        exclusions: audience.exclusions,
      });
    }
    return {
      kind: "resolved",
      recipientSource: resolvedRecipientSourceSchema.parse(recipientSource),
      audience,
    };
  };
}

const resolveCommunicationEvrySendAudience =
  createCommunicationEvrySendAudienceResolver();

export const COMMUNICATION_MESSAGE_SEND_PLAN = defineEvryPlanCapability({
  identity: COMMUNICATION_MESSAGE_SEND_IDENTITY,
  effectClass: "outbound_communication",
  arguments: sendArgumentsSchema.shape,
});

export const COMMUNICATION_RESEND_NON_OPENERS_PLAN = defineEvryPlanCapability({
  identity: COMMUNICATION_RESEND_NON_OPENERS_IDENTITY,
  effectClass: "outbound_communication",
  arguments: resendArgumentsSchema.shape,
});

function exactExecutionTuple(input: EvryEffectInput, identity: string) {
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === input.authorization.actor.userId &&
    input.execution.plantId === input.authorization.actor.plantId
  );
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  const sortedRight = [...right].toSorted();
  return (
    left.length === right.length &&
    [...left].toSorted().every((value, index) => value === sortedRight[index])
  );
}

function sameAudience(
  left: EvryCommunicationAudienceSnapshot | null,
  right: EvryCommunicationAudienceSnapshot
) {
  return Boolean(left && JSON.stringify(left) === JSON.stringify(right));
}

async function recipientIdsForSource(
  plantId: string,
  source: z.infer<typeof resolvedRecipientSourceSchema>
) {
  if (source.kind === "people") return source.recipientIds;
  if (source.kind === "page_person") return [source.personId];
  return (await getGroupRecipients(plantId, source.selector)).map(
    ({ id }) => id
  );
}

async function sendAudienceIsCurrent(input: {
  actor: EvryPlantActor;
  recipientSource: z.infer<typeof resolvedRecipientSourceSchema>;
  audience: EvryCommunicationAudienceSnapshot;
}) {
  const recipientIds = await recipientIdsForSource(
    input.actor.plantId,
    input.recipientSource
  );
  return sameAudience(
    await resolveEvryCommunicationAudience({
      churchId: input.actor.plantId,
      recipientIds,
      subject: input.audience.subject,
      body: input.audience.bodyHtml,
      channel: input.audience.channel,
      templateId: input.audience.templateId,
      meetingId: input.audience.meetingId,
    }),
    input.audience
  );
}

async function resendAudienceIsCurrent(input: {
  actor: EvryPlantActor;
  source: z.infer<typeof sourceMessageSchema>;
  nonOpenerPersonIds: readonly string[];
  audience: EvryCommunicationAudienceSnapshot;
}) {
  const original = await exactSourceMessage(input.actor.plantId, input.source);
  if (!original) return false;
  const summary = await getNonOpenerSummary(input.actor.plantId, original.id);
  if (
    !evaluateResendEligibility({
      status: original.status,
      sentAt: original.sentAt,
      deliveredCount: summary.delivered,
      nonOpenerCount: summary.personIds.length,
    }).allowed ||
    !sameStrings(summary.personIds, input.nonOpenerPersonIds)
  ) {
    return false;
  }
  return sameAudience(
    await resolveEvryCommunicationAudience({
      churchId: input.actor.plantId,
      recipientIds: summary.personIds,
      subject: original.subject ?? "",
      body: original.bodyHtml ?? original.body,
      channel: original.channel,
      templateId: original.templateId,
      meetingId: original.meetingId,
    }),
    input.audience
  );
}

export function createCommunicationEvryMessageExecutions(
  dependencies: Readonly<{ mailer?: EvryCommunicationMailer }> = {}
) {
  const send = defineEvryExecutionCapability({
    planCapability: COMMUNICATION_MESSAGE_SEND_PLAN,
    async reconcileClaimed(input) {
      const parsed = sendArgumentsSchema.safeParse(input.arguments);
      return parsed.success &&
        input.execution.capabilityIdentity ===
          COMMUNICATION_MESSAGE_SEND_IDENTITY
        ? reconcileFrozenEvryCommunication({
            effect: input,
            communicationId: parsed.data.communicationId,
            audience: parsed.data.audience,
          })
        : null;
    },
    async executeIfCurrent(input) {
      const parsed = sendArgumentsSchema.safeParse(input.arguments);
      if (
        !parsed.success ||
        !exactExecutionTuple(input, COMMUNICATION_MESSAGE_SEND_IDENTITY)
      ) {
        return { status: "refused", excludedCount: 1 };
      }
      try {
        const frozenState = await frozenEvryCommunicationState({
          effect: input,
          communicationId: parsed.data.communicationId,
          audience: parsed.data.audience,
        });
        if (
          frozenState !== "started" &&
          !(await sendAudienceIsCurrent({
            actor: input.authorization.actor,
            recipientSource: parsed.data.recipientSource,
            audience: parsed.data.audience,
          }))
        ) {
          return { status: "refused", excludedCount: 1 };
        }
        return await sendFrozenEvryCommunication({
          effect: input,
          identity: COMMUNICATION_MESSAGE_SEND_IDENTITY,
          communicationId: parsed.data.communicationId,
          audience: parsed.data.audience,
          mailer: dependencies.mailer,
        });
      } catch {
        return { status: "retryable" };
      }
    },
  });

  const resend = defineEvryExecutionCapability({
    planCapability: COMMUNICATION_RESEND_NON_OPENERS_PLAN,
    async reconcileClaimed(input) {
      const parsed = resendArgumentsSchema.safeParse(input.arguments);
      return parsed.success &&
        input.execution.capabilityIdentity ===
          COMMUNICATION_RESEND_NON_OPENERS_IDENTITY
        ? reconcileFrozenEvryCommunication({
            effect: input,
            communicationId: parsed.data.communicationId,
            audience: parsed.data.audience,
          })
        : null;
    },
    async executeIfCurrent(input) {
      const parsed = resendArgumentsSchema.safeParse(input.arguments);
      if (
        !parsed.success ||
        !exactExecutionTuple(input, COMMUNICATION_RESEND_NON_OPENERS_IDENTITY)
      ) {
        return { status: "refused", excludedCount: 1 };
      }
      try {
        const frozenState = await frozenEvryCommunicationState({
          effect: input,
          communicationId: parsed.data.communicationId,
          audience: parsed.data.audience,
        });
        const currentNonOpeners =
          frozenState === "started"
            ? new Set(
                (
                  await getNonOpenerSummary(
                    input.authorization.actor.plantId,
                    parsed.data.source.id
                  )
                ).personIds
              )
            : null;
        if (
          !currentNonOpeners &&
          !(await resendAudienceIsCurrent({
            actor: input.authorization.actor,
            source: parsed.data.source,
            nonOpenerPersonIds: parsed.data.nonOpenerPersonIds,
            audience: parsed.data.audience,
          }))
        ) {
          return { status: "refused", excludedCount: 1 };
        }
        return await sendFrozenEvryCommunication({
          effect: input,
          identity: COMMUNICATION_RESEND_NON_OPENERS_IDENTITY,
          communicationId: parsed.data.communicationId,
          audience: parsed.data.audience,
          eligiblePersonIds:
            currentNonOpeners ?? new Set(parsed.data.nonOpenerPersonIds),
          mailer: dependencies.mailer,
        });
      } catch {
        return { status: "retryable" };
      }
    },
  });

  return Object.freeze({
    send,
    resend,
    registrations: Object.freeze([send, resend] as const),
  });
}

const productionMessageExecutions = createCommunicationEvryMessageExecutions();

export const COMMUNICATION_MESSAGE_SEND_EXECUTION =
  productionMessageExecutions.send;
export const COMMUNICATION_RESEND_NON_OPENERS_EXECUTION =
  productionMessageExecutions.resend;

export const COMMUNICATION_MESSAGE_EXECUTIONS =
  productionMessageExecutions.registrations;

export const COMMUNICATION_MESSAGE_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(COMMUNICATION_MESSAGE_EXECUTIONS);
export const COMMUNICATION_MESSAGE_PLAN_REGISTRY =
  COMMUNICATION_MESSAGE_EXECUTION_REGISTRY.planRegistry;

function preview(value: string, fallback: string, maximum = 4_000) {
  return (value.trim() || fallback).slice(0, maximum);
}

function reviewStep(
  step: EvryActionStep,
  audience: EvryCommunicationAudienceSnapshot,
  input: { resend: boolean; sourceId?: string }
) {
  return {
    stepId: step.id,
    title: input.resend ? "Resend the approved message" : "Send the message",
    effectKind: "communication" as const,
    reversibility: "irreversible" as const,
    resolvedTargets: audience.recipients.map((recipient) => ({
      label: "Recipient",
      value: `${recipient.label} · ${recipient.email}`,
      sourceLink: {
        label: preview(`Open ${recipient.label}`, "Open person", 160),
        href: `/people/${recipient.personId}`,
      },
    })),
    counts: [
      {
        label: input.resend ? "Emails to resend" : "Emails to send",
        count: audience.recipients.length,
      },
    ],
    exclusions: audience.exclusions,
    dateTime: null,
    contentPreviews: [
      {
        label: "Subject",
        content: preview(audience.subject, "(No subject)"),
        format: "plain_text" as const,
      },
      {
        label: "Message",
        content: audience.body,
        format: "plain_text" as const,
      },
    ],
    beforeAfter: [
      {
        label: input.resend ? "Resend delivery" : "Email delivery",
        before: "Not sent",
        after: "Will send immediately after confirmation",
        count: audience.recipients.length,
      },
    ],
  };
}

export const COMMUNICATION_MESSAGE_REVIEWS = [
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [COMMUNICATION_MESSAGE_SEND_IDENTITY],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const parsed = sendArgumentsSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Send email to ${parsed.audience.recipients.length}`,
        actionLabel: `Send to ${parsed.audience.recipients.length}`,
        consequences: [
          `This immediately sends ${parsed.audience.recipients.length} email${parsed.audience.recipients.length === 1 ? "" : "s"}; delivery cannot be undone.`,
        ],
        steps: [reviewStep(step, parsed.audience, { resend: false })],
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [COMMUNICATION_RESEND_NON_OPENERS_IDENTITY],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const parsed = resendArgumentsSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Resend to ${parsed.audience.recipients.length} non-opener${parsed.audience.recipients.length === 1 ? "" : "s"}`,
        actionLabel: `Resend to ${parsed.audience.recipients.length}`,
        consequences: [
          "This creates a new message and immediately emails only the still-eligible people from the reviewed non-opener audience.",
        ],
        steps: [
          reviewStep(step, parsed.audience, {
            resend: true,
            sourceId: parsed.source.id,
          }),
        ],
      });
    },
  }),
] as const;

export const COMMUNICATION_MESSAGE_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(COMMUNICATION_MESSAGE_REVIEWS);

async function storePlan(input: {
  actor: EvryPlantActor;
  identity: string;
  requestKey: EvryPlanRequestKey;
  stepId: string;
  arguments: Record<string, unknown>;
}) {
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
    registry: COMMUNICATION_MESSAGE_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(input.actor),
  });
  assertEvryPlanDocumentReviewable({
    document,
    reviewRegistry: COMMUNICATION_MESSAGE_REVIEW_REGISTRY,
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
    reviewRegistry: COMMUNICATION_MESSAGE_REVIEW_REGISTRY,
  });
  if (!review) {
    throw new Error("Stored Communication plan has no complete trusted review");
  }
  return { kind: "plan" as const, plan, confirmation: review.confirmation };
}

function sourceSnapshot(
  message: NonNullable<Awaited<ReturnType<typeof getCommunication>>>
) {
  return sourceMessageSchema.safeParse({
    id: message.id,
    subject: message.subject ?? "",
    body: message.body,
    bodyHtml: message.bodyHtml,
    channel: message.channel,
    templateId: message.templateId,
    meetingId: message.meetingId,
    status: message.status,
    sentAt: message.sentAt?.toISOString(),
    recipientCount: message.recipientCount,
  });
}

async function exactSourceMessage(
  plantId: string,
  expected: z.infer<typeof sourceMessageSchema>
) {
  const current = await getCommunication(plantId, expected.id);
  if (!current) return null;
  const snapshot = sourceSnapshot(current);
  return snapshot.success &&
    JSON.stringify(snapshot.data) === JSON.stringify(expected)
    ? current
    : null;
}

async function authorizeExactActor(actor: EvryPlantActor, identity: string) {
  const authorization = await authorizeEvryEffectCapability(identity);
  return authorization &&
    authorization.actor.userId === actor.userId &&
    authorization.actor.plantId === actor.plantId
    ? authorization.actor
    : null;
}

/** Resolve and persist one exact outbound plan after a fresh send authorization. */
export async function proposeCommunicationEvryMessageEffect(input: {
  actor: EvryPlantActor;
  pageContext: EvryResolvedPageContext | null;
  selection: CommunicationEvryMessageSelection;
  requestKey: EvryPlanRequestKey;
  now: Date;
}) {
  const identity =
    input.selection.kind === "send"
      ? COMMUNICATION_MESSAGE_SEND_IDENTITY
      : COMMUNICATION_RESEND_NON_OPENERS_IDENTITY;
  const actor = await authorizeExactActor(input.actor, identity);
  if (!actor) return communicationEvryUnavailable("Communication change");

  if (input.selection.kind === "send") {
    const audience = await resolveCommunicationEvrySendAudience({
      actor,
      pageContext: input.pageContext,
      selection: input.selection,
    });
    if (audience.kind === "refusal") return audience;
    const parsedAudience = audienceSchema.safeParse(audience.audience);
    if (!parsedAudience.success) {
      throw new Error("Resolved Communication audience is invalid");
    }
    return storePlan({
      actor,
      identity,
      requestKey: input.requestKey,
      stepId: "send-message",
      arguments: sendArgumentsSchema.parse({
        communicationId: communicationEvryEffectUuid(
          input.requestKey,
          "communication"
        ),
        recipientSource: audience.recipientSource,
        audience: parsedAudience.data,
      }),
    });
  }

  const original = await getCommunication(
    actor.plantId,
    input.selection.communicationId
  );
  if (!original) return communicationEvryUnavailable("Original message");
  const source = sourceSnapshot(original);
  if (!source.success) return communicationEvryUnavailable("Original message");
  const summary = await getNonOpenerSummary(actor.plantId, original.id);
  const eligibility = evaluateResendEligibility({
    status: original.status,
    sentAt: original.sentAt,
    deliveredCount: summary.delivered,
    nonOpenerCount: summary.personIds.length,
    now: input.now,
  });
  if (!eligibility.allowed) {
    const reason = resendBlockedHint(eligibility.reason ?? "notSent");
    return communicationEvryRefusal({
      title: "This message is not eligible for resend",
      body: reason,
      exclusions: [
        {
          reason,
          count: Math.max(1, summary.total),
        },
      ],
    });
  }
  const audience = await resolveEvryCommunicationAudience({
    churchId: actor.plantId,
    recipientIds: summary.personIds,
    subject: original.subject ?? "",
    body: original.bodyHtml ?? original.body,
    channel: original.channel,
    templateId: original.templateId,
    meetingId: original.meetingId,
  });
  if (!audience) return communicationEvryUnavailable("Message recipients");
  if (audience.recipients.length === 0) {
    return communicationEvryRefusal({
      title: "No eligible email recipients",
      body: "Evry did not prepare a resend because every current non-opener was excluded.",
      exclusions: audience.exclusions,
    });
  }
  const parsedAudience = audienceSchema.safeParse(audience);
  if (!parsedAudience.success) {
    throw new Error("Resolved Communication resend audience is invalid");
  }
  return storePlan({
    actor,
    identity,
    requestKey: input.requestKey,
    stepId: "resend-non-openers",
    arguments: resendArgumentsSchema.parse({
      source: source.data,
      nonOpenerPersonIds: summary.personIds,
      communicationId: communicationEvryEffectUuid(
        input.requestKey,
        "resent-communication"
      ),
      audience: parsedAudience.data,
    }),
  });
}

function exactPlannedMessage(
  message: NonNullable<Awaited<ReturnType<typeof getCommunication>>>,
  actor: EvryPlantActor,
  audience: z.infer<typeof audienceSchema>
) {
  return (
    message.createdById === actor.userId &&
    message.subject === audience.subject &&
    message.body === audience.body &&
    message.bodyHtml === audience.bodyHtml &&
    message.channel === audience.channel &&
    message.templateId === audience.templateId &&
    message.meetingId === audience.meetingId &&
    message.recipientCount === audience.recipients.length
  );
}

async function plannedMessageIsAvailable(input: {
  actor: EvryPlantActor;
  communicationId: string;
  audience: z.infer<typeof audienceSchema>;
}) {
  const existing = await getCommunication(
    input.actor.plantId,
    input.communicationId
  );
  return (
    !existing || exactPlannedMessage(existing, input.actor, input.audience)
  );
}

/** Revalidation requires the exact reviewed source, audience, and message. */
export async function communicationEvryMessageTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}): Promise<boolean> {
  if (input.step.capabilityIdentity === COMMUNICATION_MESSAGE_SEND_IDENTITY) {
    const parsed = sendArgumentsSchema.safeParse(input.step.arguments);
    return Boolean(
      parsed.success &&
      (await sendAudienceIsCurrent({
        actor: input.actor,
        recipientSource: parsed.data.recipientSource,
        audience: parsed.data.audience,
      })) &&
      (await plannedMessageIsAvailable({
        actor: input.actor,
        communicationId: parsed.data.communicationId,
        audience: parsed.data.audience,
      }))
    );
  }
  if (
    input.step.capabilityIdentity !== COMMUNICATION_RESEND_NON_OPENERS_IDENTITY
  ) {
    return false;
  }
  const parsed = resendArgumentsSchema.safeParse(input.step.arguments);
  if (!parsed.success) return false;
  return (
    (await resendAudienceIsCurrent({
      actor: input.actor,
      source: parsed.data.source,
      nonOpenerPersonIds: parsed.data.nonOpenerPersonIds,
      audience: parsed.data.audience,
    })) &&
    (await plannedMessageIsAvailable({
      actor: input.actor,
      communicationId: parsed.data.communicationId,
      audience: parsed.data.audience,
    }))
  );
}
