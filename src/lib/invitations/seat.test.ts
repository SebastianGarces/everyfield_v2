import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CAPABILITY_BY_EXPORT } from "@/lib/auth/capability-map";
import {
  assertSeatFor,
  holdsSeatFor,
  SeatRefusalError,
} from "@/lib/auth/seat-rules";
import type { SeatFields } from "@/lib/auth/tenancy";
import type { BatchItem } from "drizzle-orm/batch";
import { accountPersonLinkStatements } from "@/lib/people/account-person-link";

import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

import { createAccountEntities } from "@/app/(auth)/register/account-entities";

import {
  ACCOUNT_NOT_INVITABLE_MESSAGE,
  INVITATION_EXPIRY_DAYS,
  INVITES_PER_INVITEE_PER_WINDOW,
  invitationActorFromSession,
} from "./core";
import { RESEND_DEDUPE_WINDOW_MS, resendDedupeWindowAt } from "./resend-window";
import { INVITED_AS_COPY, invitedAsWithArticle } from "./seat-copy";
import { seatInvitationEmailIdempotencyKey } from "./seat-email";
import {
  claimUserInvitationStatement,
  hashUserInvitationToken,
  newUserInvitationToken,
  USER_INVITE_RATE_LIMITED_MESSAGE,
  userInvitationActedOnAtRegistration,
  inviteeRefusalFor,
  invitesFromTenancyToAddressQuery,
  type UserRegistrationInvitation,
} from "./seat";

// ============================================================================
// #495 / AS-010, AS-012, AS-013 — SEAT INVITATIONS, the properties that do not
// need a database.
//
// The live half is `./seat-invitations-live.test.ts`: the two CHECK
// constraints, the hashed column as Postgres actually stores it, and the
// create → register walk. It runs in the `Live DB Race Suites` job. Everything
// a real Postgres is NOT needed for is here, because a suite that only runs
// with a container is a suite that stops running.
//
// THE THREE SHAPES THIS FILE USES, and why each is the honest one:
//
//   * EXECUTED, for the pure decisions — the refusal predicate, the address
//     binding, the registration planner, the person-link statements. These are
//     the rules, and they are functions, so they are called.
//   * GENERATED SQL, for the queries — a cap that quietly grew a `status`
//     predicate is invisible in behaviour until somebody runs a revoke-reinvite
//     loop for real, and visible in `toSQL()` immediately.
//   * SOURCE, for the ORDER and for the module graph — `createUserInvitationAs`
//     needs a database to run, but the property that matters about it is the
//     ORDER of its four checks (`memory/invariants.md` → Multi-Tenancy: the
//     neutrality rule is POSITIONAL), and an order is a fact about the source.
//     Anchors go through `@/lib/testing/source-span`, never a bare `indexOf`.
// ============================================================================

const SRC = path.join(process.cwd(), "src");
const read = (...segments: string[]) =>
  readFileSync(path.join(SRC, ...segments), "utf8");

const SEAT = sourceReader(
  stripComments(read("lib", "invitations", "seat.ts")),
  "seat.ts (stripped)"
);
const SEAT_EMAIL = stripComments(read("lib", "invitations", "seat-email.ts"));
const TEAM_ACTIONS = sourceReader(
  stripComments(read("app", "(dashboard)", "settings", "team", "actions.ts")),
  "settings/team/actions.ts (stripped)"
);
const TEAM_PAGE = stripComments(
  read("app", "(dashboard)", "settings", "team", "page.tsx")
);
const ORG_ACTIONS = sourceReader(
  stripComments(
    read("app", "(dashboard)", "oversight", "invitations", "actions.ts")
  ),
  "oversight/invitations/actions.ts (stripped)"
);
const REGISTER_ACTIONS = sourceReader(
  stripComments(read("app", "(auth)", "register", "actions.ts")),
  "register/actions.ts (stripped)"
);
const ACCOUNT_PERSON_LINK = stripComments(
  read("lib", "people", "account-person-link.ts")
);
const MIGRATION = read("db", "migrations", "0054_user_invitations.sql");
const JOURNAL = JSON.parse(
  read("db", "migrations", "meta", "_journal.json")
) as { entries: { idx: number; when: number; tag: string }[] };

/** The create, cut out of its module once. */
const CREATE = SEAT.span(
  "export async function createUserInvitationAs",
  "async function emailSeatInvitee"
);

const PLANT = "11111111-1111-4111-8111-111111111111";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const SENDING_CHURCH = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const INVITATION = "66666666-6666-4666-8666-666666666666";

function account(overrides: Partial<SeatFields> = {}): SeatFields {
  return {
    seat: null,
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...overrides,
  };
}

const PLANT_OWNER = account({ seat: "owner", churchId: PLANT });
const PLANT_ADMIN = account({ seat: "admin", churchId: PLANT });
const PLANT_MEMBER = account({ seat: "member", churchId: PLANT });
const NETWORK_OWNER = account({ seat: "owner", sendingNetworkId: NETWORK });
const NETWORK_ADMIN = account({ seat: "admin", sendingNetworkId: NETWORK });
const SC_MEMBER = account({ seat: "member", sendingChurchId: SENDING_CHURCH });
/** A coach: an account with no tenancy and no seat at all. */
const COACH = account();

/**
 * A batched statement, read as the SQL it will send.
 *
 * `BatchItem<"pg">` is the union `db.batch` accepts and it hides `toSQL`, which
 * every member of it has. The cast is the test's, never the application's — a
 * statement is exactly what this suite is asserting about.
 */
const asQuery = (statement: BatchItem<"pg">) =>
  statement as unknown as { toSQL(): { sql: string; params: unknown[] } };

const actorFor = (user: SeatFields) =>
  invitationActorFromSession({ user: { id: USER, ...user } });

// ----------------------------------------------------------------------------
// 1. ONE IMPLEMENTATION, NOT A SECOND COPY (AS-010, ruling 185 (5))
// ----------------------------------------------------------------------------

/** Every top-level `const`/`function` a module declares, by name. */
function declaredNames(code: string): string[] {
  return [
    ...code.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm),
    ...code.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm),
    ...code.matchAll(/^(?:export\s+)?const\s+(\w+)/gm),
  ].map((match) => match[1]);
}

