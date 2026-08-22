import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { and, eq, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { emailChangeRequests, users } from "@/db/schema";

import type { AttemptLimiter } from "./attempt-limiter";
import {
  confirmEmailChange,
  consumeRequestStatement,
  swapLoginIdentifierStatement,
  EMAIL_CHANGE_ADDRESS_TAKEN_MESSAGE,
  EMAIL_CHANGE_LINK_DEAD_MESSAGE,
  liveEmailChangeRequest,
  requestEmailChange,
} from "./email-change";
import { hashEmailChangeToken } from "./account-email";
import type { EmailChangeMessage } from "./email-change-email";
import { hashPassword } from "./password";

// ============================================================================
// CS-002 AGAINST A REAL POSTGRES (#616).
//
// WHAT ONLY A DATABASE CAN PROVE, and therefore what is here rather than in
// `./email-change.test.ts`:
//
//   1. THE SWAP ACTUALLY HAPPENS. `email-change.test.ts` asserts the generated
//      SQL of the two statements; that is the rule in the form the database
//      will be handed, and it is still not the database having accepted it.
//      "The new address signs in and the old one does not" is a claim about
//      what the NEXT read sees, so it takes a round trip.
//   2. THE TWO UNIQUE INDEXES BITE. `email_change_requests_live_user_unique_idx`
//      is partial on `consumed_at IS NULL`, and `users_email_unique` is what
//      decides whether the new address is free. A regex over the DDL proves
//      somebody typed them. The sibling suite next door is the standing lesson
//      that this is not the same thing: `user_invitations_seat_check` read
//      correctly, passed every static assertion, and accepted the exact row it
//      existed to refuse, because a CHECK rejects only `false`. Postgres found
//      that; nothing else could have.
//   3. SINGLE USE, AND SUPERSEDE. Both are properties of a second call seeing
//      what the first one wrote.
//   4. THE CLAIM-FIRST BATCH UNDER A CONCURRENT SUPERSEDE — the blocker this
//      round fixed. The swap's `WHERE` re-asserts the claim, so when the row is
//      superseded between the read and the batch, NOTHING moves. Before the
//      fix the claim matched zero rows and the swap still committed, moving the
//      login identifier to a superseded address while the reader was told the
//      link was dead. Only two interleaved writers show that.
//
// AND IT IS THE MIGRATION'S PROOF. The `Live DB Race Suites` job applies every
// file in `src/db/migrations/` with `psql -v ON_ERROR_STOP=1` before running
// this, so a green run is `0062_email_change_requests` applying to a database
// built from zero — the table, both indexes and the FK.
//
// THE MAIL IS STUBBED, not skipped: `deps.send` captures the message, so the
// flow's real builders run and nothing leaves the process.
//
// OPT-IN, same convention as the suites beside it:
// `LIVE_DB_TESTS=1 pnpm test:live`. Everything written here is namespaced by
// `SCRATCH_NAME` and swept in `after`.
// ============================================================================

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — a swap that happened is the only kind worth asserting";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const SCRATCH_NAME = "__t616 email change scratch__";
const scratchEmail = () => `${randomUUID()}@scratch.invalid`;
const PASSWORD = "correct horse battery";
const IP = "203.0.113.42";

async function sweep(): Promise<void> {
  // Requests point at users; `on delete cascade` would take them anyway, but
  // the delete is explicit so a failure names the table it happened in.
  await db.execute(sql`
    delete from ${emailChangeRequests}
    where ${emailChangeRequests.userId} in (
      select ${users.id} from ${users} where ${users.name} = ${SCRATCH_NAME}
    )
  `);
  await db.delete(users).where(like(users.name, SCRATCH_NAME));
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

/** An account with a real argon2 hash, and no tenancy — the coach-shaped row. */
async function makeAccount(email = scratchEmail()) {
  const [row] = await db
    .insert(users)
    .values({
      email,
      name: SCRATCH_NAME,
      passwordHash: await hashPassword(PASSWORD),
    })
    .returning();
  return row;
}

/** Captures what would have been sent. The real builders still run. */
function mailSpy() {
  const sent: EmailChangeMessage[] = [];
  return {
    sent,
    deps: {
      baseUrl: "https://scratch.invalid",
      send: async (message: EmailChangeMessage) => {
        sent.push(message);
        return { success: true };
      },
    },
  };
}

/**
 * The REAL guard over an in-memory attempt list. `auth_attempts` is a shared
 * table and these suites run beside each other, so the store is per-test —
 * what is under test here is the address change, not the counting.
 */
function limiter(): AttemptLimiter {
  return {
    count: async () => 0,
    record: async () => {},
  };
}

/** The plaintext token for the request just made — only the email has it. */
function tokenFrom(sent: EmailChangeMessage[]): string {
  const url = sent.at(-1)?.html.match(/verify-email\?token=([\w-]+)/);
  assert.ok(url, "the verification email carried no token-bound link");
  return decodeURIComponent(url[1]);
}

async function emailOf(userId: string): Promise<string> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return row.email;
}

test("the address moves only when the link comes back", { skip }, async () => {
  const account = await makeAccount();
  const previous = account.email;
  const wanted = scratchEmail();
  const mail = mailSpy();

  const asked = await requestEmailChange({
    actor: account,
    requestedEmail: wanted,
    currentPassword: PASSWORD,
    ip: IP,
    mail: mail.deps,
    limiter: limiter(),
  });

  assert.equal(asked.ok, true);
  assert.equal(
    mail.sent.at(-1)?.to,
    wanted,
    "the link goes to the NEW address"
  );

  // THE OLD ADDRESS STILL SIGNS IN. This is the safety property of the whole
  // flow, and it is a read of the column the login looks up.
  assert.equal(
    await emailOf(account.id),
    previous,
    "`users.email` must not move before the link comes back"
  );

  // AND THE TOKEN IS NOT IN THE DATABASE.
  const token = tokenFrom(mail.sent);
  const [stored] = await db
    .select()
    .from(emailChangeRequests)
    .where(eq(emailChangeRequests.userId, account.id));

  assert.equal(stored.newEmail, wanted);
  assert.notEqual(stored.tokenHash, token);
  assert.equal(stored.tokenHash, hashEmailChangeToken(token));
  assert.equal(stored.consumedAt, null, "the request is live");

  // Now redeem it.
  const confirmed = await confirmEmailChange({
    actor: account,
    token,
    ip: IP,
    mail: mail.deps,
    limiter: limiter(),
  });

  assert.deepEqual(confirmed, {
    ok: true,
    newEmail: wanted,
    previousEmail: previous,
  });

  // THE SWAP HAPPENED. The new address is what the login would find; the old
  // one now finds nothing.
  assert.equal(await emailOf(account.id), wanted);
  const [byOld] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, previous));
  assert.equal(byOld, undefined, "the old address must no longer sign in");

  // AND THE OLD ADDRESS WAS TOLD, naming where the account went.
  const notice = mail.sent.at(-1);
  assert.equal(notice?.to, previous);
  assert.ok(notice.html.includes(wanted), "the notice names the new address");
});

