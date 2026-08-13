import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import {
  TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE,
  teamMemberships,
} from "@/db/schema/ministry-teams";
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// THE FOUR RULED GUARDS OF MIGRATION 0038 — #407 D1, #407 D2, #405 D5, #409 D1.
//
// WHAT THIS FILE IS FOR. The races themselves are only visible against a real
// Postgres, and the three live suites beside the services assert them
// (`fork-and-token-race.test.ts`, `subtask-parent-fk.test.ts`,
// `role-seat-race.test.ts` — all opt-in via `LIVE_DB_TESTS=1`). This one is
// hermetic and runs on every `pnpm test`, and it exists because the failure
// mode the live suites cannot catch is a HALF of the change going missing:
//
//   * an index without its `ON CONFLICT` clause turns a race into a 500 —
//     "duplicate key value violates unique constraint" reaching a planter;
//   * an `ON CONFLICT` clause whose predicate no longer matches its index is
//     "there is no unique or exclusion constraint matching the ON CONFLICT
//     specification" on EVERY call, race or not;
//   * a repair statement that drifts BELOW the guard it prepares fails the
//     migration outright on the first database the old race had reached.
//
// None of those three is a concurrency bug, so a race test is exactly the wrong
// instrument. They are properties of two files agreeing, which is what is
// asserted here.
//
// EVERY ANCHOR GOES THROUGH `sourceReader` / `assertInOrder`
// (`memory/invariants.md` → Multi-Tenancy, the source-span rule): a bare
// `indexOf` returns -1 on a moved anchor, and both `slice` and `<` are happy
// with -1. A moved anchor must THROW, not go green.
// ----------------------------------------------------------------------------

/**
 * Repo-relative POSIX path → absolute. Resolved against `process.cwd()`, the
 * convention every source-shaped suite here uses (`register-path.test.ts`,
 * `source-span.test.ts`) — `pnpm test` runs from the repository root, and
 * `import.meta.dirname` is undefined under tsx's CJS output.
 */
function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), ...relative.split("/")), "utf8");
}

/**
 * Source with comments stripped — the same helper `register-path.test.ts`
 * carries, for the same reason: several rules here are documented by NAMING the
 * thing they forbid, so a ban asserted over raw source would be tripped by the
 * sentence explaining it.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const MIGRATION_PATH =
  "src/db/migrations/0038_partial_unique_guards_and_subtask_fk.sql";
const migration = read(MIGRATION_PATH);

const snapshot = JSON.parse(
  read("src/db/migrations/meta/0038_snapshot.json")
) as {
  tables: Record<
    string,
    {
      indexes: Record<
        string,
        {
          columns: { expression: string }[];
          isUnique: boolean;
          where?: string;
        }
      >;
      foreignKeys: Record<
        string,
        { columnsFrom: string[]; columnsTo: string[]; onDelete?: string }
      >;
    }
  >;
};

/**
 * The three partial unique indexes, declared once here so every assertion below
 * is driven off the same table. `predicate` is the index's own WHERE as drizzle
 * serialised it from `src/db/schema/`, and `onConflict` is the fragment the
 * owning service must repeat — the pairing IS the property.
 */
const PARTIAL_UNIQUE_GUARDS = [
  {
    issue: "#407 D1",
    table: "public.message_templates",
    index: "message_templates_church_fork_unique_idx",
    columns: ["church_id", "source_template_id"],
    predicate: '"message_templates"."source_template_id" is not null',
    /** The repair that must run BEFORE the index is built. */
    repairAnchor: "duplicate template forks exist",
  },
  {
    issue: "#407 D2",
    table: "public.meeting_confirmation_tokens",
    index: "meeting_confirm_tokens_pending_unique_idx",
    columns: ["meeting_id", "person_id"],
    predicate: '"meeting_confirmation_tokens"."status" = \'pending\'',
    repairAnchor: 'DELETE FROM "meeting_confirmation_tokens"',
  },
  {
    issue: "#409 D1",
    table: "public.team_memberships",
    index: "team_memberships_role_active_unique_idx",
    columns: ["role_id"],
    predicate: "status = 'active'",
    repairAnchor: 'UPDATE "team_memberships"',
  },
] as const;

// ============================================================================
// §1 — the schema declares all four guards
// ============================================================================

