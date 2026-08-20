import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { and, eq, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, persons, users } from "@/db/schema";
import { churchMeetings } from "@/db/schema/meetings";
import {
  meetingConfirmationTokens,
  messageTemplates,
} from "@/db/schema/communication";
import { createConfirmationToken } from "@/lib/communication/confirmation";
import { forkTemplate } from "@/lib/communication/templates";

// ----------------------------------------------------------------------------
// #407 D1 / D2 — two races the old services both lost, and the two indexes
// migration 0038 added to stop losing them:
//
//   message_templates_church_fork_unique_idx   (church_id, source_template_id)
//                                              where source_template_id is not null
//   meeting_confirm_tokens_pending_unique_idx  (meeting_id, person_id)
//                                              where status = 'pending'
//
// WHY THESE ARE NOT UNIT TESTS. Both bugs are properties of Postgres under READ
// COMMITTED and no SQL-string assertion can see either. `forkTemplate` read
// "does a fork exist?" and then inserted; `createConfirmationToken` read "is
// there a live pending token?" and then inserted. Both generated valid SQL,
// every static check passed, and two callers a few milliseconds apart still
// produced a duplicate — a church seeing one template twice, an invitee holding
// two unanswered RSVPs for one meeting. `memory/invariants.md` → Transactions
// states the rule and the remedy: SELECT-then-INSERT is not a concurrency
// guard; keep the claim in the SAME statement as the rows it speaks for.
//
// So the assertion has to be made against a real, REACHABLE database, and it is
// therefore OPT-IN: run it with `LIVE_DB_TESTS=1 pnpm test`. The convention, the
// flag and the reachability probe are the ones already used by
// `src/lib/ministry-teams/teams-init-race.test.ts` and
// `src/lib/phase-engine/transitions/declaration-race.test.ts` — `DATABASE_URL`
// is deliberately NOT the signal, because CI sets an unreachable placeholder on
// every `pnpm test` run and keying on its presence makes the hermetic suite
// take ECONNREFUSED.
//
// The target database must have migration 0038 applied; CI proves the indexes
// exist by applying it. The hermetic half of the change — that each index still
// has its matching `ON CONFLICT` clause — is
// `src/db/schema/ruled-guards.test.ts`, which runs on every `pnpm test`.
//
// Everything written here is namespaced by `SCRATCH_NAME` and swept in `after`,
// including on failure.
// ----------------------------------------------------------------------------

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test` with a reachable DATABASE_URL — a real Postgres is the only place these bugs are visible";

const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so the races did NOT run";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** Namespaces every row this file writes, so the sweep cannot touch real data. */
const SCRATCH_NAME = "__t407 fork and token race scratch__";

const RUNS = 3;

async function sweep(): Promise<void> {
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, SCRATCH_NAME));

  for (const church of scratch) {
    await db
      .delete(meetingConfirmationTokens)
      .where(eq(meetingConfirmationTokens.churchId, church.id));
    await db
      .delete(messageTemplates)
      .where(eq(messageTemplates.churchId, church.id));
    await db
      .delete(churchMeetings)
      .where(eq(churchMeetings.churchId, church.id));
    await db.delete(persons).where(eq(persons.churchId, church.id));
    await db.delete(users).where(eq(users.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }

  // The system template this file forks FROM carries no church_id, so it is
  // swept by name rather than by tenant.
  await db
    .delete(messageTemplates)
    .where(like(messageTemplates.name, SCRATCH_NAME));
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

/** A scratch plant plus the one user every write here needs to be attributed to. */
async function createScratchPlant(): Promise<{
  churchId: string;
  userId: string;
}> {
  const [church] = await db
    .insert(churches)
    .values({ name: SCRATCH_NAME, currentPhase: 3 })
    .returning({ id: churches.id });

  const [user] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH_NAME,
      seat: "owner",
      churchId: church.id,
    })
    .returning({ id: users.id });

  return { churchId: church.id, userId: user.id };
}

// ============================================================================
// #407 D1 — template forks
// ============================================================================

test(
  "two concurrent forks of one system template leave exactly ONE fork, every run",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();

    for (let run = 1; run <= RUNS; run++) {
      const { churchId } = await createScratchPlant();

      const [systemTemplate] = await db
        .insert(messageTemplates)
        .values({
          name: SCRATCH_NAME,
          category: "follow_up",
          body: "Original body",
          isSystem: true,
        })
        .returning({ id: messageTemplates.id });

      // Two tabs, two edits of the same system template. Neither knows about
      // the other.
      const [a, b] = await Promise.all([
        forkTemplate(systemTemplate.id, churchId),
        forkTemplate(systemTemplate.id, churchId),
      ]);

      const forks = await db
        .select({ id: messageTemplates.id })
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.churchId, churchId),
            eq(messageTemplates.sourceTemplateId, systemTemplate.id)
          )
        );

      assert.equal(
        forks.length,
        1,
        `run ${run}: the race wrote ${forks.length} forks, not 1`
      );

      // BOTH callers must come back with the SAME row — the loser re-reads the
      // winner's fork rather than returning undefined, because `updateTemplate`
      // immediately writes its edits to `fork.id`.
      assert.equal(
        a.id,
        b.id,
        `run ${run}: the two callers were handed different forks`
      );
      assert.equal(a.id, forks[0].id);
      assert.equal(a.sourceTemplateId, systemTemplate.id);
      assert.equal(a.isSystem, false);

      await sweep();
    }
  }
);

test(
  "the fork guard is the index, not the statement — a raw duplicate is refused",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();
    const { churchId } = await createScratchPlant();

    const [systemTemplate] = await db
      .insert(messageTemplates)
      .values({
        name: SCRATCH_NAME,
        category: "follow_up",
        body: "Original body",
        isSystem: true,
      })
      .returning({ id: messageTemplates.id });

    const fork = {
      churchId,
      name: "Fork",
      category: "follow_up" as const,
      body: "Edited body",
      sourceTemplateId: systemTemplate.id,
    };

    await db.insert(messageTemplates).values(fork);

    await assert.rejects(
      () => db.insert(messageTemplates).values(fork),
      (error: unknown) => {
        assert.match(
          errorText(error),
          /message_templates_church_fork_unique_idx/
        );
        return true;
      },
      "a second fork of one system template must be refused by the database"
    );

    // The index is PARTIAL: a church's OWN templates carry no source and are
    // not constrained at all.
    const own = {
      churchId,
      name: "Own",
      category: "follow_up" as const,
      body: "Mine",
    };
    await db.insert(messageTemplates).values(own);
    await db.insert(messageTemplates).values(own);

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messageTemplates)
      .where(eq(messageTemplates.churchId, churchId));
    assert.equal(n, 3);
  }
);

// ============================================================================
// #407 D2 — meeting confirmation tokens
// ============================================================================

async function createScratchMeeting(
  churchId: string,
  userId: string
): Promise<{ meetingId: string; personId: string }> {
  const [meeting] = await db
    .insert(churchMeetings)
    .values({
      churchId,
      type: "vision_meeting",
      datetime: new Date(),
      createdBy: userId,
    })
    .returning({ id: churchMeetings.id });

  const [person] = await db
    .insert(persons)
    .values({
      churchId,
      firstName: "Scratch",
      lastName: "Invitee",
      createdBy: userId,
    })
    .returning({ id: persons.id });

  return { meetingId: meeting.id, personId: person.id };
}

test(
  "two concurrent token creates leave exactly ONE pending token, every run",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();

    for (let run = 1; run <= RUNS; run++) {
      const { churchId, userId } = await createScratchPlant();
      const { meetingId, personId } = await createScratchMeeting(
        churchId,
        userId
      );

      // Two sends of one meeting invitation, in flight together.
      const [a, b] = await Promise.all([
        createConfirmationToken(churchId, meetingId, personId),
        createConfirmationToken(churchId, meetingId, personId),
      ]);

      const pending = await db
        .select({ token: meetingConfirmationTokens.token })
        .from(meetingConfirmationTokens)
        .where(
          and(
            eq(meetingConfirmationTokens.meetingId, meetingId),
            eq(meetingConfirmationTokens.personId, personId),
            eq(meetingConfirmationTokens.status, "pending")
          )
        );

      assert.equal(
        pending.length,
        1,
        `run ${run}: the race wrote ${pending.length} pending tokens, not 1`
      );
      assert.equal(
        a,
        b,
        `run ${run}: the two sends handed out different links for one invitation`
      );
      assert.equal(a, pending[0].token);

      await sweep();
    }
  }
);

test(
  "an EXPIRED pending token is renewed in place, never doubled",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();
    const { churchId, userId } = await createScratchPlant();
    const { meetingId, personId } = await createScratchMeeting(
      churchId,
      userId
    );

    // The path that produced duplicates with no race at all: the old service
    // failed its freshness test and INSERTED a second pending row.
    const stale = await createConfirmationToken(churchId, meetingId, personId);
    await db
      .update(meetingConfirmationTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(meetingConfirmationTokens.token, stale));

    const renewed = await createConfirmationToken(
      churchId,
      meetingId,
      personId
    );

    const rows = await db
      .select({
        id: meetingConfirmationTokens.id,
        token: meetingConfirmationTokens.token,
      })
      .from(meetingConfirmationTokens)
      .where(
        and(
          eq(meetingConfirmationTokens.meetingId, meetingId),
          eq(meetingConfirmationTokens.personId, personId),
          eq(meetingConfirmationTokens.status, "pending")
        )
      );

    assert.equal(rows.length, 1, "renewal added a second pending row");
    assert.notEqual(renewed, stale, "the lapsed link was handed back");
    assert.equal(rows[0].token, renewed);

    // A LIVE token is never overwritten — the invitee is holding that link.
    const again = await createConfirmationToken(churchId, meetingId, personId);
    assert.equal(again, renewed, "a live link was rotated out from under it");
  }
);

test(
  "the token guard is the index, and an ANSWERED row frees the slot",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();
    const { churchId, userId } = await createScratchPlant();
    const { meetingId, personId } = await createScratchMeeting(
      churchId,
      userId
    );

    const row = {
      churchId,
      meetingId,
      personId,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    };

    await db
      .insert(meetingConfirmationTokens)
      .values({ ...row, token: crypto.randomUUID() });

    await assert.rejects(
      () =>
        db
          .insert(meetingConfirmationTokens)
          .values({ ...row, token: crypto.randomUUID() }),
      (error: unknown) => {
        assert.match(
          errorText(error),
          /meeting_confirm_tokens_pending_unique_idx/
        );
        return true;
      },
      "a second unanswered token for one (meeting, person) must be refused"
    );

    // Partial on `status = 'pending'`: answering releases the slot, so the same
    // person can be re-invited to the same meeting without anything being
    // deleted.
    await db
      .update(meetingConfirmationTokens)
      .set({ status: "confirmed", respondedAt: new Date() })
      .where(eq(meetingConfirmationTokens.meetingId, meetingId));

    await db
      .insert(meetingConfirmationTokens)
      .values({ ...row, token: crypto.randomUUID() });

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(meetingConfirmationTokens)
      .where(eq(meetingConfirmationTokens.meetingId, meetingId));
    assert.equal(n, 2);
  }
);

/**
 * Drizzle wraps the driver error, so the constraint name is usually on the
 * `cause` rather than on the message it re-throws.
 */
function errorText(error: unknown): string {
  return [
    error instanceof Error ? error.message : String(error),
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "",
  ].join(" ");
}
