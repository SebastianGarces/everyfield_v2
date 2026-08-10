import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";

import { asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, phaseTransitions, tasks, users } from "@/db/schema";

import { planTemplateImport } from "./import";
import {
  acceptPhaseTemplatePrompt,
  getLatestPhaseTransition,
  getPhaseTemplatePrompt,
  handlePhaseChangedForTemplatePrompt,
  phaseTemplatesFor,
} from "./phase-prompt";

// ----------------------------------------------------------------------------
// T-020 — the half that EXECUTES against a database.
//
// `phase-prompt.test.ts` proves the decision; this file proves the rows. It
// seeds a plant, writes a real `phase_transitions` row, and reads the tasks
// back with a plain SELECT — so "declining leaves no tasks" is an assertion
// about the table, not about a return value.
//
// ⚠ THIS FILE SKIPS WHEN DATABASE_URL POINTS NOWHERE, AND IT DOES ON CI.
// A green PR check means the pure half held. The DB evidence comes from
// running this where a real database is configured:
//
//     pnpm exec tsx --env-file-if-exists=.env.local --test "src/lib/tasks/phase-prompt*.test.ts"
//
// and `skipped 0` in that output is the line worth quoting.
// ----------------------------------------------------------------------------

/** The stage the fixtures move into. Phase 2 carries more than one template,
 *  which is what makes "import only what was ticked" testable. */
const TO_PHASE = 2;

const SKIP_NOTE =
  "SKIPPED — the live T-020 assertions did NOT run. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

interface Fixture {
  churchId: string;
  userId: string;
}

async function seed(prefix: string): Promise<Fixture> {
  const [church] = await db
    .insert(churches)
    .values({ name: `${prefix} plant` })
    .returning({ id: churches.id });

  const [user] = await db
    .insert(users)
    .values({
      email: `${prefix}@example.test`,
      passwordHash: "not-a-real-hash",
      name: `${prefix} planter`,
      role: "planter",
      churchId: church.id,
    })
    .returning({ id: users.id });

  return { churchId: church.id, userId: user.id };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await db.delete(tasks).where(eq(tasks.churchId, fixture.churchId));
  await db
    .delete(phaseTransitions)
    .where(eq(phaseTransitions.churchId, fixture.churchId));
  await db.delete(users).where(eq(users.id, fixture.userId));
  await db.delete(churches).where(inArray(churches.id, [fixture.churchId]));
}

/** Write a real transition row and hand back its id. */
async function recordTransition(
  fixture: Fixture,
  options: {
    fromPhase: number;
    toPhase: number;
    createdAt: Date;
    kind?: "transition" | "initial_declaration";
  }
): Promise<string> {
  const [row] = await db
    .insert(phaseTransitions)
    .values({
      churchId: fixture.churchId,
      fromPhase: options.fromPhase,
      toPhase: options.toPhase,
      initiatedById: fixture.userId,
      reason: "live test",
      kind: options.kind ?? "transition",
      rubricVersion: "rubric-v0",
      createdAt: options.createdAt,
    })
    .returning({ id: phaseTransitions.id });

  return row.id;
}

/** Straight from the table — no service read in the way. */
async function tasksOf(churchId: string) {
  return db
    .select({
      title: tasks.title,
      category: tasks.category,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      assignedToId: tasks.assignedToId,
    })
    .from(tasks)
    .where(eq(tasks.churchId, churchId))
    .orderBy(asc(tasks.createdAt));
}

// ----------------------------------------------------------------------------

test("a transition surfaces the new phase's templates as a prompt", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t320-${randomUUID().slice(0, 8)}`);

  try {
    assert.equal(
      await getPhaseTemplatePrompt(fixture.churchId, null),
      null,
      "a plant that has never moved must not be prompted"
    );

    const transitionId = await recordTransition(fixture, {
      fromPhase: 1,
      toPhase: TO_PHASE,
      createdAt: new Date("2026-03-02T09:15:00.000Z"),
    });

    const prompt = await getPhaseTemplatePrompt(fixture.churchId, null);
    assert.ok(prompt);
    assert.equal(prompt.transitionId, transitionId);
    assert.equal(prompt.toPhase, TO_PHASE);
    assert.deepEqual(
      prompt.offers.map((offer) => offer.key),
      phaseTemplatesFor(TO_PHASE).map((template) => template.key)
    );

    // Prompted, not created.
    assert.deepEqual(await tasksOf(fixture.churchId), []);
  } finally {
    await cleanup(fixture);
  }
});

test("an onboarding declaration is not a move and prompts nothing", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t320-${randomUUID().slice(0, 8)}`);

  try {
    await recordTransition(fixture, {
      fromPhase: 0,
      toPhase: TO_PHASE,
      createdAt: new Date("2026-03-02T09:15:00.000Z"),
      kind: "initial_declaration",
    });

    assert.equal(await getLatestPhaseTransition(fixture.churchId), null);
    assert.equal(await getPhaseTemplatePrompt(fixture.churchId, null), null);
  } finally {
    await cleanup(fixture);
  }
});

