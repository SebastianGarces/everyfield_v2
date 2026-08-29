import assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "@react-email/components";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EvryArtifactRenderer } from "@/components/evry/artifacts/artifact-renderer";
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
import { EVRY_COMMUNICATION_MAX_RECIPIENTS } from "@/lib/communication/evry-send";
import { renderEmailBodyHtml } from "@/lib/communication/merge";
import { isRecipientGroupSelector } from "@/lib/communication/recipient-groups";
import { storedTemplateContent } from "@/lib/communication/templates";
import { CommunicationEmail } from "@/lib/email/components/communication-email";

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
  mergeFields: null,
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
    const step = review.confirmation.steps[0];
    assert.ok(step);
    assert.equal(step.counts[0]?.count, 1);
    assert.deepEqual(
      step.beforeAfter.map(({ label }) => label),
      [
        "Name",
        "Description",
        "Category",
        "Channel",
        "Subject",
        "Body",
        "Merge fields",
      ]
    );
    assert.ok(
      step.contentPreviews.every(({ format }) => format === "rich_text")
    );
    const changes = Object.fromEntries(
      step.beforeAfter.map(({ label, before, after }) => [
        label,
        { before, after },
      ])
    );
    if (identity === COMMUNICATION_TEMPLATE_CREATE_IDENTITY) {
      assert.deepEqual(
        step.contentPreviews.map(
          ({ content: previewContent }) => previewContent
        ),
        [content.bodyHtml]
      );
      assert.deepEqual(changes, {
        Name: { before: "Absent", after: content.name },
        Description: { before: "Absent", after: "(None)" },
        Category: { before: "Absent", after: content.category },
        Channel: { before: "Absent", after: content.channel },
        Subject: { before: "Absent", after: content.subject },
        Body: {
          before: "Absent",
          after: "See exact rendered body preview",
        },
        "Merge fields": { before: "Absent", after: "(None)" },
      });
    } else if (identity === COMMUNICATION_TEMPLATE_UPDATE_IDENTITY) {
      const updated = storedTemplateContent("<p>Hello Grace</p>");
      assert.deepEqual(
        step.contentPreviews.map(
          ({ content: previewContent }) => previewContent
        ),
        [content.bodyHtml, updated.bodyHtml]
      );
      assert.deepEqual(changes, {
        Name: { before: content.name, after: content.name },
        Description: { before: "(None)", after: "(None)" },
        Category: { before: content.category, after: content.category },
        Channel: { before: content.channel, after: content.channel },
        Subject: { before: content.subject, after: content.subject },
        Body: {
          before: "See exact previous body preview",
          after: "See exact rendered body preview",
        },
        "Merge fields": { before: "(None)", after: "(None)" },
      });
    } else if (identity === COMMUNICATION_TEMPLATE_DELETE_IDENTITY) {
      assert.deepEqual(
        step.contentPreviews.map(
          ({ content: previewContent }) => previewContent
        ),
        [content.bodyHtml]
      );
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(changes).map(([label, value]) => [label, value.after])
        ),
        {
          Name: "Deleted",
          Description: "Deleted",
          Category: "Deleted",
          Channel: "Deleted",
          Subject: "Deleted",
          Body: "Deleted",
          "Merge fields": "Deleted",
        }
      );
    } else {
      assert.deepEqual(
        step.contentPreviews.map(
          ({ content: previewContent }) => previewContent
        ),
        [content.bodyHtml]
      );
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(changes).map(([label, value]) => [label, value.before])
        ),
        {
          Name: "Absent",
          Description: "Absent",
          Category: "Absent",
          Channel: "Absent",
          Subject: "Absent",
          Body: "Absent",
          "Merge fields": "Absent",
        }
      );
    }
  }
});

