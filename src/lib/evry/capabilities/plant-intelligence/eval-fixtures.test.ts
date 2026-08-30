import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  eligibleEvryCapabilitiesFor,
  evryCapabilityRegistrationFor,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { EVRY_CAPABILITY_EVAL_LAYERS } from "@/lib/evry/evals/contracts";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";

import inventory from "./inventory.generated.json";
import {
  acknowledgeArgumentsSchema,
  attestationArgumentsSchema,
  checkinArgumentsSchema,
  feedbackArgumentsSchema,
  selectPlantIntelligenceEvryEffect,
  transitionArgumentsSchema,
} from "./effects";
import { PLANT_INTELLIGENCE_CAPABILITY_REGISTRATIONS } from "./registrations";
import { selectPlantIntelligenceEvryRead } from "./reads";
import { continuePlantIntelligenceEvryConversation } from "./conversation";
import {
  PLANT_INTELLIGENCE_EXECUTION_REGISTRY,
  PLANT_INTELLIGENCE_PLAN_REGISTRY,
  PLANT_INTELLIGENCE_REVIEW_REGISTRY,
} from "./runtime";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_PLAN_REGISTRY,
  PRODUCTION_EVRY_REVIEW_REGISTRY,
} from "../production";

const ID = "10000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000001";
const NOW = "2030-01-02T03:04:05.000Z";
const OWNER = { userId: ID, plantId: OTHER, seat: "owner" } as EvryPlantActor;
const MEMBER = { ...OWNER, seat: "member" } as EvryPlantActor;

const READ_COMMANDS: Readonly<Record<string, string>> = {
  "plant-intelligence.assessments.read": "show plant intelligence assessment",
  "plant-intelligence.attestations.read":
    "show plant intelligence attestations",
  "plant-intelligence.checkins.read": "show plant intelligence check-ins",
  "plant-intelligence.declarations.read":
    "show plant intelligence phase history",
  "plant-intelligence.feedback.read": "show plant intelligence feedback",
  "plant-intelligence.signals.read": "show plant intelligence signals",
};

const EFFECT_COMMANDS: Readonly<Record<string, string>> = {
  "plant-intelligence.declarations.transition":
    'plant intelligence declare-phase {"toPhase":3,"reason":"Exact reason"}',
  "plant-intelligence.assessments.acknowledge": `plant intelligence acknowledge-assessment {"assessmentId":"${ID}"}`,
  "plant-intelligence.attestations.set":
    'plant intelligence set-attestation {"signalKey":"values_documented","value":true}',
  "plant-intelligence.feedback.submit": `plant intelligence submit-feedback {"insightId":"${ID}","rating":"useful","comment":"Exact comment"}`,
  "plant-intelligence.checkins.save":
    'plant intelligence save-checkin {"spiritually":"steady","marriageFamily":"strained","financially":"steady","pace":"struggling","note":"Exact private note"}',
};

function argumentsFor(identity: string): Record<string, unknown> {
  switch (identity) {
    case "plant-intelligence.declarations.transition":
      return transitionArgumentsSchema.parse({
        expected: { currentPhase: 2 },
        toPhase: 3,
        reason: "Exact reason",
      });
    case "plant-intelligence.assessments.acknowledge":
      return acknowledgeArgumentsSchema.parse({
        expected: { id: ID, generatedAt: NOW, planterSeenAt: null },
      });
    case "plant-intelligence.attestations.set":
      return attestationArgumentsSchema.parse({
        signalKey: "values_documented",
        expected: null,
        value: true,
      });
    case "plant-intelligence.feedback.submit":
      return feedbackArgumentsSchema.parse({
        insight: {
          id: ID,
          assessmentId: OTHER,
          rubricVersion: "v1",
          title: "Stored insight",
        },
        expected: null,
        rating: "useful",
        comment: "Exact comment",
      });
    case "plant-intelligence.checkins.save":
      return checkinArgumentsSchema.parse({
        weekStart: "2030-01-01",
        expected: null,
        spiritually: "steady",
        marriageFamily: "strained",
        financially: "steady",
        pace: "struggling",
        note: "Exact private note",
      });
    default:
      throw new Error(`No fixture arguments for ${identity}`);
  }
}

function confirmationFor(identity: string) {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity,
          capabilityIdentity: identity,
          arguments: argumentsFor(identity),
          dependsOn: [],
        },
      ],
    },
    registry: PLANT_INTELLIGENCE_PLAN_REGISTRY,
    eligibleCapabilities: PLANT_INTELLIGENCE_CAPABILITY_REGISTRATIONS,
  });
  return trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: ID,
      fingerprint: "0".repeat(64),
    }),
    document,
    reviewRegistry: PLANT_INTELLIGENCE_REVIEW_REGISTRY,
  });
}