test("the seat surface declares nothing the org surface already owns", () => {
  // A NAME DIFF, NOT A HAND-WRITTEN LIST. The first version of this test named
  // five constants and passed while `seat.ts` held THREE verbatim copies —
  // `INVITATION_EXPIRED_MESSAGE`'s sentence, the address regex and the
  // rate-limit window arithmetic. A guardrail with a list in it only ever
  // catches what somebody already thought of, which is the failure mode this
  // file's own §8 narrates about `kindLabel`.
  //
  // So the claim is now the general one AS-010 actually makes: no top-level
  // declaration in the seat surface shares a name with anything the org surface
  // exports. Adding a copy fails here without anybody remembering to list it.
  const owned = new Set([
    ...declaredNames(read("lib", "invitations", "core.ts")),
    ...declaredNames(read("lib", "invitations", "resend.ts")),
    ...declaredNames(read("lib", "invitations", "resend-window.ts")),
    ...declaredNames(read("lib", "invitations", "create-notice.ts")),
    ...declaredNames(read("lib", "invitations", "register-path.ts")),
  ]);

  const copies: string[] = [];
  for (const [where, code] of [
    ["seat.ts", SEAT.code],
    ["seat-email.ts", SEAT_EMAIL],
    ["seat-copy.ts", stripComments(read("lib", "invitations", "seat-copy.ts"))],
    ["settings/team/actions.ts", TEAM_ACTIONS.code],
  ] as const) {
    for (const name of declaredNames(code)) {
      if (owned.has(name)) copies.push(`${where} → ${name}`);
    }
  }

  assert.deepEqual(
    copies,
    [],
    "AS-010 says one implementation shared with the org invitation surface, not a second copy — import these instead of re-declaring them:\n  " +
      copies.join("\n  ")
  );

  // A scan that resolved nothing would pass silently.
  assert.ok(
    owned.size > 20,
    `the org surface exports only ${owned.size} names`
  );

  // …and the seat surface really does take the vocabulary from those modules.
  assert.match(SEAT.code, /from "\.\/core"/);
  assert.match(SEAT.code, /INVITES_PER_INVITEE_PER_WINDOW/);
  assert.match(SEAT.code, /ACCOUNT_NOT_INVITABLE_MESSAGE/);
  assert.match(SEAT.code, /isInvitableEmailAddress/);
  assert.match(SEAT.code, /rateLimitWindowStart/);
  assert.match(SEAT.code, /INVITATION_EXPIRED_MESSAGE/);
  assert.match(SEAT.code, /from "\.\/resend-window"/);
  assert.match(SEAT.code, /resendRefusalMessage/);
});

test("the shared constants are the ruled numbers", () => {
  assert.equal(INVITATION_EXPIRY_DAYS, 30);
  assert.equal(INVITES_PER_INVITEE_PER_WINDOW, 3);
  assert.equal(RESEND_DEDUPE_WINDOW_MS, 60_000);
});

// ----------------------------------------------------------------------------
// 2. THE TOKEN IS A SECRET, AND THE DATABASE HOLDS ONLY ITS DIGEST
// ----------------------------------------------------------------------------

test("a minted token is 256 bits of base64url, and never repeats", () => {
  const drawn = new Set<string>();

  for (let i = 0; i < 200; i += 1) {
    const token = newUserInvitationToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/, token);
    drawn.add(token);
  }

  assert.equal(drawn.size, 200, "a token repeated inside 200 draws");
});

test("what is stored is the digest, and it is not the token", () => {
  const token = newUserInvitationToken();
  const stored = hashUserInvitationToken(token);

  // The property AS-010 states, executed: the column's value is not the value
  // the email carried.
  assert.notEqual(stored, token);
  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.equal(
    stored,
    createHash("sha256").update(token, "utf8").digest("hex")
  );
  // Deterministic, which is what makes the registration lookup a point read.
  assert.equal(stored, hashUserInvitationToken(token));
  assert.notEqual(stored, hashUserInvitationToken(newUserInvitationToken()));
});

test("no write and no read ever names the plaintext token", () => {
  // The INSERT writes the digest and the row literal has no field for the
  // other thing. Scoped to the literal on purpose: the plaintext is handed to
  // the EMAIL two lines later, which is the one place it is allowed to appear.
  const row = SEAT.span(
    "const row: NewUserInvitation = {",
    "const [invitation] = await db"
  );
  assert.match(row, /tokenHash: hashUserInvitationToken\(token\)/);
  assert.doesNotMatch(
    row,
    /^\s*token:/m,
    "the row literal grew a plaintext token field — the database must hold the digest and nothing else"
  );

  // The registration lookup matches on the digest, so a database read — or a
  // backup, or a log — hands nobody a working link.
  assert.match(
    SEAT.code,
    /eq\(userInvitations\.tokenHash, hashUserInvitationToken\(candidate\)\)/
  );

  // The schema and the migration agree that `token_hash` is the only column,
  // and that two rows cannot carry one token.
  const schema = read("db", "schema", "user-invitation.ts");
  assert.match(schema, /varchar\("token_hash", \{ length: 64 \}\)/);
  assert.doesNotMatch(stripComments(schema), /varchar\("token"/);
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "user_invitations_token_hash_unique_idx"/
  );

  // And nothing logs it. The failure logs carry the invitation id, which is
  // deliberately NOT the credential here — unlike the org path, where the id IS
  // the token.
  for (const code of [SEAT.code, SEAT_EMAIL]) {
    for (const log of code.matchAll(
      /console\.(?:error|warn|log)\([\s\S]*?\}\)/g
    )) {
      assert.doesNotMatch(log[0], /\btoken\b/, log[0]);
    }
  }
});

// ----------------------------------------------------------------------------
// 3. REGISTER-ONLY: ONE MESSAGE, FOR EVERY KIND OF ACCOUNT
// ----------------------------------------------------------------------------

test("every kind of existing account is refused with the ONE constant", () => {
  // AS-010 inverts the org rule's first clause — a seat invitation to an
  // existing account is REFUSED rather than targeted — and keeps its second
  // whole: whatever is behind the address, the sentence is the same one.
  //
  // The predicate is total over "is there a row", so the kinds below are the
  // kinds a `users` row can be, not branches it has to grow.
  const accounts = [
    ["a plant Owner", { id: USER, seat: "owner", churchId: PLANT }],
    ["a plant Admin", { id: USER, seat: "admin", churchId: PLANT }],
    ["a plant Member", { id: USER, seat: "member", churchId: PLANT }],
    ["an org Owner", { id: USER, seat: "owner", sendingNetworkId: NETWORK }],
    [
      "an org Member",
      { id: USER, seat: "member", sendingChurchId: SENDING_CHURCH },
    ],
    ["a coach, holding no seat at all", { id: USER, seat: null }],
    [
      "a projection of one column, which is what the create reads",
      { id: USER },
    ],
  ] as const;

  for (const [what, row] of accounts) {
    assert.equal(
      inviteeRefusalFor("seat", row),
      ACCOUNT_NOT_INVITABLE_MESSAGE,
      `${what} was not refused with the one neutral message`
    );
  }

  // A stranger is not refused at all — the other half, or the test above would
  // pass on a function that returned the constant unconditionally.
  assert.equal(inviteeRefusalFor("seat", undefined), null);
  assert.equal(inviteeRefusalFor("seat", null), null);
});