test("a token is single-use", { skip }, async () => {
  const account = await makeAccount();
  const mail = mailSpy();

  await requestEmailChange({
    actor: account,
    requestedEmail: scratchEmail(),
    currentPassword: PASSWORD,
    ip: IP,
    mail: mail.deps,
    limiter: limiter(),
  });
  const token = tokenFrom(mail.sent);

  const first = await confirmEmailChange({
    actor: account,
    token,
    ip: IP,
    mail: mail.deps,
    limiter: limiter(),
  });
  assert.equal(first.ok, true);
  const landed = await emailOf(account.id);

  // The SAME token again — a double click, a re-opened tab, a replay.
  const second = await confirmEmailChange({
    // The actor now signs in as the new address, exactly as a real second call
    // would after `refresh()`.
    actor: { ...account, email: landed },
    token,
    ip: IP,
    mail: mail.deps,
    limiter: limiter(),
  });

  assert.deepEqual(second, {
    ok: false,
    message: EMAIL_CHANGE_LINK_DEAD_MESSAGE,
  });
  assert.equal(
    await emailOf(account.id),
    landed,
    "nothing moved a second time"
  );
});

test(
  "asking again supersedes, and the index is what enforces it",
  { skip },
  async () => {
    const account = await makeAccount();
    const mail = mailSpy();

    const first = scratchEmail();
    const corrected = scratchEmail();

    await requestEmailChange({
      actor: account,
      requestedEmail: first,
      currentPassword: PASSWORD,
      ip: IP,
      mail: mail.deps,
      limiter: limiter(),
    });
    const staleToken = tokenFrom(mail.sent);

    await requestEmailChange({
      actor: account,
      requestedEmail: corrected,
      currentPassword: PASSWORD,
      ip: IP,
      mail: mail.deps,
      limiter: limiter(),
    });
    const liveToken = tokenFrom(mail.sent);

    // EXACTLY ONE LIVE ROW — which is the partial unique index's whole claim, and
    // the reason the supersede runs before the insert.
    const live = await db
      .select({ id: emailChangeRequests.id })
      .from(emailChangeRequests)
      .where(
        and(
          eq(emailChangeRequests.userId, account.id),
          sql`${emailChangeRequests.consumedAt} is null`
        )
      );
    assert.equal(live.length, 1);
    assert.deepEqual(await liveEmailChangeRequest(account.id), {
      newEmail: corrected,
      expiresAt: (await liveEmailChangeRequest(account.id))!.expiresAt,
    });

    // The superseded link is dead…
    assert.deepEqual(
      await confirmEmailChange({
        actor: account,
        token: staleToken,
        ip: IP,
        mail: mail.deps,
        limiter: limiter(),
      }),
      { ok: false, message: EMAIL_CHANGE_LINK_DEAD_MESSAGE }
    );
    assert.notEqual(await emailOf(account.id), first);

    // …and the newest one works. A mistyped address is self-correcting.
    const fixed = await confirmEmailChange({
      actor: account,
      token: liveToken,
      ip: IP,
      mail: mail.deps,
      limiter: limiter(),
    });
    assert.equal(fixed.ok, true);
    assert.equal(await emailOf(account.id), corrected);
  }
);

