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
// #592 — THE SNAPSHOT CHAIN, the half of a migration nobody looks at.
//
// A migration is two artifacts, not one: the `.sql` an operator applies, and
// the `meta/<n>_snapshot.json` that records the schema it left behind.
// `drizzle-kit generate` diffs the schema against the NEWEST snapshot on disk,
// so a missing or stale one is not a cosmetic gap — it re-emits DDL that
// already shipped, into somebody else's migration, weeks later. That is not a
// hypothesis: 0059 landed without its snapshot, 0060's generate re-emitted
// `plant_assessments.planter_seen_at`, and the next track deleted the
// duplicate statement by hand (PR #575). 0061 then landed without one too, and
// the next generate would have re-created the whole `planter_checkins` table.
//
// The check below is the generate itself, through `drizzle-kit/api` — no
// database, no CLI, no files written. It is the acceptance criterion of #592
// as a test, so the folder can never again be one hand-run away from knowing
// it is wrong.
//
// A DATA-ONLY MIGRATION LEGITIMATELY HAS NO SNAPSHOT. 0056 rewrites rows and
// changes no schema, so drizzle-kit generated nothing for it, and 0057 links
// straight back to 0055. Six such gaps exist. That is why neither test here
// asks "does every journal entry have a snapshot" — the property that matters
// is that the NEWEST snapshot equals the schema, and that the ones that exist
// form an unbroken chain.
//
// The journal's own invariants — strictly increasing `when` and `idx`, the
// silent-skip hazard behind them — live in `@/lib/invitations/seat.test.ts`
// ("the journal never regresses"), and the re-stamp that keeps them true lives
// in `scripts/restamp-migration.ts`.
// ============================================================================

const META = path.join(process.cwd(), "src", "db", "migrations", "meta");

/**
 * The snapshot files, in the order drizzle-kit reads them: by number, which is
 * the migration they belong to.
 */
const SNAPSHOTS = readdirSync(META)
  .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
  .sort();

const snapshot = (name: string) =>
  JSON.parse(
    readFileSync(path.join(META, name), "utf8")
  ) as DrizzleSnapshotJSON;

test("the newest snapshot IS the schema — a generate would emit nothing", async () => {
  const newest = SNAPSHOTS.at(-1);
  assert.ok(newest, "src/db/migrations/meta holds no snapshots");

  const statements = await generateMigration(
    snapshot(newest),
    generateDrizzleJson(schema)
  );

  assert.deepEqual(
    statements,
    [],
    [
      `${newest} does not describe src/db/schema, so the next \`pnpm db:generate\` will emit these statements again:`,
      ...statements,
      `Fix it where the gap was made: the migration that changed the schema shipped without its snapshot.`,
      `Run \`pnpm db:generate\`, keep the snapshot it writes, rename it to that migration's number, and delete the .sql it wrote.`,
    ].join("\n  ")
  );
});

test("every snapshot links to the one before it", () => {
  for (let i = 1; i < SNAPSHOTS.length; i++) {
    const [previous, current] = [
      snapshot(SNAPSHOTS[i - 1]),
      snapshot(SNAPSHOTS[i]),
    ];

    assert.equal(
      current.prevId,
      previous.id,
      `${SNAPSHOTS[i]} names ${current.prevId} as its parent, but ${SNAPSHOTS[i - 1]} is ${previous.id} — a snapshot was copied, renamed, or dropped out of the chain`
    );
  }
});
