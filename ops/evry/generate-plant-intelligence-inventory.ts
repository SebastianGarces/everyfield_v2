import {
  assertPlantIntelligenceCapabilityInventoryCurrent,
  generatePlantIntelligenceCapabilityInventory,
  writePlantIntelligenceCapabilityInventory,
} from "./plant-intelligence-inventory";

async function main() {
  const inventory = generatePlantIntelligenceCapabilityInventory(process.cwd());
  if (process.argv.includes("--check"))
    await assertPlantIntelligenceCapabilityInventoryCurrent(process.cwd());
  else await writePlantIntelligenceCapabilityInventory(process.cwd());
  process.stdout.write(
    `Plant Intelligence inventory: ${inventory.summary.actions} actions, ${inventory.summary.routes} route, ${inventory.summary.rscOperations} RSC operations, ${inventory.summary.unclassified} unclassified.\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
