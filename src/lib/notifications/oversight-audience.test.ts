import assert from "node:assert/strict";
import { test } from "node:test";

import { and, eq, exists, sql as rawSql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { churches, users } from "@/db/schema";

import {
  noOversightOrg,
  OVERSIGHT_ADMIN_ROWS,
  oversightOrgOfKind,
  type OversightOrgIds,
} from "./oversight-admin";
import {
  classifyOversightCandidate,
  type TenancyColumn,
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

/**
 * A `users` row as the candidate query projects it — its id and all THREE
 * tenancy FKs, because that is what `oversightOrgOf` reads.
 */
function candidate(
  tenancy: Partial<OversightOrgIds> & { churchId?: string | null } = {}
): Parameters<typeof classifyOversightCandidate>[0] {
  return { id: ADMIN_A, churchId: null, ...noOversightOrg(), ...tenancy };
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
        eq(users.seat, "owner")
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

  assert.match(
    sql.replace(/"/g, ""),
    /owed_digest_recipient\.church_id is null/
  );
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
  for (const [kind, { fk }] of OVERSIGHT_ADMIN_ROWS) {
    const org = oversightOrgOfKind(kind, SENDING_CHURCH);
    const others = OVERSIGHT_ADMIN_ROWS.map(([, row]) => row.fk).filter(
      (other) => other !== fk
    );

    // THE SQL HALF: one arm naming THIS row's FK column, AND the rest of the
    // exactly-one-tenancy rule — `church_id` null and every other oversight FK
    // null. That conjunction is what the role used to be. Column names are read
    // off drizzle rather than written out, so a rename moves this with it.
    const { sql, params } = rendered(oversightAudienceCondition(users, org));
    const bare = sql.replace(/"/g, "");
    assert.match(
      bare,
      new RegExp(`users\\.${users[fk].name} = \\$\\d+`),
      `${kind}: the arm names its own FK`
    );
    assert.match(
      bare,
      /users\.church_id is null/,
      `${kind}: a plant tenancy is not this org`
    );
    for (const other of others) {
      assert.match(
        bare,
        new RegExp(`users\\.${users[other].name} is null`),
        `${kind}: a second oversight tenancy is not this org either`
      );
    }
    assert.deepEqual(params, [SENDING_CHURCH], kind);

    // THE TYPESCRIPT HALF: a row whose ONLY tenancy is this org is an ordinary
    // recipient…
    assert.deepEqual(
      classifyOversightCandidate(candidate({ [fk]: SENDING_CHURCH }), org),
      { kind: "recipient", id: ADMIN_A },
      `${kind}: the org's own account is a recipient`
    );

    // …and every row REACHED by that FK while naming another tenancy too lands
    // on the other side of the partition, never enqueued. A plant Member with a
    // stray `sending_church_id` is the same defect as an account carrying both
    // oversight FKs: neither resolves to an org.
    //
    // THE PAYLOAD NAMES BOTH COMPETING COLUMNS — which is the point of `names`.
    // It replaced an `administers` field that was provably always null here, so
    // asserting it proved only that the branch had been taken.
    const crossTenanted: [string, TenancyColumn, Record<string, string>][] = [
      [
        "a plant tenancy",
        "churchId",
        { churchId: "cccccccc-1111-4111-8111-111111111111" },
      ],
      ...others.map(
        (other): [string, TenancyColumn, Record<string, string>] => [
          "a second oversight tenancy",
          other,
          { [other]: NETWORK },
        ]
      ),
    ];

    for (const [what, alsoNames, extra] of crossTenanted) {
      const classified = classifyOversightCandidate(
        candidate({ [fk]: SENDING_CHURCH, ...extra }),
        org
      );

      assert.equal(classified?.kind, "misprovisioned", what);
      assert.equal(
        classified?.kind === "misprovisioned" && classified.reachedBy,
        fk,
        `${kind} reached by a row that also names ${what}`
      );
      assert.deepEqual(
        classified?.kind === "misprovisioned" && [...classified.names].sort(),
        [fk, alsoNames].sort(),
        `${kind}: the log names BOTH competing columns, which is what an operator repairs from`
      );
    }
  }
});

test("a row naming BOTH oversight orgs is a defect, not a recipient of either", () => {
  // THIS EXPECTATION CHANGED WITH THE SEAT MODEL, deliberately. While
  // `users.role` existed, a row carrying both FKs was resolvable — its role
  // said which org it spoke for — so a `network_admin` carrying a stray
  // `sending_church_id` was a legitimate recipient of the NETWORK's fan-out.
  // With the role dropped (#494) nothing breaks that tie, and inventing a
  // precedence would hand one org's fan-out to an account with a competing
  // claim on the other. So the row resolves to no org and is COUNTED as the
  // defect it is (`oversightOrgOf`, `@/lib/auth/tenancy`) rather than mailed.
  const both: OversightOrgIds = {
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: NETWORK,
  };

  assert.deepEqual(
    classifyOversightCandidate(
      candidate({ sendingChurchId: SENDING_CHURCH, sendingNetworkId: NETWORK }),
      both
    ),
    {
      kind: "misprovisioned",
      id: ADMIN_A,
      names: ["sendingChurchId", "sendingNetworkId"],
      reachedBy: "sendingChurchId",
    }
  );
});

test("a row matching neither named org is not in this audience at all", () => {
  assert.equal(
    classifyOversightCandidate(
      candidate({ sendingChurchId: "44444444-4444-4444-8444-444444444444" }),
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

  // The probe names the FK and nothing else — that is the whole widening, and
  // it is why its rows must never be enqueued without
  // `classifyOversightCandidate`.
  assert.match(reach.sql.replace(/"/g, ""), /users\.sending_church_id = \$\d+/);
  assert.doesNotMatch(reach.sql.replace(/"/g, ""), /is null/);

  // The audience still carries the rest of the exactly-one-tenancy rule.
  assert.match(audience.sql.replace(/"/g, ""), /users\.church_id is null/);
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
        eq(users.seat, "owner")
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
