import assert from "node:assert/strict";
import { test } from "node:test";

import communicationInventory from "./inventory.generated.json";
import {
  isEvryEffectCapabilityIdentity,
  isEvryReadCapabilityIdentity,
} from "@/lib/evry/eligibility/capabilities";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  fingerprintEvryActionPlanIntent,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { communicationEvryEffectUuid } from "@/lib/communication/evry-effect";
import { renderEmailBodyHtml } from "@/lib/communication/merge";
import { isRecipientGroupSelector } from "@/lib/communication/recipient-groups";
import { storedTemplateContent } from "@/lib/communication/templates";

import {
  COMMUNICATION_EVRY_READ_REGISTRATIONS,
  selectCommunicationEvryRead,
} from "./reads";
import {
  COMMUNICATION_MESSAGE_PLAN_REGISTRY,
  COMMUNICATION_MESSAGE_REVIEW_REGISTRY,
  COMMUNICATION_MESSAGE_SEND_IDENTITY,
  COMMUNICATION_RESEND_NON_OPENERS_IDENTITY,
  createCommunicationEvrySendAudienceResolver,
  selectCommunicationEvryMessageEffect,
} from "./messages";
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
  ...storedTemplateContent("<p>Hello <strong>Ada</strong></p>"),
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
      content: {
        ...content,
        ...storedTemplateContent("<p>Hello Grace</p>"),
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
  assert.equal(
    selectCommunicationEvryRead("Resolve recipient group everyone-ish"),
    null
  );
  assert.equal(isRecipientGroupSelector("everyone-ish"), false);
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
      description: null,
      category: "other",
      channel: "email",
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
  assert.deepEqual(
    selectCommunicationEvryTemplateEffect(
      "Create template Launch note | Sent before launch | launch | email | We launch Sunday | <p>Join us</p>"
    ),
    {
      kind: "create_template",
      name: "Launch note",
      description: "Sent before launch",
      category: "launch",
      channel: "email",
      subject: "We launch Sunday",
      body: "<p>Join us</p>",
    }
  );
  assert.deepEqual(
    selectCommunicationEvryTemplateEffect(
      `Update template ${TEMPLATE_ID} | Follow up | Revised description | follow_up | email | Hello | <p>Updated</p>`
    ),
    {
      kind: "update_template",
      templateId: TEMPLATE_ID,
      name: "Follow up",
      description: "Revised description",
      category: "follow_up",
      channel: "email",
      subject: "Hello",
      body: "<p>Updated</p>",
    }
  );
});

test("template plans bind one canonical body and replay to one intent fingerprint", () => {
  const first = document(COMMUNICATION_TEMPLATE_UPDATE_IDENTITY);
  const second = document(COMMUNICATION_TEMPLATE_UPDATE_IDENTITY);
  assert.equal(
    fingerprintEvryActionPlanIntent({
      actorUserId: PLAN_ID,
      plantId: TEMPLATE_ID,
      document: first,
    }),
    fingerprintEvryActionPlanIntent({
      actorUserId: PLAN_ID,
      plantId: TEMPLATE_ID,
      document: second,
    })
  );

  assert.throws(() =>
    parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: "create",
            capabilityIdentity: COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
            arguments: {
              templateId: RESULT_ID,
              content: { ...content, body: "different confirmed text" },
            },
            dependsOn: [],
          },
        ],
      },
      registry: COMMUNICATION_TEMPLATE_PLAN_REGISTRY,
      eligibleCapabilities: [
        { identity: COMMUNICATION_TEMPLATE_CREATE_IDENTITY },
      ],
    })
  );
});

test("legacy system templates without HTML have reviewable update and fork plans", () => {
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: PLAN_ID,
    fingerprint: FINGERPRINT,
  });
  const legacySource = {
    ...ownedSnapshot,
    body: "Legacy plain text",
    bodyHtml: null,
    isSystem: true,
  } as const;
  for (const [identity, args] of [
    [
      COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
      {
        targetKind: "system",
        resultTemplateId: RESULT_ID,
        expected: legacySource,
        content: { ...content, ...storedTemplateContent("Updated legacy") },
      },
    ],
    [
      COMMUNICATION_TEMPLATE_FORK_IDENTITY,
      { forkId: RESULT_ID, source: legacySource },
    ],
  ] as const) {
    const candidate = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: identity.endsWith("update") ? "update" : "fork",
            capabilityIdentity: identity,
            arguments: args,
            dependsOn: [],
          },
        ],
      },
      registry: COMMUNICATION_TEMPLATE_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    });
    const review = trustedReviewForEvryPlanDocument({
      plan,
      document: candidate,
      reviewRegistry: COMMUNICATION_TEMPLATE_REVIEW_REGISTRY,
    });
    assert.ok(review);
    assert.match(JSON.stringify(review.confirmation), /Legacy plain text/);
  }
});

