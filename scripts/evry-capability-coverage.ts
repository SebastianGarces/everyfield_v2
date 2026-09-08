import { z } from "zod";
import inventory from "@/lib/evry/capabilities/inventory.generated.json";
import {
  PRODUCTION_EVRY_MODEL_READS,
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_ARTIFACT_REVIEWS,
} from "@/lib/evry/capabilities/production";
import { evryCapabilityRegistrationFor } from "@/lib/evry/eligibility/capabilities";

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
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      checks: {
        uniqueModelReadIds:
          new Set(PRODUCTION_EVRY_MODEL_READS.map((r) => r.id)).size ===
          PRODUCTION_EVRY_MODEL_READS.length,
        authorizedModelReads: PRODUCTION_EVRY_MODEL_READS.every(
          (r) =>
            evryCapabilityRegistrationFor(r.capabilityIdentity)
              ?.operationKind === "read"
        ),
        noReadIsAnEffect: PRODUCTION_EVRY_MODEL_READS.every(
          (r) =>
            !PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(
              r.capabilityIdentity
            )
        ),
      },
      families: report,
    },
    null,
    2
  )
);
if (
  process.argv.includes("--require-all-families") &&
  report.some((r) => r.modelReadCount === 0 && r.confirmedEffectCount === 0)
)
  process.exitCode = 1;
