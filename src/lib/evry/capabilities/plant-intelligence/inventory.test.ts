import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPlantIntelligenceCapabilityInventoryCurrent,
  generatePlantIntelligenceCapabilityInventory,
} from "../../../../../ops/evry/plant-intelligence-inventory";
import {
  discoverPlantIntelligenceActionIdentities,
  discoverPlantIntelligenceRscOperations,
} from "../../../../../ops/evry/plant-intelligence-source-discovery";
import { PLANT_INTELLIGENCE_CAPABILITY_REGISTRY } from "./registrations";

test("Plant Intelligence generated inventory is current and zero-gap", async () => {
  const inventory = generatePlantIntelligenceCapabilityInventory(process.cwd());
  await assertPlantIntelligenceCapabilityInventoryCurrent(process.cwd());
  assert.deepEqual(inventory.summary, {
    actions: 4,
    routes: 1,
    rscOperations: 16,
    exclusions: 6,
    readCapabilities: 6,
    effectCapabilities: 5,
    unclassified: 0,
  });
  assert.equal(
    PLANT_INTELLIGENCE_CAPABILITY_REGISTRY.registrations().length,
    11
  );
  assert.equal(
    inventory.entries.filter(
      ({ classification }) => classification.state === "supported"
    ).length,
    PLANT_INTELLIGENCE_CAPABILITY_REGISTRY.registrations().reduce(
      (total, registration) => total + registration.surfaceIdentities.length,
      0
    )
  );
});

test("discovery reaches delegated source links and the first-view write", () => {
  const rsc = discoverPlantIntelligenceRscOperations();
  assert.ok(
    rsc.includes(
      "rsc-operation:src/components/phase-engine/insight-card.tsx → getPublishedArticleRefs"
    )
  );
  assert.ok(
    rsc.includes(
      "rsc-operation:src/app/(dashboard)/phase/page.tsx → markAssessmentSeenByPlanter"
    )
  );
  assert.deepEqual(discoverPlantIntelligenceActionIdentities(), [
    "action:src/app/(dashboard)/phase/actions.ts → transitionPhaseAction",
    "action:src/app/(dashboard)/phase/checkin-actions.ts → saveCheckinAction",
    "action:src/app/(dashboard)/phase/feedback-actions.ts → submitInsightFeedbackAction",
    "action:src/app/(dashboard)/phase/signals-actions.ts → setManualSignalAction",
  ]);
});
