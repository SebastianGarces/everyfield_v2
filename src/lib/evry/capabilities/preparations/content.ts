import { z } from "zod";
import {
  communicationChannels,
  templateCategories,
  wikiProgressStatuses,
  wikiArticleFeedbackRatings,
  generatedDocumentFormats,
  planterCheckinLevels,
} from "@/db/schema";
import { MANUAL_SIGNAL_KEYS } from "@/lib/phase-engine/manual-signals";
import { CHECKIN_NOTE_MAX } from "@/lib/phase-engine/planter-checkin";
import { feedbackCreateSchema } from "@/lib/validations/feedback";
import { defineEvryModelPreparation } from "../model-preparation";
import { createCommunicationEvryConversationContinuation } from "../communication/conversation";
import {
  COMMUNICATION_MESSAGE_SEND_IDENTITY,
  COMMUNICATION_RESEND_NON_OPENERS_IDENTITY,
} from "../communication/messages";
import {
  COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
  COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
  COMMUNICATION_TEMPLATE_DELETE_IDENTITY,
  COMMUNICATION_TEMPLATE_FORK_IDENTITY,
} from "../communication/templates";
import { createDocumentsWikiEffectConversationContinuation } from "../documents-wiki/effect-conversation";
import { DOCUMENTS_WIKI_EFFECT_IDENTITIES } from "../documents-wiki/effects";
import { createPlantIntelligenceEvryConversationContinuation } from "../plant-intelligence/conversation";
import { PLANT_INTELLIGENCE_EFFECT_IDENTITIES } from "../plant-intelligence/catalog";
import { createPlatformEvryConversationContinuation } from "../platform/conversation";
import {
  MARK_ONE_NOTIFICATION_IDENTITY,
  MARK_ALL_NOTIFICATIONS_IDENTITY,
  SUBMIT_FEEDBACK_IDENTITY,
} from "../platform/effects";

const id = z.uuid();
const slug = z.string().min(1).max(500);
const body = z.string().min(1).max(100000);
const subject = z.string().max(500);
const templateContent = {
  name: z.string().trim().min(1).max(255),
  description: z.string().max(1000).nullable(),
  category: z.enum(templateCategories),
  channel: z.enum(communicationChannels),
  subject,
  body,
};
const checkin = z.enum(planterCheckinLevels);

