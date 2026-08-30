import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, persons, users } from "@/db/schema";

import { evryImportDuplicateSnapshotCtes } from "./duplicate-match";
import { evryImportDuplicateSnapshotIsCurrent } from "./evry-files";
import { parseCsvImport } from "./import";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` to exercise duplicate predicates against Postgres";
const SCRATCH_NAME = "__t778 literal duplicate match scratch__";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

async function sweep(): Promise<void> {
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(eq(churches.name, SCRATCH_NAME));

  for (const church of scratch) {
    await db.delete(persons).where(eq(persons.churchId, church.id));
    await db.delete(users).where(eq(users.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }
}

after(async () => {
  if (LIVE_DB && (await databaseReachable())) await sweep();
});

test(
  "preview, preflight, and atomic import matching treat LIKE characters as literal data",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable()))
      return t.skip("LIVE_DB_TESTS=1 was set but Postgres is unreachable");
    await sweep();

    const [church] = await db
      .insert(churches)
      .values({ name: SCRATCH_NAME })
      .returning({ id: churches.id });
    assert.ok(church);
    const [owner] = await db
      .insert(users)
      .values({
        churchId: church.id,
        email: `${crypto.randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: SCRATCH_NAME,
        seat: "owner",
      })
      .returning({ id: users.id });
    assert.ok(owner);

    const seeded = await db
      .insert(persons)
      .values([
        {
          churchId: church.id,
          createdBy: owner.id,
          firstName: "Email",
          lastName: "Underscore distractor",
          email: "axb@example.com",
        },
        {
          churchId: church.id,
          createdBy: owner.id,
          firstName: "AnnX",
          lastName: "Wildcard",
        },
        {
          churchId: church.id,
          createdBy: owner.id,
          firstName: "Percy",
          lastName: "Wildcard",
        },
        {
          churchId: church.id,
          createdBy: owner.id,
          firstName: "Esc_",
          lastName: "Literal",
        },
        {
          churchId: church.id,
          createdBy: owner.id,
          firstName: "Back\\Slash",
          lastName: "Literal",
        },
      ])
      .returning({ id: persons.id });
    assert.equal(seeded.length, 5);

    const preview = await parseCsvImport(
      [
        "First Name *,Last Name *,Email",
        "Under,Email,a_b@example.com",
        "Ann_,Wildcard,ann-underscore@scratch.invalid",
        "Per%,Wildcard,name-percent@scratch.invalid",
        "Esc\\_,Literal,escape-name@scratch.invalid",
        "Back\\Slash,Literal,backslash-name@scratch.invalid",
      ].join("\n"),
      church.id
    );

    assert.deepEqual(
      preview.validRows.map(({ rowNumber }) => rowNumber),
      [2, 3, 4, 5]
    );
    assert.deepEqual(
      preview.duplicateRows.map(({ rowNumber }) => rowNumber),
      [6]
    );
    assert.deepEqual(
      preview.duplicateRows.map(({ duplicates }) => ({
        exact: duplicates.exactMatch?.id ?? null,
        potential: duplicates.potentialMatches.map(({ id }) => id),
      })),
      [{ exact: null, potential: [seeded[4]!.id] }]
    );

    const snapshot = [...preview.validRows, ...preview.duplicateRows]
      .toSorted((left, right) => left.rowNumber - right.rowNumber)
      .map((row) => ({
        rowNumber: row.rowNumber,
        email: row.data.email?.trim().toLocaleLowerCase("en-US") || null,
        phone: row.data.phone || null,
        firstName: row.data.firstName?.trim() ?? "",
        lastName: row.data.lastName?.trim() ?? "",
        matchIds: [
          ...(row.duplicates.exactMatch ? [row.duplicates.exactMatch.id] : []),
          ...row.duplicates.potentialMatches.map(({ id }) => id),
        ],
      }));

    const snapshotJson = JSON.stringify(snapshot);
    assert.equal(
      await evryImportDuplicateSnapshotIsCurrent({
        database: db,
        plantId: church.id,
        snapshotJson,
      }),
      true
    );

    const atomic = await db.execute<
      { is_current: boolean } & Record<string, unknown>
    >(sql`
      with ${evryImportDuplicateSnapshotCtes({
        plantId: church.id,
        snapshotJson,
        expectedCount: snapshot.length,
      })}, requested as materialized (select 1)
      select is_current from duplicate_snapshot_current cross join requested
    `);
    assert.equal(atomic.rows[0]?.is_current, true);
  }
);
