import assert from "node:assert/strict";
import test from "node:test";

import communicationInventory from "./inventory.generated.json";
import { communicationEvryEffectUuid } from "@/lib/communication/evry-effect";
import { storedTemplateContent } from "@/lib/communication/templates";
import { evryDetailedConfirmationArtifactDocumentSchema } from "@/lib/evry/artifacts/review";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  evryCapabilityRegistrationFor,
  type EvryEffectCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryEffectInput } from "@/lib/evry/executor";
import { EVRY_CAPABILITY_EVAL_LAYERS } from "@/lib/evry/evals/contracts";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import {
  COMMUNICATION_MESSAGE_SEND_IDENTITY,
  COMMUNICATION_RESEND_NON_OPENERS_IDENTITY,
  selectCommunicationEvryMessageEffect,
} from "./messages";
import {
  COMMUNICATION_EVRY_READ_REGISTRATIONS,
  COMMUNICATION_READ_IDENTITIES,
  selectCommunicationEvryRead,
} from "./reads";
import {
  COMMUNICATION_EVRY_EXECUTION_REGISTRY,
  COMMUNICATION_EVRY_PLAN_REGISTRY,
  COMMUNICATION_EVRY_REVIEW_REGISTRY,
} from "./runtime";
import {
  COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
  COMMUNICATION_TEMPLATE_DELETE_IDENTITY,
  COMMUNICATION_TEMPLATE_FORK_IDENTITY,
  COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
  selectCommunicationEvryTemplateEffect,
} from "./templates";

const ID = "10000000-0000-4000-8000-000000000001";
const ID_2 = "10000000-0000-4000-8000-000000000002";
const ACTOR = {
  userId: "20000000-0000-4000-8000-000000000001",
  plantId: "30000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const PLAN = evryConversationPlanIdentitySchema.parse({
  planId: "40000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
});
const canonical = storedTemplateContent("<p>Hello <strong>Ada</strong></p>");
const templateContent = {
  name: "Follow up",
  description: null,
  category: "follow_up",
  channel: "email",
  subject: "Hello",
  ...canonical,
} as const;
const templateSnapshot = {
  id: ID,
  ...templateContent,
  isSystem: false,
  sourceTemplateId: null,
  updatedAt: "2026-08-29T06:00:00.000Z",
} as const;
const audience = {
  subject: "Hello",
  body: canonical.body,
  bodyHtml: canonical.bodyHtml,
  channel: "email",
  templateId: null,
  meetingId: null,
  messageClass: "relationship_message",
  recipients: [
    {
      personId: ID,
      label: "Ada Lovelace",
      email: "ada@example.test",
      subject: "Hello Ada",
      bodyHtml: canonical.bodyHtml,
      bodyText: canonical.body,
    },
  ],
  exclusions: [],
} as const;

const readSelections: Record<string, string> = {
  [COMMUNICATION_READ_IDENTITIES.compose]: "Show compose context",
  [COMMUNICATION_READ_IDENTITIES.totals]: "Show delivery totals",
  [COMMUNICATION_READ_IDENTITIES.meetingTracking]:
    "Show meeting delivery tracking",
  [COMMUNICATION_READ_IDENTITIES.message]: `Show message ${ID}`,
  [COMMUNICATION_READ_IDENTITIES.messageRecipients]: `Show recipients for message ${ID}`,
  [COMMUNICATION_READ_IDENTITIES.meetingHistory]:
    "Show communication for this meeting",
  [COMMUNICATION_READ_IDENTITIES.personHistory]:
    "Show communication for this person",
  [COMMUNICATION_READ_IDENTITIES.history]: "List communication history",
  [COMMUNICATION_READ_IDENTITIES.teams]: "List recipient teams",
  [COMMUNICATION_READ_IDENTITIES.group]: "Resolve recipient group leaders",
  [COMMUNICATION_READ_IDENTITIES.people]: "Search communication recipients Ada",
  [COMMUNICATION_READ_IDENTITIES.resendSummary]: `Show resend eligibility for message ${ID}`,
  [COMMUNICATION_READ_IDENTITIES.template]: `Show template ${ID}`,
  [COMMUNICATION_READ_IDENTITIES.templates]: "List communication templates",
};

const effectSelections: Record<string, string> = {
  [COMMUNICATION_MESSAGE_SEND_IDENTITY]:
    "Send email to this person: Hello | Welcome",
  [COMMUNICATION_RESEND_NON_OPENERS_IDENTITY]: `Resend message ${ID} to non-openers`,
  [COMMUNICATION_TEMPLATE_CREATE_IDENTITY]:
    "Create template Follow up | Hello | Welcome",
  [COMMUNICATION_TEMPLATE_DELETE_IDENTITY]: `Delete template ${ID}`,
  [COMMUNICATION_TEMPLATE_FORK_IDENTITY]: `Fork template ${ID}`,
  [COMMUNICATION_TEMPLATE_UPDATE_IDENTITY]: `Update template ${ID} | Follow up | Hello | Welcome`,
};

