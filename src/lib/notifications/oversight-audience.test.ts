import assert from "node:assert/strict";
import { test } from "node:test";

import { and, eq, exists, sql as rawSql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { churches, userRoles, users, type UserRole } from "@/db/schema";

import {
  noOversightOrg,
  OVERSIGHT_ADMIN,
  OVERSIGHT_ADMIN_ROWS,
  oversightOrgOfKind,
  type OversightOrgIds,
} from "./oversight-admin";
import {
  classifyOversightCandidate,
  listOversightAdminsOfOrg,
  oversightAudienceCondition,
  oversightReachCondition,
} from "./oversight-audience";

// ----------------------------------------------------------------------------
// The audience layer: who the oversight audience is, asked in SQL and answered
// in TypeScript.
//
// Two encodings of ONE decision — `oversightAudienceCondition` renders it as a
// `WHERE`, `classifyOversightCandidate` applies it to a row a wider query
// already returned — so the tie between them is asserted here, over the pairing
// table, rather than promised in a comment. Everything below is pure or
// `.toSQL()`: no live Postgres, the same way `./queries.ts` proves its builders.
// ----------------------------------------------------------------------------

const ADMIN_A = "22222222-2222-4222-8222-222222222222";
const SENDING_CHURCH = "77777777-7777-4777-8777-777777777777";
const NETWORK = "88888888-8888-4888-8888-888888888888";

/** A `users` row as the candidate query projects it. */
function candidate(
  role: UserRole,
  org: Partial<OversightOrgIds> = {}
): Parameters<typeof classifyOversightCandidate>[0] {
  return { id: ADMIN_A, role, ...noOversightOrg(), ...org };
}

/**
 * The predicate as Postgres would see it. `SQL | undefined` in, deliberately:
 * an audience built from loaded ids may be empty, and a helper that refused to
 * render that case would hide the very shape the tests below are about.
 */
const rendered = (where: SQL | undefined) =>
  db.select({ id: users.id }).from(users).where(where).toSQL();

// ----------------------------------------------------------------------------
// `oversightAudienceCondition` itself — the fail-open it must not have (#411)
// ----------------------------------------------------------------------------

test("naming no org matches nobody, never everybody", () => {
  // The `undefined` return is the whole safety of the builder's empty case: an
  // `and()` whose only arm is undefined collapses to "every row in `users`".
  assert.equal(oversightAudienceCondition(users, noOversightOrg()), undefined);

  // THE FAIL-OPEN, RENDERED. What "the caller turns undefined into no
  // recipients" is protecting against, shown rather than asserted in prose: hand
  // that `undefined` to `and()` — as the digest's clause 4 did — and drizzle
  // DROPS the arm, so the correlated `exists (…)` keeps only "the rest" and is
  // satisfied by every row in `users`. Every plant is then owed a digest
  // forever, which is a worse version of the starvation this builder fixes.
  const collapsed = db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        oversightAudienceCondition(users, noOversightOrg()),
        eq(users.role, "planter")
      )
    )
    .toSQL();

  assert.doesNotMatch(collapsed.sql, /sending_church_id|sending_network_id/);
});