test("a COACH invitation is never refused with that constant (AS-009)", () => {
  // THE RULED ASYMMETRY, from the SAME predicate the seat rule is read off —
  // which is what makes it one decision rather than two that can drift. A seat
  // invitation would MOVE an account between tenancies; a coach invitation only
  // ADDS an assignment, so every account above may hold one.
  const accounts = [
    ["a plant Owner", { id: USER, seat: "owner", churchId: PLANT }],
    ["a plant Admin", { id: USER, seat: "admin", churchId: PLANT }],
    ["a plant Member", { id: USER, seat: "member", churchId: PLANT }],
    ["an org Owner", { id: USER, seat: "owner", sendingNetworkId: NETWORK }],
    [
      "an org Member",
      { id: USER, seat: "member", sendingChurchId: SENDING_CHURCH },
    ],
    ["a coach already, holding no seat at all", { id: USER, seat: null }],
    ["the one-column projection the create reads", { id: USER }],
    ["a stranger", undefined],
  ] as const;

  for (const [what, row] of accounts) {
    assert.equal(
      inviteeRefusalFor("coach", row),
      null,
      `${what} was refused a coach invitation — AS-009 admits every account`
    );
  }
});

test("the refusal is the imported constant, not a sentence that resembles it", () => {
  // Identity, not similarity: two strings that agree today are two strings.
  assert.equal(
    inviteeRefusalFor("seat", { id: USER }),
    ACCOUNT_NOT_INVITABLE_MESSAGE
  );
  // THE PATTERN IS ONE STRING LITERAL, and it has to be spelled that way.
  //
  // It read `/"[^"]*already[^"]*account[^"]*"/i`, and `[^"]` matches a NEWLINE —
  // so the "sentence" it caught was free to start at the end of one literal, run
  // through a screenful of code, and finish at the start of another. #496 tripped
  // it twice that way without composing any sentence at all: once across a header
  // paragraph, once across `"active"` … `ALREADY_COACHING_MESSAGE` …
  // `existingAccount`. Excluding the newline is what makes it mean what it says —
  // one literal, on one line, saying an account already exists — and it still
  // catches the thing it was written for, since a string literal never spans
  // lines. Comments are stripped for the same reason `stripComments`' own
  // docblock gives: a module that documents the rule must not fail it.
  assert.doesNotMatch(
    stripComments(SEAT.code),
    /"[^"\n]*already[^"\n]*account[^"\n]*"/i,
    "seat.ts composes a sentence about an account instead of importing the one message"
  );
});

test("the success notice carries no target-derived field", () => {
  // The cheaper probe is the SUCCESS path (`memory/invariants.md` →
  // Multi-Tenancy), so the payload is pinned as a shape rather than trusted to
  // the component: `{ inviteeEmail, emailSent }`, exactly the org surface's,
  // and no third key for a target signal to arrive in.
  assert.match(
    TEAM_ACTIONS.code,
    /created\?: \{ inviteeEmail: string; emailSent\?: boolean \}/
  );

  const created = TEAM_ACTIONS.span(
    "export async function createSeatInvitationAction",
    "export async function resendSeatInvitationEmailAction"
  );
  assert.match(created, /inviteeEmail: result\.invitation\.inviteeEmail/);
  assert.match(created, /emailSent: result\.emailSent/);
  // Nothing about the address lookup, and nothing about the plant either. The
  // SEAT is not banned here — it is the admin's own choice arriving in the
  // form, not a fact about the person behind the address — but it does not come
  // back either, because the `created` shape above has no key for it.
  for (const banned of [/churchId/, /existingAccount/, /\busers\b/]) {
    assert.doesNotMatch(created, banned, String(banned));
  }
});

// ----------------------------------------------------------------------------
// 4. THE RULE IS POSITIONAL — the order of the four checks IS the property
// ----------------------------------------------------------------------------

test("every legible refusal runs ABOVE the address lookup", () => {
  // "Everything downstream of target resolution speaks about a STRANGER."
  // Here the resolution is the `users` read, so the authority check, the parse,
  // the duplicate check and the cap all sit above it — each of them answers
  // identically whether or not an account is behind the address, which is what
  // lets them keep their own legible words.
  assertInOrder(
    CREATE,
    "createUserInvitationAs",
    [
      // The capability comes off the KIND table now (#496), but it still runs
      // first — and the table's two rows are asserted below, so "whichever verb
      // the kind names" is not a loophole.
      "assertSeatFor(actor, rules.capability)",
      "normalizeInviteeEmail(request.inviteeEmail)",
      "isInvitableEmailAddress(inviteeEmail)",
      'eq(userInvitations.status, "pending")',
      "invitesFromTenancyToAddressQuery(",
      ".from(users)",
      "inviteeRefusalFor(request.kind, existingAccount)",
      "db.insert(userInvitations)",
    ],
    "the neutrality rule is positional: a check that can compose a legible message must run before the address resolves to an account"
  );
});

