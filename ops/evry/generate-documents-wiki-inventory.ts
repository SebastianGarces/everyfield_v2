import process from "node:process";

import {
  assertDocumentsWikiInventoryCurrent,
  generateDocumentsWikiInventory,
  writeDocumentsWikiInventory,
} from "./documents-wiki-inventory";

async function main() {
  const repoRoot = process.cwd();
  const inventory = generateDocumentsWikiInventory(repoRoot);
  if (process.argv.includes("--check")) {
    await assertDocumentsWikiInventoryCurrent(repoRoot, inventory);
  } else {
    await writeDocumentsWikiInventory(repoRoot, inventory);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
