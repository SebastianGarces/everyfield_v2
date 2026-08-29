import {
  assertPeopleCapabilityInventoryCurrent,
  generatePeopleCapabilityInventory,
  writePeopleCapabilityInventory,
} from "./people-inventory";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const inventory = generatePeopleCapabilityInventory(repoRoot);
  const check = process.argv.includes("--check");

  if (check) {
    await assertPeopleCapabilityInventoryCurrent(repoRoot, inventory);
  } else {
    await writePeopleCapabilityInventory(repoRoot, inventory);
  }

  const verb = check ? "verified" : "generated";
  const summary = inventory.summary;
  process.stdout.write(
    `People capability inventory ${verb}: ${summary.actions} actions, ${summary.routes} routes, ${summary.routeHandlers} handlers, ${summary.rscReads} RSC reads, ${summary.productGaps} product gap; ${summary.readCapabilities} read and ${summary.effectCapabilities} effect capabilities; 0 unclassified.\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