function deterministicProof(identity: string, layer: string) {
  const capability = inventory.capabilities.find(
    (candidate) => candidate.identity === identity
  );
  assert.ok(capability);
  const registration = evryCapabilityRegistrationFor(identity);
  assert.ok(registration);
  const readCommand = READ_COMMANDS[identity];
  const effectCommand = EFFECT_COMMANDS[identity];
  if (layer === "policy") {
    assert.equal(registration.parityCapability, "plant-intelligence");
    const source = ["reads.ts", "effects.ts"]
      .map((file) =>
        readFileSync(
          `src/lib/evry/capabilities/plant-intelligence/${file}`,
          "utf8"
        )
      )
      .join("\n");
    assert.doesNotMatch(
      source,
      /judge\/|generateAssessment|selectPlantsForAssessment|openai|anthropic/i
    );
    assert.equal(
      selectPlantIntelligenceEvryRead("is our church spiritually healthy?"),
      null
    );
  } else if (layer === "selection") {
    const selected = readCommand
      ? selectPlantIntelligenceEvryRead(readCommand)
      : selectPlantIntelligenceEvryEffect(effectCommand!);
    assert.ok(selected);
  } else if (layer === "arguments") {
    if (effectCommand) {
      const args = argumentsFor(identity);
      assert.equal(
        PLANT_INTELLIGENCE_PLAN_REGISTRY.registrationFor(
          identity
        )?.argumentsSchema.safeParse(args).success,
        true
      );
      assert.equal(
        PLANT_INTELLIGENCE_PLAN_REGISTRY.registrationFor(
          identity
        )?.argumentsSchema.safeParse({ ...args, plantId: OTHER }).success,
        false
      );
    } else {
      const selected = selectPlantIntelligenceEvryRead(readCommand!);
      assert.ok(selected);
      assert.equal(Object.hasOwn(selected.input, "plantId"), false);
    }
  } else if (layer === "permission") {
    assert.equal(
      eligibleEvryCapabilitiesFor(OWNER).some(
        (candidate) => candidate.identity === identity
      ),
      true
    );
    assert.equal(
      eligibleEvryCapabilitiesFor(MEMBER).some(
        (candidate) => candidate.identity === identity
      ),
      identity === "plant-intelligence.feedback.submit"
    );
  } else if (layer === "confirmation") {
    assert.equal(
      effectCommand
        ? Boolean(confirmationFor(identity))
        : PLANT_INTELLIGENCE_PLAN_REGISTRY.registrationFor(identity) === null,
      true
    );
  } else if (layer === "execution") {
    assert.equal(
      Boolean(PLANT_INTELLIGENCE_EXECUTION_REGISTRY.registrationFor(identity)),
      Boolean(effectCommand)
    );
  } else if (layer === "idempotency") {
    const first = readCommand
      ? selectPlantIntelligenceEvryRead(readCommand)
      : selectPlantIntelligenceEvryEffect(effectCommand!);
    const second = readCommand
      ? selectPlantIntelligenceEvryRead(readCommand)
      : selectPlantIntelligenceEvryEffect(effectCommand!);
    assert.deepEqual(first, second);
  } else if (layer === "errors") {
    assert.equal(
      selectPlantIntelligenceEvryEffect(
        'plant intelligence set-attestation {"signalKey":"forged","value":true}'
      ),
      null
    );
  } else {
    if (effectCommand) {
      const review = confirmationFor(identity);
      assert.equal(
        review?.confirmation.steps[0]?.resolvedTargets[0]?.sourceLink?.href,
        "/phase"
      );
    } else {
      assert.ok(selectPlantIntelligenceEvryRead(readCommand!));
    }
  }
}

for (const capability of inventory.capabilities) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    if (["tenancy", "execution", "idempotency", "errors"].includes(layer))
      continue;
    test(`${capability.identity}:${layer}`, () =>
      deterministicProof(capability.identity, layer));
  }
}

test("literal effect payloads survive classifier parsing exactly", () => {
  const literal = "  Exact Ḱ payload 😀  ";
  assert.deepEqual(
    selectPlantIntelligenceEvryEffect(
      `plant intelligence submit-feedback {"insightId":"${ID}","rating":"useful","comment":${JSON.stringify(literal)}}`
    ),
    { kind: "feedback", insightId: ID, rating: "useful", comment: literal }
  );
});

test("every generated capability binds exactly ten eval layers", async () => {
  const { PLANT_INTELLIGENCE_EVAL_FIXTURES } = await import("./eval-fixtures");
  assert.equal(PLANT_INTELLIGENCE_EVAL_FIXTURES.length, 11);
  for (const fixture of PLANT_INTELLIGENCE_EVAL_FIXTURES)
    assert.deepEqual(
      Object.keys(fixture.cases).toSorted(),
      [...EVRY_CAPABILITY_EVAL_LAYERS].toSorted()
    );
});

test("the production route owns every Plant Intelligence selector and effect boundary", () => {
  for (const capability of inventory.capabilities) {
    if (capability.operationKind !== "effect") continue;
    assert.ok(
      PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(capability.identity)
    );
    assert.ok(
      PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(capability.identity)
    );
    const document = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: capability.identity,
            capabilityIdentity: capability.identity,
            arguments: argumentsFor(capability.identity),
            dependsOn: [],
          },
        ],
      },
      registry: PRODUCTION_EVRY_PLAN_REGISTRY,
      eligibleCapabilities: PLANT_INTELLIGENCE_CAPABILITY_REGISTRATIONS,
    });
    assert.ok(PRODUCTION_EVRY_REVIEW_REGISTRY.registrationFor(document));
  }
  for (const command of [
    ...Object.values(READ_COMMANDS),
    ...Object.values(EFFECT_COMMANDS),
  ]) {
    assert.equal(
      continuePlantIntelligenceEvryConversation.matches({
        literalUserText: command,
        pageContext: null,
      } as never),
      true
    );
  }
});
