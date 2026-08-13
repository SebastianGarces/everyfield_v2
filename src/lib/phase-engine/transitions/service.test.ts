import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildTransitionRow,
  classifyTransition,
  declareInitialPhaseStatement,
  deriveReadiness,
  initialPhaseDeclarationSchema,
  INITIAL_DECLARATION_KIND,
  INITIAL_DECLARATION_REASON,
  isInitialDeclaration,
  MAX_PHASE,
  MIN_PHASE,
  transitionPhaseSchema,
  TRANSITION_KIND,
} from "./service";
import { sourceReader } from "@/lib/testing/source-span";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";

// ----------------------------------------------------------------------------
// Pure-logic unit tests for the phase transition service (PE-001/002/003/015).
//
// The DB writes (immutable phase_transitions row, churches.current_phase update)
// and `phase.changed` emission are exercised by integration testing against a
// live Postgres + event bus; these unit tests pin the pure contracts: the
// validation surface, direction classification, the audit-row builder, and
// readiness derivation.
// ----------------------------------------------------------------------------

// ============================================================================
// Validation (PE-001 soft-gating: only a valid phase + a non-empty reason)
// ============================================================================

test("accepts a forward transition with a reason", () => {
  const result = transitionPhaseSchema.safeParse({
    toPhase: 2,
    reason: "Ready",
  });
  assert.equal(result.success, true);
});

test("accepts a backward transition (correction) with a reason", () => {
  const result = transitionPhaseSchema.safeParse({
    toPhase: 0,
    reason: "Logged the wrong phase last week",
  });
  assert.equal(result.success, true);
});

test("requires a non-empty reason", () => {
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: 1, reason: "" }).success,
    false
  );
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: 1, reason: "   " }).success,
    false
  );
});

test("rejects out-of-range phases", () => {
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: MIN_PHASE - 1, reason: "x" })
      .success,
    false
  );
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: MAX_PHASE + 1, reason: "x" })
      .success,
    false
  );
});

test("rejects a non-integer phase", () => {
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: 1.5, reason: "x" }).success,
    false
  );
});

test("trims the reason", () => {
  const result = transitionPhaseSchema.safeParse({
    toPhase: 1,
    reason: "  growth target met  ",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.reason, "growth target met");
  }
});

// ============================================================================
// Direction classification (descriptive only — nothing is ever blocked)
// ============================================================================

test("classifies a forward-by-one move as advance", () => {
  assert.equal(classifyTransition(1, 2), "advance");
});

test("classifies a backward move as regress", () => {
  assert.equal(classifyTransition(3, 1), "regress");
  assert.equal(classifyTransition(1, 0), "regress");
});

test("classifies a forward-by-many move as skip", () => {
  assert.equal(classifyTransition(0, 3), "skip");
  assert.equal(classifyTransition(2, 6), "skip");
});

test("classifies same-phase as noop", () => {
  assert.equal(classifyTransition(4, 4), "noop");
});

// ============================================================================
// Audit-row builder (PE-002 / AC-PE-1: captures snapshot + rubric version)
// ============================================================================

function fakeSnapshot(): PlantFactSnapshot {
  return {
    snapshotVersion: "v1",
    churchId: "church-1",
    currentPhase: 1,
    generatedAt: "2026-06-22T00:00:00.000Z",
    isColdStart: false,
  } as unknown as PlantFactSnapshot;
}

test("builds an immutable audit row carrying from/to, user, reason, snapshot, rubric version", () => {
  const snapshot = fakeSnapshot();
  const row = buildTransitionRow({
    churchId: "church-1",
    fromPhase: 1,
    toPhase: 2,
    initiatedById: "user-1",
    reason: "Core group at target",
    factSnapshot: snapshot,
    rubricVersion: "v0",
  });

  assert.equal(row.churchId, "church-1");
  assert.equal(row.fromPhase, 1);
  assert.equal(row.toPhase, 2);
  assert.equal(row.initiatedById, "user-1");
  assert.equal(row.reason, "Core group at target");
  assert.equal(row.rubricVersion, "v0");
  // The exact deterministic snapshot must be persisted verbatim for audit.
  assert.deepEqual(row.factSnapshot, snapshot);
});