/** Model arguments carry requested edits only; existing proposers mint every snapshot. */
export const CONTENT_MODEL_PREPARATIONS = [
  defineEvryModelPreparation({
    id: "communication.send",
    capabilityIdentities: [COMMUNICATION_MESSAGE_SEND_IDENTITY],
    inputSchema: z.strictObject({
      audience: z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("people"),
          recipientIds: z.array(id).min(1).max(50),
        }),
        z.strictObject({
          kind: z.literal("group"),
          selector: z.string().min(1).max(200),
        }),
        z.strictObject({ kind: z.literal("page_person") }),
      ]),
      draft: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("inline"), subject, body }),
        z.strictObject({ kind: z.literal("template"), templateId: id }),
      ]),
      meetingId: id.nullable(),
    }),
    run: (context, args) =>
      createCommunicationEvryConversationContinuation(undefined, {
        kind: "send",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "communication.resend_non_openers",
    capabilityIdentities: [COMMUNICATION_RESEND_NON_OPENERS_IDENTITY],
    inputSchema: z.strictObject({ communicationId: id }),
    run: (context, args) =>
      createCommunicationEvryConversationContinuation(undefined, {
        kind: "resend",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "communication.template_create",
    capabilityIdentities: [COMMUNICATION_TEMPLATE_CREATE_IDENTITY],
    inputSchema: z.strictObject(templateContent),
    run: (context, args) =>
      createCommunicationEvryConversationContinuation(undefined, {
        kind: "create_template",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "communication.template_update",
    capabilityIdentities: [COMMUNICATION_TEMPLATE_UPDATE_IDENTITY],
    inputSchema: z.strictObject({ templateId: id, ...templateContent }),
    run: (context, args) =>
      createCommunicationEvryConversationContinuation(undefined, {
        kind: "update_template",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "communication.template_delete",
    capabilityIdentities: [COMMUNICATION_TEMPLATE_DELETE_IDENTITY],
    inputSchema: z.strictObject({ templateId: id }),
    run: (context, args) =>
      createCommunicationEvryConversationContinuation(undefined, {
        kind: "delete_template",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "communication.template_fork",
    capabilityIdentities: [COMMUNICATION_TEMPLATE_FORK_IDENTITY],
    inputSchema: z.strictObject({ templateId: id }),
    run: (context, args) =>
      createCommunicationEvryConversationContinuation(undefined, {
        kind: "fork_template",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "documents.generate",
    capabilityIdentities: [DOCUMENTS_WIKI_EFFECT_IDENTITIES.generate],
    inputSchema: z.strictObject({
      templateId: z.string().min(1).max(64),
      format: z.enum(generatedDocumentFormats),
      provided: z
        .record(
          z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
          z.string().max(4000)
        )
        .refine((v) => Object.keys(v).length <= 50),
    }),
    run: (context, args) =>
      createDocumentsWikiEffectConversationContinuation(undefined, {
        kind: "generate",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "wiki.bookmark",
    capabilityIdentities: [DOCUMENTS_WIKI_EFFECT_IDENTITIES.bookmark],
    inputSchema: z.strictObject({ slug, bookmarked: z.boolean() }),
    run: (context, args) =>
      createDocumentsWikiEffectConversationContinuation(undefined, {
        kind: "bookmark",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "wiki.progress",
    capabilityIdentities: [DOCUMENTS_WIKI_EFFECT_IDENTITIES.progress],
    inputSchema: z.strictObject({
      slug,
      status: z.enum(wikiProgressStatuses),
      scrollPosition: z.number().min(0).max(1).nullable(),
    }),
    run: (context, args) =>
      createDocumentsWikiEffectConversationContinuation(undefined, {
        kind: "progress",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "wiki.feedback",
    capabilityIdentities: [DOCUMENTS_WIKI_EFFECT_IDENTITIES.feedback],
    inputSchema: z.strictObject({
      slug,
      rating: z.enum(wikiArticleFeedbackRatings),
    }),
    run: (context, args) =>
      createDocumentsWikiEffectConversationContinuation(undefined, {
        kind: "feedback",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "intelligence.acknowledge",
    capabilityIdentities: [
      PLANT_INTELLIGENCE_EFFECT_IDENTITIES.acknowledgeAssessment,
    ],
    inputSchema: z.strictObject({ assessmentId: id.nullable() }),
    run: (context, args) =>
      createPlantIntelligenceEvryConversationContinuation(undefined, {
        kind: "acknowledge",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "intelligence.attest",
    capabilityIdentities: [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.setAttestation],
    inputSchema: z.strictObject({
      signalKey: z.enum(MANUAL_SIGNAL_KEYS),
      value: z.union([z.boolean(), z.number(), z.string().max(1000)]),
    }),
    run: (context, args) =>
      createPlantIntelligenceEvryConversationContinuation(undefined, {
        kind: "attestation",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "intelligence.checkin",
    capabilityIdentities: [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.saveCheckin],
    inputSchema: z.strictObject({
      spiritually: checkin,
      marriageFamily: checkin,
      financially: checkin,
      pace: checkin,
      note: z.string().max(CHECKIN_NOTE_MAX).nullable(),
    }),
    run: (context, args) =>
      createPlantIntelligenceEvryConversationContinuation(undefined, {
        kind: "checkin",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "intelligence.declare_phase",
    capabilityIdentities: [
      PLANT_INTELLIGENCE_EFFECT_IDENTITIES.transitionPhase,
    ],
    inputSchema: z.strictObject({
      toPhase: z.number().int().min(0).max(6),
      reason: z.string().min(1).max(2000),
    }),
    run: (context, args) =>
      createPlantIntelligenceEvryConversationContinuation(undefined, {
        kind: "transition",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "intelligence.feedback",
    capabilityIdentities: [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.submitFeedback],
    inputSchema: z.strictObject({
      insightId: id,
      rating: z.enum(["useful", "not_useful"]),
      comment: z.string().max(2000).nullable(),
    }),
    run: (context, args) =>
      createPlantIntelligenceEvryConversationContinuation(undefined, {
        kind: "feedback",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "notifications.mark_read",
    capabilityIdentities: [MARK_ONE_NOTIFICATION_IDENTITY],
    inputSchema: z.strictObject({ notificationId: id }),
    run: (context, args) =>
      createPlatformEvryConversationContinuation(undefined, {
        kind: "mark_one",
        ...args,
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "notifications.mark_all_read",
    capabilityIdentities: [MARK_ALL_NOTIFICATIONS_IDENTITY],
    inputSchema: z.strictObject({}),
    run: (context) =>
      createPlatformEvryConversationContinuation(undefined, {
        kind: "mark_all",
      }).continue(context),
  }),
  defineEvryModelPreparation({
    id: "feedback.submit",
    capabilityIdentities: [SUBMIT_FEEDBACK_IDENTITY],
    inputSchema: z.strictObject({
      category: feedbackCreateSchema.shape.category,
      description: feedbackCreateSchema.shape.description,
      pageUrl: z.string().max(500).nullable(),
    }),
    run: (context, args) =>
      createPlatformEvryConversationContinuation(undefined, {
        kind: "feedback",
        ...args,
      }).continue(context),
  }),
] as const;
