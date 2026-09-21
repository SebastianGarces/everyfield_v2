import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skills = Object.fromEntries(
  readdirSync(resolve(root, "agent/skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const markdown = readFileSync(
        resolve(root, "agent/skills", entry.name, "SKILL.md"),
        "utf8"
      );
      const name = markdown.match(/^name: ([a-z0-9-]+)$/m)?.[1];
      const description = markdown.match(/^description: (.+)$/m)?.[1];
      if (name !== entry.name || !description)
        throw new Error(`Invalid authored skill metadata: ${entry.name}`);
      return [name, { description, markdown }];
    })
);
const target = resolve(
  root,
  "src/lib/evry/eve/runtime/authored-skills.generated.ts"
);
const source = await format(
  `// Generated from agent/skills/*/SKILL.md. Run pnpm evry:skills:generate.\nexport const authoredSkills: Readonly<Record<string, { description: string; markdown: string }>> = ${JSON.stringify(skills)};\n`,
  { ...(await resolveConfig(target)), parser: "typescript" }
);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== source)
    throw new Error(
      "Authored skill bundle is stale. Run pnpm evry:skills:generate."
    );
} else writeFileSync(target, source);