test("nothing below the lookup composes a sentence of its own", () => {
  const belowTheLookup = SEAT.span(
    "const [existingAccount]",
    "const token = newUserInvitationToken()"
  );

  // Exactly one refusal is reachable down here, and it is the imported
  // constant handed over by `seatInviteeRefusal`. A `new InvitationError("…")`
  // with a literal in it would be a second sentence about a stranger.
  assert.match(belowTheLookup, /throw new InvitationError\(refusal\)/);
  assert.doesNotMatch(belowTheLookup, /new InvitationError\(\s*"/);
});

// ----------------------------------------------------------------------------
// 5. THE CAP — this plant's rows, every status, the server's window
// ----------------------------------------------------------------------------

test("the cap counts EVERY status, scoped to this tenancy and this address", () => {
  const since = new Date("2026-07-21T12:00:00.000Z");
  const { sql, params } = invitesFromTenancyToAddressQuery(
    "seat",
    { type: "church", id: PLANT },
    "stranger@example.com",
    since
  ).toSQL();

  assert.match(sql, /from "user_invitations"/);
  assert.match(sql, /"user_invitations"\."kind" = \$/);
  assert.match(sql, /"user_invitations"\."church_id" = \$/);
  assert.match(sql, /"user_invitations"\."invitee_email" = \$/);
  assert.match(sql, /"user_invitations"\."created_at" >= \$/);

  // THE ABSENT PREDICATE IS THE RULE. "Counting every status" is what stops a
  // revoke–reinvite loop, and counting only the pending ones would count only
  // the invitations that are not the problem.
  assert.doesNotMatch(
    sql,
    /"status"/,
    "the cap grew a status predicate — a revoked row must still count (AS-010)"
  );

  assert.deepEqual(params, [
    "seat",
    PLANT,
    "stranger@example.com",
    since.toISOString(),
    INVITES_PER_INVITEE_PER_WINDOW,
  ]);
});

test("the fourth invitation inside the window is the one that is refused", () => {
  // The bound, read off the source, because the query above stops counting at
  // the limit: three rows come back and the fourth attempt is the refusal.
  assert.match(CREATE, /recent\.length >= INVITES_PER_INVITEE_PER_WINDOW/);
  assert.match(CREATE, /rateLimitWindowStart\(now\)/);
  // …and the window itself is the org surface's arithmetic, imported. The seat
  // path had a byte-identical copy of it until review round 1.
  assert.match(
    stripComments(read("lib", "invitations", "core.ts")),
    /export function rateLimitWindowStart\(now: Date\): Date \{\s*return new Date\(\s*now\.getTime\(\) - INVITATION_EXPIRY_DAYS \* 24 \* 60 \* 60 \* 1000\s*\);/
  );
});

test("the cap's refusal names the plant's own behaviour, never an account", () => {
  assert.notEqual(
    USER_INVITE_RATE_LIMITED_MESSAGE,
    ACCOUNT_NOT_INVITABLE_MESSAGE
  );
  // Legible precisely because it is unreachable from below the lookup — it can
  // only ever be a statement about invitations THIS plant sent.
  assert.doesNotMatch(USER_INVITE_RATE_LIMITED_MESSAGE, /account/i);
  assert.doesNotMatch(USER_INVITE_RATE_LIMITED_MESSAGE, /exist/i);
});

// ----------------------------------------------------------------------------
// 6. A MEMBER CANNOT CREATE ONE (AS-010's own acceptance criterion)
// ----------------------------------------------------------------------------

test("seat.invitation.manage is the Owner and Admin of ANY tenancy (#500)", () => {
  // AS-005 gives an org's Owner and Admin the org's own seat invitations, and
  // the verb was widened from `tenancy: "plant"` to `tenancy: "tenancy"` rather
  // than a second verb being declared — an org Admin inviting an org Member is
  // the same decision about the same row shape. WHICH tenancy the row lands in
  // is the actor's own, resolved by `tenancyOf` one layer down, so there is no
  // question here of a plant Admin reaching an org's rows.
  for (const [what, who] of [
    ["a plant Owner", PLANT_OWNER],
    ["a plant Admin", PLANT_ADMIN],
    ["a network Owner", NETWORK_OWNER],
    ["a network Admin", NETWORK_ADMIN],
  ] as const) {
    assert.equal(
      holdsSeatFor(who, "seat.invitation.manage"),
      true,
      `${what} may not staff their own tenancy`
    );
  }

  // AND THE THREE THAT STILL MAY NOT. A Member of either kind holds no
  // ADMIN_PLUS seat, and a coach holds no seat at all.
  for (const [what, who] of [
    ["a plant Member", PLANT_MEMBER],
    ["a coach", COACH],
    ["a sending-church Member", SC_MEMBER],
  ] as const) {
    assert.equal(
      holdsSeatFor(who, "seat.invitation.manage"),
      false,
      `${what} may create a seat invitation`
    );
  }
});

test("…and NOT the registered Owner whose plant does not exist yet", () => {
  // THE REASON THE VERB IS `tenancy` AND NOT `any`. Registration mints a plant
  // Owner with every tenancy FK null; they create the plant afterwards. `any`
  // would let them past `/settings/team`'s gate onto a screen whose every query
  // has no subject, and `invitingTenancy` would then throw where a redirect
  // belongs.
  assert.equal(
    holdsSeatFor(
      {
        seat: "owner",
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId: null,
      },
      "seat.invitation.manage"
    ),
    false,
    "an account that names no tenancy has no team to staff"
  );
});

test("the logic layer refuses a Member itself, not only the action", () => {
  // Two guards on purpose: `requireSeat` in the action is the primary refusal,
  // and this one holds for any caller that reached the service some other way.
  assert.throws(
    () => assertSeatFor(actorFor(PLANT_MEMBER), "seat.invitation.manage"),
    SeatRefusalError
  );
  assert.doesNotThrow(() =>
    assertSeatFor(actorFor(PLANT_ADMIN), "seat.invitation.manage")
  );

  // …and EVERY export that takes an actor asserts it, before anything else it
  // does. The reads were missing it at review round 1, and one of them
  // (`expireLapsedUserInvitations`) is an UPDATE whose only authority was the
  // page's redirect — which holds for a browser and for nothing else.
  for (const write of [
    "export async function listUserInvitationsFor",
    "export async function revokeUserInvitationAs",
    "export async function resendUserInvitationEmailAs",
    "export async function expireLapsedUserInvitations",
  ]) {
    const body = SEAT.after(write).slice(0, 400);
    assert.match(
      body,
      /assertSeatFor\(actor, "seat\.invitation\.manage"\)/,
      write
    );
  }

  // THE CREATE GUARDS OFF THE KIND TABLE (#496), so it is asserted against the
  // table rather than against a literal — and the table itself is pinned below,
  // which is what stops "whichever verb the kind names" becoming a hole.
  assert.match(
    SEAT.after("export async function createUserInvitationAs").slice(0, 400),
    /assertSeatFor\(actor, rules\.capability\)/
  );
});

test("A MEMBER CANNOT INVITE A COACH EITHER — the kind table's other verb", () => {
  // AC 9 of #496. The create reads its capability off `INVITATION_KIND_RULES`,
  // so the table IS the authority and both of its rows are pinned here: the
  // coach row names `coach.assignment.manage` rather than a fourth verb,
  // because ending an assignment already answers to it (#497), and that verb
  // carries the same ADMIN_PLUS-on-a-plant rule the seat one does.
  const table = SEAT.span(
    "const INVITATION_KIND_RULES",
    "} as const satisfies"
  );

  assert.match(table, /capability: "seat\.invitation\.manage"/);
  assert.match(table, /capability: "coach\.assignment\.manage"/);

  for (const who of [PLANT_OWNER, PLANT_ADMIN]) {
    assert.equal(holdsSeatFor(who, "coach.assignment.manage"), true);
  }

  for (const [what, who] of [
    ["a plant Member", PLANT_MEMBER],
    ["a coach", COACH],
    ["a network Owner", NETWORK_OWNER],
    ["a sending-church Member", SC_MEMBER],
  ] as const) {
    assert.equal(
      holdsSeatFor(who, "coach.assignment.manage"),
      false,
      `${what} may invite a coach onto a plant`
    );
  }

  // And the logic layer refuses them itself, not only the action.
  assert.throws(
    () => assertSeatFor(actorFor(PLANT_MEMBER), "coach.assignment.manage"),
    SeatRefusalError
  );
});

test("the coach endpoints are checked in against their capabilities", () => {
  // The walk proves a guard is called; only the map proves the verb.
  assert.equal(
    CAPABILITY_BY_EXPORT[
      "src/app/(dashboard)/settings/team/actions.ts → createCoachInvitationAction"
    ],
    "coach.assignment.manage"
  );
  assert.equal(
    CAPABILITY_BY_EXPORT[
      "src/app/(auth)/coach-invitation/actions.ts → acceptCoachInvitationAction"
    ],
    "coach.invitation.answer"
  );

  // ANSWERING carries no seat set and no tenancy, deliberately: a plant Member,
  // an oversight Owner and a seatless coach must all be able to accept one, and
  // any narrowing would refuse the coach the invitation is most often for.
  for (const who of [PLANT_OWNER, PLANT_MEMBER, COACH, NETWORK_OWNER]) {
    assert.equal(holdsSeatFor(who, "coach.invitation.answer"), true);
  }
});

test("the three endpoints are checked in against that capability", () => {
  // The walk proves a guard is called; only the map proves it was called with
  // the right verb (`memory/invariants.md` → Authentication).
  for (const endpoint of [
    "createSeatInvitationAction",
    "resendSeatInvitationEmailAction",
    "revokeSeatInvitationAction",
  ]) {
    assert.equal(
      CAPABILITY_BY_EXPORT[
        `src/app/(dashboard)/settings/team/actions.ts → ${endpoint}`
      ],
      "seat.invitation.manage",
      endpoint
    );
  }
});

// ----------------------------------------------------------------------------
// 7. REGISTRATION — the token is address-bound, and the grant is ONE write
// ----------------------------------------------------------------------------

const described: UserRegistrationInvitation = {
  id: INVITATION,
  inviteeEmail: "stranger@example.com",
  tenancy: { type: "church", id: PLANT },
  tenancyName: "Redemption Hill",
  invitedAs: { kind: "seat", seat: "admin" },
};

test("a seat token is acted on only for the address it names", () => {
  assert.equal(
    userInvitationActedOnAtRegistration(described, "stranger@example.com"),
    described
  );
  // Case and surrounding space are not the address.
  assert.equal(
    userInvitationActedOnAtRegistration(described, "  Stranger@Example.COM "),
    described
  );

  // A mismatch carries NO message and no invitation — it falls through to the
  // ordinary sign-up exactly as an unknown token does, because `/register` is
  // an anonymous POST (Ruling C).
  assert.equal(
    userInvitationActedOnAtRegistration(described, "someone-else@example.com"),
    null
  );
  assert.equal(userInvitationActedOnAtRegistration(described, ""), null);
  assert.equal(
    userInvitationActedOnAtRegistration(null, "stranger@example.com"),
    null
  );
  assert.equal(
    userInvitationActedOnAtRegistration({ ...described, inviteeEmail: "" }, ""),
    null
  );
});

test("a redeemed seat invitation decides the whole registration plan", () => {
  // Whatever radio button the form carried is not a question: the link already
  // names a plant and a seat, and creating a second organization would leave
  // the account naming two tenancies — which `holdsSeatFor` refuses outright.
  const plan = createAccountEntities(
    // Deliberately the account type that creates an ORG, to prove it is ignored.
    "network",
    "Some Network They Typed",
    USER,
    { name: "Sam Stranger", email: "stranger@example.com" },
    false,
    {
      tenancy: { type: "church", id: PLANT },
      invitedAs: { kind: "seat", seat: "admin" },
      matchedPersonId: null,
    }
  );

  assert.equal(plan.seat, "admin");
  assert.equal(plan.churchId, PLANT);
  // AS-012: the tenancy goes into the users INSERT, beside the seat.
  assert.equal(plan.userChurchId, PLANT);
  assert.equal(plan.sendingChurchId, null);
  assert.equal(plan.sendingNetworkId, null);
  assert.deepEqual(plan.statements, []);
  // Exactly one link statement: the person record AS-013 asks for.
  assert.equal(plan.linkStatements.length, 1);
});

// ----------------------------------------------------------------------------
// #500 — THE SAME PLAN, INTO AN ORG
// ----------------------------------------------------------------------------

test("an org seat invitation grants the ORG's FK and writes no person row", () => {
  // AC 1 and AC 3 of #500, read off the planner: the seat lands in the tenancy
  // the invitation named, the other two FKs stay NULL (which is what the
  // exactly-one rule means on the users row), and `persons` is untouched —
  // an org Member is an account and never a person record inside a plant
  // (ruling 185 (9)).
  for (const [what, tenancy, expected] of [
    [
      "a sending church",
      { type: "sending_church", id: SENDING_CHURCH } as const,
      {
        churchId: null,
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: null,
      },
    ],
    [
      "a network",
      { type: "network", id: NETWORK } as const,
      { churchId: null, sendingChurchId: null, sendingNetworkId: NETWORK },
    ],
  ] as const) {
    const plan = createAccountEntities(
      // The plant-creating account type this time, to prove it is ignored in
      // the other direction too.
      "planter",
      "A Plant They Typed",
      USER,
      { name: "Ola Overseer", email: "ola@example.com" },
      true,
      {
        tenancy,
        invitedAs: { kind: "seat", seat: "member" },
        matchedPersonId: null,
      }
    );

    assert.equal(plan.seat, "member", `${what}: the invited seat is granted`);
    assert.equal(plan.churchId, expected.churchId, `${what}: church_id`);
    assert.equal(
      plan.sendingChurchId,
      expected.sendingChurchId,
      `${what}: sending_church_id`
    );
    assert.equal(
      plan.sendingNetworkId,
      expected.sendingNetworkId,
      `${what}: sending_network_id`
    );

    // NO PLANT ON THE USERS INSERT, and no plant created either. The
    // `createChurchForPlanter` argument above is true and the account type is
    // `planter`; the invitation overrides both.
    assert.equal(plan.userChurchId, null, `${what}: no church on the insert`);
    assert.deepEqual(plan.statements, [], `${what}: no org is created`);

    // AC 3 — `persons` IS UNCHANGED. The plant-side match-or-create must not
    // fire here: there is no directory on an org for a person row to live in.
    assert.deepEqual(
      plan.linkStatements,
      [],
      `${what}: an org seat writes no persons row`
    );
  }
});

test("a redeemed COACH invitation writes no tenancy, no seat and no person", () => {
  // AC 1 of #496, read off the planner rather than inferred from an INSERT:
  // a coach's whole grant is the `coach_assignments` row the ACTION batches
  // after the claim, so the plan itself creates nothing at all.
  const plan = createAccountEntities(
    // Again the org-creating account type, to prove the invitation overrides it.
    "network",
    "Some Network They Typed",
    USER,
    { name: "Casey Coach", email: "coach@example.com" },
    false,
    {
      tenancy: { type: "church", id: PLANT },
      invitedAs: { kind: "coach" },
      matchedPersonId: null,
    }
  );

  assert.equal(plan.seat, null, "a coach holds no seat");
  assert.equal(plan.churchId, null, "a coach holds no tenancy");
  assert.equal(plan.userChurchId, null, "…and the users insert writes none");
  assert.equal(plan.sendingChurchId, null);
  assert.equal(plan.sendingNetworkId, null);
  assert.deepEqual(plan.statements, []);
  // NO PERSON ROW. AS-013's link is about somebody JOINING the plant; a coach
  // reads it and is not part of it.
  assert.deepEqual(plan.linkStatements, []);
});

test("an ordinary registration still writes no tenancy on the users insert", () => {
  // The other half of `userChurchId`. An invited planter's link is written by
  // `linkUserToChurchFilter`'s compare-and-set (ruling 408-4B), so this field
  // must stay null for every path that is not a seat invitation.
  for (const type of ["planter", "sending_church", "network"] as const) {
    const plan = createAccountEntities(
      type,
      "An Organization",
      USER,
      { name: "A Planter", email: "planter@example.com" },
      type === "planter",
      null
    );
    assert.equal(plan.userChurchId, null, type);
  }
});

test("the grant and the claim go into the SAME batch as the account", () => {
  const register = REGISTER_ACTIONS.span(
    "export async function register(",
    "const DUPLICATE_EMAIL_MESSAGE"
  );

  assertInOrder(
    register,
    "register",
    [
      "const seatInvitation = userInvitationActedOnAtRegistration(",
      "createAccountEntities(",
      "db\n      .insert(users)",
      "statements.push(claimUserInvitationStatement(seatInvitation.id, userId))",
      "await db.batch(statements)",
    ],
    "AS-012: the seat, its tenancy, the person link and the claim commit together or not at all"
  );

  // The seat and the tenancy are on the insert itself, from the planner.
  assert.match(register, /\bseat,/);
  assert.match(register, /churchId: account\.userChurchId/);

  // The claim is a compare-and-set on `pending`, so a revoke landing in the
  // same instant wins and the row is not re-answered.
  const { sql, params } = claimUserInvitationStatement(
    INVITATION,
    USER,
    new Date("2026-08-20T12:00:00.000Z")
  ).toSQL();
  assert.match(sql, /update "user_invitations" set "status" = \$/);
  assert.match(sql, /"user_invitations"\."status" = \$/);
  assert.ok(params.includes("accepted"));
  assert.ok(params.includes("pending"));
});

// ----------------------------------------------------------------------------
// 8. THE PERSON LINK — matched, or minted (AS-013)
// ----------------------------------------------------------------------------

test("a matching person is CLAIMED, and the mint behind it makes that total", () => {
  const statements = accountPersonLinkStatements({
    userId: USER,
    churchId: PLANT,
    name: "Sam Stranger",
    email: "stranger@example.com",
    matchedPersonId: "77777777-7777-4777-8777-777777777777",
  });

  // TWO STATEMENTS, and the second is why AS-013 is total: the UPDATE is
  // guarded on `user_id IS NULL`, so a row claimed between the read and the
  // batch would leave the account with NO person record at all. The INSERT
  // converges either way and is a no-op when the claim worked.
  assert.equal(statements.length, 2);

  const claim = asQuery(statements[0]).toSQL();
  assert.match(claim.sql, /^update "persons" set "user_id" = \$/);
  // The two guards that cost nothing: it can never steal a row another account
  // already holds, and it cannot revive a deleted contact.
  assert.match(claim.sql, /"persons"\."user_id" is null/);
  assert.match(claim.sql, /"persons"\."deleted_at" is null/);
  assert.ok(claim.params.includes(USER));
  assert.ok(claim.params.includes("77777777-7777-4777-8777-777777777777"));

  const fallback = asQuery(statements[1]).toSQL();
  assert.match(fallback.sql, /^insert into "persons"/);
  assert.match(
    fallback.sql,
    /on conflict \("church_id","user_id"\) where "persons"\."user_id" is not null do nothing/
  );
});

test("no matching person means ONE statement, and it mints, idempotently", () => {
  const [statement, ...rest] = accountPersonLinkStatements({
    userId: USER,
    churchId: PLANT,
    name: "Sam Stranger",
    email: "stranger@example.com",
    matchedPersonId: null,
  });

  assert.deepEqual(rest, [], "an unmatched account needs no claim statement");

  const { sql, params } = asQuery(statement).toSQL();
  assert.match(sql, /^insert into "persons"/);
  // The index predicate, repeated VERBATIM, so Postgres can prove the index
  // covers the statement.
  assert.match(
    sql,
    /on conflict \("church_id","user_id"\) where "persons"\."user_id" is not null do nothing/
  );
  assert.ok(params.includes(PLANT));
  assert.ok(params.includes(USER));
});

test("the match is case-insensitive, unclaimed, undeleted and deterministic", () => {
  // `findLinkablePersonId` is an awaited read, so its RULE is pinned here and
  // its behaviour in the live suite.
  assert.match(ACCOUNT_PERSON_LINK, /lower\(\$\{persons\.email\}\) = /);
  assert.match(ACCOUNT_PERSON_LINK, /isNull\(persons\.userId\)/);
  assert.match(ACCOUNT_PERSON_LINK, /isNull\(persons\.deletedAt\)/);
  assert.match(ACCOUNT_PERSON_LINK, /eq\(persons\.churchId, churchId\)/);
  assert.match(ACCOUNT_PERSON_LINK, /orderBy\(persons\.createdAt\)/);

  // And the register action resolves it for the invitation's own plant, never
  // for an address or a church a client named.
  assert.match(
    REGISTER_ACTIONS.code,
    /findLinkablePersonId\(\s*seatInvitation\.tenancy\.id,\s*identifier\s*\)/
  );

  // …AND ONLY WHEN THAT TENANCY IS A PLANT (#500). AS-013's match-or-create
  // asks a plant's directory about an address; a sending church and a network
  // have no directory to ask, so the read is not merely unused for them — it is
  // a question about somebody else's plant that must not be asked at all.
  assert.match(
    REGISTER_ACTIONS.code,
    /seatInvitation\.tenancy\.type === "church"/,
    "the person lookup must be gated on the invitation naming a church plant"
  );
});

// ----------------------------------------------------------------------------
// 9. REVOKE AND RESEND — the org surface's shape, not a second one
// ----------------------------------------------------------------------------

test("the seat actions answer in the org actions' own state types", () => {
  // The pending list renders both tables' rows through ONE component, so the
  // two actions must answer in the shape it reads. A second copy of
  // `ResendInvitationEmailState` is how the countdown starts working on one
  // surface and not the other.
  assert.match(
    TEAM_ACTIONS.code,
    /import type \{\s*ResendInvitationEmailState,\s*RevokeInvitationState,\s*\} from "@\/app\/\(dashboard\)\/oversight\/invitations\/actions"/
  );
  assert.doesNotMatch(
    TEAM_ACTIONS.code,
    /(?:type|interface)\s+ResendInvitationEmailState/
  );
  assert.doesNotMatch(
    TEAM_ACTIONS.code,
    /(?:type|interface)\s+RevokeInvitationState/
  );
});

test("the cooldown the seat surface reports is the org surface's arithmetic", () => {
  // ONE arithmetic feeds both the provider idempotency-key suffix and the
  // countdown (`memory/invariants.md` → Multi-Tenancy), and only DURATIONS
  // cross to the browser.
  const seatResend = TEAM_ACTIONS.span(
    "export async function resendSeatInvitationEmailAction",
    "export async function revokeSeatInvitationAction"
  );
  const orgResend = ORG_ACTIONS.after(
    "export async function resendInvitationEmailAction"
  );

  const cooldown =
    /cooldown: \{\s*window: result\.resendWindow\.index,\s*remainingMs: result\.resendWindow\.remainingMs,\s*\}/;
  assert.match(seatResend, cooldown);
  assert.match(orgResend, cooldown);

  // The logic layer hands back the shared window, keyed to the SAME instant the
  // provider occasion was keyed with.
  assert.match(
    SEAT.code,
    /return \{ emailSent: true, resendWindow: resendDedupeWindowAt\(now\) \}/
  );
  const window = resendDedupeWindowAt(new Date("2026-08-20T12:00:30.000Z"));
  assert.equal(window.remainingMs, 30_000);
  assert.ok(
    window.remainingMs > 0 && window.remainingMs <= RESEND_DEDUPE_WINDOW_MS
  );
});

test("two rotations inside one bucket present two provider keys (#495 r1)", () => {
  // THE BLOCKER THIS TEST EXISTS FOR. The org path suffixes a resend key with
  // the 60-second window index, which is safe there because the credential is
  // the row's uuid and never changes. Copied here it BRICKED the invitation:
  // two resends inside one bucket presented one key, the provider returned the
  // cached response for the first, `sent: true` came back, no second message
  // left — and the database was left holding the digest of a link nobody had.
  //
  // The suffix is the ROTATION now, so the key is unique exactly when the
  // message is.
  const invitation = INVITATION;
  const first = seatInvitationEmailIdempotencyKey(invitation, {
    kind: "resend",
    rotationId: "rotation-a",
  });
  const second = seatInvitationEmailIdempotencyKey(invitation, {
    kind: "resend",
    rotationId: "rotation-b",
  });

  assert.notEqual(first, second);
  // Still invitation-scoped, so a re-invitation after a revoke is a different
  // row, a different id and a different key.
  assert.ok(first.startsWith(`seat-invitation-${invitation}-resend-`));
  // A retried CREATE still collapses — that one really is the same message.
  assert.equal(
    seatInvitationEmailIdempotencyKey(invitation),
    seatInvitationEmailIdempotencyKey(invitation, { kind: "create" })
  );
  assert.notEqual(seatInvitationEmailIdempotencyKey(invitation), first);

  // And the clock plays no part in it: the occasion has no `at` to read.
  assert.doesNotMatch(SEAT_EMAIL, /resendDedupeWindowAt/);
  assert.match(
    SEAT.code,
    /occasion: \{ kind: "resend", rotationId: randomUUID\(\) \}/
  );
});

test("a refused resend puts the old digest back, so the live link survives", () => {
  const resend = SEAT.after(
    "export async function resendUserInvitationEmailAs"
  );

  // The restore is a compare-and-set on the digest THIS call wrote, so it
  // cannot clobber a rotation that raced past it.
  assertInOrder(
    resend,
    "resendUserInvitationEmailAs",
    [
      "const rotatedHash = hashUserInvitationToken(token)",
      "if (!outcome.sent)",
      "set({ tokenHash: invitation.tokenHash })",
      "eq(userInvitations.tokenHash, rotatedHash)",
      "throw new InvitationError(resendRefusalMessage(outcome.reason))",
    ],
    "the rotation commits before the send is proven, so a refused send would otherwise kill the link the invitee already holds and deliver nothing to replace it"
  );
});

test("the register lookup does not swallow a database failure (#495 r1)", () => {
  // A blanket `catch { return null }` here cannot catch anything but a database
  // error — hashing a string does not throw — and `register` reads that null as
  // "no invitation", creating a cold-planter account with `seat: "owner"` and no
  // plant. `users_email_unique` then holds the address and AS-010 refuses to
  // re-invite it, so a transient blip becomes a permanent wrong outcome.
  const lookup = SEAT.span(
    "export async function describeUserInvitationForRegistration",
    "export function userInvitationActedOnAtRegistration"
  );

  assert.doesNotMatch(lookup, /catch/);
  assert.match(
    lookup,
    /eq\(\s*userInvitations\.tokenHash,\s*hashUserInvitationToken\(candidate\)\s*\)/
  );
});

test("the expiry sweep compares through the typed helper, not a template", () => {
  // `expires_at` is `timestamp` WITHOUT time zone. A `Date` interpolated into a
  // `sql` template bypasses the column's driver mapping: the offset is
  // serialised and then discarded by the cast, so on any non-UTC host the sweep
  // is wrong by that offset.
  const sweep = SEAT.after("export async function expireLapsedUserInvitations");
  assert.match(sweep, /lt\(userInvitations\.expiresAt, now\)/);
  assert.doesNotMatch(sweep, /sql`/);
});

test("a failed resend is a failed action, in the org path's own words", () => {
  const resend = SEAT.after(
    "export async function resendUserInvitationEmailAs"
  );
  assert.match(
    resend,
    /throw new InvitationError\(resendRefusalMessage\(outcome\.reason\)\)/
  );
  assert.match(
    resend,
    /throw new InvitationError\(resendRefusalMessage\("not_pending"\)\)/
  );
  // A lapsed row is expired rather than emailed with a link registration is
  // guaranteed to reject — and the refusal WRITES.
  assert.match(resend, /set\(\{ status: "expired" \}\)/);
});

test('"no such invitation" and "not yours" are ONE message', () => {
  // An invitation id is also an unauthenticated bearer token on the org path;
  // here it is not, but telling the two apart would still turn any seated
  // account into a reader of which invitation ids exist.
  const revoke = SEAT.span(
    "export async function revokeUserInvitationAs",
    "export async function resendUserInvitationEmailAs"
  );
  const refusals = [
    ...revoke.matchAll(/throw new InvitationError\(([^)]*)\)/g),
  ].map((match) => match[1]);
  assert.deepEqual(new Set(refusals), new Set(["INVITATION_NOT_OURS_MESSAGE"]));

  // The authority is the WHERE, and it is one predicate shared by the list, the
  // revoke and the resend — so the three can never disagree about "ours".
  assert.match(SEAT.code, /function oursFilter\(actor: InvitationActor\)/);
  for (const reader of [
    "export async function listUserInvitationsFor",
    "async function loadOurs",
    "export async function revokeUserInvitationAs",
    "export async function expireLapsedUserInvitations",
  ]) {
    assert.match(
      SEAT.after(reader).slice(0, 700),
      /oursFilter\(actor\)/,
      reader
    );
  }
});

test("the pending list on /settings/team is the org surface's component", () => {
  // Which is what makes "the resend suite's shape, mirroring the org surface's"
  // a fact rather than a promise: the countdown, the disabled window and the
  // accessible names are ONE implementation, given this page's own two actions.
  assert.match(TEAM_PAGE, /from "@\/components\/oversight\/invitations-list"/);
  assert.match(TEAM_PAGE, /resend: resendSeatInvitationEmailAction/);
  assert.match(TEAM_PAGE, /revoke: revokeSeatInvitationAction/);
  // …and it lists this plant's rows only, with no route param or query string
  // anywhere on the screen naming a plant.
  assert.match(TEAM_PAGE, /listUserInvitationsFor\(actor\)/);
  assert.doesNotMatch(TEAM_PAGE, /searchParams/);
  assert.doesNotMatch(TEAM_PAGE, /params/);
});

// ----------------------------------------------------------------------------
// 10. THE MIGRATION — the CHECKs are in the DDL, and 0054 is really next
// ----------------------------------------------------------------------------

test("the two invariants AS-010 names are CHECKs in the migration", () => {
  // Executed against a real Postgres in `./seat-invitations-live.test.ts`;
  // asserted here so a DDL edit that drops one fails without a container.
  assert.match(
    MIGRATION,
    /CONSTRAINT "user_invitations_tenancy_check" CHECK \(num_nonnulls\("user_invitations"\."church_id", "user_invitations"\."sending_church_id", "user_invitations"\."sending_network_id"\) = 1\)/
  );
  // THE BICONDITIONAL SPELLING, PINNED, because the two-arm one is the shape
  // that silently admits the row (`true and NULL` is `NULL`, and a CHECK
  // rejects only `false`). A future edit back to the readable-looking form
  // fails here, and the live suite proves the constraint by writing the row.
  assert.match(
    MIGRATION,
    /CONSTRAINT "user_invitations_seat_check" CHECK \(\("user_invitations"\."kind" = 'seat'\) = \("user_invitations"\."seat" is not null\) and \("user_invitations"\."seat" is null or "user_invitations"\."seat" in \('admin', 'member'\)\)\)/
  );
  assert.doesNotMatch(
    MIGRATION,
    /'seat' and "user_invitations"\."seat" in/,
    "the seat CHECK is back to the two-arm spelling, which accepts kind='seat' with a null seat"
  );
  // `owner` is not an invitable seat, and the DDL says so rather than deferring
  // to `users_seat_check`.
  assert.doesNotMatch(MIGRATION, /'owner'/);
});

test("0054 sits where its own header says it does", () => {
  // The journal's GENERAL properties — strictly increasing `when` and `idx`,
  // and the silent-skip hazard behind them — moved to
  // `src/db/migrations.test.ts` (#592), which owns the folder. What stays here
  // is the half that is about 0054: where it sits, and that its header names
  // its own ledger row.
  const mine = JOURNAL.entries.find(
    (entry) => entry.tag === "0054_user_invitations"
  );

  assert.ok(mine, "the journal has no 0054_user_invitations entry");
  assert.equal(mine.idx, 54);

  // The rollback header names the ledger row by that same `when`, not by a file
  // hash — the correction 0036's header records.
  assert.match(
    MIGRATION,
    new RegExp(
      `DELETE FROM drizzle\\.__drizzle_migrations WHERE created_at = ${mine.when};`
    )
  );
});

// ----------------------------------------------------------------------------
// 11. THE WORDS FOR A SEAT ARE A TABLE, NOT A COMPARISON
// ----------------------------------------------------------------------------

test("every invitable seat has copy, and nothing branches to get it", () => {
  // FIVE KEYS SINCE #500, and the two new ones are the PAIR: what they are
  // invited to be, and where. An Admin in a church plant and an Admin in a
  // network do different things, so the table forks on the tenancy rather than
  // picking one of the two sentences and being wrong for the other half of the
  // product.
  assert.deepEqual(Object.keys(INVITED_AS_COPY).sort(), [
    "admin",
    "coach",
    "member",
    "org_admin",
    "org_member",
  ]);
  assert.equal(
    invitedAsWithArticle({ kind: "seat", seat: "admin" }, "church"),
    "an Admin"
  );
  assert.equal(
    invitedAsWithArticle({ kind: "seat", seat: "member" }, "church"),
    "a Member"
  );

  // THE LABEL IS THE SEAT'S EITHER WAY — an org Admin is still "an Admin". What
  // the org keys change is what accepting MEANS, not what the seat is called,
  // so an invitee reads one vocabulary across the product.
  for (const tenancyType of ["sending_church", "network"] as const) {
    assert.equal(
      invitedAsWithArticle({ kind: "seat", seat: "admin" }, tenancyType),
      "an Admin"
    );
    assert.equal(
      invitedAsWithArticle({ kind: "seat", seat: "member" }, tenancyType),
      "a Member"
    );
  }

  // …AND WHAT ACCEPTING MEANS IS DIFFERENT, which is the whole reason for the
  // fork. A plant seat is described in terms of the plant's own work; an org
  // seat in terms of the plants it oversees.
  assert.notEqual(
    INVITED_AS_COPY.member.accepting,
    INVITED_AS_COPY.org_member.accepting
  );
  assert.match(
    INVITED_AS_COPY.org_member.accepting,
    /read-only/,
    "an org Member's sentence has to state the limit — every read, no writes (ruling 185 (3))"
  );

  // Coach is a key and not a seat: the union's coach arm carries no seat, so
  // nothing can read one off it (#496). The tenancy is not consulted for one —
  // `coach.assignment.manage` is plant-only, so an org coach cannot exist.
  assert.equal(invitedAsWithArticle({ kind: "coach" }, "church"), "a Coach");
  assert.equal(invitedAsWithArticle({ kind: "coach" }, "network"), "a Coach");

  // The reason it is a table: `seat-guard.test.ts` bans a hand-written seat
  // comparison outside the permissions module, and it bans it even where the
  // branch is only copy — a reader cannot tell an authority rule from a noun by
  // looking at it.
  for (const [where, code] of [
    ["seat-copy.ts", stripComments(read("lib", "invitations", "seat-copy.ts"))],
    [
      "the seat invitation email",
      stripComments(read("lib", "email", "templates", "seat-invitation.tsx")),
    ],
    [
      "the register form",
      stripComments(read("app", "(auth)", "register", "register-form.tsx")),
    ],
  ] as const) {
    assert.doesNotMatch(code, /seat\s*(?:===|!==)\s*["']/, where);
  }
});
