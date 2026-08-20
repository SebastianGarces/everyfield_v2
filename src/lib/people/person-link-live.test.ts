import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { and, eq, isNull, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { churchPrivacySettings, churches, persons, users } from "@/db/schema";
import { createAccountEntities } from "@/app/(auth)/register/account-entities";
import { getGroupRecipients } from "@/lib/communication/recipient-groups";
import { getDashboardMetrics } from "@/lib/dashboard/service";
import {
  churchCreationStatements,
  discardChurchStatements,
} from "@/lib/onboarding/create-church";
import { getLeadershipCandidates } from "@/lib/phase-engine/signals/queries";

// ----------------------------------------------------------------------------
// AS-013 (#378) — THE PERSON↔USER LINK, AGAINST A REAL POSTGRES.
//
// WHY THIS IS NOT A UNIT TEST. Every property below is a property of the
// DATABASE, and no SQL-string assertion can see any of them:
//
//   * idempotence is `persons_church_user_unique_idx` refusing the second row,
//     which only a real index can do (`memory/invariants.md` → Transactions:
//     SELECT-then-INSERT is not a guard, so there is no application check to
//     assert instead);
//   * the two church-gain paths issuing the SAME writes is a claim about what
//     COMMITS, not about what renders — `createAccountEntities` spreads
//     `churchCreationStatements` whole, and this runs both and compares rows;
//   * the delete isolation in both directions is FK behaviour: the soft delete
//     leaves the account alone, and the FK refuses a hard delete of an account
//     a person still names.
//
// So it is OPT-IN — `LIVE_DB_TESTS=1 pnpm test:live` — on the same flag,
// reachability probe and namespaced sweep as `teams-init-race.test.ts`.
//
// Everything it writes is namespaced by `SCRATCH_NAME` and swept in `after`,
// including on failure.
// ----------------------------------------------------------------------------

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — a real Postgres is the only place a unique index and an FK can be observed";

const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so the link did NOT run";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** Namespaces every row this file writes, so the sweep cannot touch real data. */
const SCRATCH_NAME = "__t378 person link scratch__";

async function sweep(): Promise<void> {
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, SCRATCH_NAME));

  for (const church of scratch) {
    await db.delete(persons).where(eq(persons.churchId, church.id));
    await db
      .delete(churchPrivacySettings)
      .where(eq(churchPrivacySettings.churchId, church.id));
    await db
      .update(users)
      .set({ churchId: null })
      .where(eq(users.name, SCRATCH_NAME));
    await db.delete(churches).where(eq(churches.id, church.id));
  }

  await db.delete(users).where(eq(users.name, SCRATCH_NAME));
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

/**
 * An account with no plant yet — the shape both church-gain paths start from.
 *
 * MINTED, NEVER BORROWED, for the reason `teams-init-race.test.ts` spells out:
 * a suite that writes only inside its own namespace has to own its actor too,
 * or a parallel run's sweep collides with this one's FKs.
 */
async function scratchAccount(name: string | null): Promise<{
  id: string;
  email: string;
}> {
  const email = `${crypto.randomUUID()}@scratch.invalid`;
  const [account] = await db
    .insert(users)
    .values({ email, passwordHash: "scratch", name, seat: "owner" })
    .returning({ id: users.id });

  // The scratch namespace lives in `users.name`, which this suite also uses as
  // real data. Stamped separately so a null-name account is still swept.
  await db
    .update(users)
    .set({ name: name ?? SCRATCH_NAME })
    .where(eq(users.id, account.id));

  return { id: account.id, email };
}

function gainChurch(
  account: { id: string; email: string },
  name: string | null
) {
  return churchCreationStatements({
    churchId: crypto.randomUUID(),
    plantedBy: account.id,
    plantedByName: name,
    plantedByEmail: account.email,
    name: SCRATCH_NAME,
    city: null,
    stateRegion: null,
    country: null,
  });
}

/**
 * The driver wraps a Postgres error, so the constraint name is on `cause` and
 * NOT on `message` — which reads "Failed query: …". A regex against the message
 * therefore passes for any failure at all, including the wrong one.
 */
