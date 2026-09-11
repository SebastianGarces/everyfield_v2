// ============================================================================
// A THROTTLED PLANT IS RECORDED APART FROM A BROKEN JUDGE (#376, the DB half of
// #36 / PR #372).
//
// #372 shipped the distinction in the RUN's own output — the log line and the
// summary say `deferred` where they used to say `failed`. `plant_assessments`
// did not get it, because it is a schema change, so the table an operator
// queries AFTER a bad run (once the run's log lines are gone, which is how #36
// itself had to be diagnosed) still showed both as identical `failed` rows.
//
// What these tests pin:
//   §1 the mapping is ONE exported decision, and it is the runner's own
//      predicate — a deferral is `deferred`, everything else is `failed`.
//   §2 the write that ends an unjudged run renders that status, sets NOTHING
//      else, and targets the pending row by id AND by its unjudged state.
//   §3 the orchestrator's catch block routes through that decider, with no
//      surviving `status: "failed"` literal beside it.
//   §4 the vocabulary is closed in the DATA, and the schema's CHECK and
//      migration 0040 spell the same four words.
//   §5 no read path counts `deferred` as a failure — asserted over EVERY
//      module that names `plantAssessments.status`, plus the one surface that
//      reports failure counts.
//
// These are hermetic. The live half — that a forced deferral really does leave
// a `deferred` row on a real Postgres through the neon-http driver, that a
// generic throw leaves `failed`, that `selectPlantsForAssessment` re-selects
// the deferred plant, and that the CHECK refuses a fourth spelling — was run
// against a scratch database migrated with `pnpm db:migrate` and is recorded in
// the PR's evidence bundle. It is NOT a `LIVE_DB_TESTS` suite: those are named
// one by one in `test:live`, and adding one without that edit ships assertions
// nothing runs (`src/db/live-suite-coverage.test.ts`).
// ============================================================================

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import { assessmentStatuses, plantAssessments } from "@/db/schema";
import { RateLimitDeferralError } from "@/lib/phase-engine/judge";
import { sourceReader, stripComments } from "@/lib/testing/source-span";

import {
  assessmentStatusForFailure,
  markAssessmentUnjudgedStatement,
} from "./generate-assessment";

const ROOT = path.join(process.cwd(), "src");
const ORCHESTRATOR = path.join(
  ROOT,
  "lib/phase-engine/assessment/generate-assessment.ts"
);
const MIGRATION = path.join(
  process.cwd(),
  "src/db/migrations/0040_assessment_deferred_status.sql"
);
const ASSESSMENT_ID = "5a9d0a2e-0f0e-4a2e-9f2b-0f5a2c6b1d33";

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** Every non-suite `.ts`/`.tsx` under `src/…segments`, sorted. */
function sourceFilesUnder(...segments: string[]): string[] {
  const found: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        found.push(full);
    }
  }

  walk(path.join(ROOT, ...segments));
  return found.sort();
}

