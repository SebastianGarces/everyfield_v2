/** Actual action/DB proof. Only an explicitly owned disposable preview is allowed. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import * as schema from "@/db/schema";
import { seedMergeHistory, referenceSnapshot } from "./people-merge-fixtures";
import { personMergeReferences } from "@/lib/people/merge-references";
import {
  findDuplicateMatches,
  listDuplicatePairs,
} from "@/lib/people/duplicates";
import { mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { persons, users, personActivities, type User } from "@/db/schema";
import { getMergeReview, mergePeople } from "@/lib/people/merge";
import { mergeFields, type MergeRequest } from "@/lib/people/merge-model";
import { UnauthorizedError } from "@/lib/auth/unauthorized";

async function main() {
  const connection = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  assert.equal(connection.hostname, "localhost");
  assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const [fixturePath, output] = process.argv.slice(2);
  assert.ok(fixturePath?.startsWith("/private/tmp/"));
  assert.ok(output?.startsWith("/private/tmp/"));
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.equal(connection.pathname, `/${fixture.database}`);
  const identity = await db.execute<{ name: string }>(
    sql`select current_database() as name`
  );
  assert.equal(identity.rows[0].name, fixture.database);
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, fixture.accounts[0].id));
  assert.equal(owner.seat, "owner");
  let actor: User | null = owner;
  mock.module("@/lib/auth/session", {
    namedExports: {
      verifySession: async () => {
        if (!actor) throw new UnauthorizedError();
        return { user: actor };
      },
    },
  });
  mock.module("next/cache", { namedExports: { revalidatePath() {} } });
  mock.module("next/navigation", { namedExports: { unstable_rethrow() {} } });
  const { mergePeopleAction } =
    await import("@/app/(dashboard)/people/duplicates/actions");
  const churchId = fixture.primaryChurchId;
  const key = crypto.randomUUID().slice(0, 8);
  const create = async (
    name: string,
    extra: Partial<typeof persons.$inferInsert> = {}
  ) => {
    const [person] = await db
      .insert(persons)
      .values({
        churchId,
        createdBy: owner.id,
        firstName: `${name}-${key}`,
        lastName: "Merge proof",
        ...extra,
      })
      .returning();
    return person;
  };
  const inputFor = async (
    leftId: string,
    rightId: string
  ): Promise<MergeRequest> => {
    const review = await getMergeReview(churchId, leftId, rightId);
    assert.ok(review);
    assert.ok(!JSON.stringify(review).includes('"userId"'));
    assert.ok(!JSON.stringify(review).includes('"photoUrl"'));
    return {
      leftId,
      rightId,
      leftVersion: review.left.version,
      rightVersion: review.right.version,
      survivor: "left",
      choices: Object.fromEntries(mergeFields.map((f) => [f.key, "right"])),
    };
  };
  for (const [label, leftPhoto, rightPhoto, photoChoice] of [
    [
      "right-photo",
      "private/merge-left.png",
      "private/merge-right.png",
      "right",
    ],
    ["left-photo", "private/merge-left.png", "private/merge-right.png", "left"],
    ["clear-photo", "private/merge-left.png", null, "right"],
    ["same-photo", "private/merge-same.png", "private/merge-same.png", "left"],
  ] as const) {
    const photoLeft = await create(`Photo ${label} left`, {
      photoUrl: leftPhoto,
    });
    const photoRight = await create(`Photo ${label} right`, {
      photoUrl: rightPhoto,
    });
    const review = await getMergeReview(churchId, photoLeft.id, photoRight.id);
    assert.ok(review);
    assert.equal(review.conflicts.includes("photo"), leftPhoto !== rightPhoto);
    const payload = JSON.stringify(review);
    assert.ok(!payload.includes("private/"));
    assert.ok(!payload.includes('"photoUrl"'));
    assert.ok(payload.includes(`/api/people/${photoLeft.id}/photo`));
    const input = await inputFor(photoLeft.id, photoRight.id);
    if (leftPhoto !== rightPhoto) {
      delete input.choices.photo;
      assert.equal((await mergePeopleAction(input)).success, false);
      const unchanged = await db
        .select()
        .from(persons)
        .where(eq(persons.id, photoLeft.id));
      assert.equal(unchanged[0].photoUrl, leftPhoto);
      assert.equal(unchanged[0].deletedAt, null);
    }
    input.choices.photo = photoChoice;
    assert.equal((await mergePeopleAction(input)).success, true);
    const [survivor] = await db
      .select()
      .from(persons)
      .where(eq(persons.id, photoLeft.id));
    const [source] = await db
      .select()
      .from(persons)
      .where(eq(persons.id, photoRight.id));
    assert.equal(
      survivor.photoUrl,
      photoChoice === "left" ? leftPhoto : rightPhoto
    );
    assert.equal(source.photoUrl, rightPhoto);
    assert.ok(source.deletedAt);
  }
  console.log(
    "PASS: photo conflicts require a side; left/right/null/same stored photo choices persist atomically; review exposes only authenticated routes and no private storage keys."
  );
  const left = await create("Keep", {
    email: `pair-${key}@example.test`,
    notes: "Kept original note",
  });
  const right = await create("Retire", {
    email: left.email,
    notes: "Source note",
  });
  await db.insert(personActivities).values({
    churchId,
    personId: right.id,
    activityType: "note_added",
    performedBy: owner.id,
    metadata: { note: "History must survive" },
  });
  const history = await seedMergeHistory(
    churchId,
    owner.id,
    right.id,
    left.id,
    fixture.planningMeetingId,
    fixture.sentMessageId
  );
  const before = await referenceSnapshot(right.id, left.id);
  const input = await inputFor(left.id, right.id);
  const result = await mergePeopleAction(input);
  assert.equal(result.success, true, JSON.stringify(result));
  const [kept] = await db.select().from(persons).where(eq(persons.id, left.id));
  const [retired] = await db
    .select()
    .from(persons)
    .where(eq(persons.id, right.id));
  assert.equal(kept.notes, "Source note");
  assert.ok(retired.deletedAt);
  assert.equal(retired.notes, "Source note");
  assert.equal(
    (
      await db
        .select()
        .from(personActivities)
        .where(eq(personActivities.personId, left.id))
    ).length,
    1
  );
  assert.equal((await mergePeople(churchId, owner.id, input)).success, true);
  await assert.rejects(
    db.insert(personActivities).values({
      churchId,
      personId: right.id,
      activityType: "note_added",
      performedBy: owner.id,
    })
  );

  console.log("PASS: permitted merge and complete history transfer.");
  const after = await referenceSnapshot(right.id, left.id);
  for (const previous of before) {
    const next = after.find((item) => item.table === previous.table)!;
    assert.equal(
      next.rows.length,
      previous.rows.length,
      `${previous.table} row count`
    );
    for (const old of previous.rows) {
      const moved = next.rows.find((row) => row.id === old.id)!;
      assert.ok(moved, `${previous.table} retains IDs`);
      const unchanged = { ...old.row };
      const actual = { ...moved.row };
      for (const reference of previous.references) {
        delete unchanged[reference.column];
        delete actual[reference.column];
        if (
          old.row[reference.column] === right.id &&
          previous.table !== "person_tags"
        )
          assert.equal(moved.row[reference.column], left.id);
      }
      assert.deepEqual(
        actual,
        unchanged,
        `${previous.table} preserves every non-reference value`
      );
    }
  }
  assert.equal(kept.householdId, history.householdId);
  assert.equal(
    (await listDuplicatePairs(churchId)).pairs.some((p) =>
      [p.left.id, p.right.id].includes(right.id)
    ),
    false
  );
  const refs = await db.execute<{ table_name: string; column_name: string }>(
    sql`select c.conrelid::regclass::text as table_name,a.attname as column_name from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey) where c.contype='f' and c.confrelid='persons'::regclass and c.conrelid <> 'person_merges'::regclass order by 1,2`
  );
  assert.deepEqual(
    refs.rows.map((r) => `${r.table_name}.${r.column_name}`).sort(),
    personMergeReferences
      .filter((r) => !("discriminator" in r))
      .map((r) => `${r.table}.${r.column}`)
      .sort()
  );
  const pair = async (name: string) =>
    [await create(name + "A"), await create(name + "B")] as const;
  const unchangedPair = async (ids: readonly string[]) => ({
    people: (
      await db.execute(
        sql`select to_jsonb(p) as row from persons p where id in (${ids[0]},${ids[1]}) order by id`
      )
    ).rows,
    refs: await referenceSnapshot(ids[0], ids[1]),
    receipts: (
      await db.execute(
        sql`select * from person_merges where source_id in (${ids[0]},${ids[1]})`
      )
    ).rows,
  });
  const refuse = async (a: string, b: string, pattern: RegExp) => {
    const request = await inputFor(a, b);
    const snapshot = await unchangedPair([a, b]);
    const answer = await mergePeopleAction(request);
    assert.equal(answer.success, false);
    if (!answer.success) assert.match(answer.error, pattern);
    assert.deepEqual(await unchangedPair([a, b]), snapshot);
    return answer;
  };
  const [blockedA, blockedB] = await pair("AttendanceCollision");
  await db.insert(schema.meetingAttendance).values(
    [blockedA, blockedB].map((p) => ({
      churchId,
      personId: p.id,
      meetingId: fixture.planningMeetingId,
      status: "attended" as const,
    }))
  );
  await refuse(blockedA.id, blockedB.id, /attendance/);
  const [cardA, cardB] = await pair("CardCollision");
  await db.insert(schema.meetingResponses).values(
    [cardA, cardB].map((p) => ({
      churchId,
      personId: p.id,
      meetingId: fixture.planningMeetingId,
      responseType: "interested" as const,
    }))
  );
  await refuse(cardA.id, cardB.id, /response cards/);
  const [trainingA, trainingB] = await pair("TrainingCollision");
  await db.insert(schema.trainingCompletions).values(
    [trainingA, trainingB].map((p) => ({
      churchId,
      personId: p.id,
      trainingProgramId: history.trainingId,
      completedAt: new Date(),
      createdBy: owner.id,
    }))
  );
  await refuse(trainingA.id, trainingB.id, /training/);
  const [taskA, taskB] = await pair("FollowupCollision");
  await db.insert(schema.tasks).values(
    [taskA, taskB].map((p) => ({
      churchId,
      relatedId: p.id,
      relatedType: "person" as const,
      category: "follow_up" as const,
      title: "Collision task",
      dueDate: "2026-01-10",
      createdById: owner.id,
    }))
  );
  await refuse(taskA.id, taskB.id, /follow-up/);
  const [tokenA, tokenB] = await pair("TokenCollision");
  await db.insert(schema.meetingConfirmationTokens).values({
    churchId,
    personId: tokenB.id,
    meetingId: fixture.planningMeetingId,
    token: crypto.randomUUID(),
    status: "pending",
    expiresAt: new Date("2025-01-01"),
  });
  await refuse(tokenA.id, tokenB.id, /pending RSVP/);
  const [selfA, selfB] = await pair("SelfReferral");
  await db.insert(schema.invitations).values({
    churchId,
    meetingId: fixture.planningMeetingId,
    inviterId: selfA.id,
    inviteeId: selfB.id,
  });
  await refuse(selfA.id, selfB.id, /self-referral/);
  const [foreignA, foreignB] = await pair("CorruptTenant");
  await db.insert(personActivities).values({
    churchId: fixture.foreignChurchId,
    personId: foreignB.id,
    activityType: "note_added",
    performedBy: owner.id,
  });
  await refuse(foreignA.id, foreignB.id, /church ownership/);
  const [tagA, tagB] = await pair("CorruptTagTenant");
  const [tag] = await db
    .insert(schema.tags)
    .values({ churchId, name: "Owned tag" })
    .returning();
  await db.insert(schema.personTags).values({
    churchId: fixture.foreignChurchId,
    personId: tagB.id,
    tagId: tag.id,
  });
  await refuse(tagA.id, tagB.id, /church ownership/);
  const [foreignTag] = await db
    .insert(schema.tags)
    .values({ churchId: fixture.foreignChurchId, name: "Foreign tag" })
    .returning();
  const [tagC, tagD] = await pair("CorruptTagOwner");
  await db
    .insert(schema.personTags)
    .values({ churchId, personId: tagD.id, tagId: foreignTag.id });
  await refuse(tagC.id, tagD.id, /church ownership/);
  const [member] = await db
    .insert(users)
    .values({
      name: "Merge proof Member",
      email: `member-${key}@merge.example.test`,
      passwordHash: owner.passwordHash,
      churchId,
      seat: "member",
    })
    .returning();
  const linked = await create("LinkedMember", { userId: member.id });
  const unlinked = await create("UnlinkedLeader");
  await db.insert(schema.ministryTeams).values({
    churchId,
    name: "Refused authority transfer",
    type: "custom",
    leaderId: unlinked.id,
    leaderSource: "explicit",
    createdBy: owner.id,
  });
  await refuse(linked.id, unlinked.id, /leadership access/);
  await refuse(unlinked.id, linked.id, /account-linked/);
  await db
    .update(users)
    .set({ churchId: null, seat: null })
    .where(eq(users.id, member.id));
  await refuse(linked.id, unlinked.id, /leadership access/);
  await db
    .update(users)
    .set({ churchId, seat: "member" })
    .where(eq(users.id, member.id));
  const [anotherAccount] = await db
    .insert(users)
    .values({
      name: "Merge proof Admin",
      email: `admin-${key}@merge.example.test`,
      passwordHash: owner.passwordHash,
      churchId,
      seat: "admin",
    })
    .returning();
  const linkedOwner = await create("LinkedOwner", {
    userId: anotherAccount.id,
  });
  await refuse(linked.id, linkedOwner.id, /account-linked/);
  const safeSource = await create("SafeLinkedSource");
  assert.equal(
    (await mergePeopleAction(await inputFor(linked.id, safeSource.id))).success,
    true
  );
  assert.equal(
    (await db.select().from(persons).where(eq(persons.id, linked.id)))[0]
      .userId,
    member.id
  );
  const [authA, authB] = await pair("Authorization");
  const authInput = await inputFor(authA.id, authB.id);
  actor = member;
  const memberResult = await mergePeopleAction(authInput);
  assert.equal(memberResult.success, false);
  actor = null;
  await assert.rejects(mergePeopleAction(authInput), UnauthorizedError);
  actor = owner;
  const foreign = await create("ForeignPerson", {
    churchId: fixture.foreignChurchId,
  });
  assert.equal(
    (await mergePeopleAction({ ...authInput, rightId: foreign.id })).success,
    false
  );
  assert.equal(
    (await mergePeopleAction({ ...authInput, choices: { name: "forged" } }))
      .success,
    false
  );
  assert.equal(
    (await mergePeopleAction({ ...authInput, userId: member.id })).success,
    false
  );
  assert.equal(
    (await mergePeopleAction({ ...authInput, choices: {} })).success,
    false
  );
  await db
    .update(persons)
    .set({ notes: "Changed while review open" })
    .where(eq(persons.id, authB.id));
  const staleBefore = await unchangedPair([authA.id, authB.id]);
  assert.equal((await mergePeopleAction(authInput)).success, false);
  assert.deepEqual(await unchangedPair([authA.id, authB.id]), staleBefore);
  console.log(
    "PASS: no-mutation collisions, account, consent, tenancy, authorization and stale review refusals."
  );
  const [raceA, raceB] = await pair("DoubleMerge");
  const raceInput = await inputFor(raceA.id, raceB.id);
  const racing = await Promise.all([
    mergePeopleAction(raceInput),
    mergePeopleAction(raceInput),
  ]);
  assert.ok(racing.every((r) => r.success));
  assert.equal(
    (
      await db.execute(
        sql`select id from person_merges where source_id=${raceB.id}`
      )
    ).rows.length,
    1
  );
  const [oppositeA, oppositeB] = await pair("OppositeMerge");
  const oppositeInput = await inputFor(oppositeA.id, oppositeB.id);
  const opposites = await Promise.all([
    mergePeopleAction(oppositeInput),
    mergePeopleAction({ ...oppositeInput, survivor: "right" }),
  ]);
  assert.equal(opposites.filter((r) => r.success).length, 1);
  const [insertA, insertB] = await pair("InsertRace");
  const insertInput = await inputFor(insertA.id, insertB.id);
  const inserting = db.batch([
    db.execute(
      sql`select id from persons where id=${insertB.id} for key share`
    ),
    db.execute(sql`select pg_sleep(0.2)`),
    db.insert(personActivities).values({
      churchId,
      personId: insertB.id,
      activityType: "note_added",
      performedBy: owner.id,
    }),
  ]);
  const [insertResult, mergeResult] = await Promise.allSettled([
    inserting,
    mergePeopleAction(insertInput),
  ]);
  assert.equal(mergeResult.status, "fulfilled");
  if (mergeResult.status === "fulfilled")
    assert.equal(mergeResult.value.success, true);
  assert.equal(
    (
      await db
        .select()
        .from(personActivities)
        .where(eq(personActivities.personId, insertB.id))
    ).length,
    0
  );
  if (insertResult.status === "fulfilled")
    assert.equal(
      (
        await db
          .select()
          .from(personActivities)
          .where(eq(personActivities.personId, insertA.id))
      ).length,
      1
    );
  const [faultA, faultB] = await pair("ForcedRollback");
  const faultInput = await inputFor(faultA.id, faultB.id);
  const faultBefore = await unchangedPair([faultA.id, faultB.id]);
  await db.execute(
    sql`create function merge_proof_failure() returns trigger language plpgsql as $$ begin raise exception 'Owned proof forced failure'; end $$`
  );
  await db.execute(
    sql`create trigger merge_proof_failure before update on persons for each row when (new.deleted_at is not null) execute function merge_proof_failure()`
  );
  try {
    assert.equal((await mergePeopleAction(faultInput)).success, false);
  } finally {
    await db.execute(sql`drop trigger merge_proof_failure on persons`);
    await db.execute(sql`drop function merge_proof_failure()`);
  }
  assert.deepEqual(await unchangedPair([faultA.id, faultB.id]), faultBefore);
  assert.equal((await mergePeopleAction(faultInput)).success, true);
  // Ordinary non-merge edits, nullable refs and deletion still behave normally.
  const ordinary = await create("Ordinary");
  await db
    .update(persons)
    .set({ notes: "Normal update" })
    .where(eq(persons.id, ordinary.id));
  await db.insert(schema.meetingChecklistItems).values({
    churchId,
    meetingId: fixture.planningMeetingId,
    itemName: "Null assignee",
    category: "materials",
    assignedTo: null,
  });
  await db.delete(persons).where(eq(persons.id, ordinary.id));
  await assert.rejects(
    db.update(persons).set({ deletedAt: null }).where(eq(persons.id, right.id))
  );
  const emailMatch = await create("EmailOnly", {
    email: `literal_%${key}@example.test`,
  });
  const nameMatch = await create("NameOnly");
  const phoneMatch = await create("PhoneOnly", { phone: "+1 (234) 555-9876" });
  assert.equal(
    (
      await findDuplicateMatches(churchId, {
        email: emailMatch.email!.toUpperCase(),
      })
    ).exactMatch?.id,
    emailMatch.id
  );
  assert.ok(
    (
      await findDuplicateMatches(churchId, {
        firstName: nameMatch.firstName.toUpperCase(),
        lastName: nameMatch.lastName,
      })
    ).potentialMatches.some((p) => p.id === nameMatch.id)
  );
  assert.ok(
    (
      await findDuplicateMatches(churchId, { phone: "000-9876" })
    ).potentialMatches.some((p) => p.id === phoneMatch.id)
  );
  assert.equal(
    (
      await findDuplicateMatches(churchId, {
        email: `literal_ax${key}@example.test`,
      })
    ).exactMatch,
    null
  );
  const { previewImportAction, executeBulkImportAction } =
    await import("@/app/(dashboard)/people/import-export-actions");
  const importExisting = await create("Import existing", {
    email: `import-${key}@example.test`,
  });
  const csv = `firstName,lastName,email\nImport,Duplicate,${importExisting.email}`;
  const form = new FormData();
  form.set("file", new File([csv], "duplicates.csv", { type: "text/csv" }));
  const preview = await previewImportAction(form);
  assert.equal(preview.success, true);
  assert.ok(preview.success);
  assert.equal(preview.data.duplicateRows.length, 1);
  const row = preview.data.duplicateRows[0];
  const skipped = await executeBulkImportAction([row], {
    [row.rowNumber]: "skip",
  });
  assert.ok(skipped.success);
  assert.equal(skipped.data.skipped, 1);
  assert.equal(skipped.data.created, 0);
  const imported = await executeBulkImportAction([row], {
    [row.rowNumber]: "review",
  });
  assert.ok(imported.success);
  assert.equal(imported.data.created, 1);
  assert.equal(imported.data.reviewPairs?.length, 1);
  const importedPair = imported.data.reviewPairs![0];
  assert.equal(importedPair.matchId, importExisting.id);
  assert.equal(
    (
      await db.execute(
        sql`select id from person_merges where source_id=${importedPair.createdId}`
      )
    ).rows.length,
    0,
    "import never auto-merges"
  );
  assert.equal(
    (
      await mergePeopleAction(
        await inputFor(importedPair.matchId, importedPair.createdId)
      )
    ).success,
    true
  );
  const createAnyway = await executeBulkImportAction([row], {
    [row.rowNumber]: "create",
  });
  assert.ok(createAnyway.success);
  assert.equal(createAnyway.data.created, 1);
  assert.equal(createAnyway.data.reviewPairs, undefined);
  const { quickAddPersonAction } =
    await import("@/app/(dashboard)/people/actions");
  const quick = await quickAddPersonAction({
    firstName: "Quick",
    lastName: "Review",
    email: importExisting.email!,
  });
  assert.ok(quick.success);
  assert.equal(
    (await mergePeopleAction(await inputFor(importExisting.id, quick.data.id)))
      .success,
    true
  );
  console.log(
    "PASS: duplicate import skip/create/review and Quick Add use the same explicit merge operation."
  );
  const browserA = await create("Browser merge", {
    email: `browser-${key}@example.test`,
    notes: "Keep this original",
  });
  const browserB = await create("Browser duplicate", {
    email: browserA.email,
    notes: "Choose this note",
    phone: "555-8787",
  });
  const browserBlockedA = await create("Blocked review", {
    email: `blocked-${key}@example.test`,
  });
  const browserBlockedB = await create("Blocked duplicate", {
    email: browserBlockedA.email,
  });
  await db.insert(schema.meetingAttendance).values(
    [browserBlockedA, browserBlockedB].map((p) => ({
      churchId,
      personId: p.id,
      meetingId: fixture.planningMeetingId,
      status: "attended" as const,
    }))
  );
  writeFileSync(
    output,
    JSON.stringify(
      {
        fixture,
        key,
        browser: {
          left: browserA.id,
          right: browserB.id,
          blockedLeft: browserBlockedA.id,
          blockedRight: browserBlockedB.id,
        },
        merged: { left: left.id, right: right.id },
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  console.log(
    "PASS: full reference inventory/history, account/consent/tenant/collision refusals, action authorization/input, double/opposite merge and child-insert races, forced rollback/retry, ordinary writes and duplicate rules."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
