import assert from "node:assert/strict";
import { test } from "node:test";

import communicationInventory from "./inventory.generated.json";
import {
  isEvryEffectCapabilityIdentity,
  isEvryReadCapabilityIdentity,
} from "@/lib/evry/eligibility/capabilities";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { communicationEvryEffectUuid } from "@/lib/communication/evry-effect";
import { renderEmailBodyHtml } from "@/lib/communication/merge";
import { storedTemplateContent } from "@/lib/communication/templates";

import {
  COMMUNICATION_EVRY_READ_REGISTRATIONS,
  selectCommunicationEvryRead,
} from "./reads";
import {
  COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
  COMMUNICATION_TEMPLATE_DELETE_IDENTITY,
  COMMUNICATION_TEMPLATE_FORK_IDENTITY,
  COMMUNICATION_TEMPLATE_PLAN_REGISTRY,
  COMMUNICATION_TEMPLATE_REVIEW_REGISTRY,
  COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
  selectCommunicationEvryTemplateEffect,
} from "./templates";

const TEMPLATE_ID = "10000000-0000-4000-8000-000000000001";
const RESULT_ID = "10000000-0000-4000-8000-000000000002";
const PLAN_ID = "20000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);
const UPDATED_AT = "2026-08-29T06:00:00.000Z";

const content = {
  name: "Sunday follow-up",
  description: null,
  category: "follow_up",
  channel: "email",
  subject: "Good to meet you",
  body: "Hello Ada",
  bodyHtml: "<p>Hello <strong>Ada</strong></p>",
} as const;

const ownedSnapshot = {
  id: TEMPLATE_ID,
  ...content,
  isSystem: false,
  sourceTemplateId: null,
  updatedAt: UPDATED_AT,
} as const;

function document(identity: string) {
  const argumentsByIdentity: Record<string, Record<string, unknown>> = {
    [COMMUNICATION_TEMPLATE_CREATE_IDENTITY]: {
      templateId: RESULT_ID,
      content,
    },
    [COMMUNICATION_TEMPLATE_UPDATE_IDENTITY]: {
      targetKind: "owned",
      resultTemplateId: TEMPLATE_ID,
      expected: ownedSnapshot,
      changedAt: "2026-08-29T06:05:00.000Z",
      content: {
        ...content,
        body: "Hello Grace",
        bodyHtml: "<p>Hello Grace</p>",
      },
    },
    [COMMUNICATION_TEMPLATE_DELETE_IDENTITY]: { expected: ownedSnapshot },
    [COMMUNICATION_TEMPLATE_FORK_IDENTITY]: {
      forkId: RESULT_ID,
      source: { ...ownedSnapshot, isSystem: true },
    },
  };
  return parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity.split(".").at(-1) ?? "template",
          capabilityIdentity: identity,
          arguments: argumentsByIdentity[identity],
          dependsOn: [],
        },
      ],
    },
    registry: COMMUNICATION_TEMPLATE_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
}

test("all generated Communication identities are installed with the authoritative operation kind", () => {
  for (const capability of communicationInventory.capabilities) {
    assert.equal(
      capability.operationKind === "read"
        ? isEvryReadCapabilityIdentity(capability.identity)
        : isEvryEffectCapabilityIdentity(capability.identity),
      true,
      capability.identity
    );
  }
});

test("all fourteen generated Communication reads have one concrete adapter", () => {
  const expected = communicationInventory.capabilities
    .filter(({ operationKind }) => operationKind === "read")
    .map(({ identity }) => identity)
    .sort();
  const actual = COMMUNICATION_EVRY_READ_REGISTRATIONS.map(
    ({ capabilityIdentity }) => capabilityIdentity
  ).sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
});