function causeOf(error: unknown): string {
  return String((error as { cause?: unknown })?.cause ?? error);
}

async function linkedPersonOf(userId: string) {
  const [person] = await db
    .select()
    .from(persons)
    .where(eq(persons.userId, userId));
  return person ?? null;
}

test(
  "gaining a church mints the Owner a linked person, at `leader` and not `prospect`",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    const account = await scratchAccount(SCRATCH_NAME);
    const statements = gainChurch(account, "Grace Q Planter");
    await db.batch(statements);

    const person = await linkedPersonOf(account.id);
    assert.ok(person, "the Owner has a person row in their own plant");
    assert.equal(person.firstName, "Grace");
    assert.equal(person.lastName, "Q Planter");
    assert.equal(person.email, account.email);
    // Not `prospect`: the planter is not a recruit in their own pipeline.
    assert.equal(person.status, "leader");
    assert.equal(person.deletedAt, null);

    // TENANCY. The row lands in the plant this account just gained and nowhere
    // else — `persons.church_id` is the only thing keeping one plant's people
    // out of another's, and there is no RLS behind it.
    const [owner] = await db
      .select({ churchId: users.churchId })
      .from(users)
      .where(eq(users.id, account.id));
    assert.equal(person.churchId, owner.churchId);
  }
);

test(
  "replaying the person insert is a no-op, not a second planter",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // WHAT THIS PROVES, PRECISELY. `ON CONFLICT (church_id, user_id) WHERE
    // user_id IS NOT NULL` only works if Postgres can infer that
    // `persons_church_user_unique_idx` covers every row the statement could
    // conflict on — and whether it manages that is a property of the live
    // index, which is why the assertion is here and not in a rendered-SQL test.
    // When inference fails there is no degraded mode: it is "there is no unique
    // or exclusion constraint matching the ON CONFLICT specification" on EVERY
    // church creation.
    //
    // The statement is replayed rather than the whole tuple, because the tuple
    // mints a FRESH church id per attempt — its own second send fails on
    // `churches_pkey` long before reaching here, which would be a test of the
    // wrong thing.
    const account = await scratchAccount(SCRATCH_NAME);
    const statements = gainChurch(account, "Retry Planter");
    await db.batch(statements);

    const personInsert = statements[3];
    await personInsert;
    await personInsert.execute();

    const rows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.userId, account.id));

    assert.equal(rows.length, 1, `the replay wrote ${rows.length} person rows`);
  }
);

test(
  "the guard is the INDEX — a raw duplicate link is refused outright",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // The statement above can only be as safe as the constraint under it, so
    // the constraint is asserted directly: a rewrite of the batch cannot
    // quietly remove what makes the duplicate impossible.
    const account = await scratchAccount(SCRATCH_NAME);
    await db.batch(gainChurch(account, "Index Planter"));
    const person = await linkedPersonOf(account.id);
    assert.ok(person);

    await assert.rejects(
      () =>
        db.insert(persons).values({
          churchId: person.churchId,
          userId: account.id,
          createdBy: account.id,
          firstName: "Duplicate",
          lastName: "Planter",
          status: "leader",
        }),
      (error: unknown) => {
        assert.match(causeOf(error), /persons_church_user_unique_idx/);
        return true;
      }
    );

    // …and an UNLINKED contact is not caught by it, which is the whole point of
    // the partial predicate: a plant may hold any number of people with no
    // account behind them.
    const [contact] = await db
      .insert(persons)
      .values({
        churchId: person.churchId,
        userId: null,
        createdBy: account.id,
        firstName: "Ordinary",
        lastName: "Contact",
        status: "prospect",
      })
      .returning({ id: persons.id });
    assert.ok(contact.id);
  }
);