test(
  "a concurrent supersede stops the swap dead — neither statement lands",
  { skip },
  async () => {
    const account = await makeAccount();
    const previous = account.email;
    const wanted = scratchEmail();
    const mail = mailSpy();

    await requestEmailChange({
      actor: account,
      requestedEmail: wanted,
      currentPassword: PASSWORD,
      ip: IP,
      mail: mail.deps,
      limiter: limiter(),
    });

    const [request] = await db
      .select()
      .from(emailChangeRequests)
      .where(eq(emailChangeRequests.userId, account.id));

    // THE INTERLEAVING, FORCED. `confirmEmailChange` reads the request and then
    // batches; the window between those two round trips is where a second tab's
    // `requestEmailChange` settles this row. Nothing in the process can hook
    // that gap, so the batch is driven directly with the exported builders —
    // which is the pair the flow itself hands to `db.batch`.
    await db
      .update(emailChangeRequests)
      .set({ consumedAt: new Date(Date.now() - 1000) })
      .where(eq(emailChangeRequests.id, request.id));

    const now = new Date();
    const [claimed, swapped] = await db.batch([
      consumeRequestStatement(request.id, now),
      swapLoginIdentifierStatement(
        account.id,
        request.id,
        previous,
        wanted,
        now
      ),
    ]);

    assert.equal(claimed.length, 0, "the claim lost, as it should have");
    assert.equal(
      swapped.length,
      0,
      "THE #616 REVIEW BLOCKER. The swap re-asserts the CLAIM, not just the users row — without that predicate this is 1, and the login identifier moves to a superseded address while the reader is told the link is dead"
    );
    assert.equal(await emailOf(account.id), previous);
  }
);