test("preserves a backward (correction) transition in the audit row", () => {
  const row = buildTransitionRow({
    churchId: "c",
    fromPhase: 3,
    toPhase: 1,
    initiatedById: "u",
    reason: "regression",
    factSnapshot: fakeSnapshot(),
    rubricVersion: "v0",
  });
  assert.equal(row.fromPhase, 3);
  assert.equal(row.toPhase, 1);
});

// ============================================================================
// Readiness derivation (PE-015) — advisory, derived from latest assessment
// ============================================================================

function insight(
  over: Partial<{
    category: string;
    audience: string;
    severity: string;
    title: string;
    body: string;
    rank: number;
  }>
) {
  return {
    category: "launch_readiness",
    audience: "planter",
    severity: "info",
    title: "title",
    body: "body",
    rank: 0,
    ...over,
  };
}

test("returns unknown / no-assessment when there is no assessment", () => {
  const r = deriveReadiness(null, []);
  assert.equal(r.hasAssessment, false);
  assert.equal(r.state, "unknown");
  assert.equal(r.assessmentId, null);
});

test("returns unknown when there are no readiness insights", () => {
  const r = deriveReadiness("a-1", [
    insight({ category: "vision_casting", severity: "urgent" }),
  ]);
  assert.equal(r.hasAssessment, true);
  assert.equal(r.state, "unknown");
  assert.equal(r.assessmentId, "a-1");
});

test("maps an urgent readiness insight to not_ready", () => {
  const r = deriveReadiness("a-1", [
    insight({ severity: "urgent", title: "Not enough committed adults" }),
  ]);
  assert.equal(r.state, "not_ready");
  assert.equal(r.headline, "Not enough committed adults");
});

test("maps a watch readiness insight to approaching", () => {
  const r = deriveReadiness("a-1", [insight({ severity: "watch" })]);
  assert.equal(r.state, "approaching");
});

test("maps a positive/info readiness insight to ready", () => {
  assert.equal(
    deriveReadiness("a-1", [insight({ severity: "positive" })]).state,
    "ready"
  );
  assert.equal(
    deriveReadiness("a-1", [insight({ severity: "info" })]).state,
    "ready"
  );
});

// Regression: the PRODUCTION path (getPhaseReadiness) feeds deriveReadiness the
// PERSISTED insights, whose severities are the DB vocabulary the persist layer
// produced (urgent→high, watch→medium, info→low, positive→info). Earlier the
// mapping only knew the judge vocabulary, so every persisted insight fell
// through to "ready" — a launch-imminent plant the judge flagged urgent showed
// as "ready". These assert the real stored severities map correctly.
test("maps PERSISTED severities (high/medium/low) to readiness states", () => {
  assert.equal(
    deriveReadiness("a-1", [insight({ severity: "high" })]).state,
    "not_ready",
    "high (persisted from judge 'urgent') must be not_ready"
  );
  assert.equal(
    deriveReadiness("a-1", [insight({ severity: "critical" })]).state,
    "not_ready"
  );
  assert.equal(
    deriveReadiness("a-1", [insight({ severity: "medium" })]).state,
    "approaching",
    "medium (persisted from judge 'watch') must be approaching"
  );
  assert.equal(
    deriveReadiness("a-1", [insight({ severity: "low" })]).state,
    "ready"
  );
});

test("picks the highest-priority (lowest rank) readiness insight", () => {
  const r = deriveReadiness("a-1", [
    insight({ severity: "info", rank: 5, title: "low priority" }),
    insight({ severity: "urgent", rank: 1, title: "high priority" }),
  ]);
  assert.equal(r.state, "not_ready");
  assert.equal(r.headline, "high priority");
});

