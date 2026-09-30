import assert from "node:assert/strict";
import { db } from "@/db";
import {
  assessments,
  churches,
  interviews,
  commitments,
  persons,
  users,
  recordCorrections,
} from "@/db/schema";
import {
  correctPersonRecord,
  getPersonRecordCorrection,
  type PersonRecordKind,
} from "@/lib/people/corrections";
import { eq } from "drizzle-orm";

async function main() {
  // Run only through an owned preview runner. Never load a checkout's shared .env.
  if (process.env.ALPHA_CORRECTIONS_OWNED_DB !== "1")
    throw new Error("Owned fixture database acknowledgement required");
  const [church] = await db
    .insert(churches)
    .values({ name: `Correction proof ${crypto.randomUUID()}` })
    .returning();
  const [user] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@example.test`,
      name: "Correction proof",
      passwordHash: "unused-local-proof",
      churchId: church.id,
    })
    .returning();
  const [person] = await db
    .insert(persons)
    .values({
      churchId: church.id,
      createdBy: user.id,
      firstName: "Correction",
      lastName: "Proof",
    })
    .returning();
  try {
    const [assessment] = await db
      .insert(assessments)
      .values({
        churchId: church.id,
        personId: person.id,
        assessedBy: user.id,
        committedScore: 1,
        compelledScore: 1,
        contagiousScore: 1,
        courageousScore: 1,
        totalScore: 4,
        assessmentDate: "2026-09-01",
        committedNotes: "Original",
      })
      .returning();
    const [interview] = await db
      .insert(interviews)
      .values({
        churchId: church.id,
        personId: person.id,
        interviewedBy: user.id,
        interviewDate: "2026-09-01",
        maturityStatus: "pass",
        giftedStatus: "pass",
        chemistryStatus: "pass",
        rightReasonsStatus: "pass",
        seasonStatus: "pass",
        overallResult: "qualified",
        nextSteps: "Original",
      })
      .returning();
    const [commitment] = await db
      .insert(commitments)
      .values({
        churchId: church.id,
        personId: person.id,
        commitmentType: "core_group",
        signedDate: "2026-09-01",
        notes: "Original",
        documentUrl: "proof/retained.pdf",
        witnessedBy: user.id,
      })
      .returning();
    for (const [kind, id, input] of [
      [
        "assessment",
        assessment.id,
        {
          committedScore: 2,
          compelledScore: 2,
          contagiousScore: 2,
          courageousScore: 2,
          assessmentDate: "2026-09-02",
        },
      ],
      [
        "interview",
        interview.id,
        {
          maturityStatus: "concern",
          giftedStatus: "pass",
          chemistryStatus: "pass",
          rightReasonsStatus: "pass",
          seasonStatus: "pass",
          overallResult: "follow_up",
          interviewDate: "2026-09-02",
        },
      ],
      [
        "commitment",
        commitment.id,
        {
          commitmentType: "launch_team",
          signedDate: "2026-09-02",
          witnessedBy: crypto.randomUUID(),
        },
      ],
    ] as [PersonRecordKind, string, Record<string, unknown>][]) {
      const original = await getPersonRecordCorrection(
        church.id,
        person.id,
        kind,
        id
      );
      assert.ok(original);
      assert.equal(
        await getPersonRecordCorrection(
          crypto.randomUUID(),
          person.id,
          kind,
          id
        ),
        undefined
      );
      assert.equal(
        await getPersonRecordCorrection(
          church.id,
          crypto.randomUUID(),
          kind,
          id
        ),
        undefined
      );
      const raced = await Promise.all(
        [0, 1].map(() =>
          correctPersonRecord(
            church.id,
            user.id,
            person.id,
            kind,
            id,
            original.version,
            input
          )
        )
      );
      assert.equal(
        raced.filter(Boolean).length,
        1,
        `${kind}: only one concurrent correction wins`
      );
      assert.equal(
        await correctPersonRecord(
          church.id,
          user.id,
          person.id,
          kind,
          id,
          original.version,
          input
        ),
        false
      );
      const revised = await getPersonRecordCorrection(
        church.id,
        person.id,
        kind,
        id
      );
      assert.ok(revised);
      if (kind === "assessment") {
        assert.equal(revised.record.total_score, 8);
        assert.equal(revised.record.committed_notes, null);
      }
      if (kind === "interview") assert.equal(revised.record.next_steps, null);
      if (kind === "commitment") {
        assert.equal(revised.record.document_url, "proof/retained.pdf");
        assert.equal(revised.record.witnessed_by, user.id);
      }
      const history = await db
        .select()
        .from(recordCorrections)
        .where(eq(recordCorrections.entityId, id));
      assert.equal(history.length, 1);
      assert.equal((history[0].before as Record<string, unknown>).id, id);
      assert.equal(history[0].correctedBy, user.id);
      assert.equal(
        await correctPersonRecord(
          crypto.randomUUID(),
          user.id,
          person.id,
          kind,
          id,
          revised.version,
          input
        ),
        false
      );
      console.log(
        `PASS ${kind}: concurrent correction, stale refusal, history, tenant/person isolation, optional clearing`
      );
    }
  } finally {
    await db
      .delete(recordCorrections)
      .where(eq(recordCorrections.churchId, church.id));
    await db.delete(assessments).where(eq(assessments.churchId, church.id));
    await db.delete(interviews).where(eq(interviews.churchId, church.id));
    await db.delete(commitments).where(eq(commitments.churchId, church.id));
    await db.delete(persons).where(eq(persons.churchId, church.id));
    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
