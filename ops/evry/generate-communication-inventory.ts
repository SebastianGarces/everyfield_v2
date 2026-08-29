import {
  assertCommunicationCapabilityInventoryCurrent,
  generateCommunicationCapabilityInventory,
  writeCommunicationCapabilityInventory,
} from "./communication-inventory";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const inventory = generateCommunicationCapabilityInventory(repoRoot);
  const check = process.argv.includes("--check");

  if (check) {
    await assertCommunicationCapabilityInventoryCurrent(repoRoot, inventory);
  } else {
    await writeCommunicationCapabilityInventory(repoRoot, inventory);
  }

  const verb = check ? "verified" : "generated";
  const summary = inventory.summary;
  process.stdout.write(
    `Communication capability inventory ${verb}: ${summary.actions} actions, ${summary.routes} routes, ${summary.rscReads} RSC reads, ${summary.externalExclusions} external exclusions, ${summary.productGaps} product gap; ${summary.readCapabilities} read and ${summary.effectCapabilities} effect capabilities; 0 unclassified.\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
