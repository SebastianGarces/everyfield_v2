import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { churches, users, persons } from "@/db/schema";
import {
  createTrainingProgram,
  updateTrainingProgram,
  markTrainingComplete,
  undoTrainingComplete,
} from "./training";

const skip = process.env.LIVE_DB_TESTS !== "1";

test(
  "training correction audit snapshots match saved rows and concurrent undo records once",
  { skip },
  async () => {
    // This proof mutates only a fresh namespace on an explicitly owned local runtime.
    const connection = new URL(process.env.DATABASE_URL!);
    assert.equal(connection.hostname, "localhost");
    if (process.env.EVERYFIELD_OWNED_PREVIEW === "1") {
      assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
    } else {
      assert.equal(
        connection.pathname,
        "/live_lib_ministry_teams_training_history_live"
      );
      const endpoint = new URL(
        process.env.NEON_HTTP_PROXY_URL ?? "http://localhost:4444/sql"
      );
      assert.ok(["localhost", "127.0.0.1"].includes(endpoint.hostname));
    }
    if (process.env.TRAINING_AUDIT_TEST_TIMEZONE) {
      const timezone = await db.execute(sql`SHOW timezone`);
      assert.equal(
        timezone.rows[0].TimeZone,
        process.env.TRAINING_AUDIT_TEST_TIMEZONE
      );
    }
    const [church] = await db
      .insert(churches)
      .values({ name: "Training audit regression" })
      .returning();
    const [actor] = await db
      .insert(users)
      .values({
        email: `${randomUUID()}@example.test`,
        passwordHash: "owned-fixture",
        seat: "owner",
        churchId: church.id,
      })
      .returning();
    const [person] = await db
      .insert(persons)
      .values({
        churchId: church.id,
        firstName: "Audit",
        lastName: "Fixture",
        createdBy: actor.id,
      })
      .returning();
    const program = await createTrainingProgram(church.id, actor.id, {
      name: "Before",
    });
    const original = await db.execute(
      sql`SELECT to_jsonb(t) AS snapshot FROM training_programs t WHERE id=${program.id}::uuid AND church_id=${church.id}::uuid`
    );
    const updated = await updateTrainingProgram(
      church.id,
      program.id,
      actor.id,
      { name: "After", description: "Updated", isRequired: true },
      program.updatedAt.toISOString()
    );
    assert.equal(updated.name, "After");
    assert.ok(updated.updatedAt instanceof Date);
    const programAudit = await db.execute(
      sql`SELECT r.before, r.after, to_jsonb(t) AS actual FROM record_corrections r JOIN training_programs t ON t.id=r.entity_id AND t.church_id=r.church_id WHERE r.entity_type='training_program' AND r.entity_id=${program.id}::uuid AND r.church_id=${church.id}::uuid`
    );
    assert.equal(programAudit.rows.length, 1);
    assert.deepEqual(programAudit.rows[0].before, original.rows[0].snapshot);
    assert.deepEqual(programAudit.rows[0].after, programAudit.rows[0].actual);
    await assert.rejects(
      updateTrainingProgram(
        church.id,
        program.id,
        actor.id,
        { name: "Stale" },
        program.updatedAt.toISOString()
      )
    );
    const afterStale = await db.execute(
      sql`SELECT count(*)::int AS count FROM record_corrections WHERE entity_type='training_program' AND entity_id=${program.id}::uuid AND church_id=${church.id}::uuid`
    );
    assert.equal(afterStale.rows[0].count, 1);
    const edits = await Promise.allSettled([
      updateTrainingProgram(
        church.id,
        program.id,
        actor.id,
        { name: "Concurrent one" },
        updated.updatedAt.toISOString()
      ),
      updateTrainingProgram(
        church.id,
        program.id,
        actor.id,
        { name: "Concurrent two" },
        updated.updatedAt.toISOString()
      ),
    ]);
    assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(edits.filter((r) => r.status === "rejected").length, 1);
    const latestProgramAudit = await db.execute(
      sql`SELECT r.before, r.after, to_jsonb(t) AS actual FROM record_corrections r JOIN training_programs t ON t.id=r.entity_id AND t.church_id=r.church_id WHERE r.entity_type='training_program' AND r.entity_id=${program.id}::uuid AND r.church_id=${church.id}::uuid ORDER BY r.corrected_at DESC LIMIT 1`
    );
    assert.deepEqual(
      latestProgramAudit.rows[0].before,
      programAudit.rows[0].actual
    );
    assert.deepEqual(
      latestProgramAudit.rows[0].after,
      latestProgramAudit.rows[0].actual
    );
    const programHistoryCount = await db.execute(
      sql`SELECT count(*)::int AS count FROM record_corrections WHERE entity_type='training_program' AND entity_id=${program.id}::uuid AND church_id=${church.id}::uuid`
    );
    assert.equal(programHistoryCount.rows[0].count, 2);
    await markTrainingComplete(church.id, person.id, program.id, actor.id);
    const beforeUndo = await db.execute(
      sql`SELECT to_jsonb(t) AS snapshot FROM training_completions t WHERE church_id=${church.id}::uuid AND person_id=${person.id}::uuid AND training_program_id=${program.id}::uuid`
    );
    const undoStartedAt = Date.now();
    const outcomes = await Promise.allSettled([
      undoTrainingComplete(church.id, person.id, program.id, actor.id),
      undoTrainingComplete(church.id, person.id, program.id, actor.id),
    ]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
    const undoAudit = await db.execute(
      sql`SELECT r.before, r.after, to_jsonb(t) AS actual FROM record_corrections r JOIN training_completions t ON t.id=r.entity_id AND t.church_id=r.church_id WHERE r.entity_type='training_completion' AND t.person_id=${person.id}::uuid AND t.training_program_id=${program.id}::uuid AND r.church_id=${church.id}::uuid`
    );
    assert.equal(undoAudit.rows.length, 1);
    assert.deepEqual(undoAudit.rows[0].before, beforeUndo.rows[0].snapshot);
    assert.deepEqual(undoAudit.rows[0].after, undoAudit.rows[0].actual);
    const actual = undoAudit.rows[0].actual as { revoked_at: string };
    const revokedAt = Date.parse(actual.revoked_at);
    assert.ok(
      revokedAt >= undoStartedAt && revokedAt <= Date.now(),
      "Revocation is the actual elapsed instant, independent of database timezone"
    );
  }
);
