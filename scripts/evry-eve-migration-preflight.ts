/** Read-only preview migration audit. Never applies DDL or repairs the ledger.
 * Usage: node --import tsx scripts/evry-eve-migration-preflight.ts <env-file> <expected-host>
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { createdObjects } from "./db-migrate";

const journalEntry = z.object({
  tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
  when: z.number().int().nonnegative().safe(),
});
const appliedEntry = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.string().regex(/^\d+$/),
});
type Migration = z.infer<typeof journalEntry> & { hash: string };
type Applied = z.infer<typeof appliedEntry>;

export function inspectMigrationLedger(
  migrations: readonly Migration[],
  applied: readonly Applied[]
) {
  const maximum = applied.reduce(
    (value, entry) => Math.max(value, Number(entry.created_at)),
    -1
  );
  const entries = migrations.map((entry) => {
    const matches = applied.filter(
      (row) => row.created_at === String(entry.when)
    );
    const state =
      matches.length > 1
        ? "duplicate_stamp"
        : matches.length === 1
          ? matches[0].hash === entry.hash
            ? "applied"
            : "hash_mismatch"
          : entry.when > maximum
            ? "pending"
            : "shadowed_missing";
    return { ...entry, state };
  });
  const stamps = new Set(migrations.map((entry) => String(entry.when)));
  return {
    entries,
    unrecognizedAppliedRows: applied.filter(
      (entry) => !stamps.has(entry.created_at)
    ),
  };
}

async function main(args: string[]) {
  const [envFile, expectedHost] = z
    .tuple([z.string().min(1), z.string().min(1)])
    .parse(args);
  const env = parse(readFileSync(envFile));
  const target = new URL(z.string().url().parse(env.DATABASE_URL));
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== expectedHost
  )
    throw new Error(
      "Database target does not match the explicit expected host"
    );
  const folder = resolve("src/db/migrations");
  const journal = z
    .object({ entries: z.array(journalEntry) })
    .parse(
      JSON.parse(readFileSync(resolve(folder, "meta/_journal.json"), "utf8"))
    );
  const migrations = journal.entries.map((entry) => ({
    ...entry,
    hash: createHash("sha256")
      .update(readFileSync(resolve(folder, `${entry.tag}.sql`)))
      .digest("hex"),
  }));
  const sql = neon(target.href, {
    fetchOptions: { signal: AbortSignal.timeout(15_000) },
  });
  const applied = z.array(appliedEntry).parse(
    await sql`
    SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at
  `
  );
  const audit = inspectMigrationLedger(migrations, applied);
  const candidates = audit.entries
    .filter((entry) => entry.state === "pending")
    .flatMap((entry) =>
      createdObjects(
        readFileSync(resolve(folder, `${entry.tag}.sql`), "utf8")
      ).map((object) => ({
        migration: entry.tag,
        key: `${object.kind}:${object.name}`,
      }))
    );
  const catalog = z.array(z.object({ key: z.string() })).parse(
    await sql`
    SELECT 'relation:' || c.relname AS key FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    UNION ALL
    SELECT 'column:' || table_name || '.' || column_name AS key
      FROM information_schema.columns WHERE table_schema='public'
    UNION ALL
    SELECT 'constraint:' || c.conname AS key FROM pg_constraint c
      JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'
  `
  );
  const present = new Set(catalog.map((row) => row.key));
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        databaseHost: target.hostname,
        ...audit,
        pendingObjectCollisions: candidates.filter((object) =>
          present.has(object.key)
        ),
        requiredObjects: Object.fromEntries(
          [
            "relation:leadership_versions",
            "relation:evry_eve_sessions",
            "relation:communication_failed_retries",
            "column:communication_recipients.failure_origin",
            "relation:evry_eve_attachments",
          ].map((key) => [key, present.has(key)])
        ),
        note: "An audit is not permission to repair history or apply migrations. Inspect pending objects and known historical drift before deployment.",
      },
      null,
      2
    )
  );
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main(process.argv.slice(2)).catch(() => {
    // Database exceptions may contain a URL or credentials. Do not print them.
    console.error(
      "Read-only migration preflight failed; verify the explicit target and local configuration."
    );
    process.exitCode = 1;
  });
}
