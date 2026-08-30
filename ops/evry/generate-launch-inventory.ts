import {
  assertLaunchCapabilityInventoryCurrent,
  generateLaunchCapabilityInventory,
  writeLaunchCapabilityInventory,
} from "./launch-inventory";

async function main() {
  const inventory = generateLaunchCapabilityInventory(process.cwd());
  if (process.argv.includes("--check")) {
    await assertLaunchCapabilityInventoryCurrent(process.cwd());
  } else {
    await writeLaunchCapabilityInventory(process.cwd());
  }
  process.stdout.write(
    `Launch inventory: ${inventory.summary.actions} actions, ${inventory.summary.routes} route, ${inventory.summary.rscOperations} RSC operations, ${inventory.summary.unclassified} unclassified.\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
