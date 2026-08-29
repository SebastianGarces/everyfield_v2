import {
  assertMeetingsCapabilityInventoryCurrent,
  generateMeetingsCapabilityInventory,
  writeMeetingsCapabilityInventory,
} from "./meetings-inventory";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const inventory = generateMeetingsCapabilityInventory();
  if (process.argv.includes("--check")) {
    await assertMeetingsCapabilityInventoryCurrent(repoRoot, inventory);
    return;
  }
  await writeMeetingsCapabilityInventory(repoRoot, inventory);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