test("Communication read selection is closed and deterministic", () => {
  assert.deepEqual(selectCommunicationEvryRead("List communication history"), {
    kind: "history",
    search: "",
  });
  assert.deepEqual(
    selectCommunicationEvryRead(`Show recipients for message ${TEMPLATE_ID}`),
    { kind: "message_recipients", id: TEMPLATE_ID }
  );
  assert.deepEqual(
    selectCommunicationEvryRead("List communication templates"),
    {
      kind: "templates",
    }
  );
  assert.equal(selectCommunicationEvryRead("Fetch https://example.com"), null);
  assert.equal(selectCommunicationEvryRead("Delete every message"), null);
});

test("every template mutation shape has strict arguments and a complete trusted review", () => {
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: PLAN_ID,
    fingerprint: FINGERPRINT,
  });
  for (const identity of [
    COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
    COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
    COMMUNICATION_TEMPLATE_DELETE_IDENTITY,
    COMMUNICATION_TEMPLATE_FORK_IDENTITY,
  ]) {
    const candidate = document(identity);
    const registration =
      COMMUNICATION_TEMPLATE_PLAN_REGISTRY.registrationFor(identity);
    assert.ok(registration);
    const args = candidate.steps[0]?.arguments;
    assert.equal(registration.argumentsSchema.safeParse(args).success, true);
    assert.equal(
      registration.argumentsSchema.safeParse({
        ...args,
        url: "https://example.com",
      }).success,
      false,
      `${identity} accepted an extra network target`
    );
    const review = trustedReviewForEvryPlanDocument({
      plan,
      document: candidate,
      reviewRegistry: COMMUNICATION_TEMPLATE_REVIEW_REGISTRY,
    });
    assert.ok(review, identity);
    assert.equal(review.confirmation.steps.length, 1);
    assert.equal(review.confirmation.steps[0]?.counts[0]?.count, 1);
  }
});

test("template selection exposes every mutation shape without accepting arbitrary prose", () => {
  assert.deepEqual(
    selectCommunicationEvryTemplateEffect(
      "Create template Follow up | Good to meet you | Hello there"
    ),
    {
      kind: "create_template",
      name: "Follow up",
      subject: "Good to meet you",
      body: "Hello there",
    }
  );
  assert.deepEqual(
    selectCommunicationEvryTemplateEffect(
      `Update template ${TEMPLATE_ID} | New name | New subject | New body`
    ),
    {
      kind: "update_template",
      templateId: TEMPLATE_ID,
      name: "New name",
      subject: "New subject",
      body: "New body",
    }
  );
  assert.deepEqual(
    selectCommunicationEvryTemplateEffect(`Delete template ${TEMPLATE_ID}`),
    { kind: "delete_template", templateId: TEMPLATE_ID }
  );
  assert.deepEqual(
    selectCommunicationEvryTemplateEffect(`Fork template ${TEMPLATE_ID}`),
    { kind: "fork_template", templateId: TEMPLATE_ID }
  );
  assert.equal(selectCommunicationEvryTemplateEffect("Run this SQL"), null);
});

test("draft, stored, preview, and sent rich text share one sanitized source", () => {
  const stored = storedTemplateContent(
    '<p>Hello <strong>{{first_name}}</strong> <a href="https://example.com">details</a></p><script>bad()</script>'
  );
  assert.doesNotMatch(stored.bodyHtml, /script|bad\(\)/i);
  assert.match(stored.bodyHtml, /<strong>\{\{first_name\}\}<\/strong>/);
  assert.match(stored.body, /Hello \{\{first_name\}\} details/);
  const preview = renderEmailBodyHtml(stored.bodyHtml, { first_name: "Ada" });
  const sent = renderEmailBodyHtml(stored.bodyHtml, { first_name: "Ada" });
  assert.equal(preview, sent);
  assert.match(sent, /<strong>Ada<\/strong>/);
  assert.match(sent, /href="https:\/\/example.com"/);
});

test("effect identities are stable, purpose-separated UUIDs", () => {
  const first = communicationEvryEffectUuid("effect-key", "template");
  assert.equal(first, communicationEvryEffectUuid("effect-key", "template"));
  assert.notEqual(
    first,
    communicationEvryEffectUuid("effect-key", "recipient")
  );
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});
