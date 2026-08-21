import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { and, eq, like, sql } from "drizzle-orm";

import { createAccountEntities } from "@/app/(auth)/register/account-entities";
import { db } from "@/db";
import { churches, persons, userInvitations, users } from "@/db/schema";
import { findLinkablePersonId } from "@/lib/people/account-person-link";

import {
  ACCOUNT_NOT_INVITABLE_MESSAGE,
  INVITES_PER_INVITEE_PER_WINDOW,
  invitationActorFromSession,
  InvitationError,
} from "./core";
import { invitationRegisterPath } from "./register-path";
import {
  claimUserInvitationStatement,
  createUserInvitationAs,
  describeUserInvitationForRegistration,
  hashUserInvitationToken,
  resendUserInvitationEmailAs,
  revokeUserInvitationAs,
  USER_INVITE_RATE_LIMITED_MESSAGE,
  userInvitationActedOnAtRegistration,
} from "./seat";
import type { SeatInvitationEmailDeps } from "./seat-email";

// ============================================================================
// #495 — SEAT INVITATIONS AGAINST A REAL POSTGRES.
//
// WHAT ONLY A DATABASE CAN PROVE, and therefore what is in this file rather
// than in `./seat.test.ts`:
//
//   1. THE TWO CHECKS. `user_invitations_tenancy_check` and
//      `user_invitations_seat_check` are the invariants AS-010 puts in the DATA,
//      and a regex over the DDL proves only that somebody typed them. It
//      demonstrably does not prove they bite: the first spelling of the seat
//      check — `(kind = 'seat' and seat in (…)) or (kind = 'coach' and seat is
//      null)` — reads correctly, passed every static assertion, and ACCEPTED
//      `kind = 'seat', seat = NULL`, because `true and NULL` is `NULL` and a
//      CHECK rejects only `false`. Postgres found that; nothing else could
//      have. Hence the tests below write the rows.
//   2. THE HASH AS STORED. "The column does not equal the token" is a claim
//      about a round trip through a database, so it takes one.
//   3. CREATE → REGISTER. The cap, the refusal, the revoke, the resend's token
//      rotation and the registration grant are each a sequence of writes whose
//      whole point is what the NEXT read sees.
//
// THE RESIDUAL, NAMED. The registration half composes the users insert the way
// `register/actions.ts` composes it, rather than calling that action — the
// action is a `"use server"` export that reads a request IP, sets a session
// cookie and ends in `redirect()`, none of which exists in a test process. Two
// things close the gap instead of one test pretending to: `./seat.test.ts`
// pins the action's statement list — its ORDER, its `seat`, its
// `churchId: account.userChurchId` and the claim pushed into the SAME batch —
// and the browser validation on the preview walks the real POST end to end.
//
// OPT-IN, same convention as the race suites beside it:
// `LIVE_DB_TESTS=1 pnpm test:live`. Everything written here is namespaced by
// `SCRATCH_NAME` and swept in `after`.
// ============================================================================

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — a CHECK constraint is the only place these rules live";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const SCRATCH_NAME = "__t495 seat invitations scratch__";
const scratchEmail = () => `${randomUUID()}@scratch.invalid`;

