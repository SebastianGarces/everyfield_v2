import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { eq, like, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  coachAssignments,
  sendingChurches,
  sendingNetworks,
  users,
} from "@/db/schema";
import {
  canAccessFeatureData,
  getAccessibleChurchIds,
} from "@/lib/auth/access";
import type { User } from "@/db/schema";

// ----------------------------------------------------------------------------
// WHICH CHURCHES AN ACCOUNT REACHES, read from (tenancy, seat) instead of from
// `users.role` (#494).
//
// THE PROPERTY THIS SUITE OWNS is that the answer did not MOVE. `role` was a
// switch with five arms and the seat model has three tenancies and a nullable
// seat, so the five old answers have to come out of the new shape unchanged —
// a plant seat reaches its plant, a seatless account reaches its assignments,
// an oversight tenancy reaches its portfolio. Every case below is named after
// the role it used to be so the before/after reads as one line.
//
// WHY LIVE. Two of the five arms are queries — the coach's assignments and the
// two portfolio reads — and the interesting cases are precisely the ones where
// a row's columns disagree (a coach who also carries a `church_id`, an account
// naming two tenancies). A stubbed `db` would prove the branch was taken, not
// the set that came back.
//
// OPT-IN, against a real database: `LIVE_DB_TESTS=1 pnpm test`, or the
// `test:live` lane. Everything written here is namespaced by `SCRATCH_NAME`
// and swept in `after`.
// ----------------------------------------------------------------------------

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test` with a reachable DATABASE_URL — three of the five arms are queries";

const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so the reach was NOT resolved";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const SCRATCH_NAME = "__t494 accessible churches scratch__";

const scratchEmail = () => `${crypto.randomUUID()}@scratch.invalid`;

async function sweep(): Promise<void> {
  // `coach_assignments` carries no name of its own, so it is swept by the
  // scratch CHURCHES it points at — and before the churches, which it
  // references.
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, SCRATCH_NAME));

  for (const church of scratch) {
    await db
      .delete(coachAssignments)
      .where(eq(coachAssignments.churchId, church.id));
  }

  await db.delete(users).where(like(users.name, SCRATCH_NAME));
  await db.delete(churches).where(like(churches.name, SCRATCH_NAME));
  await db
    .delete(sendingChurches)
    .where(like(sendingChurches.name, SCRATCH_NAME));
  await db
    .delete(sendingNetworks)
    .where(like(sendingNetworks.name, SCRATCH_NAME));
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

/** A whole `users` row around the four columns the reach is resolved from. */
function account(overrides: Partial<User>): User {
  return {
    id: crypto.randomUUID(),
    email: scratchEmail(),
    passwordHash: "scratch",
    name: SCRATCH_NAME,
    seat: null,
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

/**
 * One network, one sending church inside it, and two plants: one belonging to
 * both orgs, one belonging to neither.
 */
async function scratchWorld() {
  const [network] = await db
    .insert(sendingNetworks)
    .values({ name: SCRATCH_NAME })
    .returning({ id: sendingNetworks.id });

  const [sendingChurch] = await db
    .insert(sendingChurches)
    .values({ name: SCRATCH_NAME, sendingNetworkId: network.id })
    .returning({ id: sendingChurches.id });

  const [mine] = await db
    .insert(churches)
    .values({
      name: SCRATCH_NAME,
      currentPhase: 1,
      sendingChurchId: sendingChurch.id,
      sendingNetworkId: network.id,
      onboardingCompletedAt: new Date(),
    })
    .returning({ id: churches.id });

  const [unaffiliated] = await db
    .insert(churches)
    .values({
      name: SCRATCH_NAME,
      currentPhase: 1,
      onboardingCompletedAt: new Date(),
    })
    .returning({ id: churches.id });

  return {
    networkId: network.id,
    sendingChurchId: sendingChurch.id,
    plantId: mine.id,
    otherPlantId: unaffiliated.id,
  };
}

test(
  "a plant seat reaches its own plant, whichever seat it is",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    const world = await scratchWorld();

    // `planter` and `team_member` both answered `[user.churchId]` before, and the
    // seat is not consulted: access is what the TENANCY reaches, and an org
    // Member reads what its Owner reads (ruling 185 (3)). The seat decides what
    // may be DONE, which is a different question.
    for (const seat of ["owner", "admin", "member"] as const) {
      assert.deepEqual(
        await getAccessibleChurchIds(
          account({ seat, churchId: world.plantId })
        ),
        [world.plantId],
        seat
      );
    }
  }
);

test(
  "a seatless account reaches its coach assignments, not its church_id",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    const world = await scratchWorld();

    // THE CASE THE SEED ACTUALLY HOLDS. A coach carries a `church_id` — the plant
    // they coach — and the old `role` switch ignored it, answering from
    // `coach_assignments` alone. It still does: the seat, not the FK, is what
    // says this account holds no seat in that plant.
    const [coach] = await db
      .insert(users)
      .values(account({ seat: null, churchId: world.plantId }))
      .returning({ id: users.id });

    assert.deepEqual(
      await getAccessibleChurchIds(
        account({ id: coach.id, seat: null, churchId: world.plantId })
      ),
      [],
      "a coach with no assignment reaches nothing, however its church_id reads"
    );

    await db.insert(coachAssignments).values({
      coachUserId: coach.id,
      churchId: world.otherPlantId,
      status: "active",
    });

    assert.deepEqual(
      await getAccessibleChurchIds(
        account({ id: coach.id, seat: null, churchId: world.plantId })
      ),
      [world.otherPlantId],
      "the assignment is the reach — and it is a DIFFERENT plant from the FK"
    );
  }
);

test(
  "an oversight tenancy reaches the plants its org holds",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    const world = await scratchWorld();

    assert.deepEqual(
      await getAccessibleChurchIds(
        account({ seat: "owner", sendingChurchId: world.sendingChurchId })
      ),
      [world.plantId],
      "a sending church reaches the plants whose churches.sending_church_id is it"
    );

    assert.deepEqual(
      await getAccessibleChurchIds(
        account({ seat: "owner", sendingNetworkId: world.networkId })
      ),
      [world.plantId],
      "a network reaches the plants whose churches.sending_network_id is it"
    );

    // An org Member reads the same portfolio as its Owner — the seat is not an
    // input here (ruling 185 (3)).
    assert.deepEqual(
      await getAccessibleChurchIds(
        account({ seat: "member", sendingNetworkId: world.networkId })
      ),
      [world.plantId]
    );
  }
);

test(
  "an account naming TWO tenancies reaches nothing at all",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    const world = await scratchWorld();

    // The shape migration 0050 §1 repaired twelve of. `role` used to break the
    // tie; nothing does now, so the account resolves to no oversight org, holds
    // no unambiguous plant tenancy, and falls through to an assignment lookup
    // that finds none. It fails CLOSED in both directions rather than being
    // handed whichever tenancy a precedence order picked.
    const [defect] = await db
      .insert(users)
      .values(
        account({
          seat: "owner",
          churchId: world.plantId,
          sendingNetworkId: world.networkId,
        })
      )
      .returning({ id: users.id });

    assert.deepEqual(
      await getAccessibleChurchIds(
        account({
          id: defect.id,
          seat: "owner",
          churchId: world.plantId,
          sendingNetworkId: world.networkId,
        })
      ),
      []
    );
  }
);

test(
  "the privacy toggles gate an oversight tenancy and exempt everyone else",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    const world = await scratchWorld();

    // Unchanged from the role model: a church-level account is not subject to the
    // toggles, and an oversight one is — with no `church_privacy_settings` row
    // the defaults are all false, so it is refused.
    for (const seat of ["owner", "member", null] as const) {
      assert.equal(
        await canAccessFeatureData(
          account({ seat, churchId: seat === null ? null : world.plantId }),
          world.plantId,
          "people"
        ),
        true,
        `church-level (${seat ?? "no seat"}) is exempt`
      );
    }

    assert.equal(
      await canAccessFeatureData(
        account({ seat: "owner", sendingNetworkId: world.networkId }),
        world.plantId,
        "people"
      ),
      false,
      "an oversight tenancy is gated, and the default is closed"
    );
  }
);
