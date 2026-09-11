import assert from "node:assert/strict";
import { test } from "node:test";

import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryDetailedConfirmationArtifactDocumentSchema } from "@/lib/evry/artifacts/review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  fingerprintEvryActionPlanIntent,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";

import {
  PEOPLE_EVRY_ADD_NOTE_IDENTITY,
  PEOPLE_EVRY_DELETE_NOTE_IDENTITY,
  PEOPLE_EVRY_EDIT_NOTE_IDENTITY,
  PEOPLE_EVRY_PLAN_REGISTRY,
  PEOPLE_EVRY_REVIEW_REGISTRY,
  selectPeopleEvryRequest,
} from "./runtime";

const PERSON_ID = "10000000-0000-4000-8000-000000000001";
const PLAN_ID = "20000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);
const ACTIVITY_ID = "30000000-0000-4000-8000-000000000001";
const NOTE_METADATA = JSON.stringify({ note: "Called before lunch." });

function addNoteDocument() {
  return parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "add-note",
          capabilityIdentity: PEOPLE_EVRY_ADD_NOTE_IDENTITY,
          arguments: {
            personId: PERSON_ID,
            firstName: "Ada",
            lastName: "Lovelace",
            note: "Called and scheduled a follow-up.",
          },
          dependsOn: [],
        },
      ],
    },
    registry: PEOPLE_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity: PEOPLE_EVRY_ADD_NOTE_IDENTITY }],
  });
}

function noteChangeDocument(kind: "edit" | "delete") {
  return parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: `${kind}-note`,
          capabilityIdentity:
            kind === "edit"
              ? PEOPLE_EVRY_EDIT_NOTE_IDENTITY
              : PEOPLE_EVRY_DELETE_NOTE_IDENTITY,
          arguments: {
            personId: PERSON_ID,
            personLabel: "Ada Lovelace",
            activityId: ACTIVITY_ID,
            expectedMetadataJson: NOTE_METADATA,
            ...(kind === "edit"
              ? {
                  note: "Called after lunch.",
                  editedAt: "2026-08-29T06:00:00.000Z",
                }
              : {}),
          },
          dependsOn: [],
        },
      ],
    },
    registry: PEOPLE_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [
      {
        identity:
          kind === "edit"
            ? PEOPLE_EVRY_EDIT_NOTE_IDENTITY
            : PEOPLE_EVRY_DELETE_NOTE_IDENTITY,
      },
    ],
  });
}

test("People selection is closed, deterministic, and serialization-stable", () => {
  const selections = [
    selectPeopleEvryRequest("List people"),
    selectPeopleEvryRequest("Find people named Ada"),
    selectPeopleEvryRequest("Add note: Called today"),
    selectPeopleEvryRequest(`Edit note ${ACTIVITY_ID}: Called tomorrow`),
    selectPeopleEvryRequest(`Delete note ${ACTIVITY_ID}`),
    selectPeopleEvryRequest("Show this person's activity"),
    selectPeopleEvryRequest(
      "Show more activity before 2026-08-29T06:00:00.000Z"
    ),
  ];
  assert.deepEqual(selections, [
    { kind: "list_people", search: "" },
    { kind: "list_people", search: "Ada" },
    { kind: "add_note", note: "Called today" },
    {
      kind: "edit_note",
      activityId: ACTIVITY_ID,
      note: "Called tomorrow",
    },
    { kind: "delete_note", activityId: ACTIVITY_ID },
    { kind: "list_activity", cursor: null },
    { kind: "list_activity", cursor: "2026-08-29T06:00:00.000Z" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(selections)), selections);
  assert.equal(selectPeopleEvryRequest("Delete every record"), null);
  assert.equal(selectPeopleEvryRequest("Fetch https://example.com"), null);
});

test("edit and delete note plans freeze exact baselines and reject extra fields", () => {
  for (const kind of ["edit", "delete"] as const) {
    const identity =
      kind === "edit"
        ? PEOPLE_EVRY_EDIT_NOTE_IDENTITY
        : PEOPLE_EVRY_DELETE_NOTE_IDENTITY;
    const registration = PEOPLE_EVRY_PLAN_REGISTRY.registrationFor(identity);
    const args = noteChangeDocument(kind).steps[0]?.arguments;
    assert.ok(registration);
    assert.equal(registration.argumentsSchema.safeParse(args).success, true);
    assert.equal(
      registration.argumentsSchema.safeParse({ ...args, churchId: PERSON_ID })
        .success,
      false
    );
    assert.equal(
      registration.argumentsSchema.safeParse({
        ...args,
        expectedMetadataJson: JSON.stringify({ note: "Changed" }),
      }).success,
      true,
      "a changed baseline is schema-valid but produces a different fingerprint"
    );
    const changed = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: `${kind}-note`,
            capabilityIdentity: identity,
            arguments: {
              ...args,
              expectedMetadataJson: JSON.stringify({ note: "Changed" }),
            },
            dependsOn: [],
          },
        ],
      },
      registry: PEOPLE_EVRY_PLAN_REGISTRY,
      eligibleCapabilities: [{ identity }],
    });
    assert.notEqual(
      fingerprintEvryActionPlanIntent({
        actorUserId: PERSON_ID,
        plantId: PLAN_ID,
        document: noteChangeDocument(kind),
      }),
      fingerprintEvryActionPlanIntent({
        actorUserId: PERSON_ID,
        plantId: PLAN_ID,
        document: changed,
      })
    );
  }
});