async function sweep(): Promise<void> {
  // Order is the FK graph: invitations point at users and churches, persons
  // point at both, users point at churches.
  await db.execute(sql`
    delete from ${userInvitations}
    where ${userInvitations.inviterUserId} in (
      select ${users.id} from ${users} where ${users.name} = ${SCRATCH_NAME}
    )
  `);
  await db.execute(sql`
    delete from ${persons}
    where ${persons.churchId} in (
      select ${churches.id} from ${churches} where ${churches.name} = ${SCRATCH_NAME}
    )
  `);
  await db.delete(users).where(like(users.name, SCRATCH_NAME));
  await db.delete(churches).where(like(churches.name, SCRATCH_NAME));
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

/**
 * THE SQLSTATE AND THE CONSTRAINT NAME, never the sentence: the message text
 * moves with `lc_messages`, and the five-character code plus the constraint is
 * what says WHICH rule fired. The neon-http driver hangs the `NeonDbError` off
 * `cause`.
 */
const CHECK_VIOLATION = "23514";

function pgError(error: unknown): { code?: string; constraint?: string } {
  const cause = (error as { cause?: unknown })?.cause;
  return (cause ?? error) as { code?: string; constraint?: string };
}

/** One scratch plant with an Owner, and an actor minted from that Owner. */
async function scratchPlant() {
  const [church] = await db
    .insert(churches)
    .values({ name: SCRATCH_NAME, currentPhase: 1 })
    .returning({ id: churches.id });

  const [owner] = await db
    .insert(users)
    .values({
      email: scratchEmail(),
      passwordHash: "scratch",
      name: SCRATCH_NAME,
      seat: "owner",
      churchId: church.id,
    })
    .returning({ id: users.id });

  return {
    churchId: church.id,
    ownerId: owner.id,
    actor: invitationActorFromSession({
      user: {
        id: owner.id,
        seat: "owner" as const,
        churchId: church.id,
        sendingChurchId: null,
        sendingNetworkId: null,
      },
    }),
  };
}

/** A transport that keeps every message, so a test can read the emailed link. */
function captureTransport() {
  const sent: { to: string; text: string; idempotencyKey?: string }[] = [];

  const deps: SeatInvitationEmailDeps = {
    baseUrl: "https://scratch.everyfield.test",
    send: async (message) => {
      sent.push({
        to: message.to,
        text: message.text,
        idempotencyKey: message.idempotencyKey,
      });
      return { success: true };
    },
  };

  /** The token the invitee would click, read out of the message body. */
  const tokenFrom = (index = sent.length - 1): string => {
    const match = sent[index].text.match(/[?&]invitation=([A-Za-z0-9_-]+)/);
    assert.ok(match, `no invitation link in message ${index}`);
    return decodeURIComponent(match[1]);
  };

  return { deps, sent, tokenFrom };
}

// ----------------------------------------------------------------------------
// 1. THE TWO CHECKS, EXERCISED
// ----------------------------------------------------------------------------

test(
  "the database refuses every row AS-010 says must not exist",
  { skip },
  async () => {
    assert.ok(
      await databaseReachable(),
      "DATABASE_URL points at no reachable Postgres"
    );

    const { churchId, ownerId } = await scratchPlant();

    const row = (overrides: Record<string, unknown>) => ({
      kind: "seat" as const,
      inviteeEmail: scratchEmail(),
      churchId,
      seat: "admin" as const,
      tokenHash: hashUserInvitationToken(randomUUID()),
      inviterUserId: ownerId,
      expiresAt: new Date(Date.now() + 86_400_000),
      ...overrides,
    });

    const refusals = [
      [
        "two tenancies on one row",
        "user_invitations_tenancy_check",
        row({ sendingNetworkId: randomUUID() }),
      ],
      [
        "no tenancy at all",
        "user_invitations_tenancy_check",
        row({ churchId: null }),
      ],
      [
        "a seat invitation granting no seat",
        "user_invitations_seat_check",
        row({ seat: null }),
      ],
      [
        "a coach invitation carrying a seat",
        "user_invitations_seat_check",
        row({ kind: "coach" as const }),
      ],
      [
        "the un-invitable owner seat",
        "user_invitations_seat_check",
        row({ seat: "owner" }),
      ],
    ] as const;

    for (const [what, constraint, values] of refusals) {
      await assert.rejects(
        // The FK on `sending_network_id` would also refuse the first case; the
        // CHECK is asserted by NAME, so it is the rule that fired.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db.insert(userInvitations).values(values as any),
        (error: unknown) => {
          const { code, constraint: fired } = pgError(error);
          assert.equal(code, CHECK_VIOLATION, `${what}: wrong SQLSTATE`);
          assert.equal(fired, constraint, `${what}: the wrong rule fired`);
          return true;
        },
        what
      );
    }

    // The other half, or a table that refused everything would pass the test
    // above: both well-formed shapes are accepted.
    const accepted = await db
      .insert(userInvitations)
      .values([row({}), row({ kind: "coach" as const, seat: null })])
      .returning({ id: userInvitations.id });

    assert.equal(accepted.length, 2);
  }
);

// ----------------------------------------------------------------------------
// 2. THE TOKEN IS STORED HASHED
// ----------------------------------------------------------------------------

test(
  "the stored column is not the token the email carried",
  { skip },
  async () => {
    const { actor, churchId } = await scratchPlant();
    const mail = captureTransport();
    const invitee = scratchEmail();

    const { invitation, emailSent } = await createUserInvitationAs(
      actor,
      { inviteeEmail: invitee, seat: "admin" },
      mail.deps
    );

    assert.equal(emailSent, true);
    assert.equal(mail.sent.length, 1);

    const token = mail.tokenFrom();
    const [stored] = await db
      .select({ tokenHash: userInvitations.tokenHash })
      .from(userInvitations)
      .where(eq(userInvitations.id, invitation.id));

    assert.notEqual(stored.tokenHash, token);
    assert.equal(stored.tokenHash, hashUserInvitationToken(token));
    assert.match(stored.tokenHash, /^[0-9a-f]{64}$/);

    // …and the link the email built is the shared `?invitation=` contract, so a
    // seat token and an org id arrive through ONE parameter.
    assert.ok(
      mail.sent[0].text.includes(invitationRegisterPath(token)),
      "the email links somewhere other than the shared register path"
    );

    // The row is this plant's, addressed to the one address, with the seat asked
    // for and nothing else decided by the client.
    assert.equal(invitation.churchId, churchId);
    assert.equal(invitation.seat, "admin");
    assert.equal(invitation.status, "pending");
    assert.equal(invitation.inviteeEmail, invitee.toLowerCase());
  }
);

// ----------------------------------------------------------------------------
// 3. REGISTER-ONLY — every existing account, one message
// ----------------------------------------------------------------------------

test(
  "an address that already holds an account is refused, whatever kind",
  { skip },
  async () => {
    const { actor } = await scratchPlant();
    const mail = captureTransport();

    const existing = [
      [
        "a plant seat holder",
        { seat: "member" as const, churchId: (await scratchPlant()).churchId },
      ],
      [
        "an oversight seat holder",
        { seat: "owner" as const, sendingNetworkId: null },
      ],
      ["a coach, holding no seat", {}],
    ] as const;

    for (const [what, shape] of existing) {
      const address = scratchEmail();
      await db.insert(users).values({
        email: address,
        passwordHash: "scratch",
        name: SCRATCH_NAME,
        ...shape,
      });

      await assert.rejects(
        createUserInvitationAs(
          actor,
          { inviteeEmail: address, seat: "member" },
          mail.deps
        ),
        (error: unknown) => {
          assert.ok(error instanceof InvitationError, what);
          assert.equal(error.message, ACCOUNT_NOT_INVITABLE_MESSAGE, what);
          return true;
        },
        what
      );
    }

    // Nothing was written, and nothing was emailed — the refusal is the whole
    // outcome.
    assert.equal(mail.sent.length, 0);
  }
);

// ----------------------------------------------------------------------------
// 4. THE CAP — counting every status
// ----------------------------------------------------------------------------

test(
  "a fourth invitation to one address is refused, revoked ones included",
  { skip },
  async () => {
    const { actor } = await scratchPlant();
    const mail = captureTransport();
    const invitee = scratchEmail();

    const created = [];
    for (let i = 0; i < INVITES_PER_INVITEE_PER_WINDOW; i += 1) {
      const { invitation } = await createUserInvitationAs(
        actor,
        { inviteeEmail: invitee, seat: "member" },
        mail.deps
      );
      created.push(invitation.id);
      // Each create refuses a second PENDING row, so close this one before the
      // next — which is exactly the revoke–reinvite loop the cap exists to stop.
      await revokeUserInvitationAs(actor, invitation.id);
    }

    assert.equal(created.length, 3);

    await assert.rejects(
      createUserInvitationAs(
        actor,
        { inviteeEmail: invitee, seat: "member" },
        mail.deps
      ),
      (error: unknown) => {
        assert.ok(error instanceof InvitationError);
        assert.equal(error.message, USER_INVITE_RATE_LIMITED_MESSAGE);
        return true;
      }
    );

    // All three are revoked, so a cap that filtered on `pending` would have
    // counted zero and let the fourth through.
    const rows = await db
      .select({ status: userInvitations.status })
      .from(userInvitations)
      .where(eq(userInvitations.inviteeEmail, invitee));

    assert.equal(rows.length, 3);
    assert.deepEqual(
      new Set(rows.map((row) => row.status)),
      new Set(["revoked"])
    );

    // …and another plant is not capped by this one's behaviour.
    const other = await scratchPlant();
    const { invitation } = await createUserInvitationAs(
      other.actor,
      { inviteeEmail: invitee, seat: "member" },
      mail.deps
    );
    assert.equal(invitation.churchId, other.churchId);
  }
);

// ----------------------------------------------------------------------------
// 5. REVOKE AND RESEND
// ----------------------------------------------------------------------------

test(
  "a revoked invitation stops working, and a resend mints a new token",
  { skip },
  async () => {
    const { actor } = await scratchPlant();
    const mail = captureTransport();

    const { invitation } = await createUserInvitationAs(
      actor,
      { inviteeEmail: scratchEmail(), seat: "member" },
      mail.deps
    );
    const first = mail.tokenFrom();
    assert.ok(await describeUserInvitationForRegistration(first));

    // A RESEND ROTATES, which is what hashing costs: the plaintext existed only
    // in transit, so the row cannot reproduce the link it already sent.
    const resent = await resendUserInvitationEmailAs(
      actor,
      invitation.id,
      mail.deps
    );
    assert.equal(resent.emailSent, true);
    assert.ok(resent.resendWindow.remainingMs > 0);
    assert.equal(mail.sent.length, 2);
    // A deliberate resend presents a different provider key from the create's.
    assert.notEqual(mail.sent[0].idempotencyKey, mail.sent[1].idempotencyKey);

    const second = mail.tokenFrom();
    assert.notEqual(second, first);
    assert.equal(await describeUserInvitationForRegistration(first), null);
    assert.ok(await describeUserInvitationForRegistration(second));

    // A REVOKE CLOSES IT IMMEDIATELY, and the link stops working.
    await revokeUserInvitationAs(actor, invitation.id);
    assert.equal(await describeUserInvitationForRegistration(second), null);

    // …and a closed row can be neither revoked nor emailed again.
    await assert.rejects(
      revokeUserInvitationAs(actor, invitation.id),
      InvitationError
    );
    await assert.rejects(
      resendUserInvitationEmailAs(actor, invitation.id, mail.deps),
      InvitationError
    );
    assert.equal(mail.sent.length, 2);

    // Another plant's Owner reaches none of it — the same one message for "no
    // such invitation" and "not yours".
    const stranger = await scratchPlant();
    await assert.rejects(
      revokeUserInvitationAs(stranger.actor, invitation.id),
      InvitationError
    );
  }
);

test(
  "a refused resend leaves the live link working (#495 r1)",
  { skip },
  async () => {
    const { actor } = await scratchPlant();
    const mail = captureTransport();

    const { invitation } = await createUserInvitationAs(
      actor,
      { inviteeEmail: scratchEmail(), seat: "member" },
      mail.deps
    );
    const live = mail.tokenFrom();

    // The provider says no. The rotation has already committed by then, so
    // without the restore the invitee's only link would be dead and nothing
    // would have been delivered to replace it — and every retry would kill
    // another one.
    const refusing = {
      ...mail.deps,
      send: async () => ({ success: false, error: "scratch refusal" }),
    };

    await assert.rejects(
      resendUserInvitationEmailAs(actor, invitation.id, refusing),
      InvitationError
    );

    const described = await describeUserInvitationForRegistration(live);
    assert.ok(described, "a refused resend destroyed the working link");
    assert.equal(described.id, invitation.id);

    const [row] = await db
      .select({ tokenHash: userInvitations.tokenHash })
      .from(userInvitations)
      .where(eq(userInvitations.id, invitation.id));
    assert.equal(row.tokenHash, hashUserInvitationToken(live));

    // …and a successful resend afterwards still rotates.
    await resendUserInvitationEmailAs(actor, invitation.id, mail.deps);
    assert.equal(await describeUserInvitationForRegistration(live), null);
    assert.ok(await describeUserInvitationForRegistration(mail.tokenFrom()));
  }
);

test(
  "two resends in one 60s bucket both deliver, with different keys (#495 r1)",
  { skip },
  async () => {
    const { actor } = await scratchPlant();
    const mail = captureTransport();

    const { invitation } = await createUserInvitationAs(
      actor,
      { inviteeEmail: scratchEmail(), seat: "member" },
      mail.deps
    );

    // The same instant for both, which is what the org path's window suffix
    // collapsed. Each one mints a NEW credential, so each one must be
    // deliverable and each must present its own provider key.
    const at = new Date("2026-08-20T12:00:10.000Z");
    await resendUserInvitationEmailAs(actor, invitation.id, mail.deps, at);
    await resendUserInvitationEmailAs(actor, invitation.id, mail.deps, at);

    assert.equal(mail.sent.length, 3);
    assert.equal(new Set(mail.sent.map((m) => m.idempotencyKey)).size, 3);

    // The link in the LAST message is the one the database now holds; the two
    // before it are dead.
    const [row] = await db
      .select({ tokenHash: userInvitations.tokenHash })
      .from(userInvitations)
      .where(eq(userInvitations.id, invitation.id));
    assert.equal(row.tokenHash, hashUserInvitationToken(mail.tokenFrom()));
    assert.equal(
      await describeUserInvitationForRegistration(mail.tokenFrom(1)),
      null
    );
  }
);

// ----------------------------------------------------------------------------
// 6. CREATE → REGISTER (AS-012, AS-013)
// ----------------------------------------------------------------------------

/**
 * The registration write, composed the way `register/actions.ts` composes it —
 * see "THE RESIDUAL, NAMED" in the header.
 */
async function registerThrough(token: string, email: string, name: string) {
  const described = userInvitationActedOnAtRegistration(
    await describeUserInvitationForRegistration(token),
    email
  );
  assert.ok(described, "the token did not resolve for the invited address");

  const userId = randomUUID();
  const account = createAccountEntities(
    "planter",
    null,
    userId,
    { name, email },
    false,
    {
      churchId: described.churchId,
      seat: described.seat,
      matchedPersonId: await findLinkablePersonId(described.churchId, email),
    }
  );

  await db.batch([
    db
      .insert(users)
      .values({
        id: userId,
        email,
        passwordHash: "scratch",
        name,
        seat: account.seat,
        churchId: account.userChurchId,
        sendingChurchId: account.sendingChurchId,
        sendingNetworkId: account.sendingNetworkId,
      })
      .returning({ id: users.id }),
    ...account.linkStatements,
    claimUserInvitationStatement(described.id, userId),
  ]);

  return { userId, invitationId: described.id };
}

test(
  "the invitee registers into the plant with the invited seat",
  { skip },
  async () => {
    const { actor, churchId } = await scratchPlant();
    const mail = captureTransport();
    const invitee = scratchEmail();

    await createUserInvitationAs(
      actor,
      { inviteeEmail: invitee, seat: "admin" },
      mail.deps
    );
    const { userId, invitationId } = await registerThrough(
      mail.tokenFrom(),
      invitee,
      SCRATCH_NAME
    );

    const [account] = await db
      .select({
        seat: users.seat,
        churchId: users.churchId,
        sendingChurchId: users.sendingChurchId,
        sendingNetworkId: users.sendingNetworkId,
      })
      .from(users)
      .where(eq(users.id, userId));

    // AS-012: the tenancy FK and the seat, written by the same statement that
    // created the account.
    assert.equal(account.churchId, churchId);
    assert.equal(account.seat, "admin");
    assert.equal(account.sendingChurchId, null);
    assert.equal(account.sendingNetworkId, null);

    // The invitation is closed by the same batch, and its link is spent.
    const [row] = await db
      .select({
        status: userInvitations.status,
        respondedBy: userInvitations.respondedBy,
      })
      .from(userInvitations)
      .where(eq(userInvitations.id, invitationId));

    assert.equal(row.status, "accepted");
    assert.equal(row.respondedBy, userId);
    assert.equal(
      await describeUserInvitationForRegistration(mail.tokenFrom()),
      null
    );
  }
);

test(
  "registration MINTS a person record when the plant holds none",
  { skip },
  async () => {
    const { actor, churchId } = await scratchPlant();
    const mail = captureTransport();
    const invitee = scratchEmail();

    await createUserInvitationAs(
      actor,
      { inviteeEmail: invitee, seat: "member" },
      mail.deps
    );
    const { userId } = await registerThrough(
      mail.tokenFrom(),
      invitee,
      SCRATCH_NAME
    );

    const linked = await db
      .select({ id: persons.id, email: persons.email })
      .from(persons)
      .where(and(eq(persons.churchId, churchId), eq(persons.userId, userId)));

    assert.equal(
      linked.length,
      1,
      "no person record was created for the account"
    );
    assert.equal(linked[0].email, invitee);
  }
);

test(
  "registration LINKS the person the plant already had",
  { skip },
  async () => {
    const { actor, churchId, ownerId } = await scratchPlant();
    const mail = captureTransport();
    const invitee = scratchEmail();

    // Somebody the planter added months ago — deliberately with a different
    // casing, because `persons.email` is typed by hand and `users.email` is
    // stored lowercased.
    const [existing] = await db
      .insert(persons)
      .values({
        churchId,
        firstName: "Sam",
        lastName: "Stranger",
        email: invitee.toUpperCase(),
        status: "attendee",
        createdBy: ownerId,
      })
      .returning({ id: persons.id });

    await createUserInvitationAs(
      actor,
      { inviteeEmail: invitee, seat: "member" },
      mail.deps
    );
    const { userId } = await registerThrough(
      mail.tokenFrom(),
      invitee,
      SCRATCH_NAME
    );

    const rows = await db
      .select({ id: persons.id, userId: persons.userId })
      .from(persons)
      .where(eq(persons.churchId, churchId));

    // AS-013: LINKED rather than duplicated. One row, and it is the one that was
    // already there — with its history on it.
    assert.equal(rows.length, 1, "the account got a second person record");
    assert.equal(rows[0].id, existing.id);
    assert.equal(rows[0].userId, userId);
  }
);
