import { generatePlatformEvryInventory } from "./platform-inventory";

async function main(): Promise<void> {
  await generatePlatformEvryInventory({
    repoRoot: process.cwd(),
    check: process.argv.includes("--check"),
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
