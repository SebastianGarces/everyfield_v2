import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getTableColumns } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { churchPrivacySettings } from "@/db/schema";
import {
  SHARING_TOGGLE_COLUMNS,
  allSharingOn,
} from "@/lib/auth/sharing-columns";
import { churchCreationStatements } from "@/lib/onboarding/create-church";
import { createAccountEntities } from "@/app/(auth)/register/account-entities";
import { sourceReader } from "@/lib/testing/source-span";

import { sharingDefaultsStatement, type InvitationActor } from "./core";

// ============================================================================
// CS-013 (#620) — invite-origin sharing defaults.
//
// The ruling (2026-08-15 §187) is three claims, and they fail in three
// different ways, so they are tested three different ways:
//
//   1. A plant that JOINS AN ORG starts sharing everything, and the write is
//      the ACCEPTANCE's — read off the generated SQL, because "in the same
//      batch" is not observable from behaviour without a live Postgres and is
//      exactly what a later edit splits into a follow-up write by accident.
//   2. A SELF-STARTED plant starts sharing nothing, and the DB column defaults
//      stay FALSE. Read off the creation statements and off the schema.
//   3. The write covers EXACTLY the toggles the schema has. Read off the table,
//      never off a list in this file — a hand-written expectation here would go
//      stale the same way the write it is checking would.
//
// The two ACCEPTANCE PATHS are one statement, which is the design: an invited
// planter's registration hands off to `redeemRegistrationInvitation`, which
// calls the same `acceptInvitationAs` the association screen does. §4 pins that
// hand-off, because it is the only thing making one statement enough for two
// paths.
// ============================================================================

const ACTOR = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
} as unknown as InvitationActor;

const INVITATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const REGISTER = sourceReader(
  readFileSync(
    path.join(process.cwd(), "src", "app", "(auth)", "register", "actions.ts"),
    "utf8"
  ),
  "register/actions.ts"
);

const CORE = sourceReader(
  readFileSync(
    path.join(process.cwd(), "src", "lib", "invitations", "core.ts"),
    "utf8"
  ),
  "invitations/core.ts"
);

/**
 * A batched statement, read as the SQL it will send.
 *
 * `BatchItem<"pg">` is the union `db.batch` accepts and it hides `toSQL`, which
 * every member of it has. The cast is the test's, never the application's — the
 * statement is exactly what this suite asserts about. Same helper, same reason,
 * as `seat.test.ts`.
 */
const asQuery = (statement: BatchItem<"pg">) =>
  statement as unknown as { toSQL(): { sql: string; params: unknown[] } };

/** The `share_*` column names as the DATABASE spells them, off the table. */
const DB_TOGGLE_COLUMNS = Object.values(getTableColumns(churchPrivacySettings))
  .filter((column) => column.dataType === "boolean")
  .map((column) => column.name);

// ----------------------------------------------------------------------------
// §1 — the column set is the SCHEMA's (AC5)
// ----------------------------------------------------------------------------

test("the toggle set is every boolean column the privacy table has", () => {
  // Keyed to the schema, not to a list. #62's wiki toggle is one column away
  // from existing, and the failure a hand-written list produces is an invited
  // plant sharing six things out of seven with no screen saying which.
  assert.deepEqual(
    [...SHARING_TOGGLE_COLUMNS].sort(),
    Object.entries(getTableColumns(churchPrivacySettings))
      .filter(([, column]) => column.dataType === "boolean")
      .map(([property]) => property)
      .sort()
  );

  // The non-toggle columns are excluded by their TYPE, so nothing has to
  // remember to exclude them. Asserted positively: a `boolean` added to any of
  // these names would be a real toggle and should join the set.
  for (const notAToggle of ["id", "churchId", "updatedAt", "updatedBy"]) {
    assert.ok(
      !SHARING_TOGGLE_COLUMNS.includes(notAToggle as never),
      `${notAToggle} is not a sharing toggle`
    );
  }

  // Seven today: the six pull toggles and the push toggle. Stated as a floor
  // rather than an equality so a new toggle does not fail this line for
  // existing — the deepEqual above is what holds the set to the schema.
  assert.ok(SHARING_TOGGLE_COLUMNS.length >= 7);
});

test("all-on means all of them, every time it is asked", () => {
  const on = allSharingOn();

  assert.deepEqual(
    Object.keys(on).sort(),
    [...SHARING_TOGGLE_COLUMNS].sort(),
    "the value names a different set than the column list"
  );
  assert.ok(
    Object.values(on).every((value) => value === true),
    "a toggle is not being turned on"
  );

  // A FRESH OBJECT PER CALL. It is spread into a Drizzle `.set()` beside
  // `updatedAt`, and a shared frozen-by-convention object is one careless
  // mutation away from a partial default no test would see.
  const again = allSharingOn();
  assert.notEqual(on, again);
  assert.deepEqual(on, again);
});

// ----------------------------------------------------------------------------
// §2 — the acceptance write (AC1, AC2)
// ----------------------------------------------------------------------------