test(
  "both church-gain paths write the same person — registration spreads the same tuple",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // Onboarding step 1.
    const viaOnboarding = await scratchAccount(SCRATCH_NAME);
    await db.batch(gainChurch(viaOnboarding, "Same Planter"));

    // An INVITED planter, through the registration planner. Nothing about the
    // person row is spelled there: `createAccountEntities` spreads
    // `churchCreationStatements` whole (ruling 408-4B), which is exactly the
    // property this asserts.
    const viaRegistration = await scratchAccount(SCRATCH_NAME);
    const planned = createAccountEntities(
      "planter",
      SCRATCH_NAME,
      viaRegistration.id,
      { name: "Same Planter", email: viaRegistration.email },
      true
    );
    await db.batch(
      planned.linkStatements as [
        (typeof planned.linkStatements)[number],
        ...(typeof planned.linkStatements)[number][],
      ]
    );

    const a = await linkedPersonOf(viaOnboarding.id);
    const b = await linkedPersonOf(viaRegistration.id);
    assert.ok(a, "onboarding minted one");
    assert.ok(b, "registration minted one");

    for (const field of ["firstName", "lastName", "status"] as const) {
      assert.equal(
        b[field],
        a[field],
        `the two paths disagree about ${field} — the tuple is no longer shared`
      );
    }
  }
);

test(
  "deleting the person leaves the account, and the account cannot be deleted out from under it",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    const account = await scratchAccount(SCRATCH_NAME);
    await db.batch(gainChurch(account, "Isolated Planter"));
    const person = await linkedPersonOf(account.id);
    assert.ok(person);

    // Person → user. A soft delete is a tombstone on the CRM record; the login
    // is untouched, which is what keeps "I removed myself from the people list"
    // from meaning "I deleted my account".
    await db
      .update(persons)
      .set({ deletedAt: new Date() })
      .where(eq(persons.id, person.id));

    const [stillThere] = await db
      .select({ id: users.id, seat: users.seat })
      .from(users)
      .where(eq(users.id, account.id));
    assert.ok(stillThere, "the account survives its person row's deletion");
    assert.equal(stillThere.seat, "owner", "and keeps its seat");

    // …and the link still names it, so undeleting restores the same identity
    // rather than minting a second row.
    const [tombstoned] = await db
      .select({ userId: persons.userId })
      .from(persons)
      .where(eq(persons.id, person.id));
    assert.equal(tombstoned.userId, account.id);

    // User → person. Both of the FKs `persons` points at `users` with —
    // `user_id` and the older `created_by` — carry no ON DELETE action, so an
    // account a person record still names cannot be hard-deleted around it.
    // That is the honest behaviour: the application has no such path, and a
    // silent SET NULL would orphan the plant's record of who its Owner is.
    // Which of the two fires first is Postgres's business; that it is one of
    // THEM, and not some unrelated failure, is the assertion.
    await assert.rejects(
      () => db.delete(users).where(eq(users.id, account.id)),
      (error: unknown) => {
        assert.match(
          causeOf(error),
          /violates foreign key constraint "persons_(user_id|created_by)_users_id_fk"/
        );
        return true;
      }
    );
  }
);

test(
  "the lost-race sweep takes the person row with the church it discards",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // #198's cleanup: the LOSER of a double submit commits its own church and
    // then sweeps it up. The person row carries `church_id`, so leaving it
    // behind does not litter — it makes the `churches` delete fail on the FK
    // and the orphan survives forever, which is the defect that sweep exists
    // to prevent.
    const account = await scratchAccount(SCRATCH_NAME);
    const statements = gainChurch(account, "Loser Planter");
    await db.batch(statements);

    const person = await linkedPersonOf(account.id);
    assert.ok(person);
    const churchId = person.churchId;

    // Unlink the account, which is the state a lost compare-and-set leaves:
    // a church nobody is pointing at.
    await db
      .update(users)
      .set({ churchId: null })
      .where(eq(users.id, account.id));

    await db.batch(discardChurchStatements(churchId));

    const remaining = await db
      .select({ id: churches.id })
      .from(churches)
      .where(eq(churches.id, churchId));
    assert.equal(remaining.length, 0, "the discarded church is gone");

    const orphans = await db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.churchId, churchId), isNull(persons.deletedAt)));
    assert.equal(orphans.length, 0, "and so is its person row");
  }
);

