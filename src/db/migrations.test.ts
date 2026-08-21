import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  generateDrizzleJson,
  generateMigration,
  type DrizzleSnapshotJSON,
} from "drizzle-kit/api";

import * as schema from "./schema";

// ============================================================================
// THE MIGRATIONS FOLDER, and the two of its properties no reviewer can see.
//
// Why a bare snapshot is a defect, and why a `when` may not regress:
// `memory/invariants.md` → Migrations. Both rules are cheap to state and
// invisible in a diff — a snapshot is 10k lines nobody reads, and a stamp is a
// number — so they live here as tests rather than as advice.
//
// THE SNAPSHOT CHECK IS THE GENERATE ITSELF, through `drizzle-kit/api`: no
// database, no CLI, no files written. It is #592's acceptance criterion, run on
// every `pnpm test` instead of by whoever remembers.
//
// IT IS A TAIL CHECK, and that limit is real. `drizzle-kit generate` reads only
// the NEWEST snapshot, so this proves only the newest is current: one PR
// shipping 0062 bare and 0063 with a snapshot passes both tests while 0063's
// `.sql` carries 0062's DDL. Nothing cheap catches that — "every migration has
// a snapshot" is false by design, since a DATA-ONLY migration generates none
// (0010 and 0056 rewrite rows and change no schema). The other three gaps,
// 0011, 0052 and 0059, are this bug already absorbed by a later snapshot, not
// licence for a fourth. 0035 was never minted at all.
// ============================================================================

const MIGRATIONS = path.join(process.cwd(), "src", "db", "migrations");
const META = path.join(MIGRATIONS, "meta");

/**
 * The snapshots as drizzle-kit reads them — `prepareOutFolder` takes every
 * entry not starting with `_`, sorts by name, and uses the last as the diff
 * base. Matching that filter rather than a stricter pattern is deliberate: a
 * stray `0062_snapshot.json.orig` from a mergetool becomes drizzle-kit's base,
 * and a test that filtered it out would stay green while a generate went wrong.
 */
const SNAPSHOTS = readdirSync(META)
  .filter((name) => !name.startsWith("_"))
  .sort();

const snapshot = (name: string) =>
  JSON.parse(
    readFileSync(path.join(META, name), "utf8")
  ) as DrizzleSnapshotJSON;

const JOURNAL = JSON.parse(
  readFileSync(path.join(META, "_journal.json"), "utf8")
) as { entries: { idx: number; when: number; tag: string }[] };

const BACKFILL = "pnpm exec tsx scripts/backfill-snapshot.ts";

test("meta holds snapshots and nothing else", () => {
  for (const name of SNAPSHOTS) {
    assert.match(
      name,
      /^\d{4}_snapshot\.json$/,
      `meta/${name} is not a snapshot, and drizzle-kit will read it as one — it filters on the leading underscore only`
    );
  }
});

test("the newest snapshot IS the schema — a generate would emit nothing", async () => {
  const newest = SNAPSHOTS.at(-1);
  assert.ok(newest, "src/db/migrations/meta holds no snapshots");

  const repair = `Repair it with \`${BACKFILL} <the migration that shipped bare>\`.`;

  // A drift holding both a creation and a deletion of the same kind reaches
  // drizzle-kit's rename prompt, which throws on a non-TTY rather than
  // answering. That is still a failure, but it would arrive as a stack trace
  // about `process.stdin.isTTY` — so it is caught and re-thrown as what it
  // means.
  const statements = await generateMigration(
    snapshot(newest),
    generateDrizzleJson(schema)
  ).catch((error: unknown) => {
    throw new Error(
      `${newest} does not describe src/db/schema — drizzle-kit stopped to ask whether the difference is a rename (${error instanceof Error ? error.message : String(error)}).\n  ${repair}`
    );
  });

  assert.deepEqual(
    statements,
    [],
    [
      `${newest} does not describe src/db/schema, so the next \`pnpm db:generate\` emits these again, inside somebody else's migration:`,
      ...statements,
      repair,
    ].join("\n  ")
  );
});

test("every snapshot links to the one before it", () => {
  for (let i = 1; i < SNAPSHOTS.length; i++) {
    const [previous, current] = [
      snapshot(SNAPSHOTS[i - 1]),
      snapshot(SNAPSHOTS[i]),
    ];

    // Both ids asserted first: `undefined === undefined` would pass this for a
    // truncated or hand-written file, which is the only shape the equality
    // below cannot see.
    assert.ok(
      current.prevId && previous.id,
      `${SNAPSHOTS[i]} or ${SNAPSHOTS[i - 1]} carries no id — it did not come from drizzle-kit`
    );
    assert.equal(
      current.prevId,
      previous.id,
      `${SNAPSHOTS[i]} names ${current.prevId} as its parent, but ${SNAPSHOTS[i - 1]} is ${previous.id} — a snapshot was copied, renamed, or dropped out of the chain`
    );
  }
});

test("the journal never regresses", () => {
  // THE SILENT-SKIP HAZARD (0036's, still live). `drizzle-kit migrate` compares
  // each entry's `when` against the MAXIMUM `created_at` already in the ledger,
  // never against that migration's own row — so a `when` below a sibling that
  // reached the database first is skipped in SILENCE.
  //
  // STATED AS THE GENERAL PROPERTY, not as "0054 is last" (#521). This test
  // used to pin the journal's TAIL, which is a claim that expires the moment
  // anybody adds a migration: 0055 broke it while being stamped perfectly
  // correctly, and the only repair available was to re-point the pin at the new
  // tail — a test the next author has to edit again is a test that will
  // eventually be deleted instead. Strictly increasing `when` AND `idx` over
  // the whole journal is the hazard itself, it covers every migration rather
  // than one, and it needs no maintenance.
  const entries = JOURNAL.entries;

  for (let i = 1; i < entries.length; i++) {
    const [previous, entry] = [entries[i - 1], entries[i]];
    assert.ok(
      entry.when > previous.when,
      `${entry.tag} is stamped at or below ${previous.tag} — re-stamp it, or it applies nothing and prints success`
    );
    assert.ok(
      entry.idx > previous.idx,
      `${entry.tag} carries idx ${entry.idx}, at or below ${previous.tag}'s ${previous.idx} — the journal is read in order`
    );
  }
});