function rel(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

// ----------------------------------------------------------------------------
// §1 — the mapping
// ----------------------------------------------------------------------------

test("§1 a rate-limit deferral is `deferred`; every other throw is `failed`", () => {
  // Both flavours of the deferral. `run_budget` is the ladder standing down
  // because the next hold would have crossed the run's deadline — still
  // throttling, still nothing learned about the judge.
  for (const reason of ["attempts_exhausted", "run_budget"] as const) {
    const deferral = new RateLimitDeferralError(
      "church",
      4,
      1200,
      900,
      null,
      reason
    );
    assert.equal(
      assessmentStatusForFailure(deferral),
      "deferred",
      `#376: a ${reason} deferral says nothing about the judge — recording it as \`failed\` is the ambiguity #36 was filed about`
    );
  }

  // The judge answered and the answer was broken — including the flavour whose
  // WARNING the runner softens (`isDeadlineTruncatedFailure`). That softening
  // is about which channel a human is paged on, not about what happened, so the
  // row stays `failed` exactly as the run summary's bucket does.
  for (const error of [
    new Error("judge returned unparseable output"),
    new TypeError("cannot read properties of undefined"),
    Object.assign(new Error("bad gateway"), { statusCode: 502 }),
    "a thrown string",
    null,
    undefined,
  ]) {
    assert.equal(
      assessmentStatusForFailure(error),
      "failed",
      "#376: only throttling is deferred — anything else is a defect somebody has to look at"
    );
  }
});

test("§1b the decision is made ONCE, through the runner's own predicate", () => {
  const code = stripComments(read(ORCHESTRATOR));

  assert.match(
    code,
    /isRateLimitDeferral/,
    '#376: the row and the run summary must branch on the SAME predicate — a second `error.name === "RateLimitDeferralError"` copy here is how the log and the table drift apart again'
  );
  assert.doesNotMatch(
    code,
    /RateLimitDeferralError\.isInstance|name === "RateLimitDeferralError"/,
    "#376: `isRateLimitDeferral` is the one door; do not re-derive the test"
  );
});

// ----------------------------------------------------------------------------
// §2 — the rendered write
// ----------------------------------------------------------------------------

test("§2 the unjudged-run write renders the right status, sets only status, and only demotes a still-pending row", () => {
  const deferred = markAssessmentUnjudgedStatement(
    ASSESSMENT_ID,
    new RateLimitDeferralError("church", 4, 1200, 900, null)
  ).toSQL();

  // The `status = 'pending'` term is a COMPARE-AND-SET, and it is what keeps a
  // completed run from being demoted: the `try` this serves does not end at the
  // `complete` flip — step 6's emit runs after the row is already `complete`
  // with its insights persisted — so a throw from there would otherwise
  // overwrite a good assessment and hide it from every read, all of which name
  // `complete` positively (§5). An empty rowcount is the guard working.
  assert.equal(
    deferred.sql,
    'update "plant_assessments" set "status" = $1 where ("plant_assessments"."id" = $2 and "plant_assessments"."status" = $3)',
    "#376/PE-011: status ONLY, and only over a row that has not been judged. The `fact_snapshot` recorded up-front stays as the judge saw it, and the plant's last good `complete` row is a different row entirely"
  );
  assert.deepEqual(deferred.params, ["deferred", ASSESSMENT_ID, "pending"]);

  const failed = markAssessmentUnjudgedStatement(
    ASSESSMENT_ID,
    new Error("judge returned unparseable output")
  ).toSQL();
  assert.equal(failed.sql, deferred.sql, "one statement, two statuses");
  assert.deepEqual(failed.params, ["failed", ASSESSMENT_ID, "pending"]);
});

// ----------------------------------------------------------------------------
// §3 — the orchestrator routes through it
// ----------------------------------------------------------------------------

test("§3 the catch block marks the row through the decider, not a literal", () => {
  const source = sourceReader(
    stripComments(read(ORCHESTRATOR)),
    "generate-assessment.ts (comments stripped)"
  );
  // Anchored on declarations, so a moved anchor THROWS rather than slicing the
  // empty string every `doesNotMatch` is true of (`memory/invariants.md` →
  // source-shaped tests).
  const catchBlock = source.span("} catch (error) {", "throw error;");

  assert.match(
    catchBlock,
    /markAssessmentUnjudgedStatement\(pending\.id, error\)/,
    "#376: the failure path hands the ERROR to the decider — a status computed anywhere else is a second copy of the rule"
  );
  assert.doesNotMatch(
    catchBlock,
    /status: "(failed|deferred)"/,
    "#376: the literal is what made every throw look like a broken judge; it must not come back beside the decider"
  );

  // The success path is untouched: `complete` is still written literally, and
  // still with the judge's audit metadata.
  assert.match(
    source.span("const [completed]", "} catch (error) {"),
    /status: "complete"/,
    "PE-009: a successful run still flips to complete"
  );
});

// ----------------------------------------------------------------------------
// §4 — the vocabulary is closed in the data
// ----------------------------------------------------------------------------

test("§4 `deferred` is in the vocabulary, and the CHECK is the vocabulary", () => {
  assert.deepEqual(
    [...assessmentStatuses],
    ["pending", "complete", "failed", "deferred"],
    "#376: four values. `deferred` is appended rather than inserted, so nothing that reads this tuple by position moves"
  );

  const { checks } = getTableConfig(plantAssessments);
  const status = checks.find(
    (check) => check.name === "plant_assessments_status_check"
  );
  assert.ok(
    status,
    "#376: `.$type<>()` on a varchar is a compile-time brand and nothing else — the vocabulary must be in the DATA (0024/0031/0032/0033 precedent)"
  );

  // Asserted off the RENDERED constraint, never a regex over the declaration: a
  // list built through a helper or a spread is invisible to a pattern and
  // present in the config (the `getTableConfig` idiom, ruled-guards §4d).
  const rendered = new PgDialect().sqlToQuery(status.value).sql;
  assert.equal(
    rendered,
    `"plant_assessments"."status" in ('pending', 'complete', 'failed', 'deferred')`
  );

  // …and the migration spells the same four words. The constraint the DATABASE
  // holds comes from the SQL file, not from this declaration, so a value added
  // to the tuple without a migration is a column that accepts three words while
  // the type says four.
  assert.match(
    read(MIGRATION),
    /ALTER TABLE "plant_assessments" ADD CONSTRAINT "plant_assessments_status_check" CHECK \("plant_assessments"\."status" in \('pending', 'complete', 'failed', 'deferred'\)\);/,
    "#376: migration 0040 and the schema must spell one vocabulary"
  );
});

// ----------------------------------------------------------------------------
// §5 — nothing reads `deferred` as a failure
// ----------------------------------------------------------------------------

// EVERY module in `src/` that filters on the column, enumerated so a NEW reader
// fails this test until somebody has answered the question for it, rather than
// joining the codebase with an unexamined `!= 'complete'`.
//
//   queries.ts — `getLatestAssessment`, `getLatestCompleteSnapshot` and
//                `selectPlantsForAssessment`. The third is why a deferred plant
//                is re-selected: it contributes no `generatedAt` to the
//                latest-per-church map, so the plant still looks
//                never-assessed and `filterDirtyOrStale` includes it.
//   trends.ts  — `readSnapshotHistory`, the four trend series.
//   Plant Intelligence reads/effects/page-context — only complete assessments
//                are eligible for retrieval, acknowledgement, feedback, and
//                source-context handoff.
//
// The WRITER (`generate-assessment.ts`) sets the column through a
// `.set({ status })` key, but it also NAMES it once — the `status = 'pending'`
// compare-and-set that stops a completed run being demoted — so it is in the
// scan and gets its own expectation below rather than the readers' one.
const STATUS_READERS = [
  "src/lib/evry/capabilities/plant-intelligence/effects.ts",
  "src/lib/evry/capabilities/plant-intelligence/reads.ts",
  "src/lib/evry/resolvers/page-context.ts",
  "src/lib/phase-engine/assessment/queries.ts",
  "src/lib/phase-engine/signals/trends.ts",
];
const STATUS_WRITER = "src/lib/phase-engine/assessment/generate-assessment.ts";

test("§5 every read selects `complete` POSITIVELY — no `not complete` anywhere", () => {
  const namers = [...sourceFilesUnder("lib"), ...sourceFilesUnder("app")]
    .filter((file) => read(file).includes("plantAssessments.status"))
    .map(rel);

  assert.deepEqual(
    namers.sort(),
    [...STATUS_READERS, STATUS_WRITER].sort(),
    "#376: a new module naming `plant_assessments.status` must be checked against this rule before it is added here"
  );

  for (const file of STATUS_READERS) {
    const code = stripComments(read(path.join(process.cwd(), file)));
    const mentions = code.match(/plantAssessments\.status[^)]*\)/g) ?? [];

    assert.ok(mentions.length > 0, `${file}: expected at least one read`);
    for (const mention of mentions) {
      assert.match(
        mention,
        /^plantAssessments\.status, "complete"\)$/,
        `${file}: every read of this column is \`eq(status, "complete")\`. A negative filter ("not complete") would fold a throttled plant in with a broken judge — the ambiguity #376 exists to end — and would silently change meaning again the next time a value is added`
      );
    }

    for (const negation of [
      "ne(plantAssessments.status",
      "not(eq(plantAssessments.status",
      "inArray(plantAssessments.status",
      "notInArray(plantAssessments.status",
    ]) {
      assert.ok(
        !code.includes(negation),
        `${file}: \`${negation}…\` is the shape this rule forbids — name \`complete\`, never "everything else"`
      );
    }
  }

  // The writer's single mention is the compare-and-set guard, and it is pinned
  // here so it cannot be deleted quietly: without it the unjudged-run write
  // targets the row by id alone, and any throw AFTER the `complete` flip — step
  // 6's emit — demotes a persisted assessment that every read then drops.
  const writer = stripComments(read(path.join(process.cwd(), STATUS_WRITER)));
  assert.deepEqual(
    writer.match(/plantAssessments\.status[^)]*\)/g),
    ['plantAssessments.status, "pending")'],
    "#376: the unjudged-run write is a compare-and-set on the UNJUDGED state — a bare `where(id)` demotes a row that already reached `complete`"
  );
});

test("§5b the failure COUNT surface counts run outcomes, and has a deferred bucket", () => {
  // `/api/phase-engine/assess` is the only surface that reports failure counts.
  // It counts its OWN in-run outcome objects, so it holds no query over this
  // table at all — which is why a fourth status cannot move any number it
  // prints. Asserted rather than assumed: a future "failed assessments" tile
  // built off `status != 'complete'` is exactly the regression #376 is about.
  const route = path.join(
    process.cwd(),
    "src/app/api/phase-engine/assess/route.ts"
  );
  const code = stripComments(read(route));

  assert.ok(
    !code.includes("plantAssessments"),
    "#376: the run summary counts outcomes it produced, never rows — keep the table out of it"
  );
  assert.match(
    code,
    /failed: outcomes\.filter\(\(o\) => o\.status === "failed"\)\.length/,
    "#372: the failure count is over the run's own outcomes"
  );
  assert.match(
    code,
    /deferred: outcomes\.filter\(\(o\) => o\.status === "deferred"\)\.length/,
    "#372: throttling has its own bucket in the summary — #376 gives it the same in the table"
  );
});