test("ignores network-audience readiness insights (planter view only)", () => {
  const r = deriveReadiness("a-1", [
    insight({ audience: "network", severity: "urgent", rank: 0 }),
  ]);
  assert.equal(r.state, "unknown");
});

test("also treats phase_progress as a readiness category", () => {
  const r = deriveReadiness("a-1", [
    insight({ category: "phase_progress", severity: "watch" }),
  ]);
  assert.equal(r.state, "approaching");
});

// ============================================================================
// Initial declaration (OB-005) — the row that is NOT a transition
//
// The rules this half has to hold are properties of the STATEMENT, not of a
// return value: that ONE row is written however far along the planter says they
// are, that the row is marked, that the marker cannot be forged, and that the
// phase cannot move without the row landing. So they are asserted against the
// generated SQL, the way `src/lib/launch/service.test.ts` reads its `WITH`
// chain. A guard that lives only in a comment is a guard that comes back.
// ============================================================================

const DECLARE_CHURCH_ID = "33333333-3333-4333-8333-333333333333";
const DECLARE_ACTOR_ID = "44444444-4444-4444-8444-444444444444";

const declareDialect = new PgDialect();

function declareQuery(toPhase: number) {
  return declareDialect.sqlToQuery(
    declareInitialPhaseStatement({
      churchId: DECLARE_CHURCH_ID,
      toPhase,
      initiatedById: DECLARE_ACTOR_ID,
      factSnapshot: fakeSnapshot(),
      rubricVersion: "v0",
    })
  );
}

