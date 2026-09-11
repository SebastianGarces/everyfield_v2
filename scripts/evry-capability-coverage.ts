import { z } from "zod";
import inventory from "@/lib/evry/capabilities/inventory.generated.json";
import {
  PRODUCTION_EVRY_MODEL_READS,
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_ARTIFACT_REVIEWS,
  PRODUCTION_EVRY_MODEL_PREPARATIONS,
} from "@/lib/evry/capabilities/production";
import { EVRY_READ_WORKFLOWS } from "@/lib/evry/recipes/read-workflows";
import { evryCapabilityRegistrationFor } from "@/lib/evry/eligibility/capabilities";
import { PEOPLE_QUERY_READS } from "@/lib/evry/capabilities/queries/people";
import { OPERATIONS_QUERY_READS } from "@/lib/evry/capabilities/queries/operations";
import { CONTENT_QUERY_READS } from "@/lib/evry/capabilities/queries/content";

// Read-only, provider-free audit of what the deployed composition actually exposes.
// node --import tsx --env-file=.env.local scripts/evry-capability-coverage.ts
const families = inventory.capabilities.filter(
  (family) => family.classification.state === "supported"
);
const report = families.map((family) => {
  const surfaces = inventory.entries.filter(
    (entry) => entry.parityCapability === family.id
  );
  const reads = PRODUCTION_EVRY_MODEL_READS.filter(
    (read) =>
      evryCapabilityRegistrationFor(read.capabilityIdentity)
        ?.parityCapability === family.id
  ).map((read) => ({
    id: read.id,
    schema: z.toJSONSchema(read.inputSchema, { unrepresentable: "any" }),
  }));
  const effects = PRODUCTION_EVRY_ARTIFACT_REVIEWS.flatMap(({ source }) =>
    source.kind === "generic" ? [...source.capabilityIdentities] : []
  ).filter(
    (identity) =>
      evryCapabilityRegistrationFor(identity)?.parityCapability === family.id &&
      PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(identity)
  );
  return {
    family: family.id,
    declaredSurfaces: surfaces.length,
    modelReadCount: reads.length,
    modelReads: reads,
    confirmedEffectCount: effects.length,
    confirmedEffects: effects,
    // A source declaration is not evidence of natural-language execution parity.
    coverage: reads.length
      ? "partial: verify filters and workflows"
      : effects.length
        ? "effect-only: verify natural-language preparation"
        : "missing reads and effects",
  };
});
const proposedReads = [
  ...PEOPLE_QUERY_READS,
  ...OPERATIONS_QUERY_READS,
  ...CONTENT_QUERY_READS,
];
const audit = {
  schemaVersion: 1,
  checks: {
    proposedContractsRegistered:
      proposedReads.length === 22 &&
      proposedReads.every((read) =>
        PRODUCTION_EVRY_MODEL_READS.some(
          (registered) =>
            registered.id === read.id &&
            registered.capabilityIdentity === read.capabilityIdentity &&
            registered.inputSchema === read.inputSchema
        )
      ) &&
      PRODUCTION_EVRY_MODEL_PREPARATIONS.length > 0,
    allEightRecipesRegistered:
      EVRY_READ_WORKFLOWS.length === 7 &&
      PRODUCTION_EVRY_MODEL_PREPARATIONS.some(
        (entry) => entry.id === "recipe.meeting-invite"
      ),
    uniquePreparationIds:
      new Set(PRODUCTION_EVRY_MODEL_PREPARATIONS.map((entry) => entry.id))
        .size === PRODUCTION_EVRY_MODEL_PREPARATIONS.length,
    authorizedPreparations: PRODUCTION_EVRY_MODEL_PREPARATIONS.every(
      (entry) =>
        entry.capabilityIdentities.length > 0 &&
        entry.capabilityIdentities.every(
          (id) => evryCapabilityRegistrationFor(id)?.operationKind === "effect"
        )
    ),
    uniqueModelReadIds:
      new Set(PRODUCTION_EVRY_MODEL_READS.map((r) => r.id)).size ===
      PRODUCTION_EVRY_MODEL_READS.length,
    authorizedModelReads: PRODUCTION_EVRY_MODEL_READS.every(
      (r) =>
        evryCapabilityRegistrationFor(r.capabilityIdentity)?.operationKind ===
        "read"
    ),
    noReadIsAnEffect: PRODUCTION_EVRY_MODEL_READS.every(
      (r) =>
        !PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(
          r.capabilityIdentity
        )
    ),
  },
  families: report,
  proposedContracts: [
    ...proposedReads.map((read) => read.id),
    "actions.prepare",
  ],
  preparations: PRODUCTION_EVRY_MODEL_PREPARATIONS.map((entry) => ({
    id: entry.id,
    capabilityIdentities: entry.capabilityIdentities,
    schema: z.toJSONSchema(entry.inputSchema, { unrepresentable: "any" }),
  })),
  recipes: [
    ...EVRY_READ_WORKFLOWS.map((entry) => ({
      id: entry.id,
      kind: "read-workflow",
      description: entry.description,
      readIds: entry.readIds,
      schema: z.toJSONSchema(entry.inputSchema, { unrepresentable: "any" }),
    })),
    {
      id: "meeting-invite",
      kind: "confirmed-effect-recipe",
      preparation: "recipe.meeting-invite",
    },
  ],
};
const compactCatalog = [
  ...PRODUCTION_EVRY_MODEL_READS,
  ...PRODUCTION_EVRY_MODEL_PREPARATIONS,
].map((entry) => ({
  id: entry.id,
  description: entry.inputSchema.description?.slice(0, 500),
}));
console.log(
  JSON.stringify(
    process.argv.includes("--summary")
      ? {
          checks: audit.checks,
          proposedContracts: audit.proposedContracts,
          recipeIds: audit.recipes.map((entry) => entry.id),
          registeredReadCount: PRODUCTION_EVRY_MODEL_READS.length,
          typedPreparationCount: PRODUCTION_EVRY_MODEL_PREPARATIONS.length,
          initialCatalogCharacters: JSON.stringify(compactCatalog).length,
          allCatalogSchemasCharacters: JSON.stringify(
            [
              ...PRODUCTION_EVRY_MODEL_READS,
              ...PRODUCTION_EVRY_MODEL_PREPARATIONS,
            ].map((entry) =>
              z.toJSONSchema(entry.inputSchema, { unrepresentable: "any" })
            )
          ).length,
          liveQuestionEvaluation: "not_run",
        }
      : audit,
    null,
    2
  )
);
if (Object.values(audit.checks).some((passed) => !passed)) process.exitCode = 1;
if (
  process.argv.includes("--require-all-families") &&
  report.some((r) => r.modelReadCount === 0 && r.confirmedEffectCount === 0)
)
  process.exitCode = 1;