test("the acceptance turns every sharing column on", () => {
  const { sql, params } = sharingDefaultsStatement(
    ACTOR,
    INVITATION_ID
  ).toSQL();

  for (const column of DB_TOGGLE_COLUMNS) {
    assert.match(
      sql,
      new RegExp(`"${column}" = \\$\\d+`),
      `the accept never writes ${column}`
    );
  }

  // …and it writes TRUE, not merely something. One bound `true` per toggle,
  // ahead of the timestamp and the actor — a `false` slipping into this list
  // would still match every assertion above.
  assert.deepEqual(
    params.slice(0, DB_TOGGLE_COLUMNS.length),
    DB_TOGGLE_COLUMNS.map(() => true)
  );

  // The planter who accepted, so the table's one piece of provenance names the
  // person who read the consent copy rather than reading as "the system did it".
  assert.ok(params.includes(ACTOR.id), "the accept records no author");
});

test("the write is gated on the claim, so a lost accept shares nothing", () => {
  const { sql, params } = sharingDefaultsStatement(
    ACTOR,
    INVITATION_ID
  ).toSQL();

  // `db.batch` is all-or-nothing on FAILURE only — a zero-row UPDATE is a
  // success — so a lost claim rolls NOTHING back. Without this predicate a
  // planter whose accept was refused would be told so while their plant quietly
  // started sharing, which is the one outcome the consent copy cannot survive.
  assert.match(sql, /exists \(/);
  assert.match(sql, /"organization_invitations"\."status" = \$\d+/);
  assert.ok(params.includes("accepted"), "the claim is not re-asserted");
  assert.ok(params.includes(INVITATION_ID));
});

test("the write reaches only the plant THIS invitation names", () => {
  const { sql } = sharingDefaultsStatement(ACTOR, INVITATION_ID).toSQL();

  // The correlation is the whole tenancy guard AND the reason the statement
  // needs no type switch: the privacy row is joined to the invitation's own
  // `target_church_id`. An uncorrelated EXISTS would turn every plant in the
  // database on the moment any invitation was accepted.
  assert.match(
    sql,
    /"organization_invitations"\."target_church_id" = "church_privacy_settings"\."church_id"/
  );

  // No unqualified UPDATE. The WHERE is the EXISTS and nothing else, so there is
  // no second predicate to get wrong — but there must be one.
  assert.match(sql, /where exists \(/);
});

test("an invitation with no plant in it is TOTAL, not skipped", () => {
  // `sending_church_to_network` names no church, so `target_church_id` is NULL
  // and `NULL = church_id` is never true: the statement matches no row and
  // writes nothing, with no branch anybody can later make reachable.
  //
  // Read off the SOURCE because that is where the property lives — the rendered
  // SQL is identical for all three types, which IS the claim. A type switch here
  // would give `acceptInvitationAs` a second batch shape, the thing the OV-008
  // audit rule spent a round removing.
  const builder = CORE.span(
    "export function sharingDefaultsStatement",
    "* Verify the actor has authority"
  );

  assert.doesNotMatch(builder, /switch \(/);
  assert.doesNotMatch(builder, /requireAssociationPair/);
  assert.doesNotMatch(builder, /case "church_to/);
});

// ----------------------------------------------------------------------------
// §3 — the self-started plant (AC3)
// ----------------------------------------------------------------------------

test("a self-started plant is created sharing nothing", () => {
  const statements = churchCreationStatements({
    churchId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    plantedBy: ACTOR.id,
    plantedByName: "A Planter",
    plantedByEmail: "planter@example.com",
    name: "Grace Plant",
    city: null,
    stateRegion: null,
    country: null,
  });

  const privacyInsert = statements
    .map((statement) => statement.toSQL())
    .find(({ sql }) => sql.includes("church_privacy_settings"));

  assert.ok(privacyInsert, "church creation writes no privacy row");

  // EVERY toggle takes the COLUMN DEFAULT. Drizzle names each column in the
  // insert and writes the literal `default` where no value was supplied, so the
  // assertion is on the VALUE at each toggle's own position — checking only that
  // the column name is absent would pass against an insert that binds `true`
  // into all seven.
  for (const [column, value] of insertedValues(privacyInsert.sql)) {
    if (!DB_TOGGLE_COLUMNS.includes(column)) continue;
    assert.equal(
      value,
      "default",
      `self-started creation writes ${column} instead of defaulting it`
    );
  }
  assert.ok(
    !privacyInsert.params.includes(true),
    "self-started creation binds a true into the privacy row"
  );

  // …and every toggle was actually seen, so a parse that matched nothing cannot
  // pass the loop above by being empty.
  const covered = insertedValues(privacyInsert.sql).map(([column]) => column);
  for (const column of DB_TOGGLE_COLUMNS) {
    assert.ok(
      covered.includes(column),
      `${column} is not in the insert at all`
    );
  }
});

/**
 * `insert into … ("a", "b") values (default, $1)` → `[["a","default"],["b","$1"]]`.
 *
 * The columns list and the values list are positional and parallel, which is
 * the only reason a toggle's value can be read at all: the rendered statement
 * says nothing about which `default` belongs to which column except by order.
 */
function insertedValues(sql: string): [string, string][] {
  const columns = /insert into "[^"]+" \(([^)]*)\)/.exec(sql)?.[1];
  const values = /values \(([^)]*)\)/.exec(sql)?.[1];
  assert.ok(columns && values, `could not read the insert: ${sql}`);

  const names = columns.split(", ").map((name) => name.replace(/"/g, ""));
  const bound = values.split(", ");
  assert.equal(
    names.length,
    bound.length,
    "the columns and values lists are not parallel"
  );

  return names.map((name, index) => [name, bound[index]]);
}

test("the DB column defaults are FALSE, all of them", () => {
  // The other half of AC3, and the half the SQL above rests on: the statement
  // omits the columns, so the column defaults ARE the values a self-started
  // plant gets. Read off the schema, so flipping one to `.default(true)` fails
  // here rather than silently making every plant share.
  for (const [property, column] of Object.entries(
    getTableColumns(churchPrivacySettings)
  )) {
    if (column.dataType !== "boolean") continue;
    assert.equal(
      column.default,
      false,
      `${property} does not default to false`
    );
    assert.equal(column.notNull, true, `${property} is nullable`);
  }
});

test("an invited planter's registration writes the same privacy row", () => {
  // The invited path spreads `churchCreationStatements` WHOLE (ruling 408-4B),
  // so the row it creates is the self-started one — defaults and all. The ON
  // write is NOT here, and that is deliberate: §4 is where it comes from.
  const account = createAccountEntities(
    "planter",
    "Grace Plant",
    ACTOR.id,
    { name: "A Planter", email: "planter@example.com" },
    true
  );

  const privacyInsert = account.linkStatements
    .map((statement) => asQuery(statement).toSQL())
    .find(({ sql }) => sql.includes("church_privacy_settings"));

  assert.ok(privacyInsert, "an invited planter gets no privacy row");
  assert.ok(
    !privacyInsert.params.includes(true),
    "registration binds a sharing value the acceptance is supposed to write"
  );
});

// ----------------------------------------------------------------------------
// §4 — one statement, two paths (AC1)
// ----------------------------------------------------------------------------

test("an invited planter's registration accepts through the ordinary path", () => {
  // WHY THIS IS THE TEST FOR AC1. The registration batch deliberately does NOT
  // carry the ON write: it commits before the invitation is even bound, and the
  // redemption that follows is best-effort by construction — it never throws,
  // because an invitation that cannot be redeemed must not cost somebody their
  // account. Writing the toggles at registration would therefore leave a plant
  // whose redemption failed sharing everything with an org it had not joined,
  // holding an invitation it could still DECLINE.
  //
  // So the toggles are written by the accept, and what makes that reach the
  // registration path is this hand-off. If it is ever inlined or replaced, an
  // invited planter silently stops getting the defaults and NOTHING else in the
  // suite notices — the association would still be written, and the plant would
  // simply share nothing.
  // `.after`, not `.span`: the redemption is the last function in the file, so
  // there is no anchor below it to bound a span with.
  const redeem = REGISTER.after("async function redeemRegistrationInvitation");

  assert.match(redeem, /bindOpenInvitationTarget\(/);
  assert.match(redeem, /acceptInvitationAs\(/);
});

test("both acceptance screens carry the consent copy", async () => {
  // CS-013 is a consent ruling before it is a write: the copy has to be on the
  // screen BEFORE the control that accepts. `oversight.test.ts` holds the copy
  // itself to the exempt-type list and the promise order; this holds the two
  // screens to RENDERING it, which that guard cannot see.
  const { OVERSIGHT_CONSENT_SURFACES, INVITE_ORIGIN_SHARING_CONSENT } =
    await import("@/lib/notifications/categories");

  for (const route of ["/register?invitation=", "/settings/association"]) {
    assert.equal(
      OVERSIGHT_CONSENT_SURFACES[route],
      INVITE_ORIGIN_SHARING_CONSENT,
      `${route} is not registered as a consent surface`
    );
  }

  const screens = [
    path.join(
      process.cwd(),
      "src",
      "app",
      "(auth)",
      "register",
      "register-form.tsx"
    ),
    path.join(
      process.cwd(),
      "src",
      "app",
      "(dashboard)",
      "settings",
      "association",
      "page.tsx"
    ),
  ];

  for (const screen of screens) {
    const source = readFileSync(screen, "utf8");

    assert.match(
      source,
      /from "@\/lib\/notifications\/categories"/,
      `${path.basename(screen)} does not take the copy from categories.ts`
    );

    // THE IMPORT LINE AND THE COMMENTS ARE STRIPPED FIRST, and that is the
    // whole point of this assertion rather than a tidy-up.
    //
    // `scripts/cs013-mutation-check.ts` caught the naive version: gut the
    // `.map` that renders the lines, or drop the `consent` prop that carries
    // them, and a bare search for the identifier still passes — because the
    // import that no longer feeds anything still names it. A consent notice
    // that is imported and never rendered is precisely the failure this test
    // exists to see.
    const rendered = source
      .replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    assert.match(
      rendered,
      /INVITE_ORIGIN_SHARING_CONSENT/,
      `${path.basename(screen)} imports the consent copy but renders nothing`
    );
  }
});
