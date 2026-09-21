import { readFile } from "node:fs/promises";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../src/db/schema";

// Prints reviewable SQL only. The release owner chooses the baseline snapshot
// and allocates a numbered migration after reviewing the complete schema.
async function main() {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) throw new Error("Pass the prior Drizzle snapshot path");
  const previous = JSON.parse(await readFile(snapshotPath, "utf8"));
  const statements = await generateMigration(
    previous,
    generateDrizzleJson(schema)
  );
  process.stdout.write(statements.join("\n--> statement-breakpoint\n") + "\n");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