test("the note plan accepts only its exact immutable argument object", () => {
  const plan = PEOPLE_EVRY_PLAN_REGISTRY.registrationFor(
    PEOPLE_EVRY_ADD_NOTE_IDENTITY
  );
  assert.ok(plan);
  const args = addNoteDocument().steps[0]?.arguments;
  assert.equal(plan.argumentsSchema.safeParse(args).success, true);
  assert.equal(
    plan.argumentsSchema.safeParse({ ...args, foreignPlantId: PERSON_ID })
      .success,
    false
  );
  assert.equal(
    plan.argumentsSchema.safeParse({ ...args, note: " " }).success,
    false
  );
});

test("trusted edit and destructive delete reviews bind complete note disclosure", () => {
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: PLAN_ID,
    fingerprint: FINGERPRINT,
  });
  const edit = trustedReviewForEvryPlanDocument({
    plan,
    document: noteChangeDocument("edit"),
    reviewRegistry: PEOPLE_EVRY_REVIEW_REGISTRY,
  });
  const deletion = trustedReviewForEvryPlanDocument({
    plan,
    document: noteChangeDocument("delete"),
    reviewRegistry: PEOPLE_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(edit);
  assert.ok(deletion);
  assert.deepEqual(edit.confirmation.steps[0]?.beforeAfter, [
    {
      label: "Note",
      before: "Called before lunch.",
      after: "Called after lunch.",
      count: 1,
    },
  ]);
  assert.equal(deletion.confirmation.steps[0]?.effectKind, "destructive");
  assert.equal(deletion.confirmation.steps[0]?.reversibility, "irreversible");
  assert.deepEqual(deletion.confirmation.steps[0]?.contentPreviews, [
    { label: "Note to delete", content: "Called before lunch." },
  ]);
  assert.deepEqual(deletion.confirmation.steps[0]?.beforeAfter, [
    {
      label: "Note",
      before: "Called before lunch.",
      after: "Deleted",
      count: 1,
    },
  ]);
  for (const review of [edit.confirmation, deletion.confirmation]) {
    assert.deepEqual(
      evryDetailedConfirmationArtifactDocumentSchema.parse(
        JSON.parse(JSON.stringify(review))
      ),
      review
    );
  }
});

test("trusted note review derives every material field from plan arguments", () => {
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: PLAN_ID,
      fingerprint: FINGERPRINT,
    }),
    document: addNoteDocument(),
    reviewRegistry: PEOPLE_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  assert.deepEqual(review.confirmation, {
    kind: "confirmation",
    artifactVersion: 1,
    plan: { planId: PLAN_ID, fingerprint: FINGERPRINT },
    title: "Add a note for Ada Lovelace",
    actionLabel: "Add note",
    consequences: ["This adds one note to the person’s activity timeline."],
    steps: [
      {
        stepId: "add-note",
        title: "Add activity note",
        effectKind: "other",
        reversibility: "reversible",
        resolvedTargets: [
          {
            label: "Person",
            value: "Ada Lovelace",
            sourceLink: {
              label: "Open Ada Lovelace",
              href: `/people/${PERSON_ID}`,
            },
          },
        ],
        counts: [{ label: "Notes to add", count: 1 }],
        exclusions: [],
        dateTime: null,
        contentPreviews: [
          { label: "Note", content: "Called and scheduled a follow-up." },
        ],
        beforeAfter: [],
      },
    ],
  });
  assert.deepEqual(
    evryDetailedConfirmationArtifactDocumentSchema.parse(
      JSON.parse(JSON.stringify(review.confirmation))
    ),
    review.confirmation
  );
});
