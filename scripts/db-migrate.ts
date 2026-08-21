/**
 * `pnpm db:migrate` — `drizzle-kit migrate`, plus the diagnosis it does not
 * print (#577).
 *
 * WHY THIS EXISTS. `drizzle-kit migrate` swallows the driver's error. When a
 * migration aborts it exits 1 with an unfinished `[⣷] applying migrations...`
 * spinner and NOTHING on stdout or stderr — no message, no SQLSTATE, no name of
 * the migration it was on. The failure that shape hides most often here is
 * Postgres 42701, `column ... already exists`, raised when a RENUMBERED
 * migration re-runs DDL a database already holds: drizzle-kit compares a
 * journal entry's `when` against the ledger's MAXIMUM `created_at` and never
 * asks whether THIS migration's own row is present, so a database that applied
 * the old number is invisible to it (`memory/invariants.md` → Migrations). An
 * operator gets a bare exit 1 and no way to tell that from a bad password.
 *
 * WHAT IT ADDS. On a non-zero exit it prints the batch drizzle-kit attempted
 * and, where the catalog can prove it, the migration that collided — by name,
 * object and SQLSTATE — then points at the reconcile.
 *
 * THE BATCH IS ONE TRANSACTION, which is why the ledger cannot name the
 * culprit on its own. `drizzle-orm`'s migrator reads the maximum `created_at`
 * ONCE, then applies every entry above it inside a single `begin`/`commit`
 * (`pg-core/dialect.cjs`, verified against a scratch database 2026-08-21: with
 * two pending migrations and a collision in the SECOND, the FIRST one's table
 * was absent afterwards and the ledger was byte-identical). So a failed run
 * rolls back the rows it inserted too, every attempted entry is still pending,
 * and "the first pending one failed" would be wrong every time the collider is
 * not first. The pending list is the SEARCH SPACE; the catalog is the evidence.
 *
 * IT NEVER WRITES. The shared Neon branch is the de-facto prod DB and its
 * ledger is diagnosed read-only: a write to `drizzle.__drizzle_migrations` is
 * attended-only, never a side effect of tooling (`memory/contracts/db.md` →
 * Migration ledger vs journal). So the diagnosis is four SELECTs against the
 * catalog. It does NOT replay the failing batch to capture the real error, even
 * inside a transaction it means to roll back — that ships DDL at prod to
 * produce a log line. The operator gets a copy-pasteable BEGIN/ROLLBACK
 * instead, and decides for themselves.
 *
 * Usage: `pnpm db:migrate` — extra arguments pass straight to drizzle-kit.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { constants } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { readJournal, type JournalEntry } from "./restamp-migration";

/** Where the applied-migration ledger lives. drizzle-kit owns the name. */
const LEDGER = "drizzle.__drizzle_migrations";

/** Long enough for a cold Neon endpoint, short enough not to become the hang. */
const DIAGNOSIS_TIMEOUT_MS = 15_000;

/** Past this many, the batch listing is a wall of text nobody reads. */
const MAX_LISTED = 8;

/**
 * The migrations directory, and `DATABASE_URL`, from the config drizzle-kit is
 * about to read — `--config <path>` when the caller passed one, so the two
 * halves of this command can never disagree about which journal they mean.
 *
 * Importing it is also how `DATABASE_URL` arrives: it lives in `.env.local`,
 * which `drizzle.config.ts` loads on import and no shell exports.
 */
async function migrationsDir(argv: readonly string[]): Promise<string> {
  const flag = argv.findIndex((arg) => arg === "--config");
  const inline = argv.find((arg) => arg.startsWith("--config="));
  const path = flag >= 0 ? argv[flag + 1] : inline?.slice("--config=".length);

  const config = (await import(
    pathToFileURL(resolve(path ?? "drizzle.config.ts")).href
  )) as { default: { out?: string } };

  // No fallback: drizzle-kit's own default `out` is `./drizzle`, so guessing
  // this repo's `src/db/migrations` would read a journal the run never used.
  const { out } = config.default;
  if (!out) throw new Error("the drizzle config sets no `out` directory");
  return out;
}

// ============================================================================
// What a migration would create, named the way the catalog names it
// ============================================================================

type Kind = "relation" | "column" | "constraint";

