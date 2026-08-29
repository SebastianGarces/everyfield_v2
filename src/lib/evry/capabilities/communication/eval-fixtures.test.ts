import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import communicationInventory from "./inventory.generated.json";
import { storedTemplateContent } from "@/lib/communication/templates";
import { evryDetailedConfirmationArtifactDocumentSchema } from "@/lib/evry/artifacts/review";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  evryCapabilityRegistrationFor,
  eligibleEvryCapabilitiesFor,
  type EvryEffectCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryEffectInput } from "@/lib/evry/executor";
import {
  EVRY_CAPABILITY_EVAL_LAYERS,
  type EvryCapabilityEvalLayer,
} from "@/lib/evry/evals/contracts";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";

import {
  COMMUNICATION_MESSAGE_SEND_IDENTITY,
  COMMUNICATION_RESEND_NON_OPENERS_IDENTITY,
  selectCommunicationEvryMessageEffect,
} from "./messages";
import {
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
const MEMBER_ACTOR = {
  ...ACTOR,
  seat: "member",
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

const LIVE_EFFECT_LAYERS = new Set<EvryCapabilityEvalLayer>([
  "execution",
  "idempotency",
  "errors",
]);
type ReadOutcome = Readonly<{
  execution: boolean;
  idempotency: boolean;
  arguments: boolean;
  tenancy: boolean;
  permission: boolean;
  confirmation: boolean;
  errors: boolean;
  uiArtifact: boolean;
}>;

let cachedReadOutcomes: Readonly<Record<string, ReadOutcome>> | null = null;

function readOutcomes(): Readonly<Record<string, ReadOutcome>> {
  if (cachedReadOutcomes) return cachedReadOutcomes;
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/lib/evry/capabilities/communication/eval-read-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      timeout: 60_000,
    }
  );
  assert.equal(
    proof.status,
    0,
    `Communication read proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  const encoded = /^EVRY_COMMUNICATION_READ_OUTCOMES=(.+)$/m.exec(
    proof.stdout
  )?.[1];
  assert.ok(encoded, "Communication read proof returned no outcomes");
  cachedReadOutcomes = JSON.parse(encoded) as Readonly<
    Record<string, ReadOutcome>
  >;
  return cachedReadOutcomes;
}

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

function readOutcomeFor(
  outcome: ReadOutcome,
  layer: EvryCapabilityEvalLayer
): boolean {
  switch (layer) {
    case "arguments":
    case "tenancy":
    case "permission":
    case "confirmation":
    case "execution":
    case "idempotency":
    case "errors":
      return outcome[layer];
    case "ui_artifact":
      return outcome.uiArtifact;
    case "policy":
    case "selection":
      throw new Error(`${layer} is not a read continuation outcome`);
  }
}

async function exercise(identity: string, layer: EvryCapabilityEvalLayer) {
  const inventory = communicationInventory.capabilities.find(
    (candidate) => candidate.identity === identity
  );
  assert.ok(inventory);
  const registration = evryCapabilityRegistrationFor(identity);
  assert.ok(registration);

  if (layer === "policy") {
    assert.equal(registration.parityCapability, "communication");
    assert.equal(
      registration.applicationCapability,
      inventory.operationKind === "effect" ? "communication.send" : "read"
    );
    return;
  }
  if (layer === "selection") {
    assert.ok(selectionFor(identity));
    assert.deepEqual(selectionFor(identity), selectionFor(identity));
    return;
  }
  if (layer === "permission") {
    assert.equal(
      eligibleEvryCapabilitiesFor(ACTOR).some(
        (candidate) => candidate.identity === identity
      ),
      true
    );
    assert.equal(
      eligibleEvryCapabilitiesFor(MEMBER_ACTOR).some(
        (candidate) => candidate.identity === identity
      ),
      inventory.operationKind === "read"
    );
    if (inventory.operationKind === "read") {
      assert.equal(readOutcomes()[identity]?.permission, true);
    }
    return;
  }
  if (inventory.operationKind === "read") {
    const outcome = readOutcomes()[identity];
    assert.ok(outcome, `missing read outcome for ${identity}`);
    assert.equal(readOutcomeFor(outcome, layer), true);
    if (layer === "confirmation") {
      assert.equal(
        COMMUNICATION_EVRY_EXECUTION_REGISTRY.registrationFor(identity),
        null
      );
    }
    return;
  }

  const execution =
    COMMUNICATION_EVRY_EXECUTION_REGISTRY.registrationFor(identity);
  assert.ok(execution);
  const args = effectArguments(identity);
  const schema = execution.planCapability.argumentsSchema;
  if (layer === "arguments") {
    assert.equal(schema.safeParse(args).success, true);
    assert.equal(
      schema.safeParse({ ...args, url: "https://example.com" }).success,
      false
    );
    return;
  }
  if (layer === "tenancy") {
    assert.deepEqual(
      await execution.executeIfCurrent(effectInput(identity, args)),
      {
        status: "refused",
        excludedCount: 1,
      }
    );
    return;
  }
  assert.equal(
    LIVE_EFFECT_LAYERS.has(layer),
    false,
    `${identity}:${layer} belongs to the live outcome proof`
  );
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

for (const { identity, operationKind } of communicationInventory.capabilities) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    if (operationKind === "effect" && LIVE_EFFECT_LAYERS.has(layer)) {
      continue;
    }
    test(`${identity}:${layer}`, () => exercise(identity, layer));
  }
}
