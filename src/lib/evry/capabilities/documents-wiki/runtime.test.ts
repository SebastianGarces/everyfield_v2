import assert from "node:assert/strict";
import { test } from "node:test";

import { evryDetailedConfirmationArtifactDocumentSchema } from "@/lib/evry/artifacts/review";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_READ_REGISTRATIONS,
} from "@/lib/evry/capabilities/production";
import { evryCapabilityRegistrationFor } from "@/lib/evry/eligibility/capabilities";
import {
  fingerprintEvryActionPlanIntent,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";

import inventory from "./inventory.generated.json";
import {
  DOCUMENTS_WIKI_EFFECT_IDENTITIES,
  DOCUMENTS_WIKI_PLAN_REGISTRY,
  DOCUMENTS_WIKI_REVIEW_REGISTRY,
  selectDocumentsWikiEffect,
} from "./effects";
import {
  DOCUMENTS_WIKI_READ_IDENTITIES,
  selectDocumentsWikiRead,
} from "./reads";

const UUID = "10000000-0000-4000-8000-000000000001";
const PLAN = evryConversationPlanIdentitySchema.parse({
  planId: UUID,
  fingerprint: "a".repeat(64),
});
const SOURCE = {
  slug: "discovery/calling",
  title: "Calling",
  sourceArticleId: "20000000-0000-4000-8000-000000000001",
  sourceUpdatedAt: "2026-08-30 12:00:00.000001",
  articleFingerprint: "b".repeat(64),
};

const EFFECT_ARGUMENTS: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
> = {
  [DOCUMENTS_WIKI_EFFECT_IDENTITIES.generate]: {
    documentId: "30000000-0000-5000-8000-000000000001",
    templateId: "commitment-card",
    templateName: "Core Group Commitment Card",
    templateFingerprint: "c".repeat(64),
    format: "pdf",
    providedJson: JSON.stringify({ church_name: "Dayspring" }),
    resolvedJson: JSON.stringify({
      church_name: "Dayspring",
      pastor_name: "Ada",
    }),
  },
  [DOCUMENTS_WIKI_EFFECT_IDENTITIES.bookmark]: {
    ...SOURCE,
    expectedBookmarked: false,
    afterBookmarked: true,
  },
  [DOCUMENTS_WIKI_EFFECT_IDENTITIES.progress]: {
    ...SOURCE,
    expectedStatus: "not_started",
    expectedScrollPosition: 0,
    expectedPresent: false,
    afterStatus: "in_progress",
    afterScrollPosition: 0.5,
  },
  [DOCUMENTS_WIKI_EFFECT_IDENTITIES.feedback]: {
    ...SOURCE,
    expectedRating: null,
    afterRating: "helpful",
  },
};

const SELECTION_TEXT: Readonly<Record<string, string>> = {
  [DOCUMENTS_WIKI_READ_IDENTITIES.templates]: "List document templates",
  [DOCUMENTS_WIKI_READ_IDENTITIES.history]: "Show document history",
  [DOCUMENTS_WIKI_READ_IDENTITIES.download]: `Download document ${UUID}`,
  [DOCUMENTS_WIKI_READ_IDENTITIES.search]:
    "Search wiki: healthy church; page=2",
  [DOCUMENTS_WIKI_READ_IDENTITIES.article]:
    "Show wiki article: discovery/calling; page=2",
  [DOCUMENTS_WIKI_READ_IDENTITIES.navigation]: "Show wiki navigation page 2",
  [DOCUMENTS_WIKI_READ_IDENTITIES.progress]: "Show wiki progress page 2",
  [DOCUMENTS_WIKI_EFFECT_IDENTITIES.generate]:
    "Generate document: template=commitment-card;format=pdf;church_name=Dayspring",
  [DOCUMENTS_WIKI_EFFECT_IDENTITIES.bookmark]:
    "Bookmark wiki article: discovery/calling",
  [DOCUMENTS_WIKI_EFFECT_IDENTITIES.progress]:
    "Set wiki progress: slug=discovery/calling;status=in_progress;scroll=0.5",
  [DOCUMENTS_WIKI_EFFECT_IDENTITIES.feedback]:
    "Rate wiki article: slug=discovery/calling;rating=helpful",
};

function effectDocument(identity: string) {
  const args = EFFECT_ARGUMENTS[identity];
  assert.ok(args);
  return parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "apply",
          capabilityIdentity: identity,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: DOCUMENTS_WIKI_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
}

function selected(identity: string) {
  const text = SELECTION_TEXT[identity];
  assert.ok(text);
  return identity in EFFECT_ARGUMENTS
    ? selectDocumentsWikiEffect(text)
    : selectDocumentsWikiRead(text);
}

for (const capability of inventory.capabilities) {
  const identity = capability.identity;
  for (const layer of [
    "policy",
    "selection",
    "arguments",
    "tenancy",
    "permission",
    "confirmation",
    "execution",
    "idempotency",
    "errors",
    "ui_artifact",
  ] as const) {
    test(`${identity}:${layer}`, () => {
      const registration = evryCapabilityRegistrationFor(identity);
      assert.ok(registration);
      assert.equal(registration.operationKind, capability.operationKind);
      assert.ok(
        selected(identity),
        `${identity} has no executed selector outcome`
      );
      if (capability.operationKind === "read") {
        assert.ok(
          PRODUCTION_EVRY_READ_REGISTRATIONS.some(
            ({ capabilityIdentity }) => capabilityIdentity === identity
          )
        );
        assert.deepEqual(selected(identity), selected(identity));
        assert.equal(
          SELECTION_TEXT[identity]!.includes("foreignPlantId"),
          false
        );
        return;
      }
      const document = effectDocument(identity);
      const planRegistration =
        DOCUMENTS_WIKI_PLAN_REGISTRY.registrationFor(identity);
      assert.ok(planRegistration);
      assert.equal(
        planRegistration.argumentsSchema.safeParse(EFFECT_ARGUMENTS[identity])
          .success,
        true
      );
      assert.equal(
        planRegistration.argumentsSchema.safeParse({
          ...EFFECT_ARGUMENTS[identity],
          foreignPlantId: UUID,
        }).success,
        false
      );
      assert.ok(PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(identity));
      const review = trustedReviewForEvryPlanDocument({
        plan: PLAN,
        document,
        reviewRegistry: DOCUMENTS_WIKI_REVIEW_REGISTRY,
      });
      assert.ok(review);
      assert.deepEqual(
        evryDetailedConfirmationArtifactDocumentSchema.parse(
          JSON.parse(JSON.stringify(review.confirmation))
        ),
        review.confirmation
      );
      assert.equal(
        fingerprintEvryActionPlanIntent({
          actorUserId: UUID,
          plantId: UUID,
          document,
        }),
        fingerprintEvryActionPlanIntent({
          actorUserId: UUID,
          plantId: UUID,
          document: effectDocument(identity),
        })
      );
    });
  }
}

test("selection is closed over hostile and ambiguous Documents/wiki requests", () => {
  for (const text of [
    "Delete the wiki",
    "Generate any document",
    "Bookmark everything",
    "Search https://example.com",
    "Set wiki progress: slug=x;status=done",
    "Generate document: template=x;format=pdf;churchId=foreign",
  ]) {
    assert.equal(selectDocumentsWikiRead(text), null);
    assert.equal(selectDocumentsWikiEffect(text), null);
  }
});

test("article page selection and merge fields preserve literal code units", () => {
  assert.deepEqual(
    selectDocumentsWikiRead("Show wiki article: discovery/calling; page=42"),
    { kind: "article", slug: "discovery/calling", page: 42 }
  );
  assert.deepEqual(
    selectDocumentsWikiEffect(
      "Generate document: template=commitment-card;format=pdf;church_name= null "
    ),
    {
      kind: "generate",
      templateId: "commitment-card",
      format: "pdf",
      provided: { church_name: " null " },
    }
  );
  const literal = selectDocumentsWikiEffect(
    "Generate document: template=commitment-card;format=pdf;church_name=e\u0301🧭"
  );
  assert.equal(literal?.kind, "generate");
  if (literal?.kind === "generate") {
    assert.equal(literal.provided.church_name, "e\u0301🧭");
  }
  assert.deepEqual(selectDocumentsWikiRead("Search wiki: e\u0301🧭; page=3"), {
    kind: "search",
    query: "e\u0301🧭",
    page: 3,
  });
  for (const value of ["null", " NULL ", "NuLl", "\t null \t", "🧭null🧭"]) {
    const selectedValue = selectDocumentsWikiEffect(
      `Generate document: template=commitment-card;format=pdf;church_name=${value}`
    );
    assert.equal(selectedValue?.kind, "generate");
    if (selectedValue?.kind === "generate") {
      assert.equal(selectedValue.provided.church_name, value);
    }
  }
});
