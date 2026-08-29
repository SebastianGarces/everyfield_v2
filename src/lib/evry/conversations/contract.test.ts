import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEvryReadArtifact } from "@/lib/evry/artifacts/core";
import { trustedEvryApplicationSourceLink } from "@/lib/evry/artifacts/types";
import { EVRY_SETTINGS_CATALOG } from "@/lib/evry/policy/inventory";

import {
  evryBoundaryArtifactDocument,
  evryConversationArtifactDocumentSchema,
  evrySettingsArtifactDocument,
  hydrateStoredEvryConversationArtifact,
  parseStoredEvryConversationArtifact,
  storedEvryReadArtifactDocument,
} from "./artifacts";
import {
  evryConversationReplayMetadataSchema,
  evryConversationStateDocumentSchema,
  initialEvryConversationState,
  parseStoredEvryConversationState,
} from "./contract";

const MESSAGE_ID = "10000000-0000-4000-8000-000000000001";

test("replay reference snapshots pair exactly with idempotency metadata", () => {
  const reference = {
    key: "person.alex",
    entityType: "person",
    entityId: "person-1",
    label: "Alex Rivera",
    distinguishingFacts: [],
    sourceLink: { label: "Alex Rivera", href: "/people/person-1" },
    aliases: ["alex"],
    sourceMessageId: MESSAGE_ID,
    resolvedAt: "2026-08-20T12:00:00.000Z",
    validThrough: null,
  };
  const resolvedContext = {
    status: "resolved" as const,
    referenceKey: "person.alex",
    entityType: "person",
    entityId: "person-1",
  };
  const resolvedReplay = {
    status: "resolved" as const,
    reference,
    relevanceKeys: ["person.alex"],
  };
  for (const valid of [
    { idempotencyContext: { status: "none" }, replayReference: null },
    {
      idempotencyContext: { status: "clarification", reason: "missing" },
      replayReference: null,
    },
    {
      idempotencyContext: { status: "not_applicable" },
      replayReference: { status: "not_applicable" },
    },
    { idempotencyContext: resolvedContext, replayReference: resolvedReplay },
  ]) {
    assert.equal(
      evryConversationReplayMetadataSchema.safeParse(valid).success,
      true
    );
  }
  for (const hostile of [
    {
      idempotencyContext: { status: "not_applicable" },
      replayReference: null,
    },
    {
      idempotencyContext: { status: "none" },
      replayReference: { status: "not_applicable" },
    },
    {
      idempotencyContext: { status: "clarification", reason: "stale" },
      replayReference: { status: "not_applicable" },
    },
    { idempotencyContext: resolvedContext, replayReference: null },
    {
      idempotencyContext: resolvedContext,
      replayReference: {
        ...resolvedReplay,
        reference: { ...reference, entityId: "person-2" },
      },
    },
  ]) {
    assert.equal(
      evryConversationReplayMetadataSchema.safeParse(hostile).success,
      false
    );
  }
});

test("conversation state is closed and choices name exact persisted references", () => {
  const initial = initialEvryConversationState();
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(
    evryConversationStateDocumentSchema.safeParse({ ...initial, extra: true })
      .success,
    false
  );

  const reference = {
    key: "person.alex",
    entityType: "person",
    entityId: "person-1",
    label: "Alex Rivera",
    distinguishingFacts: [{ label: "Email", value: "alex@example.test" }],
    sourceLink: { label: "Alex Rivera", href: "/people/person-1" },
    aliases: ["alex", "her"],
    sourceMessageId: MESSAGE_ID,
    resolvedAt: "2026-08-20T12:00:00.000Z",
    validThrough: "2026-09-20T12:00:00.000Z",
  };
  const valid = evryConversationStateDocumentSchema.parse({
    ...initial,
    resolvedReferences: [
      reference,
      {
        ...reference,
        key: "person.sam",
        entityId: "person-2",
        label: "Sam Lee",
        sourceLink: { label: "Sam Lee", href: "/people/person-2" },
        aliases: ["sam"],
      },
    ],
    explicitChoices: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        clarificationArtifactId: "30000000-0000-4000-8000-000000000001",
        offeredReferences: [
          {
            referenceKey: "person.alex",
            entityType: "person",
            entityId: "person-1",
          },
          {
            referenceKey: "person.sam",
            entityType: "person",
            entityId: "person-2",
          },
        ],
        referenceKey: "person.alex",
        selectedEntityId: "person-1",
        sourceMessageId: MESSAGE_ID,
        selectedAt: "2026-08-20T12:01:00.000Z",
      },
    ],
  });
  assert.equal(valid.explicitChoices[0]?.selectedEntityId, "person-1");

  assert.equal(
    evryConversationStateDocumentSchema.safeParse({
      ...valid,
      explicitChoices: [
        { ...valid.explicitChoices[0], selectedEntityId: "person-2" },
      ],
    }).success,
    false
  );
  assert.equal(
    evryConversationStateDocumentSchema.safeParse({
      ...initial,
      resolvedReferences: [{ ...reference, aliases: ["Her"] }],
    }).success,
    false
  );
  assert.throws(
    () => parseStoredEvryConversationState({ version: 1 }),
    /Stored Evry conversation data is invalid/
  );
});