type Candidate = {
  kind: Kind;
  /** `users`, `users.email`, `users_email_unique` — as printed and as queried. */
  name: string;
};

/** The SQLSTATE Postgres raises when that kind of object is already there. */
const DUPLICATE: Record<Kind, string> = {
  relation: "42P07 duplicate_table",
  column: "42701 duplicate_column",
  constraint: "42710 duplicate_object",
};

/**
 * The DDL shapes the repo's migrations use. `CREATE TYPE`, `VIEW`, `FUNCTION`
 * and `SEQUENCE` appear in no executable line today; a migration that adds one
 * is a silent false negative here and wants a fourth kind.
 */
const CREATES: readonly { kind: Kind; pattern: RegExp }[] = [
  {
    kind: "relation",
    pattern:
      /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"([^"]+)"/gi,
  },
  {
    kind: "relation",
    pattern: /create\s+table\s+(?:if\s+not\s+exists\s+)?"([^"]+)"/gi,
  },
  {
    kind: "column",
    pattern:
      /alter\s+table\s+"([^"]+)"\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"([^"]+)"/gi,
  },
  {
    kind: "constraint",
    pattern: /alter\s+table\s+"[^"]+"\s+add\s+constraint\s+"([^"]+)"/gi,
  },
];

/**
 * The mirror of {@link CREATES}, and the reason it exists: four migrations DROP
 * an object and recreate it under the same name in the same file — 0025 drops
 * `notifications_dedupe_key_unique_idx` before creating it, and 0018, 0029 and
 * 0055 do the same for theirs. Without subtracting the drops, those names are
 * "already in the database" on every database that has not run them yet, and
 * the report accuses a migration that cannot collide.
 *
 * `ALTER COLUMN ... DROP NOT NULL` is not a drop of anything named, and none of
 * these patterns match it.
 */
const DROPS: readonly { kind: Kind; pattern: RegExp }[] = [
  {
    kind: "relation",
    pattern: /drop\s+(?:table|index)\s+(?:if\s+exists\s+)?"([^"]+)"/gi,
  },
  {
    kind: "column",
    pattern:
      /alter\s+table\s+"([^"]+)"\s+drop\s+column\s+(?:if\s+exists\s+)?"([^"]+)"/gi,
  },
  {
    kind: "constraint",
    pattern:
      /alter\s+table\s+"[^"]+"\s+drop\s+constraint\s+(?:if\s+exists\s+)?"([^"]+)"/gi,
  },
];

/** `relation:users`, `column:users.email` — one string, comparable. */
const key = (c: Candidate) => `${c.kind}:${c.name}`;

function scan(
  ddl: string,
  registry: readonly { kind: Kind; pattern: RegExp }[]
): Candidate[] {
  return registry.flatMap(({ kind, pattern }) =>
    [...ddl.matchAll(pattern)].map((match) => ({
      kind,
      name: match.slice(1).filter(Boolean).join("."),
    }))
  );
}

/**
 * What `sql` would leave behind that was not there before.
 *
 * Comment lines are dropped first: a migration header quotes its own DDL to
 * explain it (0058 quotes all four of its statements) and several quote a
 * ROLLBACK's `DROP`/`CREATE` pair, so a probe that read those would report a
 * collision for a statement nobody is running.
 */
export function createdObjects(sql: string): Candidate[] {
  const ddl = sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");

  const dropped = new Set(scan(ddl, DROPS).map(key));
  return scan(ddl, CREATES).filter((c) => !dropped.has(key(c)));
}

// ============================================================================
// Reading the database — SELECT only
// ============================================================================

type Sql = NeonQueryFunction<false, false>;

/** The keys, of those offered, that the database already holds. */
async function alreadyPresent(
  sql: Sql,
  candidates: readonly Candidate[]
): Promise<Set<string>> {
  const namesOf = (kind: Kind) => [
    ...new Set(candidates.filter((c) => c.kind === kind).map((c) => c.name)),
  ];

  const found = new Set<string>();
  const collect = async (
    kind: Kind,
    rows: Promise<Record<string, unknown>[]>
  ) => {
    for (const row of await rows) found.add(`${kind}:${String(row.name)}`);
  };

  const relations = namesOf("relation");
  const columns = namesOf("column");
  const constraints = namesOf("constraint");

  // Tables and indexes are both `pg_class` rows in one namespace, so they may
  // not share a name and one lookup answers for both.
  if (relations.length > 0) {
    await collect(
      "relation",
      sql`
        SELECT c.relname AS name FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = ANY(${relations}::text[])
      `
    );
  }
  if (columns.length > 0) {
    await collect(
      "column",
      sql`
        SELECT table_name || '.' || column_name AS name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name || '.' || column_name = ANY(${columns}::text[])
      `
    );
  }
  // Schema-scoped like the other two: a same-named constraint in another schema
  // is not what this migration would collide with.
  if (constraints.length > 0) {
    await collect(
      "constraint",
      sql`
        SELECT c.conname AS name FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = 'public' AND c.conname = ANY(${constraints}::text[])
      `
    );
  }

  return found;
}

/**
 * The entries `drizzle-kit migrate` attempted, in the order it ran them.
 *
 * Its rule, not ours: it reads the ledger's MAXIMUM `created_at` once, up
 * front, and applies every entry stamped strictly above it — journal order, not
 * `when` order. Because the run is one transaction, a failure leaves that
 * maximum untouched, so this is the batch as attempted rather than the tail
 * that was left over.
 */
export function pendingAfter(
  entries: readonly JournalEntry[],
  ledgerMax: number
): JournalEntry[] {
  return entries.filter((entry) => entry.when > ledgerMax);
}

// ============================================================================
// The report
// ============================================================================

function report(lines: readonly string[]): void {
  console.error(lines.map((line) => (line ? `  ${line}` : "")).join("\n"));
}

/**
 * The batch, wrapped in one transaction that always rolls back — one path per
 * line so a 30-file batch is still something a person can read before running.
 */
function replay(paths: readonly string[]): string[] {
  const cat = paths.map(
    (path, i) =>
      `        ${i === 0 ? "cat " : "    "}${path}${i < paths.length - 1 ? " \\" : ""}`
  );

  return [
    "    ( echo 'BEGIN;'",
    ...cat,
    "      echo 'ROLLBACK;'",
    `    ) | psql "$DATABASE_URL" -v ON_ERROR_STOP=1`,
  ];
}

function listed(paths: readonly string[]): string[] {
  const shown = paths.slice(0, MAX_LISTED).map((p) => `    ${p}`);
  const rest = paths.length - shown.length;
  return rest > 0 ? [...shown, `    …and ${rest} more`] : shown;
}

async function diagnose(argv: readonly string[]): Promise<void> {
  const dir = await migrationsDir(argv);
  const url = process.env.DATABASE_URL;
  if (!url) {
    report([
      "DATABASE_URL is not set — not in the environment and not in .env.local,",
      "which the drizzle config loads. That alone explains the exit.",
    ]);
    return;
  }

  const sql = neon(url, {
    fetchOptions: { signal: AbortSignal.timeout(DIAGNOSIS_TIMEOUT_MS) },
  });

  let ledgerMax: number;
  try {
    const [row] = await sql.query(
      `SELECT max(created_at) AS max FROM ${LEDGER}`
    );
    ledgerMax = Number(row?.max ?? -1);
  } catch (error) {
    // The SQLSTATE, never the message: `does not exist` is also how Postgres
    // reports an unknown database (3D000) and an unknown role (28000), and
    // sending an operator into a migration file for a bad connection string is
    // the same misleading silence this script exists to end.
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;

    report(
      code === "42P01"
        ? [
            `${LEDGER} does not exist yet.`,
            "",
            "drizzle-kit creates it as it applies, so nothing has ever been",
            "applied here and the run failed somewhere in the whole journal.",
          ]
        : [
            `Could not reach the database to diagnose: ${describe(error)}`,
            "",
            "The migrations themselves are not implicated. Check DATABASE_URL,",
            "the credentials in it, and whether the endpoint is awake.",
          ]
    );
    return;
  }

  const batch = pendingAfter(readJournal(dir).entries, ledgerMax).map(
    (entry) => {
      const path = join(dir, `${entry.tag}.sql`);
      return {
        entry,
        path,
        creates: createdObjects(readFileSync(path, "utf8")),
      };
    }
  );

  const highWater =
    ledgerMax < 0
      ? `${LEDGER} holds no rows — nothing has been applied here yet.`
      : `The highest created_at in ${LEDGER} is ${ledgerMax}.`;

  if (batch.length === 0) {
    report([
      highWater,
      "",
      "Every journal entry is already at or below it, so drizzle-kit had",
      "nothing to apply and failed on something else — connecting,",
      "authenticating, or reading the config.",
    ]);
    return;
  }

  const present = await alreadyPresent(
    sql,
    batch.flatMap((m) => m.creates)
  );
  const collided = batch
    .map((m) => ({ ...m, hits: m.creates.filter((c) => present.has(key(c))) }))
    .filter((m) => m.hits.length > 0);

  report([
    highWater,
    "",
    "drizzle-kit read that maximum once, then ran every journal entry stamped",
    "above it in ONE transaction — so the failure rolled the whole batch back,",
    "and all of it is still pending. This is what it attempted:",
    "",
    ...listed(
      batch.map((m) => {
        const width = Math.max(...batch.map((b) => b.entry.tag.length));
        return `${m.entry.tag.padEnd(width)}   when ${m.entry.when}`;
      })
    ),
    "",
    ...(collided.length > 0
      ? [
          "ALREADY IN THE DATABASE — an apply collides with exactly this:",
          "",
          ...collided.flatMap((m) => [
            `    ${m.entry.tag}`,
            ...m.hits.map(
              (c) => `      ${c.name.padEnd(46)} ${DUPLICATE[c.kind]}`
            ),
          ]),
          "",
          "So that DDL is already in place and must not re-run. The usual cause",
          "is a RENUMBERED migration: a database applied these statements under",
          "an OLD number, so it holds a row for a file the repo no longer has —",
          "and drizzle-kit only compares `when` against the maximum above, never",
          "asking whether THIS migration's own row is present, so that row is",
          "invisible to it. Confirm that is what happened before changing",
          "anything; an object created by hand looks the same from here.",
          "",
          "The reconcile is an ATTENDED ledger write, never tooling's side",
          "effect: memory/contracts/db.md → 'Migration ledger vs journal (HR2)'.",
          "The worked example, with both exits, is the header of",
          "src/db/migrations/0058_church_digest_send_time.sql.",
        ]
      : [
          "Nothing any of them creates is in the database already, so this is",
          "not the renumbered-migration collision. Replay the batch to see the",
          "error drizzle-kit swallowed — one transaction, rolled back, so it",
          "changes nothing and the first ERROR names the statement:",
          "",
          // Every path, never elided. The listing above is prose and may be
          // capped; this is a command, and a truncated command is a wrong one.
          ...replay(batch.map((m) => m.path)),
        ]),
  ]);
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// ============================================================================

async function main(argv: readonly string[]): Promise<void> {
  // `drizzle-kit` off PATH, which is what `db:migrate` always ran: pnpm puts
  // `node_modules/.bin` there for a package script. Its `exports` map does not
  // expose the bin, so there is no module path to resolve instead.
  const { status, signal, error } = spawnSync(
    "drizzle-kit",
    ["migrate", ...argv],
    { stdio: "inherit" }
  );

  if (error) throw error;

  // A signal is an abort, not a migration failure. Diagnosing it would hit the
  // database for nothing, and `status` is null here, so the shell learns what
  // happened only from the conventional 128 + n.
  if (signal) process.exit(128 + (constants.signals[signal] ?? 0));
  if (status === 0) return;

  // ALWAYS, not only when drizzle-kit printed nothing. Whether the spinner left
  // bytes behind is a guess about ANSI framing, and the diagnosis is worth
  // reading even when drizzle-kit did speak.
  console.error(
    `\ndb:migrate: drizzle-kit exited ${status}. Diagnosing, read-only:\n`
  );
  try {
    await diagnose(argv);
  } catch (error) {
    report([`The diagnosis itself failed: ${describe(error)}`]);
  }
  process.exit(status ?? 1);
}

// Only when RUN, never when imported: the unit tests import `createdObjects`
// and `pendingAfter`, and a bare call here would apply migrations to whatever
// `DATABASE_URL` points at as a side effect of `pnpm test`.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