test("accepting imports through the T-011 path, dated from the transition", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t320-${randomUUID().slice(0, 8)}`);
  const transitionedAt = new Date("2026-03-02T09:15:00.000Z");

  try {
    const transitionId = await recordTransition(fixture, {
      fromPhase: 1,
      toPhase: TO_PHASE,
      createdAt: transitionedAt,
    });

    const template = phaseTemplatesFor(TO_PHASE)[0];
    const result = await acceptPhaseTemplatePrompt({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKeys: [template.key],
    });

    assert.ok(result);
    assert.equal(result.transitionId, transitionId);
    assert.equal(result.createdCount, template.items.length);

    const rows = await tasksOf(fixture.churchId);
    assert.equal(rows.length, template.items.length);

    // The dates are the transition's, NOT today's — this is the whole claim of
    // T-020, so it is asserted against the plan for the transition instant.
    const expected = planTemplateImport(template, transitionedAt);
    assert.deepEqual(
      rows.map((row) => row.dueDate).sort(),
      expected.tasks.map((task) => task.dueDate).sort()
    );

    const today = new Date().toISOString().slice(0, 10);
    assert.notEqual(
      expected.importedOn,
      today,
      "fixture is stale: pick a transition date that is not today"
    );

    for (const row of rows) {
      assert.equal(row.category, template.category);
      assert.equal(
        row.assignedToId,
        fixture.userId,
        "an unassigned import reaches no My tasks view"
      );
    }
  } finally {
    await cleanup(fixture);
  }
});

test("only the ticked checklists are imported", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const offered = phaseTemplatesFor(TO_PHASE);
  if (offered.length < 2) {
    return t.skip(
      `phase ${TO_PHASE} now carries one template; pick a phase with two`
    );
  }

  const fixture = await seed(`__t320-${randomUUID().slice(0, 8)}`);

  try {
    await recordTransition(fixture, {
      fromPhase: 1,
      toPhase: TO_PHASE,
      createdAt: new Date("2026-03-02T09:15:00.000Z"),
    });

    const taken = offered[1];
    const result = await acceptPhaseTemplatePrompt({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKeys: [taken.key],
    });

    assert.ok(result);
    assert.deepEqual(result.templateNames, [taken.name]);

    const titles = new Set(
      (await tasksOf(fixture.churchId)).map((r) => r.title)
    );
    assert.equal(titles.size > 0, true);

    for (const item of offered[0].items) {
      assert.ok(
        !titles.has(item.title),
        `an unticked checklist's item was created: ${item.title}`
      );
    }
  } finally {
    await cleanup(fixture);
  }
});

test("a template outside the prompted phase is refused, not imported", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t320-${randomUUID().slice(0, 8)}`);

  try {
    await recordTransition(fixture, {
      fromPhase: 1,
      toPhase: TO_PHASE,
      createdAt: new Date("2026-03-02T09:15:00.000Z"),
    });

    // The keys arrive from a browser. A forged one names a real template from
    // a stage this plant has not reached — it must buy nothing.
    const elsewhere = phaseTemplatesFor(5)[0];
    assert.ok(elsewhere);

    const result = await acceptPhaseTemplatePrompt({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKeys: [elsewhere.key, "not-a-template"],
    });

    assert.equal(result, null);
    assert.deepEqual(await tasksOf(fixture.churchId), []);
  } finally {
    await cleanup(fixture);
  }
});

test("accepting with no live prompt creates nothing", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t320-${randomUUID().slice(0, 8)}`);

  try {
    const result = await acceptPhaseTemplatePrompt({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKeys: phaseTemplatesFor(TO_PHASE).map((t) => t.key),
    });

    assert.equal(result, null);
    assert.deepEqual(await tasksOf(fixture.churchId), []);
  } finally {
    await cleanup(fixture);
  }
});

test("declining leaves no tasks, and the prompt does not come back", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t320-${randomUUID().slice(0, 8)}`);

  try {
    const transitionId = await recordTransition(fixture, {
      fromPhase: 1,
      toPhase: TO_PHASE,
      createdAt: new Date("2026-03-02T09:15:00.000Z"),
    });

    // Decline writes nothing but the answer; the answer is the transition id
    // the browser then sends back on every later render.
    assert.deepEqual(await tasksOf(fixture.churchId), []);

    // The "second page load".
    assert.equal(
      await getPhaseTemplatePrompt(fixture.churchId, transitionId),
      null
    );
    assert.deepEqual(await tasksOf(fixture.churchId), []);

    // And the NEXT move prompts again, unanswered.
    await recordTransition(fixture, {
      fromPhase: TO_PHASE,
      toPhase: 3,
      createdAt: new Date("2026-06-01T09:15:00.000Z"),
    });

    const next = await getPhaseTemplatePrompt(fixture.churchId, transitionId);
    assert.ok(next);
    assert.equal(next.toPhase, 3);
    assert.deepEqual(await tasksOf(fixture.churchId), []);
  } finally {
    await cleanup(fixture);
  }
});

test("the phase.changed handler creates no tasks", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t320-${randomUUID().slice(0, 8)}`);

  try {
    await recordTransition(fixture, {
      fromPhase: 1,
      toPhase: TO_PHASE,
      createdAt: new Date("2026-03-02T09:15:00.000Z"),
    });

    await handlePhaseChangedForTemplatePrompt({
      type: "phase.changed",
      churchId: fixture.churchId,
      fromPhase: 1,
      toPhase: TO_PHASE,
      initiatedById: fixture.userId,
      rubricVersion: "rubric-v0",
      timestamp: new Date(),
    });

    // "Prompt, do not auto-create", asserted against the table.
    assert.deepEqual(await tasksOf(fixture.churchId), []);
    assert.ok(await getPhaseTemplatePrompt(fixture.churchId, null));
  } finally {
    await cleanup(fixture);
  }
});
