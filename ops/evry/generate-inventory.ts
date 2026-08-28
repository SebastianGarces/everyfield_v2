import {
  assertParityInventoryCurrent,
  generateParityInventory,
  writeParityInventory,
} from "./inventory";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const inventory = await generateParityInventory(repoRoot);
  const check = process.argv.includes("--check");

  if (check) await assertParityInventoryCurrent(repoRoot, inventory);
  else await writeParityInventory(repoRoot, inventory);

  const verb = check ? "verified" : "generated";
  const { routes, actions, supported, excluded, unreachable } =
    inventory.summary;
  process.stdout.write(
    `Evry parity inventory ${verb}: ${routes} routes, ${actions} actions; ${supported} supported, ${excluded} excluded, ${unreachable} unreachable, 0 unclassified.\n`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
