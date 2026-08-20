import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { like, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, sendingChurches, sendingNetworks, users } from "@/db/schema";

// ----------------------------------------------------------------------------
// AS-002 / ruling 185 (4) — ONE OWNER PER TENANCY, ENFORCED BY THE DATABASE,
// guarded by three partial unique indexes (migration 0050):
//
//   users_church_owner_unique_idx           (church_id)          WHERE seat = 'owner'
//   users_sending_church_owner_unique_idx   (sending_church_id)  WHERE seat = 'owner'
//   users_sending_network_owner_unique_idx  (sending_network_id) WHERE seat = 'owner'
//
// WHY THIS IS NOT A UNIT TEST. The ruling is explicit that ownership is "a data
// defect that must be impossible rather than detected", and what makes it
// impossible is the INDEX, not any line of TypeScript. A unit test over
// `isPlantOwner` proves the readers agree about who the Owner is; only a real
// Postgres proves that a second one cannot be written. Before 0050 the OB-010
// planter claim was a raced write (`memory/invariants.md` → User Roles, as it
// stood): two callers both read "this plant has no planter" and both wrote one,
// and every static check passed.
//
// THE NULL HALF IS THE OTHER HALF, and it is the one a careless index gets
// wrong. A btree unique index treats NULLs as DISTINCT, and the `WHERE` keeps
// Admins and Members out of the index entirely — so a coach-only account (no
// tenancy, no seat) must insert as many times as it likes. An index built
// without the partial predicate, or on a column made NOT NULL, would make the
// second coach account unwritable and nothing in the application would say why.
//
// OPT-IN, against a real database: `LIVE_DB_TESTS=1 pnpm test`, or the
// `test:live` lane which points the neon-http driver at a local proxy. Same
// convention, flag and reachability probe as the race suites beside it.
//
// Everything written here is namespaced by `SCRATCH_NAME` and swept in `after`.
// ----------------------------------------------------------------------------

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test` with a reachable DATABASE_URL — an index is the only place this rule lives";

const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so the constraint was NOT exercised";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const SCRATCH_NAME = "__t494 seat owner uniqueness scratch__";

const scratchEmail = () => `${crypto.randomUUID()}@scratch.invalid`;

async function sweep(): Promise<void> {
  await db.delete(users).where(like(users.name, SCRATCH_NAME));

  for (const table of [churches, sendingChurches, sendingNetworks]) {
    await db.delete(table).where(like(table.name, SCRATCH_NAME));
  }
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

/**
 * THE SQLSTATE, NOT THE SENTENCE.
 *
 * `duplicate key value violates unique constraint` is Postgres's localized
 * message text: it moves with `lc_messages`, so a server running in any other
 * locale turns these assertions green-for-the-wrong-reason (the insert still
 * failed, but the matcher stopped being able to say why). The five-character
 * SQLSTATE is the stable contract — 23505 unique_violation, 23514
 * check_violation — and the CONSTRAINT NAME is what says WHICH rule fired.
 *
 * The neon-http driver re-throws with its own "Failed query: …" message and
 * hangs the `NeonDbError`, which carries `code` and `constraint`, off `cause`.
 */
function pgError(error: unknown): { code?: string; constraint?: string } {
  const cause = (error as { cause?: unknown })?.cause;
  return (cause ?? error) as { code?: string; constraint?: string };
}

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

function isUniqueViolation(error: unknown, index: string): boolean {
  const { code, constraint } = pgError(error);
  return code === UNIQUE_VIOLATION && constraint === index;
}

/**
 * One scratch tenancy of each kind, and the index that guards it.
 *
 * A table rather than three tests, because the rule is that the three tenancies
 * are the SAME rule — the whole point of the seat model (ruling 185). A fourth
 * tenancy would be a row here and would fail until its index exists.
 */
const TENANCIES = [
  {
    what: "a plant",
    index: "users_church_owner_unique_idx",
    async create() {
      const [row] = await db
        .insert(churches)
        .values({ name: SCRATCH_NAME, currentPhase: 1 })
        .returning({ id: churches.id });
      return { churchId: row.id };
    },
  },
  {
    what: "a sending church",
    index: "users_sending_church_owner_unique_idx",
    async create() {
      const [row] = await db
        .insert(sendingChurches)
        .values({ name: SCRATCH_NAME })
        .returning({ id: sendingChurches.id });
      return { sendingChurchId: row.id };
    },
  },
  {
    what: "a sending network",
    index: "users_sending_network_owner_unique_idx",
    async create() {
      const [row] = await db
        .insert(sendingNetworks)
        .values({ name: SCRATCH_NAME })
        .returning({ id: sendingNetworks.id });
      return { sendingNetworkId: row.id };
    },
  },
] as const;

for (const tenancy of TENANCIES) {
  test(
    `a second Owner in ${tenancy.what} is refused by the database`,
    { skip },
    async (t: TestContext) => {
      if (!(await databaseReachable())) return t.skip(UNREACHABLE);

      const fk = await tenancy.create();

      // The first Owner commits.
      const [first] = await db
        .insert(users)
        .values({
          email: scratchEmail(),
          passwordHash: "scratch",
          name: SCRATCH_NAME,
          seat: "owner",
          ...fk,
        })
        .returning({ id: users.id });
      assert.ok(first.id, "the first Owner must be writable");

      // The second does not — and it is the INDEX that says so, not application
      // code, which is what AS-002 asks for.
      await assert.rejects(
        () =>
          db.insert(users).values({
            email: scratchEmail(),
            passwordHash: "scratch",
            name: SCRATCH_NAME,
            seat: "owner",
            ...fk,
          }),
        (error: unknown) => isUniqueViolation(error, tenancy.index),
        `a second Owner in ${tenancy.what} committed — ${tenancy.index} is missing or not partial on the Owner seat`
      );

      // …while an Admin and a Member of the SAME tenancy are unaffected: the
      // index is partial on the seat, so they never enter it at all.
      for (const seat of ["admin", "member"] as const) {
        const [other] = await db
          .insert(users)
          .values({
            email: scratchEmail(),
            passwordHash: "scratch",
            name: SCRATCH_NAME,
            seat,
            ...fk,
          })
          .returning({ id: users.id });
        assert.ok(other.id, `${seat} must be writable beside the Owner`);
      }
    }
  );
}

test(
  "a coach-only account — no tenancy, no seat — commits as often as it likes",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // THE NULL CASE, TWICE. Once proves the CHECK admits a null seat; twice
    // proves the three partial indexes do not collapse every tenancy-less
    // account onto one key. A btree unique index treats NULLs as distinct and
    // the `WHERE seat = 'owner'` keeps these rows out of the index entirely —
    // two independent reasons, and this asserts the result of both.
    for (const _ of [1, 2]) {
      const [row] = await db
        .insert(users)
        .values({
          email: scratchEmail(),
          passwordHash: "scratch",
          name: SCRATCH_NAME,
        })
        .returning({ id: users.id, seat: users.seat });

      assert.ok(row.id);
      assert.equal(
        row.seat,
        null,
        "a coach holds no seat, and that is a value"
      );
    }
  }
);

test(
  "an Owner with no tenancy at all is writable, and so is a second one",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // Registration mints exactly this row — the Owner seat, no plant yet — and
    // it must not be a key anybody else can collide with. All three index keys
    // are NULL here, so all three treat these rows as distinct.
    for (const _ of [1, 2]) {
      const [row] = await db
        .insert(users)
        .values({
          email: scratchEmail(),
          passwordHash: "scratch",
          name: SCRATCH_NAME,
          seat: "owner",
        })
        .returning({ id: users.id });

      assert.ok(row.id);
    }
  }
);

test(
  "no row on this database names more than one tenancy",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // THE END STATE 0050 §1 EXISTS TO REACH, asserted over the WHOLE table
    // rather than over the rows this suite wrote. §1 repairs BOTH directions —
    // §1a clears the oversight FKs from church-level rows, §1b clears
    // `church_id` from oversight rows — so this catches a database where either
    // direction's assumption did not hold, or where something wrote such a row
    // after the migration ran. Such a row is not a leak (every reader fails
    // closed on it) but it reaches NOTHING, which is a silent outage for that
    // account until somebody notices.
    const [census] = await db
      .select({
        offenders: sql<number>`count(*) filter (where
          (case when ${users.churchId} is not null then 1 else 0 end)
          + (case when ${users.sendingChurchId} is not null then 1 else 0 end)
          + (case when ${users.sendingNetworkId} is not null then 1 else 0 end)
          > 1)`,
      })
      .from(users);

    assert.equal(
      Number(census.offenders),
      0,
      "a users row names more than one tenancy — see migration 0050 §1 and the operator exit in its header"
    );
  }
);

test(
  "the seat column refuses a word that is not a seat",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // `users_seat_check` — the enum, in the data. `.$type<UserSeat>()` on a
    // varchar is a compile-time brand and nothing else, so the five retired role
    // names would otherwise still be writable by any statement that reached the
    // database from outside TypeScript.
    await assert.rejects(
      () =>
        db.execute(
          sql`insert into ${users} (email, password_hash, name, seat) values (${scratchEmail()}, 'scratch', ${SCRATCH_NAME}, 'planter')`
        ),
      (error: unknown) => {
        const { code, constraint } = pgError(error);
        return code === CHECK_VIOLATION && constraint === "users_seat_check";
      },
      "`planter` is writable to users.seat — the CHECK is missing"
    );
  }
);
