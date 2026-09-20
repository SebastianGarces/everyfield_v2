import { existsSync } from "node:fs";
import { z } from "zod";
import inventory from "@/lib/evry/capabilities/inventory.generated.json";
import { createEveToolRegistry } from "@/lib/evry/eve/capabilities/registry";
import {
  EVE_CAPABILITY_CATALOG,
  EVE_WORKFLOW_COVERAGE,
} from "@/lib/evry/eve/capabilities/catalog";
import {
  evePreparations,
  evePreparationInputSchema,
} from "@/lib/evry/eve/preparation";
import { PRODUCTION_EVRY_EXECUTION_REGISTRY } from "@/lib/evry/capabilities/execution";
import { evryCapabilityRegistrationFor } from "@/lib/evry/eligibility/capabilities";

// Read-only audit of the actual Eve registry. It never invokes a reader, model or preparation.
const tools = createEveToolRegistry({
  context: {
    actor: { userId: "audit", plantId: "audit" },
    literalUserText: "",
    pageContext: null,
    now: new Date(0),
  },
  authorizeRead: async () => null,
  preparation: {
    inputSchema: evePreparationInputSchema,
    prepare: async () => {
      throw new Error("Audit cannot prepare actions");
    },
  },
}).describe();
const reads = tools.filter((entry) => entry.effect === "read");
const identities = [
  ...new Set(reads.flatMap((entry) => entry.capabilityIdentities ?? [])),
];
const effects = [
  ...new Set(
    evePreparations.flatMap((entry) => [...entry.capabilityIdentities])
  ),
];
const families = inventory.capabilities
  .filter((entry) => entry.classification.state === "supported")
  .map((family) => {
    const modelReads = reads.filter((read) =>
      read.capabilityIdentities?.some(
        (id) =>
          evryCapabilityRegistrationFor(id)?.parityCapability === family.id
      )
    );
    const confirmedEffects = effects.filter(
      (id) =>
        evryCapabilityRegistrationFor(id)?.parityCapability === family.id &&
        PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(id)
    );
    return {
      family: family.id,
      modelReadCount: modelReads.length,
      modelReads: modelReads.map((entry) => entry.name),
      confirmedEffects,
      coverage:
        "Declared contracts only; natural-language completeness requires evaluated questions.",
    };
  });
const checks = {
  proposedContractsRegistered: EVE_CAPABILITY_CATALOG.every(([name]) =>
    tools.some((entry) => entry.name === name)
  ),
  uniqueToolNames:
    new Set(tools.map((entry) => entry.name)).size === tools.length,
  authorizedReadPaths: identities.every(
    (id) => evryCapabilityRegistrationFor(id)?.operationKind === "read"
  ),
  noReadIsAnEffect: identities.every(
    (id) => !PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(id)
  ),
  uniquePreparationIds:
    new Set(evePreparations.map((entry) => entry.id)).size ===
    evePreparations.length,
  authorizedPreparations: effects.every(
    (id) => evryCapabilityRegistrationFor(id)?.operationKind === "effect"
  ),
  skillsExist: EVE_WORKFLOW_COVERAGE.every((entry) =>
    existsSync(`agent/skills/${entry.name}/SKILL.md`)
  ),
  skillToolsRegistered: EVE_WORKFLOW_COVERAGE.every((entry) =>
    entry.tools.every((name) => tools.some((tool) => tool.name === name))
  ),
  noModelConfirmationTool: !tools.some((entry) =>
    /execute|confirm|commit|send$/.test(entry.name)
  ),
};
const summary = {
  runtime: "eve",
  checks,
  proposedContracts: EVE_CAPABILITY_CATALOG.map(([name]) => name),
  registeredReadCount: reads.length,
  authorizedReadPathCount: identities.length,
  typedPreparationCount: evePreparations.length,
  skillIds: EVE_WORKFLOW_COVERAGE.map((entry) => entry.name),
  liveQuestionEvaluation: "not_run",
  parityClaim:
    "No legacy-runtime or natural-language parity inferred from registration counts.",
};
console.log(
  JSON.stringify(
    process.argv.includes("--summary")
      ? summary
      : {
          ...summary,
          families,
          workflows: EVE_WORKFLOW_COVERAGE,
          tools: tools.map((entry) => ({
            ...entry,
            inputSchema: z.toJSONSchema(entry.inputSchema, { io: "input" }),
          })),
          preparations: evePreparations.map((entry) => ({
            id: entry.id,
            capabilityIdentities: entry.capabilityIdentities,
            schema: z.toJSONSchema(entry.inputSchema, { io: "input" }),
          })),
        },
    null,
    2
  )
);
if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
if (
  process.argv.includes("--require-all-families") &&
  families.some(
    (entry) => entry.modelReadCount === 0 && entry.confirmedEffects.length === 0
  )
)
  process.exitCode = 1;
