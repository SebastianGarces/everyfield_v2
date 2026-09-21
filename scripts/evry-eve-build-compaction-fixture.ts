import { cp, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Isolated build input only. No production config switch or reserved session edits.
async function main() {
  const root = process.cwd();
  const fixture = await mkdtemp(join(root, ".eve", "compaction-fixture-"));
  await cp(join(root, "agent"), join(fixture, "agent"), { recursive: true });
  await symlink(join(root, "src"), join(fixture, "src"), "dir");
  const source = await readFile(join(root, "agent", "agent.ts"), "utf8");
  if (source.split("  reasoning:").length !== 2)
    throw new Error(
      "Production agent definition changed; inspect the fixture context override."
    );
  await writeFile(
    join(fixture, "agent", "agent.ts"),
    source.replace(
      "  reasoning:",
      "  modelContextWindowTokens: 16_000,\n  compaction: { modelContextWindowTokens: 16_000, thresholdPercent: 0.9 },\n  reasoning:"
    )
  );
  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8")
  );
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({
      name: "evry-compaction-proof",
      private: true,
      type: "module",
      dependencies: packageJson.dependencies,
    })
  );
  await writeFile(
    join(fixture, "tsconfig.json"),
    JSON.stringify({ extends: join(root, "tsconfig.json") })
  );
  const built = spawnSync(
    process.execPath,
    [resolve("node_modules/eve/bin/eve.js"), "build"],
    {
      cwd: fixture,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
        RESEND_API_KEY: "re_fixture_build",
        OPENAI_API_KEY: "fixture-no-provider-network",
      },
    }
  );
  if (built.status !== 0)
    throw new Error(`Fixture build failed: ${built.status}`);
  process.stdout.write(
    `EVRY_COMPACTION_FIXTURE_ENTRY=${join(fixture, ".output", "server", "index.mjs")}\n`
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