test("§1 the three partial unique indexes are declared, unique and partial", () => {
  for (const guard of PARTIAL_UNIQUE_GUARDS) {
    const declared = snapshot.tables[guard.table]?.indexes[guard.index];
    assert.ok(
      declared,
      `${guard.issue}: ${guard.index} is missing from the 0038 snapshot — the schema no longer declares it`
    );
    assert.equal(
      declared.isUnique,
      true,
      `${guard.issue}: ${guard.index} is not UNIQUE, so it guards nothing`
    );
    assert.deepEqual(
      declared.columns.map((column) => column.expression),
      [...guard.columns],
      `${guard.issue}: ${guard.index} keys on the wrong columns`
    );
    assert.equal(
      declared.where,
      guard.predicate,
      `${guard.issue}: ${guard.index}'s predicate changed — every ON CONFLICT clause inferred against it must change with it`
    );
  }
});

test("§1b tasks.parent_task_id is a self-FK that CASCADES (#405 D5)", () => {
  const fk =
    snapshot.tables["public.tasks"]?.foreignKeys[
      "tasks_parent_task_id_tasks_id_fk"
    ];
  assert.ok(
    fk,
    "#405 D5: the subtask self-FK is missing from the 0038 snapshot"
  );
  assert.deepEqual(fk.columnsFrom, ["parent_task_id"]);
  assert.deepEqual(fk.columnsTo, ["id"]);
  assert.equal(
    fk.onDelete,
    "cascade",
    "#405 D5: `set null` promotes a checklist item to a top-level task on a delete it had nothing to do with"
  );
});

// ============================================================================
// §2 — the migration builds them, and every repair runs FIRST
// ============================================================================

test("§2 each guard's repair statement precedes the guard it prepares", () => {
  for (const guard of PARTIAL_UNIQUE_GUARDS) {
    assertInOrder(
      migration,
      MIGRATION_PATH,
      [guard.repairAnchor, `CREATE UNIQUE INDEX "${guard.index}"`],
      `${guard.issue}: the repair must run before ${guard.index} is built — a build first fails the whole migration on the first plant the old race reached`
    );
  }

  assertInOrder(
    migration,
    MIGRATION_PATH,
    [
      'UPDATE "tasks" SET "parent_task_id" = NULL',
      'ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk"',
    ],
    "#405 D5: dangling parents must be nulled before the FK is validated"
  );
});

test("§2b the migration carries a rollback block naming all four guards", () => {
  const header = sourceReader(migration, MIGRATION_PATH).span(
    "ROLLBACK (HR1/HR2)",
    "1. #407 D1"
  );

  for (const guard of PARTIAL_UNIQUE_GUARDS) {
    assert.match(
      header,
      new RegExp(`DROP INDEX IF EXISTS "${guard.index}"`),
      `${guard.issue}: the rollback block does not drop ${guard.index}`
    );
  }
  assert.match(
    header,
    /DROP CONSTRAINT IF EXISTS "tasks_parent_task_id_tasks_id_fk"/
  );
  assert.match(
    header,
    /DELETE FROM drizzle\.__drizzle_migrations WHERE hash/,
    "the rollback must clear the LEDGER row, never the journal entry"
  );
});

// ============================================================================
// §3 — the owning service repeats the predicate it is inferred against
// ============================================================================