test(
  "an address that belongs to somebody else is refused, and the token survives",
  { skip },
  async () => {
    const holder = await makeAccount();
    const mover = await makeAccount();
    const mail = mailSpy();

    // Ask for an address that is free at request time — the check is
    // deliberately not made there (see the module header).
    const wanted = scratchEmail();
    await requestEmailChange({
      actor: mover,
      requestedEmail: wanted,
      currentPassword: PASSWORD,
      ip: IP,
      mail: mail.deps,
      limiter: limiter(),
    });
    const token = tokenFrom(mail.sent);

    // Somebody takes it in the meantime.
    await db
      .update(users)
      .set({ email: wanted })
      .where(eq(users.id, holder.id));

    const outcome = await confirmEmailChange({
      actor: mover,
      token,
      ip: IP,
      mail: mail.deps,
      limiter: limiter(),
    });

    assert.deepEqual(outcome, {
      ok: false,
      message: EMAIL_CHANGE_ADDRESS_TAKEN_MESSAGE,
    });
    assert.equal(await emailOf(mover.id), mover.email, "nothing moved");

    // THE UNIQUE VIOLATION ABORTED THE WHOLE BATCH, so the claim rolled back
    // with it and the token is still live — the address may free up later.
    const [request] = await db
      .select()
      .from(emailChangeRequests)
      .where(eq(emailChangeRequests.userId, mover.id));
    assert.equal(
      request.consumedAt,
      null,
      "`db.batch` is one transaction: a failure must roll the claim back too"
    );
  }
);

test("a token issued to another account does nothing", { skip }, async () => {
  const owner = await makeAccount();
  const stranger = await makeAccount();
  const mail = mailSpy();

  await requestEmailChange({
    actor: owner,
    requestedEmail: scratchEmail(),
    currentPassword: PASSWORD,
    ip: IP,
    mail: mail.deps,
    limiter: limiter(),
  });
  const token = tokenFrom(mail.sent);

  // The stranger holds the link — forwarded, or an auto-forward rule nobody
  // remembers setting — and holds their own live session.
  const outcome = await confirmEmailChange({
    actor: stranger,
    token,
    ip: IP,
    mail: mail.deps,
    limiter: limiter(),
  });

  assert.deepEqual(outcome, {
    ok: false,
    message: EMAIL_CHANGE_LINK_DEAD_MESSAGE,
  });
  assert.equal(await emailOf(stranger.id), stranger.email);
  assert.equal(await emailOf(owner.id), owner.email);

  // AND IT IS STILL SPENDABLE BY ITS OWNER. A stranger must not be able to
  // burn somebody else's confirmation link by opening it.
  const [request] = await db
    .select()
    .from(emailChangeRequests)
    .where(eq(emailChangeRequests.userId, owner.id));
  assert.equal(request.consumedAt, null);
});

test(
  "an expired request neither reads as live nor redeems",
  { skip },
  async () => {
    const account = await makeAccount();
    const mail = mailSpy();

    await requestEmailChange({
      actor: account,
      requestedEmail: scratchEmail(),
      currentPassword: PASSWORD,
      ip: IP,
      mail: mail.deps,
      limiter: limiter(),
    });
    const token = tokenFrom(mail.sent);

    await db
      .update(emailChangeRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailChangeRequests.userId, account.id));

    assert.equal(
      await liveEmailChangeRequest(account.id),
      null,
      "the expiry predicate is in the `WHERE`, so an expired row is not 'waiting on confirmation'"
    );
    assert.deepEqual(
      await confirmEmailChange({
        actor: account,
        token,
        ip: IP,
        mail: mail.deps,
        limiter: limiter(),
      }),
      { ok: false, message: EMAIL_CHANGE_LINK_DEAD_MESSAGE }
    );
    assert.equal(await emailOf(account.id), account.email);
  }
);