test("outbound selection is closed and each message effect has an exact trusted review", () => {
  assert.deepEqual(
    selectCommunicationEvryMessageEffect(
      `Send email to people ${TEMPLATE_ID}: Hello | Welcome`
    ),
    {
      kind: "send",
      audience: { kind: "people", recipientIds: [TEMPLATE_ID] },
      draft: { kind: "inline", subject: "Hello", body: "Welcome" },
      meetingId: null,
    }
  );
  const interfaceSizedAudience = Array.from(
    { length: 101 },
    (_, index) =>
      `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  );
  assert.deepEqual(
    selectCommunicationEvryMessageEffect(
      `Send email to people ${interfaceSizedAudience.join(",")}: Hello | Welcome`
    ),
    {
      kind: "send",
      audience: { kind: "people", recipientIds: interfaceSizedAudience },
      draft: { kind: "inline", subject: "Hello", body: "Welcome" },
      meetingId: null,
    }
  );
  assert.deepEqual(
    selectCommunicationEvryMessageEffect(
      "Draft email to group leaders: Hello | Welcome"
    ),
    {
      kind: "send",
      audience: { kind: "group", selector: "leaders" },
      draft: { kind: "inline", subject: "Hello", body: "Welcome" },
      meetingId: null,
    }
  );
  assert.deepEqual(
    selectCommunicationEvryMessageEffect(
      `Send template ${TEMPLATE_ID} to this person for meeting ${RESULT_ID}`
    ),
    {
      kind: "send",
      audience: { kind: "page_person" },
      draft: { kind: "template", templateId: TEMPLATE_ID },
      meetingId: RESULT_ID,
    }
  );
  assert.deepEqual(
    selectCommunicationEvryMessageEffect(
      `Resend message ${TEMPLATE_ID} to non-openers`
    ),
    { kind: "resend", communicationId: TEMPLATE_ID }
  );
  assert.equal(
    selectCommunicationEvryMessageEffect("Send https://example.com"),
    null
  );

  const audience = {
    subject: "Hello",
    body: content.body,
    bodyHtml: content.bodyHtml,
    channel: "email",
    templateId: null,
    meetingId: null,
    messageClass: "relationship_message",
    recipients: [
      {
        personId: TEMPLATE_ID,
        label: "Ada Lovelace",
        email: "ada@example.test",
        subject: "Hello Ada",
        bodyHtml: content.bodyHtml,
        bodyText: content.body,
      },
    ],
    exclusions: [],
  } as const;
  const source = {
    id: TEMPLATE_ID,
    subject: "Hello",
    body: content.body,
    bodyHtml: content.bodyHtml,
    channel: "email",
    templateId: null,
    meetingId: null,
    status: "sent",
    sentAt: UPDATED_AT,
    recipientCount: 1,
  } as const;
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: PLAN_ID,
    fingerprint: FINGERPRINT,
  });
  for (const [identity, args] of [
    [
      COMMUNICATION_MESSAGE_SEND_IDENTITY,
      { communicationId: RESULT_ID, audience },
    ],
    [
      COMMUNICATION_RESEND_NON_OPENERS_IDENTITY,
      { source, communicationId: RESULT_ID, audience },
    ],
  ] as const) {
    const candidate = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: identity.endsWith("send") ? "send" : "resend",
            capabilityIdentity: identity,
            arguments: args,
            dependsOn: [],
          },
        ],
      },
      registry: COMMUNICATION_MESSAGE_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    });
    const registration =
      COMMUNICATION_MESSAGE_PLAN_REGISTRY.registrationFor(identity);
    assert.ok(registration);
    assert.equal(
      registration.argumentsSchema.safeParse({
        ...args,
        url: "https://example.com",
      }).success,
      false
    );
    const review = trustedReviewForEvryPlanDocument({
      plan,
      document: candidate,
      reviewRegistry: COMMUNICATION_MESSAGE_REVIEW_REGISTRY,
    });
    assert.ok(review);
    assert.equal(review.confirmation.steps[0]?.resolvedTargets.length, 1);
    assert.match(JSON.stringify(review.confirmation), /Hello/);
  }
});

test("group and template drafts resolve inside the actor plant before confirmation", async () => {
  const calls: unknown[] = [];
  const resolver = createCommunicationEvrySendAudienceResolver({
    async getGroupRecipients(churchId, selector) {
      calls.push({ kind: "group", churchId, selector });
      return [
        {
          id: RESULT_ID,
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.test",
        },
      ];
    },
    async getTemplate(templateId, churchId) {
      calls.push({ kind: "template", templateId, churchId });
      return {
        id: templateId,
        churchId,
        ...content,
        mergeFields: ["first_name"],
        isSystem: false,
        sourceTemplateId: null,
        createdAt: new Date(UPDATED_AT),
        updatedAt: new Date(UPDATED_AT),
      };
    },
    async resolveAudience(input) {
      calls.push({ kind: "audience", input });
      return {
        subject: input.subject,
        body: content.body,
        bodyHtml: content.bodyHtml,
        channel: "email",
        templateId: input.templateId ?? null,
        meetingId: input.meetingId ?? null,
        messageClass: input.meetingId
          ? "transactional_meeting"
          : "relationship_message",
        recipients: [
          {
            personId: RESULT_ID,
            label: "Ada Lovelace",
            email: "ada@example.test",
            subject: input.subject,
            bodyHtml: content.bodyHtml,
            bodyText: content.body,
          },
        ],
        exclusions: [],
      };
    },
  });
  const selection = selectCommunicationEvryMessageEffect(
    `Draft template ${TEMPLATE_ID} to group leaders for meeting ${RESULT_ID}`
  );
  assert.ok(selection?.kind === "send");

  const audience = await resolver({
    actor: {
      userId: PLAN_ID,
      plantId: TEMPLATE_ID,
      seat: "owner",
    } as never,
    pageContext: null,
    selection,
  });

  assert.equal(audience?.templateId, TEMPLATE_ID);
  assert.equal(audience?.meetingId, RESULT_ID);
  assert.deepEqual(calls, [
    { kind: "group", churchId: TEMPLATE_ID, selector: "leaders" },
    { kind: "template", templateId: TEMPLATE_ID, churchId: TEMPLATE_ID },
    {
      kind: "audience",
      input: {
        churchId: TEMPLATE_ID,
        recipientIds: [RESULT_ID],
        subject: content.subject,
        body: content.bodyHtml,
        channel: "email",
        templateId: TEMPLATE_ID,
        meetingId: RESULT_ID,
      },
    },
  ]);
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