test("§3 forkTemplate claims with ON CONFLICT against the fork index (#407 D1)", () => {
  const source = read("src/lib/communication/templates.ts");
  const fork = sourceReader(source, "templates.ts").span(
    "export async function forkTemplate",
    "export async function updateTemplate"
  );

  assert.match(
    fork,
    /\.onConflictDoNothing\(/,
    "#407 D1: forkTemplate no longer claims — a SELECT-then-INSERT is not a concurrency guard"
  );
  assert.match(
    fork,
    /target: \[messageTemplates\.churchId, messageTemplates\.sourceTemplateId\]/
  );
  assert.match(
    fork,
    /where: sql`\$\{messageTemplates\.sourceTemplateId\} is not null`/,
    "#407 D1: the ON CONFLICT predicate must repeat message_templates_church_fork_unique_idx's own"
  );
  assert.match(
    fork,
    /findExistingFork\(/,
    "#407 D1: an empty returning() is not an error — the loser must re-read the winner's fork"
  );

  assertInOrder(
    fork,
    "forkTemplate",
    [".onConflictDoNothing(", "if (fork) return fork;", "findExistingFork("],
    "#407 D1: the claim comes first, the re-read only when the claim wrote nothing"
  );
});

test("§3b createConfirmationToken upserts against the pending index (#407 D2)", () => {
  const source = read("src/lib/communication/confirmation.ts");
  const claim = sourceReader(source, "confirmation.ts").span(
    "async function claimConfirmationToken",
    "// ---------------------------------------------------------------------------\n// Resolve"
  );

  assert.match(claim, /\.onConflictDoUpdate\(/);
  assert.match(
    claim,
    /targetWhere: sql`\$\{meetingConfirmationTokens\.status\} = 'pending'`/,
    "#407 D2: the ON CONFLICT predicate must repeat meeting_confirm_tokens_pending_unique_idx's own"
  );
  assert.match(
    claim,
    /setWhere: sql`\$\{meetingConfirmationTokens\.expiresAt\} <= now\(\)`/,
    "#407 D2: only an EXPIRED pending row may be renewed — a live token is in somebody's inbox"
  );
  assert.match(
    claim,
    /findPendingToken\(/,
    "#407 D2: a live holder means an empty returning(), and the live token has to be re-read"
  );
});

test("§3c assignMember claims the seat with ON CONFLICT (#409 D1)", () => {
  const source = read("src/lib/ministry-teams/memberships.ts");
  const assign = sourceReader(source, "memberships.ts").span(
    "export async function assignMember",
    "export async function removeMember"
  );

  assert.match(assign, /\.onConflictDoNothing\(/);
  assert.match(assign, /target: teamMemberships\.roleId/);
  assert.match(
    assign,
    /where: sql`\$\{teamMemberships\.status\} = 'active'`/,
    "#409 D1: the ON CONFLICT predicate must repeat team_memberships_role_active_unique_idx's own"
  );
  assert.match(
    assign,
    /if \(!inserted\) \{[\s\S]{0,200}throw new ExpectedError\(\s*await seatRefusalMessage\(churchId, roleId, personId\)/,
    "#409 D1: an empty returning() is the loser of the race and must be reported, not returned as undefined"
  );
  // #411 quality round 1, second pass — THE REACTIVATION PATH'S OWN GUARD.
  // §4d proves the seat index is the only unique index on the table; it is not
  // a guard for this path at all when the two racers are the SAME PERSON
  // reactivating one inactive row, because two UPDATEs of ONE row collide with
  // nothing. The `status = 'inactive'` predicate is what refuses the loser —
  // a compare-and-set, re-evaluated against the winner's committed row version
  // under the row lock — and its empty `returning()` must be read exactly as
  // the INSERT's is. Without both halves the double submit returns TWO
  // successes and emits every assignment event twice.
  assert.match(
    assign,
    /\.update\(teamMemberships\)[\s\S]{0,600}eq\(teamMemberships\.status, "inactive"\)/,
    "#411 quality round 1: the reactivation UPDATE must be conditional on the row still being inactive — keyed on the row id alone it has no guard at all"
  );
  assert.match(
    assign,
    /if \(!reactivated\) \{[\s\S]{0,200}throw new ExpectedError\(\s*await seatRefusalMessage\(churchId, roleId, personId\)/,
    "#411 quality round 1: the conditional UPDATE's empty returning() is the loser of the race and must be refused, not returned as undefined"
  );
  // #411 round 2 — the thrown half. The reactivation UPDATE takes no ON
  // CONFLICT, and a RACED insert raises on the non-arbiter index, so this is a
  // live refusal path and it must end in the SAME holder read as the empty
  // `returning()` above. A branch that produced its own sentence here would be
  // a second decider, and predicting which index raises is what round 1 got
  // wrong.
  assert.match(
    assign,
    /if \(isSeatConflict\(error\)\) \{[\s\S]{0,200}throw new ExpectedError\(\s*await seatRefusalMessage\(churchId, roleId, personId\)/,
    "#411 round 2: a recognised seat conflict must be refused with the sentence the holder read chooses, not one picked from the index name"
  );

  // #411 round 1 — the loser branch reads WHO holds the seat before choosing a
  // sentence. `team_memberships_role_active_unique_idx` is keyed on `role_id`
  // alone, so the two-people race and the same-person double-submit both come
  // back as `INSERT 0 0`; without this read the double-submit was told "Role is
  // already filled" plus "Someone filled it while this page was open", which is
  // false to the planter who filled it.
  const refusal = sourceReader(source, "memberships.ts").span(
    "async function seatRefusalMessage",
    "Assign a person to a team role"
  );
  assertInOrder(
    refusal,
    "seatRefusalMessage",
    [
      "eq(teamMemberships.roleId, roleId)",
      'eq(teamMemberships.status, "active")',
      "holder?.personId === personId",
      "PERSON_ALREADY_ASSIGNED_MESSAGE",
      "ROLE_ALREADY_FILLED_MESSAGE",
    ],
    "#411 round 1: the seat's active holder decides the sentence — same person means the double-submit sentence, anybody else means the seat one"
  );
});

// ============================================================================
// §4 — the refusal reaches the planter, and the leaf stays a leaf
// ============================================================================

test("§4 the assign dialog reads the ruled sentence from the import-free leaf", () => {
  const dialog = read("src/components/ministry-teams/member-assign-dialog.tsx");
  const delivery = read("src/components/ministry-teams/assign-refusal.ts");

  // The sentence still comes from the leaf, one module further out than it used
  // to. It moved because the DELIVERY moved: the dialog no longer decides where
  // a refusal is shown — `assignRefusalDelivery` does, and it is the thing that
  // imports the constant. `assign-refusal.test.ts` owns that contract in full;
  // what §4 keeps is the property this file is about, that the ruled sentence
  // has ONE source and it is the leaf.
  assert.match(
    delivery,
    /import \{ ROLE_ALREADY_FILLED_MESSAGE \} from "@\/lib\/ministry-teams\/membership-copy"/,
    "#409 D1: the sentence is imported, never re-typed"
  );
  assert.doesNotMatch(
    dialog,
    /"Role is already filled"/,
    "#409 D1: no second copy of the ruled sentence in the component"
  );

  // The refusal is surfaced verbatim — the action shell already passes
  // `ExpectedError.message` through — but NOT into the dialog's own subtree.
  // `router.refresh()` flips the role card to its Filled arm and unmounts this
  // component, so an inline `<Alert>` was measured living ~120 ms (preview
  // 16e9cf5). The sentence goes to the root `<Toaster>` instead; the refresh is
  // unchanged and is NOT delayed behind a dismissal.
  assert.match(
    dialog,
    /import \{ toast \} from "sonner"/,
    "#409 D1: the sentence has to outlive the refresh that fires with it"
  );
  assert.match(
    dialog,
    /assignRefusalDelivery\(result\.error\)[\s\S]*toast\.error\([\s\S]*router\.refresh\(\)/,
    "#409 D1: this dialog only renders beside an OPEN seat, so being told it is filled means the page underneath is stale — raise the sentence clear of the subtree, then refresh"
  );

  for (const [label, source] of [
    ["member-assign-dialog.tsx", dialog],
    ["assign-refusal.ts", delivery],
  ] as const) {
    assert.doesNotMatch(
      source,
      /from "@\/lib\/ministry-teams\/(service|memberships)"/,
      `${label}: the barrel opens with @/db — importing it from a client module ships the database client to the browser`
    );
  }
});

test("§4b the copy leaf is not also served from the trunk", () => {
  const leaf = read("src/lib/ministry-teams/membership-copy.ts");
  assert.doesNotMatch(
    leaf,
    /^import /m,
    "membership-copy.ts is an IMPORT-FREE leaf — a client component imports it"
  );

  for (const trunk of [
    "src/lib/ministry-teams/service.ts",
    "src/lib/ministry-teams/memberships.ts",
  ]) {
    assert.doesNotMatch(
      read(trunk),
      /export \{[^}]*ROLE_ALREADY_FILLED_MESSAGE/,
      `${trunk} re-exports the leaf's copy — a leaf whose contents are also served from the trunk is not a leaf, and the pass-through is one import away from a browser chunk`
    );
  }
});

test("§4c the seat refusal is decided by the ONE unique-violation predicate, not a second copy", () => {
  const conflict = read("src/lib/ministry-teams/membership-conflict.ts");

  assert.match(
    conflict,
    /import \{ isUniqueViolation \} from "@\/db\/errors"/,
    "#411 AC5: the recognition is `src/db/errors.ts`'s, shared with every other domain"
  );
  // ONE INDEX, ONE NAME (#411 quality round 1, migration 0039). The seat index
  // is keyed on `role_id` ALONE, and `role_id` is NOT NULL, so it strictly
  // subsumes the (team_id, person_id, role_id) index that used to sit beside it
  // — which was therefore dropped. Keeping it was not free: it was not the
  // `ON CONFLICT` arbiter, so a raced INSERT met it first (lower OID) and raised
  // 23505 where the DO NOTHING could not cover it, and this predicate had to
  // OR in a second name to keep that exception off a planter's screen. With one
  // unique index the arbiter covers every INSERT conflict and the recognition
  // has one constant.
  assert.match(
    conflict,
    /isUniqueViolation\(error, TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE\)/,
    "#409 D1: the seat's violation is recognised, and the index name comes from the schema that declares it, never re-typed here"
  );
  assert.equal(
    conflict.match(/isUniqueViolation\(/g)?.length,
    1,
    "#411 quality round 1: ONE unique index stands over an active membership, so ONE name is recognised — a second branch means a second index came back, and with it the raced 23505 that 0039 removed"
  );

  // THE PROPERTY, not the instance: the dropped index may not be re-declared,
  // re-exported or re-named anywhere in `src/`. The name is assembled here so
  // this assertion is not itself the hit it is looking for.
  const droppedIndex = ["team", "memberships", "active", "unique"].join("_");
  // `git grep -l` EXITS 1 WHEN IT FINDS NOTHING, which is the passing case here
  // — unlike the 23505 sweep below, whose answer is never empty. An unguarded
  // `execFileSync` would throw that exit code as a test ERROR the day the
  // property finally holds, so no-match is read as the empty list.
  let candidates: string[] = [];
  try {
    candidates = execFileSync(
      "git",
      ["grep", "-l", droppedIndex, "--", "src/**/*.ts", "src/**/*.tsx"],
      { cwd: process.cwd(), encoding: "utf8" }
    )
      .split("\n")
      .filter((line) => line.length > 0 && !line.endsWith(".test.ts"));
  } catch (error) {
    assert.equal(
      (error as { status?: number }).status,
      1,
      `git grep failed for a reason other than "no matches": ${String(error)}`
    );
  }
  // COMMENTS DO NOT COUNT, and that is deliberate rather than a loophole: three
  // modules NAME this index in order to forbid it — the same move
  // `register-path.test.ts` allows `resend.ts` for, and the same one `memory/`
  // makes. What is banned is the identifier in CODE: a `uniqueIndex(...)`
  // declaration, an exported constant, a second `isUniqueViolation` branch. So
  // the grep only picks candidates and the assertion reads them stripped.
  const revivals = candidates.filter((file) =>
    code(read(file)).includes(droppedIndex)
  );
  assert.deepEqual(
    revivals,
    [],
    `#411 quality round 1: ${droppedIndex} was dropped by migration 0039 because the seat index strictly subsumes it — re-adding it re-adds the non-arbiter raise it caused`
  );

  const seatIndexNote = sourceReader(
    read("src/db/schema/ministry-teams.ts"),
    "ministry-teams.ts"
  ).span(
    "THE SEAT INDEX IS THE ONLY UNIQUE INDEX",
    "export const teamMemberships"
  );
  assert.match(
    seatIndexNote,
    /Never re-add it[\s\S]*subsumes/i,
    "#411 quality round 1: the next reader must be told the older index was dropped and why re-adding it is wrong, beside the table that no longer declares it"
  );
  // Comments stripped: this rule is documented by NAMING what it forbids, in
  // `membership-conflict.ts`'s own header (`register-path.test.ts`'s `code()`).
  assert.doesNotMatch(
    code(conflict),
    /\.includes\(/,
    "#411: matching the constraint by substring was the hand-rolled second implementation — it drops the SQLSTATE check and walks one level of cause instead of five"
  );

  // The PROPERTY, not the instance: exactly one module under src/ spells the
  // SQLSTATE, so no third domain can quietly grow a third copy either.
  const spellings = execFileSync(
    "git",
    ["grep", "-l", "23505", "--", "src/**/*.ts", "src/**/*.tsx"],
    { cwd: process.cwd(), encoding: "utf8" }
  )
    .split("\n")
    .filter((line) => line.length > 0 && !line.endsWith(".test.ts"));

  assert.deepEqual(
    spellings,
    ["src/db/errors.ts"],
    "#411 AC5: `23505` is spelled in exactly one non-test module — a second one is a second implementation of the same decision"
  );
});

test("§4d the seat index is the ONLY unique index on team_memberships — under that name or any other", () => {
  // WHAT THIS ADDS THAT §4c CANNOT SEE. §4c bans the DROPPED INDEX'S NAME
  // (`team_memberships_active_unique`) anywhere in `src/`. The rule the schema
  // states beside the table is wider than that — "Never re-add it, under that
  // name or another" — and the wider half is the half that matters, because
  // nothing about the failure depended on the identifier. `assignMember`
  // inserts with `ON CONFLICT (role_id) WHERE status = 'active' DO NOTHING`,
  // which arbitrates on the SEAT index and no other; ANY second unique index on
  // this table is a non-arbiter that a raced INSERT can meet first, block on the
  // winner's uncommitted tuple, and raise 23505 through — where the DO NOTHING
  // cannot cover it and `isSeatConflict` (one constant, by §4c) does not
  // recognise it. That is a raw `NeonDbError` out of `assignMember`, which the
  // action shell replaces with its generic sentence: the exact defect of #411's
  // resume, measured at roughly two runs in three on Postgres 16, and the reason
  // migration 0039 exists. A second index added under a NEW name reproduces it
  // with every §4c assertion still green.
  //
  // ASSERTED OFF THE RENDERED TABLE, NEVER A REGEX OVER THE SOURCE — the
  // `getTableConfig` idiom `predefined-teams-guard.test.ts` established, and the
  // same reasoning `memory/invariants.md` records for `portfolioPlantsStatement`
  // and for `invitations-ui.test.ts` §9b: a declaration reached through a helper,
  // a spread or another module is invisible to a pattern and present in the
  // config. It is the ARBITER'S UNIQUENESS being asserted, so the live suite's
  // determinism (`role-seat-race.test.ts`, three runs) has a hermetic guard
  // under it that runs on every `pnpm test`.
  const { indexes } = getTableConfig(teamMemberships);
  const unique = indexes.filter((index) => index.config.unique);

  assert.deepEqual(
    unique.map((index) => index.config.name),
    [TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE],
    "#411 quality round 1 (migration 0039): exactly ONE unique index stands over team_memberships. A second one is not the arbiter, so a raced INSERT meets it first and raises 23505 past the DO NOTHING — the same-person double submit then reads the action shell's generic error instead of the person sentence"
  );

  // …and it is the SEAT key, whose subsumption is what made dropping the other
  // one free: `role_id` ALONE, NOT NULL, so one active row per role implies one
  // per any wider key containing it, with no NULL hole. Widened to
  // (church_id, role_id) it would also let a forged church id claim a second
  // active seat on one role.
  const [seat] = unique;
  assert.deepEqual(
    seat.config.columns.map((column) =>
      "name" in column ? column.name : String(column)
    ),
    ["role_id"],
    "#409 D1: the seat key is `role_id` alone — a wider key is a different rule, and `church_id` is carried for tenant-scoped reads, not for identity"
  );

  // Partial, on the predicate the `ON CONFLICT` clause repeats byte for byte. A
  // total index would make a role fillable exactly once in its life (every past
  // holder stays as an `inactive` row), and a DRIFTED predicate is "there is no
  // unique or exclusion constraint matching the ON CONFLICT specification" on
  // every assignment, race or not.
  assert.ok(
    seat.config.where,
    "#409 D1: the seat is single only while it is occupied, so the index must be PARTIAL"
  );
  assert.equal(
    new PgDialect().sqlToQuery(seat.config.where).sql,
    "status = 'active'",
    "#409 D1: the index predicate is what `assignMember`'s ON CONFLICT clause repeats — the pairing IS the guard"
  );
});