test("the non-nullable call is STATICALLY SQL, so the digest cannot re-open the fail-open", () => {
  // The compiler carries this one. Both refs below are columns, never null, so
  // the builder's first overload applies and the annotation below type-checks —
  // exactly the call `plantsOwedDigestQuery` makes. Make either ref nullable and
  // `tsc` fails HERE and at the digest, instead of `and()` silently swallowing
  // the audience at run time. `pnpm typecheck` is the assertion; this runtime
  // check only pins that the value really is a rendered predicate.
  const owedDigestRecipient = alias(users, "owed_digest_recipient");
  const audience: SQL = oversightAudienceCondition(owedDigestRecipient, {
    sendingChurchId: churches.sendingChurchId,
    sendingNetworkId: churches.sendingNetworkId,
  });

  const { sql } = db
    .select({ id: churches.id })
    .from(churches)
    .where(
      exists(
        db
          .select({ one: rawSql`1` })
          .from(users)
          .where(audience)
      )
    )
    .toSQL();

  assert.match(sql.replace(/"/g, ""), /owed_digest_recipient\.role = \$\d+/);
});

// ----------------------------------------------------------------------------
// The SQL half and the TypeScript half are ONE pairing
// ----------------------------------------------------------------------------
//
// A `WHERE` cannot call a TypeScript predicate, so the pairing is written in
// both languages: the digest sweep asks it as SQL to decide who is still owed a
// row, and the fan-out asks it in TypeScript to decide who is a recipient. That
// is exactly the shape that drifted before `OVERSIGHT_ADMIN` existed, and the
// drift starved a plant of its digest. This test is the tie: it walks the
// pairing table and fails if either half is edited alone.

test("each pairing row renders as its own SQL arm AND classifies to itself", () => {
  for (const [kind, { role, fk }] of OVERSIGHT_ADMIN_ROWS) {
    const org = oversightOrgOfKind(kind, SENDING_CHURCH);

    // THE SQL HALF: one arm, naming THIS row's FK column and binding THIS row's
    // role. The column name is read off drizzle rather than written out, so a
    // renamed column moves this assertion with it.
    const { sql, params } = rendered(oversightAudienceCondition(users, org));
    assert.match(
      sql.replace(/"/g, ""),
      new RegExp(`users\\.role = \\$\\d+ and users\\.${users[fk].name} = `),
      `${kind}: the arm pairs the role with its own FK`
    );
    assert.deepEqual(params, [role, SENDING_CHURCH], kind);

    // THE TYPESCRIPT HALF, over the whole role domain: the row's own role is an
    // ordinary recipient…
    assert.deepEqual(
      classifyOversightCandidate(
        candidate(role, { [fk]: SENDING_CHURCH }),
        org
      ),
      { kind: "recipient", id: ADMIN_A },
      `${kind}: the paired role is a recipient`
    );

    // …and EVERY other role carrying that FK classifies to the OTHER side of
    // the partition, never enqueued — the other oversight role and the three
    // church roles alike. A `planter` with a stray `sending_church_id` is the
    // same defect as a cross-paired admin.
    for (const other of userRoles.filter(
      (candidateRole) => candidateRole !== role
    )) {
      assert.deepEqual(
        classifyOversightCandidate(
          candidate(other, { [fk]: SENDING_CHURCH }),
          org
        ),
        { kind: "misprovisioned", id: ADMIN_A, role: other, reachedBy: fk },
        `${kind} reached by ${other}`
      );
    }
  }
});

test("a row that administers ONE of the named orgs is a recipient, not a defect", () => {
  // The plant-wide audience names both orgs at once, and one row can carry both
  // FKs. Judging it FK-by-FK would flag a legitimate network admin because its
  // sending-church id also matched — so the question is asked of the row's own
  // role first, and a match anywhere makes it a recipient.
  const both: OversightOrgIds = {
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: NETWORK,
  };

  assert.deepEqual(
    classifyOversightCandidate(
      candidate(OVERSIGHT_ADMIN.network.role, {
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: NETWORK,
      }),
      both
    ),
    { kind: "recipient", id: ADMIN_A }
  );
});

test("a row matching neither named org is not in this audience at all", () => {
  assert.equal(
    classifyOversightCandidate(
      candidate(OVERSIGHT_ADMIN.sending_church.role, {
        sendingChurchId: "44444444-4444-4444-8444-444444444444",
      }),
      oversightOrgOfKind("sending_church", SENDING_CHURCH)
    ),
    null
  );
});

// ----------------------------------------------------------------------------
// `oversightReachCondition` — the probe, and what it is NOT
// ----------------------------------------------------------------------------

test("the probe matches on the FK alone, and the audience still does not", () => {
  const org = oversightOrgOfKind("sending_church", SENDING_CHURCH);

  const reach = rendered(oversightReachCondition(users, org));
  const audience = rendered(oversightAudienceCondition(users, org));

  // The probe names the FK and no role — that is the whole widening, and it is
  // why its rows must never be enqueued without `classifyOversightCandidate`.
  assert.match(reach.sql.replace(/"/g, ""), /users\.sending_church_id = \$\d+/);
  assert.doesNotMatch(reach.sql.replace(/"/g, ""), /users\.role/);

  // The audience is unchanged: still the pairing, role included.
  assert.match(audience.sql.replace(/"/g, ""), /users\.role = \$\d+/);
});

test("the probe naming no org renders FALSE, which no and() can drop", () => {
  // The audience builder answers the empty case with `undefined` and makes the
  // caller face it through its overloads. The probe has no overloads to lean
  // on, so it answers with `false` instead — the same encoding
  // `invitationRelationship` uses — and there is nothing for drizzle to drop.
  const empty = rendered(oversightReachCondition(users, noOversightOrg()));
  assert.match(empty.sql, /where false/i);
  assert.deepEqual(empty.params, []);

  // The fail-open, attempted: `and()` keeps the arm, so the statement still
  // matches nobody rather than every row in `users`.
  const guarded = db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        oversightReachCondition(users, noOversightOrg()),
        eq(users.role, "planter")
      )
    )
    .toSQL();

  assert.match(guarded.sql, /false/);
});

test("listOversightAdminsOfOrg refuses an org with no ids without touching the database", async () => {
  // The production function, called directly. `namesAnOversightOrg` returns
  // false and the lister returns early, so this asserts the guard rather than
  // the query — and it is the guard that keeps "no org" from becoming a query
  // at all.
  assert.deepEqual(await listOversightAdminsOfOrg(noOversightOrg()), {
    recipients: [],
    misprovisioned: [],
  });
});