test("stored artifacts are strict JSON and source links regain trust only on hydrate", () => {
  const sourceLink = trustedEvryApplicationSourceLink({
    label: "Tasks",
    href: "/tasks",
  });
  const read = buildEvryReadArtifact({
    title: "Overdue tasks",
    filters: [{ label: "Status", value: "Overdue" }],
    exclusions: [{ reason: "Archived", count: 1 }],
    items: [
      {
        id: "task-1",
        label: "Call Alex",
        facts: [{ label: "Due", value: "Aug 27" }],
        sourceLink,
      },
    ],
    sourceLinks: [sourceLink],
  });
  const stored = storedEvryReadArtifactDocument(read);
  assert.equal(stored.kind, "read");
  if (stored.kind !== "read") assert.fail("expected stored read artifact");
  const storedSourceLink = stored.sourceLinks[0];
  assert.ok(storedSourceLink);
  assert.equal(Object.getOwnPropertySymbols(storedSourceLink).length, 0);
  assert.equal(
    evryConversationArtifactDocumentSchema.safeParse({
      ...stored,
      sourceLinks: [{ label: "Bad", href: "https://example.com" }],
    }).success,
    false
  );
  assert.equal(
    evryConversationArtifactDocumentSchema.safeParse({
      ...stored,
      counts: { matched: 99, returned: 1, excluded: 1 },
    }).success,
    false
  );

  const hydrated = hydrateStoredEvryConversationArtifact(stored);
  assert.equal(hydrated.kind, "read");
  if (hydrated.kind !== "read") assert.fail("expected a read artifact");
  const hydratedSourceLink = hydrated.sourceLinks[0];
  assert.ok(hydratedSourceLink);
  assert.equal(Object.getOwnPropertySymbols(hydratedSourceLink).length, 1);
  assert.throws(
    () =>
      parseStoredEvryConversationArtifact({
        kind: "result",
        document: stored,
      }),
    /Stored Evry conversation data is invalid/
  );
});

test("Settings and boundary artifacts rehydrate canonical fixed copy", () => {
  const settings = EVRY_SETTINGS_CATALOG[0];
  assert.ok(settings);
  const settingsDocument = evrySettingsArtifactDocument(settings.id);
  assert.deepEqual(settingsDocument, {
    kind: "settings_handoff",
    sectionId: settings.id,
  });
  const settingsArtifact =
    hydrateStoredEvryConversationArtifact(settingsDocument);
  assert.equal(settingsArtifact.kind, "settings_handoff");
  if (settingsArtifact.kind !== "settings_handoff") {
    assert.fail("expected Settings handoff");
  }
  assert.equal(settingsArtifact.destination.sectionId, settings.id);
  assert.equal(
    settingsArtifact.message,
    "Review or change this in EveryField Settings. Evry has not read or changed the setting."
  );

  const boundary = hydrateStoredEvryConversationArtifact(
    evryBoundaryArtifactDocument("mixed")
  );
  assert.equal(boundary.kind, "boundary");
  if (boundary.kind !== "boundary") assert.fail("expected boundary artifact");
  assert.equal(
    boundary.message,
    "Send the EveryField work as a separate request. Nothing from this request was run."
  );
});

test("confirmation, progress, and result documents have closed plan identities", () => {
  const plan = {
    planId: "40000000-0000-4000-8000-000000000001",
    fingerprint: "a".repeat(64),
  };
  for (const document of [
    {
      kind: "confirmation",
      plan,
      title: "Create the meeting",
      actionLabel: "Create meeting",
      items: [{ label: "When", value: "August 30 at 10:00 AM EDT" }],
      consequences: ["One meeting will be created."],
    },
    {
      kind: "progress",
      plan,
      title: "Creating the meeting",
      activeStep: { stepId: "meeting.create", label: "Create meeting" },
      completedSteps: [],
    },
    {
      kind: "result",
      plan,
      title: "Meeting created",
      status: "completed",
      steps: [
        {
          stepId: "meeting.create",
          label: "Create meeting",
          status: "completed",
          resultCode: "effect_completed",
          affectedCount: 1,
          excludedCount: 0,
          sourceLinks: [{ label: "Meeting", href: "/meetings/meeting-1" }],
        },
      ],
    },
  ]) {
    assert.equal(
      evryConversationArtifactDocumentSchema.safeParse(document).success,
      true
    );
    assert.equal(
      evryConversationArtifactDocumentSchema.safeParse({
        ...document,
        actorUserId: "forged",
      }).success,
      false
    );
  }

  assert.equal(
    evryConversationArtifactDocumentSchema.safeParse({
      kind: "result",
      plan,
      title: "Meeting refused",
      status: "refused",
      steps: [
        {
          stepId: "meeting.create",
          label: "Create meeting",
          status: "refused",
          resultCode: "effect_completed",
          affectedCount: 0,
          excludedCount: 0,
          sourceLinks: [],
        },
      ],
    }).success,
    false
  );
  assert.equal(
    evryConversationArtifactDocumentSchema.safeParse({
      kind: "result",
      plan,
      title: "Contradictory result",
      status: "completed",
      steps: [
        {
          stepId: "meeting.create",
          label: "Create meeting",
          status: "failed",
          resultCode: "effect_failed",
          affectedCount: 0,
          excludedCount: 0,
          sourceLinks: [],
        },
      ],
    }).success,
    false
  );
});