test("valid maximum-size and subjectless templates remain exactly reviewable", () => {
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: PLAN_ID,
    fingerprint: FINGERPRINT,
  });
  const boundaryContent = {
    ...content,
    name: "N".repeat(255),
    channel: "sms" as const,
    subject: null,
    ...storedTemplateContent("B".repeat(5_000)),
  };
  const boundarySnapshot = {
    ...ownedSnapshot,
    ...boundaryContent,
  };
  const candidates = [
    {
      identity: COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
      arguments: { templateId: RESULT_ID, content: boundaryContent },
    },
    {
      identity: COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
      arguments: {
        targetKind: "owned",
        resultTemplateId: TEMPLATE_ID,
        expected: boundarySnapshot,
        content: boundaryContent,
      },
    },
    {
      identity: COMMUNICATION_TEMPLATE_DELETE_IDENTITY,
      arguments: { expected: boundarySnapshot },
    },
    {
      identity: COMMUNICATION_TEMPLATE_FORK_IDENTITY,
      arguments: {
        forkId: RESULT_ID,
        source: { ...boundarySnapshot, isSystem: true },
      },
    },
  ];

  for (const candidate of candidates) {
    const document = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: candidate.identity.split(".").at(-1) ?? "template",
            capabilityIdentity: candidate.identity,
            arguments: candidate.arguments,
            dependsOn: [],
          },
        ],
      },
      registry: COMMUNICATION_TEMPLATE_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity: candidate.identity }],
    });
    const review = trustedReviewForEvryPlanDocument({
      plan,
      document,
      reviewRegistry: COMMUNICATION_TEMPLATE_REVIEW_REGISTRY,
    });
    assert.ok(review, candidate.identity);
    assert.ok(review.confirmation.title.length <= 200);
    for (const step of review.confirmation.steps) {
      for (const target of step.resolvedTargets) {
        assert.ok((target.sourceLink?.label.length ?? 0) <= 160);
      }
      for (const preview of step.contentPreviews) {
        assert.ok(preview.content.length > 0);
        assert.ok(
          preview.content.length <=
            (preview.format === "rich_text" ? 200_000 : 4_000)
        );
      }
      for (const change of step.beforeAfter) {
        assert.ok(change.before.length > 0);
        assert.ok(change.before.length <= 4_000);
        assert.ok(change.after.length > 0);
        assert.ok(change.after.length <= 4_000);
      }
    }
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
    mergeFields: ["first_name"],
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
    assert.match(JSON.stringify(review.confirmation), /\{\{first_name\}\}/);
    const step = review.confirmation.steps[0];
    assert.ok(step);
    assert.equal(step.contentPreviews[0]?.format, "rich_text");
    if (identity === COMMUNICATION_TEMPLATE_UPDATE_IDENTITY) {
      assert.match(review.confirmation.title, /^Copy and edit template/);
      assert.equal(review.confirmation.actionLabel, "Create edited copy");
      assert.deepEqual(step.counts, [
        { label: "Plant copies to create", count: 1 },
      ]);
      assert.deepEqual(
        step.resolvedTargets.map(({ label }) => label),
        ["System template source", "New plant-owned template"]
      );
      assert.match(step.resolvedTargets[1]?.value ?? "", new RegExp(RESULT_ID));
    }
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
  const supportedAudience = Array.from(
    { length: EVRY_COMMUNICATION_MAX_RECIPIENTS },
    (_, index) =>
      `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  );
  assert.deepEqual(
    selectCommunicationEvryMessageEffect(
      `Send email to people ${supportedAudience.join(",")}: Hello | Welcome`
    ),
    {
      kind: "send",
      audience: { kind: "people", recipientIds: supportedAudience },
      draft: { kind: "inline", subject: "Hello", body: "Welcome" },
      meetingId: null,
    }
  );
  const oversizedAudience = [
    ...supportedAudience,
    "10000000-0000-4000-8000-000000000101",
  ];
  assert.equal(
    selectCommunicationEvryMessageEffect(
      `Send email to people ${oversizedAudience.join(",")}: Hello | Welcome`
    ),
    null
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
    recipients: supportedAudience.map((personId, index) => ({
      personId,
      label: index === 0 ? "R".repeat(511) : `Recipient ${index + 1}`,
      email: `recipient-${index + 1}@example.test`,
      subject: `Hello recipient ${index + 1}`,
      bodyHtml: content.bodyHtml,
      bodyText: content.body,
    })),
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
    recipientCount: supportedAudience.length,
  } as const;
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: PLAN_ID,
    fingerprint: FINGERPRINT,
  });
  for (const [identity, args] of [
    [
      COMMUNICATION_MESSAGE_SEND_IDENTITY,
      {
        communicationId: RESULT_ID,
        recipientSource: {
          kind: "people",
          recipientIds: supportedAudience,
        },
        audience,
      },
    ],
    [
      COMMUNICATION_RESEND_NON_OPENERS_IDENTITY,
      {
        source,
        nonOpenerPersonIds: supportedAudience,
        communicationId: RESULT_ID,
        audience,
      },
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
    assert.equal(
      review.confirmation.steps[0]?.resolvedTargets.length,
      EVRY_COMMUNICATION_MAX_RECIPIENTS
    );
    assert.ok(
      review.confirmation.steps[0]?.resolvedTargets.every(
        ({ sourceLink }) => (sourceLink?.label.length ?? 0) <= 160
      )
    );
    assert.match(JSON.stringify(review.confirmation), /Hello/);
  }

  const sendRegistration = COMMUNICATION_MESSAGE_PLAN_REGISTRY.registrationFor(
    COMMUNICATION_MESSAGE_SEND_IDENTITY
  );
  assert.ok(sendRegistration);
  assert.equal(
    sendRegistration.argumentsSchema.safeParse({
      communicationId: RESULT_ID,
      recipientSource: { kind: "people", recipientIds: oversizedAudience },
      audience: {
        ...audience,
        recipients: [
          ...audience.recipients,
          {
            ...audience.recipients[0],
            personId: "10000000-0000-4000-8000-000000000101",
          },
        ],
      },
    }).success,
    false,
    "the immutable plan and rendered confirmation have an explicit batch bound"
  );
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

  assert.equal(audience.kind, "resolved");
  if (audience.kind !== "resolved") return;
  assert.equal(audience.audience.templateId, TEMPLATE_ID);
  assert.equal(audience.audience.meetingId, RESULT_ID);
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

test("valid selections with unavailable sources or zero eligible recipients return reviewable refusals", async () => {
  let audienceCalls = 0;
  const resolver = createCommunicationEvrySendAudienceResolver({
    async getGroupRecipients() {
      return [];
    },
    async getTemplate() {
      return undefined;
    },
    async resolveAudience() {
      audienceCalls += 1;
      return null;
    },
  });
  const actor = {
    userId: PLAN_ID,
    plantId: TEMPLATE_ID,
    seat: "owner",
  } as never;
  const emptyGroup = selectCommunicationEvryMessageEffect(
    "Send email to group leaders: Hello | Welcome"
  );
  assert.ok(emptyGroup?.kind === "send");
  const empty = await resolver({
    actor,
    pageContext: null,
    selection: emptyGroup,
  });
  assert.equal(empty.kind, "refusal");
  assert.match(JSON.stringify(empty), /No eligible email recipients/);
  assert.equal(audienceCalls, 0);

  const missingTemplate = selectCommunicationEvryMessageEffect(
    `Send template ${TEMPLATE_ID} to people ${RESULT_ID}`
  );
  assert.ok(missingTemplate?.kind === "send");
  const unavailable = await resolver({
    actor,
    pageContext: null,
    selection: missingTemplate,
  });
  assert.equal(unavailable.kind, "refusal");
  assert.match(JSON.stringify(unavailable), /template unavailable/i);
  assert.equal(audienceCalls, 0);

  const missingMeeting = selectCommunicationEvryMessageEffect(
    `Send email to people ${RESULT_ID} for meeting ${PLAN_ID}: Hello | Welcome`
  );
  assert.ok(missingMeeting?.kind === "send");
  const unavailableMeeting = await resolver({
    actor,
    pageContext: null,
    selection: missingMeeting,
  });
  assert.equal(unavailableMeeting.kind, "refusal");
  assert.match(JSON.stringify(unavailableMeeting), /meeting unavailable/i);
  assert.equal(audienceCalls, 1);
});

test("group resolution refuses a batch above the plan and DOM bound", async () => {
  let audienceCalls = 0;
  const resolver = createCommunicationEvrySendAudienceResolver({
    async getGroupRecipients() {
      return Array.from(
        { length: EVRY_COMMUNICATION_MAX_RECIPIENTS + 1 },
        (_, index) => ({
          id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          firstName: `Recipient ${index + 1}`,
          lastName: "",
          email: `recipient-${index + 1}@example.test`,
        })
      );
    },
    async getTemplate() {
      return undefined;
    },
    async resolveAudience() {
      audienceCalls += 1;
      return null;
    },
  });
  const selection = selectCommunicationEvryMessageEffect(
    "Send email to group leaders: Hello | Welcome"
  );
  assert.ok(selection?.kind === "send");
  const result = await resolver({
    actor: {
      userId: PLAN_ID,
      plantId: TEMPLATE_ID,
      seat: "owner",
    } as never,
    pageContext: null,
    selection,
  });
  assert.equal(result.kind, "refusal");
  assert.match(JSON.stringify(result), /at most 100 recipients/);
  assert.equal(audienceCalls, 0);
});

test("draft, stored, preview, and sent rich text share one sanitized source", async () => {
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

  const audience = {
    subject: "Hello Ada",
    body: stored.body,
    bodyHtml: stored.bodyHtml,
    channel: "email",
    templateId: null,
    meetingId: null,
    messageClass: "relationship_message",
    recipients: [
      {
        personId: RESULT_ID,
        label: "Ada Lovelace",
        email: "ada@example.test",
        subject: "Hello Ada",
        bodyHtml: preview,
        bodyText: "Hello Ada details",
      },
    ],
    exclusions: [],
  } as const;
  const candidate = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "send",
          capabilityIdentity: COMMUNICATION_MESSAGE_SEND_IDENTITY,
          arguments: {
            communicationId: RESULT_ID,
            recipientSource: { kind: "people", recipientIds: [RESULT_ID] },
            audience,
          },
          dependsOn: [],
        },
      ],
    },
    registry: COMMUNICATION_MESSAGE_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity: COMMUNICATION_MESSAGE_SEND_IDENTITY }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: PLAN_ID,
      fingerprint: FINGERPRINT,
    }),
    document: candidate,
    reviewRegistry: COMMUNICATION_MESSAGE_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const renderedConfirmation = renderToStaticMarkup(
    createElement(EvryArtifactRenderer, {
      model: { variant: "confirmation", artifact: review.confirmation },
    })
  );
  const delivered = await render(
    CommunicationEmail({ bodyHtml: preview, churchName: "EveryField Test" })
  );
  for (const surface of [renderedConfirmation, delivered]) {
    assert.match(surface, /<strong>Ada<\/strong>/);
    assert.match(surface, /href="https:\/\/example.com"/);
    assert.doesNotMatch(surface, /&lt;strong&gt;/);
    assert.doesNotMatch(surface, /script|bad\(\)/i);
  }
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