function effectArguments(identity: string): Record<string, unknown> {
  switch (identity) {
    case COMMUNICATION_MESSAGE_SEND_IDENTITY:
      return { communicationId: ID_2, audience };
    case COMMUNICATION_RESEND_NON_OPENERS_IDENTITY:
      return {
        source: {
          id: ID,
          subject: "Hello",
          body: canonical.body,
          bodyHtml: canonical.bodyHtml,
          channel: "email",
          templateId: null,
          meetingId: null,
          status: "sent",
          sentAt: "2026-08-27T06:00:00.000Z",
          recipientCount: 1,
        },
        communicationId: ID_2,
        audience,
      };
    case COMMUNICATION_TEMPLATE_CREATE_IDENTITY:
      return { templateId: ID_2, content: templateContent };
    case COMMUNICATION_TEMPLATE_UPDATE_IDENTITY:
      return {
        targetKind: "owned",
        resultTemplateId: ID,
        expected: templateSnapshot,
        content: { ...templateContent, ...storedTemplateContent("Updated") },
      };
    case COMMUNICATION_TEMPLATE_DELETE_IDENTITY:
      return { expected: templateSnapshot };
    case COMMUNICATION_TEMPLATE_FORK_IDENTITY:
      return {
        forkId: ID_2,
        source: { ...templateSnapshot, isSystem: true },
      };
    default:
      throw new Error(`Missing Communication effect fixture ${identity}`);
  }
}

function effectDocument(identity: string) {
  return parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: `fixture-${identity.split(".").at(-1)}`,
          capabilityIdentity: identity,
          arguments: effectArguments(identity),
          dependsOn: [],
        },
      ],
    },
    registry: COMMUNICATION_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
}

function selectionFor(identity: string) {
  const text = readSelections[identity] ?? effectSelections[identity];
  assert.ok(text, `missing selection text for ${identity}`);
  return readSelections[identity]
    ? selectCommunicationEvryRead(text)
    : identity.startsWith("communication.templates.")
      ? selectCommunicationEvryTemplateEffect(text)
      : selectCommunicationEvryMessageEffect(text);
}

function effectInput(identity: string, args: Record<string, unknown>) {
  const registration = evryCapabilityRegistrationFor(identity);
  assert.ok(registration && registration.operationKind === "effect");
  const authorization = {
    actor: ACTOR,
    registration,
  } as unknown as EvryEffectCapabilityAuthorization;
  return {
    authorization,
    effectKey: "fixture-effect-key",
    execution: {
      attemptId: "50000000-0000-4000-8000-000000000001",
      planId: PLAN.planId,
      actorUserId: ACTOR.userId,
      // Deliberate mismatch: every adapter must refuse before DB/provider work.
      plantId: "30000000-0000-4000-8000-000000000099",
      fingerprint: PLAN.fingerprint,
      correlationId: "60000000-0000-4000-8000-000000000001",
      stepId: "fixture-step",
      capabilityIdentity: identity,
    },
    arguments: args,
  } as unknown as EvryEffectInput;
}

async function exercise(identity: string, layer: string) {
  const inventory = communicationInventory.capabilities.find(
    (candidate) => candidate.identity === identity
  );
  assert.ok(inventory);
  const registration = evryCapabilityRegistrationFor(identity);
  assert.ok(registration);

  if (layer === "policy" || layer === "permission") {
    assert.equal(registration.parityCapability, "communication");
    assert.equal(
      registration.applicationCapability,
      inventory.operationKind === "effect" ? "communication.send" : "read"
    );
    return;
  }
  if (layer === "selection" || layer === "idempotency") {
    assert.ok(selectionFor(identity));
    assert.deepEqual(selectionFor(identity), selectionFor(identity));
    if (inventory.operationKind === "effect") {
      assert.equal(
        communicationEvryEffectUuid(identity, "fixture"),
        communicationEvryEffectUuid(identity, "fixture")
      );
    }
    return;
  }
  if (inventory.operationKind === "read") {
    const read = COMMUNICATION_EVRY_READ_REGISTRATIONS.find(
      (candidate) => candidate.capabilityIdentity === identity
    );
    assert.ok(read);
    // Invalid arguments fail before authorization or any application read.
    assert.equal(
      await read.execute(
        { literalUserText: "fixture", pageContext: null },
        { unexpected: true }
      ),
      null
    );
    assert.equal(
      COMMUNICATION_EVRY_EXECUTION_REGISTRY.registrationFor(identity),
      null
    );
    return;
  }

  const execution =
    COMMUNICATION_EVRY_EXECUTION_REGISTRY.registrationFor(identity);
  assert.ok(execution);
  const args = effectArguments(identity);
  const schema = execution.planCapability.argumentsSchema;
  if (layer === "arguments" || layer === "errors") {
    assert.equal(schema.safeParse(args).success, true);
    assert.equal(
      schema.safeParse({ ...args, url: "https://example.com" }).success,
      false
    );
    return;
  }
  if (layer === "tenancy" || layer === "execution") {
    assert.deepEqual(
      await execution.executeIfCurrent(effectInput(identity, args)),
      {
        status: "refused",
        excludedCount: 1,
      }
    );
    return;
  }
  const document = effectDocument(identity);
  const review = trustedReviewForEvryPlanDocument({
    plan: PLAN,
    document,
    reviewRegistry: COMMUNICATION_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  assert.equal(
    evryDetailedConfirmationArtifactDocumentSchema.safeParse(
      review.confirmation
    ).success,
    true
  );
}

for (const { identity } of communicationInventory.capabilities) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    test(`${identity}:${layer}`, () => exercise(identity, layer));
  }
}