function declareSql(toPhase: number): string {
  return declareQuery(toPhase).sql.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// FRD AC 3 — declaring N fabricates nothing for 1..N-1 (the high-risk assertion)
// ---------------------------------------------------------------------------

test("declaring phase N writes exactly ONE phase_transitions row", () => {
  for (const phase of [0, 1, 2, 3, 4, 5, 6]) {
    const sql = declareSql(phase);
    const inserts = sql.match(/insert into phase_transitions/g) ?? [];
    assert.equal(
      inserts.length,
      1,
      `declaring ${phase} must write one row, not a ladder`
    );
  }
});

test("declaring 3 produces NO record for phases 1 or 2", () => {
  // The only phase NUMBERS the statement can write are the declared one and
  // whatever `churches.current_phase` already holds — read from the locked row,
  // never enumerated. So the intermediate phases are not merely unwritten, they
  // are unrepresentable: there is no parameter carrying them and no
  // set-generating construct that could invent one.
  const { sql, params } = declareQuery(3);
  const flat = sql.replace(/\s+/g, " ").trim();

  assert.equal(
    params.filter((value) => value === 1 || value === 2).length,
    0,
    "phases 1 and 2 must not appear as parameters"
  );
  assert.equal(
    params.filter((value) => value === 3).length,
    2,
    "the declared phase appears twice: the insert's to_phase and the update"
  );

  for (const generator of ["generate_series", "unnest", "values ("]) {
    assert.equal(
      flat.includes(generator),
      false,
      `${generator} would be a way to synthesise intermediate rows`
    );
  }

  // `from_phase` is read, not computed: wherever the row already sat.
  assert.match(flat, /select c\.id, c\.current_phase,/);
});

// ---------------------------------------------------------------------------
// The marker, and why it cannot be forged
// ---------------------------------------------------------------------------

test("the declaration row is marked with the stored discriminator", () => {
  const { sql, params } = declareQuery(2);
  const flat = sql.replace(/\s+/g, " ").trim();

  assert.match(
    flat,
    /insert into phase_transitions \( church_id, from_phase, to_phase, initiated_by_id, reason, kind,/,
    "`kind` must be written, not left to the column default"
  );
  assert.equal(
    params.filter((value) => value === INITIAL_DECLARATION_KIND).length,
    1,
    "the kind is written once — the guard reads the index, not a second copy"
  );
  // The reason still rides along as display copy for the history surface.
  assert.equal(
    params.filter((value) => value === INITIAL_DECLARATION_REASON).length,
    1
  );
});

test("an ordinary transition row is built as kind `transition`", () => {
  const row = buildTransitionRow({
    churchId: "c",
    fromPhase: 1,
    toPhase: 2,
    initiatedById: "u",
    reason: "Core group at target",
    factSnapshot: fakeSnapshot(),
    rubricVersion: "v0",
  });
  assert.equal(row.kind, TRANSITION_KIND);
  assert.equal(isInitialDeclaration({ kind: row.kind as string }), false);
});

test("isInitialDeclaration reads the marker, and only the marker", () => {
  assert.equal(isInitialDeclaration({ kind: INITIAL_DECLARATION_KIND }), true);
  assert.equal(isInitialDeclaration({ kind: TRANSITION_KIND }), false);
  // Not the reason text — that is display copy, and a row whose reason happens
  // to read like a declaration is still whatever `kind` says it is.
  assert.equal(
    isInitialDeclaration({ kind: `${INITIAL_DECLARATION_KIND} ` }),
    false
  );
});

test("a planter cannot type the reserved reason on a real transition", () => {
  // Without this refusal the marker is a convention, not a discriminator: a
  // planter pasting the constant into /phase's reason box would manufacture a
  // row that `isInitialDeclaration` misreads as history they never declared.
  const forged = transitionPhaseSchema.safeParse({
    toPhase: 4,
    reason: INITIAL_DECLARATION_REASON,
  });
  assert.equal(forged.success, false);

  // And the ordinary case still passes, so the refusal is narrow.
  assert.equal(
    transitionPhaseSchema.safeParse({ toPhase: 4, reason: "Teams trained" })
      .success,
    true
  );
});

// ---------------------------------------------------------------------------
// The guards, read off the statement
// ---------------------------------------------------------------------------

test("the church row is LOCKED before anything is written", () => {
  // A row lock, not a snapshot predicate: it is the row the UPDATE at the end
  // of this statement writes, so two submits serialise here
  // (memory/invariants.md → Atomicity).
  const sql = declareSql(1);
  assert.match(
    sql,
    /^with current as \( select id, current_phase from churches where .* for update \)/
  );
});

test("the insert DEPENDS on the locked read, so from_phase cannot be lost", () => {
  // `current` must be pulled BEFORE anything modifies the row. As a lazy
  // sibling it would be evaluated after the UPDATE, the re-read would skip the
  // tuple its own command just wrote, and the row would land with a false
  // `from_phase` — the trap diagnosed in `setLaunchDateStatement`.
  const sql = declareSql(1);
  const insertAt = sql.indexOf("insert into phase_transitions");
  const fromCurrentAt = sql.indexOf("from current c");
  const updateAt = sql.indexOf("update churches");

  assert.ok(insertAt > -1 && fromCurrentAt > insertAt);
  assert.ok(
    fromCurrentAt < updateAt,
    "the insert reads `current` before the update runs"
  );
});

test("the declaration is once-only, and the DATABASE is what makes it so", () => {
  // The predicate this replaced (`where not exists (select 1 from
  // phase_transitions …)`) read a different table than the `FOR UPDATE` locks,
  // so under READ COMMITTED both racers passed it and both inserted — raced
  // live on #306, 2 of 3 runs wrote a fabricated second row. A statement-shape
  // test cannot see that, which is why the real proof lives in
  // `declaration-race.test.ts`. What THIS asserts is that the mechanism is the
  // index and that the old trap has not crept back.
  const sql = declareSql(5);

  assert.match(
    sql,
    /on conflict \(church_id\) where kind = 'initial_declaration' do nothing/,
    "the guard must be ON CONFLICT inferred against the partial unique index"
  );
  assert.equal(
    sql.includes("not exists"),
    false,
    "a NOT EXISTS subquery over phase_transitions is the bug, not the guard"
  );
});

test("the once-only index the statement infers against actually exists", () => {
  // The `ON CONFLICT` inference above is a promise about the schema. If the
  // index is ever renamed or dropped, every declaration starts failing at
  // runtime with "there is no unique or exclusion constraint matching the ON
  // CONFLICT specification" — so the two are pinned to each other here.
  const migration = readFileSync(
    join(process.cwd(), "src/db/migrations/0033_phase_transition_kind.sql"),
    "utf8"
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "phase_transitions_initial_declaration_unique_idx" ON "phase_transitions" USING btree \("church_id"\) WHERE "phase_transitions"\."kind" = 'initial_declaration'/
  );
  // And the backfill runs BEFORE the index is built, or it indexes nothing.
  assert.ok(
    migration.indexOf('UPDATE "phase_transitions" SET "kind"') <
      migration.indexOf("CREATE UNIQUE INDEX"),
    "existing declarations must be re-marked before the index is built"
  );
});

test("current_phase cannot move unless the declaration row landed", () => {
  // The UPDATE is sourced from the insert's `RETURNING`, so a refused
  // declaration writes nothing at all — including no phase change.
  const sql = declareSql(6);
  assert.match(
    sql,
    /update churches ch set current_phase = .* from declared d/
  );
  assert.match(sql, /select d\.id as transition_id/);
});

test("a refused declaration still reports the LOCKED church's phase", () => {
  // `left join declared d on true` is what makes the refusal answerable: the
  // statement returns one row either way, with `stored_phase` read off the row
  // this request holds the lock on — the winner's value, not the stale one the
  // caller read before it queued. A plain `from declared d` returns nothing and
  // the caller has to guess from a pre-lock snapshot.
  const sql = declareSql(2);
  assert.match(sql, /c\.current_phase as stored_phase/);
  assert.match(sql, /from current c left join declared d on true/);
});

// ---------------------------------------------------------------------------
// A declaration does not announce itself as an advance (#306, HR4)
//
// `phase.changed` has exactly one subscriber today
// (`src/lib/events/subscriptions.ts` → `handlePhaseChangedForOversight`), and
// its whole job is the oversight "reached a new stage" milestone. A planter
// invited by a sending church who declares phase 4 at onboarding reached no
// stage — they told us where they already were — so that push must not fire.
// `PhaseChangedEvent` carries no `kind`, so the handler cannot tell the two
// apart; the emit is therefore DROPPED from the declaration path rather than
// filtered downstream, which is the version a future subscriber cannot undo by
// accident.
// ---------------------------------------------------------------------------

/** The service's own source, for the two negatives that have no return value. */
const SERVICE_CODE = readFileSync(
  join(process.cwd(), "src/lib/phase-engine/transitions/service.ts"),
  "utf8"
);

/** Everything from `export async function declareInitialPhase` to the next export. */
function declareInitialPhaseBody(): string {
  const start = SERVICE_CODE.indexOf(
    "export async function declareInitialPhase"
  );
  assert.notEqual(start, -1, "declareInitialPhase must exist");
  const rest = SERVICE_CODE.slice(start + 1);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

test("declaring a stage emits no phase.changed", () => {
  const body = declareInitialPhaseBody();

  assert.equal(
    /emitPhaseChanged\(/.test(body),
    false,
    "a declaration must not emit phase.changed — its only subscriber announces an advance"
  );

  // The ordinary transition path still emits: this narrowed one write path, it
  // did not remove the event.
  assert.match(SERVICE_CODE, /emitPhaseChanged\(/);
});

test("the handler cannot tell a declaration from a move, which is why nothing is emitted", () => {
  // The pin on the OTHER side of the bus. `handlePhaseChangedForOversight`
  // announces on `isPhaseAdvance(from, to)` alone, and the event payload it is
  // handed carries no discriminator — so a declaration reaching this handler is
  // announced, unconditionally. If someone adds `kind` to `PhaseChangedEvent`
  // and starts emitting again, this assertion is the one that must be revisited
  // in the same change.
  const events = readFileSync(
    join(process.cwd(), "src/lib/phase-engine/events.ts"),
    "utf8"
  );
  const handler = readFileSync(
    join(process.cwd(), "src/lib/notifications/oversight-events.ts"),
    "utf8"
  );

  const declaration = events.indexOf("interface PhaseChangedEvent");
  assert.notEqual(declaration, -1);
  const payload = events.slice(
    declaration,
    events.indexOf("\n}", declaration) + 2
  );
  assert.equal(
    /\bkind\b/.test(payload),
    false,
    "PhaseChangedEvent carries no kind, so the handler has nothing to filter on"
  );
  assert.match(
    handler,
    /if \(!isPhaseAdvance\(event\.fromPhase, event\.toPhase\)\) return;/
  );
});

// ---------------------------------------------------------------------------
// The declaration's own validation surface
// ---------------------------------------------------------------------------

test("a declared stage must be a real phase", () => {
  for (const phase of [0, 3, 6]) {
    assert.equal(
      initialPhaseDeclarationSchema.safeParse({ phase }).success,
      true
    );
  }
  for (const phase of [-1, 7, 1.5]) {
    assert.equal(
      initialPhaseDeclarationSchema.safeParse({ phase }).success,
      false
    );
  }
});

// ---------------------------------------------------------------------------
// Atomicity — the audit row and the phase move are ONE batched transaction.
//
// Source-shaped, because the subject is a DB write this process cannot execute.
// Anchored on DECLARATIONS through `sourceReader`, so a moved anchor throws
// instead of silently widening the span to the whole module
// (memory/invariants.md → Multi-Tenancy, the source-span rule).
// ---------------------------------------------------------------------------

test("transitionPhase writes the audit row and the phase move in one db.batch", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/phase-engine/transitions/service.ts"),
    "utf8"
  );
  const body = sourceReader(source, "transitions/service.ts").span(
    "export async function transitionPhase(",
    "export function declareInitialPhaseStatement("
  );

  assert.match(
    body,
    /await db\.batch\(\[/,
    "the two writes must be one Neon batched transaction — neon-http has no db.transaction"
  );
  assert.equal(
    /await db\.transaction\(/.test(body),
    false,
    "db.transaction() throws at runtime on neon-http"
  );

  // The point of the batch is that there is no SECOND awaited write between the
  // insert and the update. `buildFactSnapshot` is a read and stays above it.
  const writes = body.match(/await db\s*\n?\s*\.(insert|update|delete)\b/g);
  assert.equal(
    writes,
    null,
    `every write belongs to the batch; found ${writes?.join(", ")}`
  );
});

// ---------------------------------------------------------------------------
// The "use server" surface — the plant is the SESSION's, never an argument.
//
// Every export of a `"use server"` module is a public POST endpoint, and an
// entity implied by the actor is not an argument (memory/invariants.md →
// Authentication). `/phase`'s action module therefore exposes exactly ONE
// endpoint — the write the UI makes — and that endpoint names no church.
// ---------------------------------------------------------------------------

test("the /phase action module exposes one endpoint and it takes no churchId", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/(dashboard)/phase/actions.ts"),
    "utf8"
  );

  const exportedFunctions = [
    ...source.matchAll(/export async function (\w+)/g),
  ].map((match) => match[1]);
  assert.deepEqual(
    exportedFunctions,
    ["transitionPhaseAction"],
    "a new export here is a new public POST endpoint — a read belongs in a sibling module with no directive"
  );

  const body = sourceReader(source, "phase/actions.ts").after(
    "export async function transitionPhaseAction("
  );
  assert.match(
    body,
    /const churchId = user\.churchId;/,
    "the plant is minted from the session"
  );
  assert.equal(
    /input\.churchId/.test(body),
    false,
    "the caller must not be able to name the plant"
  );

  // The input shape itself carries no plant.
  const input = sourceReader(source, "phase/actions.ts").span(
    "export interface TransitionPhaseActionInput {",
    "export async function transitionPhaseAction("
  );
  assert.equal(/churchId/.test(input), false);
});
