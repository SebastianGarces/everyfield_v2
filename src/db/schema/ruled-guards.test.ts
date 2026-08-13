import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

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
    /if \(!inserted\) throw new ExpectedError\(ROLE_ALREADY_FILLED_MESSAGE\)/,
    "#409 D1: an empty returning() is the loser of the race and must be reported, not returned as undefined"
  );
  assert.match(
    assign,
    /membershipConflictMessage\(error\)/,
    "#409 D1: the reactivation UPDATE takes no ON CONFLICT, so its index violation must become the same user copy"
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
  for (const constant of [
    "TEAM_MEMBERSHIPS_ROLE_ACTIVE_UNIQUE",
    "TEAM_MEMBERSHIPS_ACTIVE_UNIQUE",
  ]) {
    assert.match(
      conflict,
      new RegExp(`isUniqueViolation\\(error, ${constant}\\)`),
      `#409 D1: the index name must come from the schema that declares it, never be re-typed here`
    );
  }
  // Comments stripped: this rule is documented by NAMING what it forbids, in
  // `membership-conflict.ts`'s own header (`register-path.test.ts`'s `code()`).
  assert.doesNotMatch(
    conflict.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1"),
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
