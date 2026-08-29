import {
  assertTaskCapabilityInventoryCurrent,
  generateTaskCapabilityInventory,
  writeTaskCapabilityInventory,
} from "./tasks-inventory";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const inventory = generateTaskCapabilityInventory(repoRoot);
  const check = process.argv.includes("--check");
  if (check) {
    await assertTaskCapabilityInventoryCurrent(repoRoot, inventory);
  } else {
    await writeTaskCapabilityInventory(repoRoot, inventory);
  }
  const summary = inventory.summary;
  process.stdout.write(
    `Task capability inventory ${check ? "verified" : "generated"}: ${summary.actions} actions, ${summary.routes} routes, ${summary.rscReads} page operations (${summary.exclusions} exclusions), ${summary.readCapabilities} read and ${summary.effectCapabilities} effect capabilities; 0 unclassified.\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
