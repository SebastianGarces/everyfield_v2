import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { eq, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, phaseTransitions, users } from "@/db/schema";
import {
  declareInitialPhaseStatement,
  INITIAL_DECLARATION_KIND,
} from "./service";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";

// ----------------------------------------------------------------------------
// OB-005 regression — a raced initial declaration lands ONE row (issue #306).
//
// WHY THIS TEST IS NOT A UNIT TEST. The bug it pins is a property of Postgres
// under READ COMMITTED, and no SQL-string assertion can see it: the first cut
// of `declareInitialPhaseStatement` LOOKED once-only — it locked the church row
// `FOR UPDATE` as statement one and gated the insert on
// `WHERE NOT EXISTS (SELECT 1 FROM phase_transitions …)` — and the generated
// SQL passed every static check in `service.test.ts`. Raced for real, 2 of 3
// runs wrote TWO rows, the second reading `from_phase 5 → to_phase 3`: a move
// the planter never made, fabricated into the OB-005 audit trail. The lock and
// the predicate are about different rows, so EvalPlanQual re-checks only
// `churches` when the waiter unblocks and the subquery still answers from the
// pre-wait snapshot (`memory/invariants/transactions-atomicity.md` → the
// subquery trap).
//
// So the assertion has to be made against a real, REACHABLE database, and it
// is therefore OPT-IN: run it with `LIVE_DB_TESTS=1 pnpm test`. Without that
// flag the file skips, so the hermetic suite stays green. The guard it protects
// is `phase_transitions_initial_declaration_unique_idx` (migration 0033), which
// CI proves exists by applying the migration.
//
// `DATABASE_URL` is deliberately NOT the signal. CI sets an unreachable
// placeholder (`postgresql://ci:ci@localhost:5432/ci`) on every `pnpm test` run
// — see the Test step in `.github/workflows/pull-request-checks.yml`, whose own
// comment records the contract: the suite is "verified to pass with no
// .env.local and an unreachable database". Keying on presence made this file
// connect in CI, take ECONNREFUSED, and fail the very hermetic run it was
// written to sit out of. An explicit flag cannot be switched back on by
// accident by some future environment. Behind the flag there is a second layer
// — a `select 1` reachability probe, the same one the other live-DB file in
// `src/` uses (`src/lib/wiki/tenancy-live.test.ts`) — so even an explicit
// opt-in against a dead database skips loudly instead of failing.
//
// Everything it writes is namespaced by `SCRATCH_NAME` and swept in `after`,
// including on failure.
// ----------------------------------------------------------------------------

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test` with a reachable DATABASE_URL — a real Postgres is the only place this bug is visible";

/**
 * Defence in depth behind the opt-in flag: even when someone asks for the live
 * run, refuse to fail the suite over a database that is not there. Matches
 * `src/lib/wiki/tenancy-live.test.ts`, the other live-DB file in `src/`.
 */
const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so the race did NOT run";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** Namespaces every row this file writes, so the sweep cannot touch real data. */
const SCRATCH_NAME = "__t306 declaration race scratch__";

/** How far along the scratch plant claims to be BEFORE either racer declares. */
const PRE_DECLARATION_PHASE = 5;

/** The two racers submit DIFFERENT stages — the fabricated row read 5 → 3. */
const RACER_PHASES = [3, 1] as const;

const RUNS = 3;

function fakeSnapshot(churchId: string): PlantFactSnapshot {
  return {
    snapshotVersion: "v1",
    churchId,
    currentPhase: PRE_DECLARATION_PHASE,
    generatedAt: "2026-08-09T00:00:00.000Z",
    isColdStart: false,
  } as unknown as PlantFactSnapshot;
}

/**
 * The actor a scratch declaration is attributed to.
 *
 * MINTED, NEVER BORROWED. This used to be `select … from users limit 1` — "any
 * real user, because the test is about the write guard, not about who
 * submitted". That reads harmlessly and is not: it makes the suite unrunnable
 * against an empty database (the CI job that finally runs these has one), and
 * in a parallel run it borrows ANOTHER suite's scratch user, which that suite's
 * sweep then cannot delete. A suite that writes only inside its own namespace
 * has to own its actor too.
 */
async function createScratchActor(): Promise<string> {
  const [actor] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH_NAME,
      role: "planter",
    })
    .returning({ id: users.id });
  return actor.id;
}

async function sweep(): Promise<void> {
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, SCRATCH_NAME));

  for (const church of scratch) {
    await db
      .delete(phaseTransitions)
      .where(eq(phaseTransitions.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }

  // Last: the transitions above reference it, and the scratch user carries no
  // church of its own.
  await db.delete(users).where(eq(users.name, SCRATCH_NAME));
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

test(
  "two concurrent declarations leave exactly ONE declaration row, every run",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();

    const actorId = await createScratchActor();

    for (let run = 1; run <= RUNS; run++) {
      const [church] = await db
        .insert(churches)
        .values({ name: SCRATCH_NAME, currentPhase: PRE_DECLARATION_PHASE })
        .returning({ id: churches.id });

      const results = await Promise.all(
        RACER_PHASES.map((toPhase) =>
          db.execute(
            declareInitialPhaseStatement({
              churchId: church.id,
              toPhase,
              initiatedById: actorId,
              factSnapshot: fakeSnapshot(church.id),
              rubricVersion: "v0",
            })
          )
        )
      );

      const rows = await db
        .select({
          fromPhase: phaseTransitions.fromPhase,
          toPhase: phaseTransitions.toPhase,
          kind: phaseTransitions.kind,
        })
        .from(phaseTransitions)
        .where(eq(phaseTransitions.churchId, church.id));

      assert.equal(
        rows.length,
        1,
        `run ${run}: the race wrote ${rows.length} declaration rows, not 1`
      );
      assert.equal(rows[0].kind, INITIAL_DECLARATION_KIND);
      assert.equal(
        rows[0].fromPhase,
        PRE_DECLARATION_PHASE,
        `run ${run}: from_phase must be where the plant actually sat`
      );
      assert.ok(
        (RACER_PHASES as readonly number[]).includes(rows[0].toPhase),
        `run ${run}: to_phase must be one of the two submitted stages`
      );

      // Exactly one racer is told it declared; the other is refused with a
      // null `transition_id` and reports the stored phase.
      const declaredCount = results.filter(
        (result) => result.rows[0]?.transition_id !== null
      ).length;
      assert.equal(
        declaredCount,
        1,
        `run ${run}: ${declaredCount} racers were told they declared`
      );

      const refused = results.find(
        (result) => result.rows[0]?.transition_id === null
      );
      assert.ok(refused, `run ${run}: nobody was refused`);

      // And the phase moved exactly once — to the winner's stage, never to the
      // loser's, because the UPDATE is sourced from the insert.
      const [after] = await db
        .select({ currentPhase: churches.currentPhase })
        .from(churches)
        .where(eq(churches.id, church.id));
      assert.equal(
        after.currentPhase,
        rows[0].toPhase,
        `run ${run}: current_phase must match the one declaration that landed`
      );

      await db
        .delete(phaseTransitions)
        .where(eq(phaseTransitions.churchId, church.id));
      await db.delete(churches).where(eq(churches.id, church.id));
    }
  }
);

test(
  "the guard is the index, not the statement — a raw duplicate insert is refused",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    // The statement above can only be as safe as the constraint under it. This
    // asserts the constraint directly, so a future rewrite of the CTE chain
    // cannot quietly remove the thing that makes duplicates impossible.
    await sweep();

    const actorId = await createScratchActor();

    const [church] = await db
      .insert(churches)
      .values({ name: SCRATCH_NAME, currentPhase: 0 })
      .returning({ id: churches.id });

    try {
      const row = {
        churchId: church.id,
        fromPhase: 0,
        toPhase: 2,
        initiatedById: actorId,
        reason: "raw insert",
        kind: INITIAL_DECLARATION_KIND,
        rubricVersion: "v0",
      };

      await db.insert(phaseTransitions).values(row);

      await assert.rejects(
        () => db.insert(phaseTransitions).values({ ...row, toPhase: 4 }),
        (error: unknown) => {
          // Drizzle wraps the driver error, so the constraint name is on the
          // `cause`, not on the message it re-throws.
          const text = [
            error instanceof Error ? error.message : String(error),
            error instanceof Error && error.cause instanceof Error
              ? error.cause.message
              : "",
          ].join(" ");
          assert.match(
            text,
            /phase_transitions_initial_declaration_unique_idx/
          );
          return true;
        },
        "a second initial declaration must be refused by the database"
      );

      // An ordinary transition on the same church is NOT refused — the index is
      // partial, and phase history stays append-only for real moves.
      await db
        .insert(phaseTransitions)
        .values({ ...row, kind: "transition", reason: "moved on" });

      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(phaseTransitions)
        .where(eq(phaseTransitions.churchId, church.id));
      assert.equal(n, 2);
    } finally {
      await db
        .delete(phaseTransitions)
        .where(eq(phaseTransitions.churchId, church.id));
      await db.delete(churches).where(eq(churches.id, church.id));
    }
  }
);