// ----------------------------------------------------------------------------
// THE BLAST RADIUS OF `status = 'leader'` (#378, review finding 1).
//
// The planter's row sits at the TOP of the recruitment pipeline, which is the
// honest value for it — and that is exactly why the three reads that MEASURE
// recruiting had to be told about it. Each of these is a backfilled plant with
// nothing in it but its Owner: the correct answer to all three is "nothing
// yet", and before `isRecruitedContact()` all three answered "one".
//
// A live suite because every one of them is a SQL predicate. A unit test would
// have to re-implement the query to assert it, which is the same bug written
// twice.
// ----------------------------------------------------------------------------

/** A plant whose ONLY person is its Owner — a fresh plant, post-backfill. */
async function plantWithOnlyItsOwner() {
  const account = await scratchAccount(SCRATCH_NAME);
  await db.batch(gainChurch(account, "Solo Planter"));
  const person = await linkedPersonOf(account.id);
  assert.ok(person, "the fixture depends on the church-gain batch minting one");
  return { account, person, churchId: person.churchId };
}

test(
  "the dashboard's Core Group opens at ZERO on a plant that has gathered nobody",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    const plant = await plantWithOnlyItsOwner();
    const metrics = await getDashboardMetrics(plant.churchId, plant.account.id);

    assert.equal(
      metrics.coreGroupSize,
      0,
      "the metric counted the planter as somebody the plant gathered"
    );
    // …and `totalPeople` still counts them, which is the distinction: the
    // planter IS in the plant's people, they are just not a recruit.
    assert.equal(metrics.totalPeople, 1);
  }
);

test(
  "the phase engine sees no leadership candidate the plant never developed",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    const plant = await plantWithOnlyItsOwner();

    assert.deepEqual(
      await getLeadershipCandidates(plant.churchId),
      [],
      "a plant one minute old was credited with raising up a leader"
    );
  }
);

test(
  "the Leaders quick-select does not put the sender in their own audience",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    const plant = await plantWithOnlyItsOwner();

    assert.deepEqual(
      await getGroupRecipients(plant.churchId, "leaders"),
      [],
      "composing to Leaders would have emailed the planter themselves"
    );

    // `all` is NOT a cohort — it is the people list, and the planter is really
    // in it. This is the line the exclusion must not cross.
    const everyone = await getGroupRecipients(plant.churchId, "all");
    assert.deepEqual(
      everyone.map((person) => person.id),
      [plant.person.id],
      "`all` must still mean everyone"
    );
  }
);

test(
  "the discard sweep cannot empty a plant's contact list",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // Review finding 2. `noUserLinkedTo` asks whether anybody HOLDS this
    // church; it says nothing about which of its PEOPLE may be deleted, and
    // `church_id` alone named all of them. A church that has acquired contacts
    // is not a discardable shell whatever its links say — so the sweep is
    // scoped to the one row it minted, and the `churches` delete then fails
    // LOUDLY on the FK rather than quietly taking the contacts with it.
    const plant = await plantWithOnlyItsOwner();
    const [contact] = await db
      .insert(persons)
      .values({
        churchId: plant.churchId,
        userId: null,
        createdBy: plant.account.id,
        firstName: "Real",
        lastName: "Contact",
        status: "prospect",
      })
      .returning({ id: persons.id });

    await db
      .update(users)
      .set({ churchId: null })
      .where(eq(users.id, plant.account.id));

    await assert.rejects(
      () => db.batch(discardChurchStatements(plant.churchId)),
      (error: unknown) => {
        assert.match(
          causeOf(error),
          /violates foreign key constraint "persons_church_id_churches_id_fk"/
        );
        return true;
      }
    );

    const survivors = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.churchId, plant.churchId));
    assert.ok(
      survivors.some((person) => person.id === contact.id),
      "the sweep deleted a contact the plant really had"
    );
  }
);
