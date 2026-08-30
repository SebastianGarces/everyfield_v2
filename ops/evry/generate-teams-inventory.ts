import {
  assertTeamsCapabilityInventoryCurrent,
  generateTeamsCapabilityInventory,
  writeTeamsCapabilityInventory,
} from "./teams-inventory";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const inventory = generateTeamsCapabilityInventory(repoRoot);
  const check = process.argv.includes("--check");
  if (check) await assertTeamsCapabilityInventoryCurrent(repoRoot, inventory);
  else await writeTeamsCapabilityInventory(repoRoot, inventory);
  const summary = inventory.summary;
  process.stdout.write(
    `Teams capability inventory ${check ? "verified" : "generated"}: ${summary.actions} actions, ${summary.routes} routes, ${summary.rscOperations} RSC operations; ${summary.readCapabilities} read and ${summary.effectCapabilities} effect capabilities; 0 unclassified.\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
