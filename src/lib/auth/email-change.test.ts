import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { authAttempts } from "@/db/schema";
import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

import type { AttemptLimiter } from "./attempt-limiter";
import {
  consumeRequestStatement,
  EMAIL_CHANGE_INVALID_ADDRESS_MESSAGE,
  EMAIL_CHANGE_LINK_DEAD_MESSAGE,
  EMAIL_CHANGE_RATE_LIMITED_MESSAGE,
  EMAIL_CHANGE_SAME_ADDRESS_MESSAGE,
  requestEmailChange,
  supersedeLiveRequestsStatement,
  swapLoginIdentifierStatement,
} from "./email-change";
import {
  buildEmailChangeNotice,
  buildEmailChangeVerification,
  type EmailChangeMessage,
} from "./email-change-email";
import {
  EMAIL_CHANGE_EXPIRY_HOURS,
  emailChangeVerifyPath,
  hashEmailChangeToken,
  isMailableAddress,
  newEmailChangeToken,
  normalizeAccountEmail,
} from "./email-change-token";
import { hashPassword } from "./password";
import { CURRENT_PASSWORD_WRONG_MESSAGE } from "./password-policy";
import { checkRateLimit, type FailureCounter } from "./rate-limit";

// ============================================================================
// CS-002 — an address change is asked for, mailed to the NEW address, and only
// becomes the login identifier when the link comes back (#616).
//
// THREE LAYERS, EACH PROVEN THE WAY IT CAN BE:
//
//   1. THE TOKEN AND THE ADDRESS — pure, so they simply execute.
//   2. THE REQUEST'S REFUSALS — every one lands before the `db.batch`, so with
//      the attempt store injected (`AttemptLimiter`, default: `auth_attempts`)
//      they execute too, against a real argon2 hash.
//   3. THE SWAP — it writes, so a unit test cannot run it. Its two statements
//      are exported builders and their GENERATED SQL is asserted here: the
//      claim's predicate, and the compare-and-set that re-asserts the address
//      being moved off. Reading the SQL is not a proxy for the rule — it IS the
//      rule, in the form the database will be handed.
//
// AND THE SENDS ARE ASSERTED AT THE SEAM. `buildEmailChange*` render the real
// templates, so "the link goes to the new address" and "the old address is told,
// and the notice names the change" are read off the messages themselves.
// ============================================================================

const SOURCE = readFileSync(
  path.join(process.cwd(), "src/lib/auth/email-change.ts"),
  "utf8"
);
const READER = sourceReader(SOURCE, "email-change.ts");

const PASSWORD = "correct horse battery";
const CURRENT_EMAIL = "Planter@Example.com";
const NEW_EMAIL = "new.address@example.org";
const IP = "203.0.113.11";
const USER_ID = "11111111-1111-4111-8111-111111111111";

async function actor() {
  return {
    id: USER_ID,
    email: CURRENT_EMAIL,
    name: "Bryan",
    passwordHash: await hashPassword(PASSWORD),
  };
}

interface Recorded {
  identifier: string;
  ip: string | null;
  kind: string;
  success: boolean;
  at: number;
}

/** The REAL guard over an in-memory attempt list — see `rate-limit.test.ts`. */
function limiterWithLog(): { limiter: AttemptLimiter; log: Recorded[] } {
  const log: Recorded[] = [];
  const count: FailureCounter = async (column, value, kind, windowMs) => {
    const since = Date.now() - windowMs;
    const axis = column === authAttempts.identifier ? "identifier" : "ip";
    return log.filter(
      (row) =>
        row[axis] === value &&
        row.kind === kind &&
        !row.success &&
        row.at > since
    ).length;
  };

  return {
    log,
    limiter: {
      check: (identifier, ip, kind) =>
        checkRateLimit(identifier, ip, kind, count),
      record: async (identifier, ip, kind, success) => {
        log.push({
          identifier: identifier.toLowerCase(),
          ip,
          kind,
          success,
          at: Date.now(),
        });
      },
    },
  };
}

// ----------------------------------------------------------------------------
// 1. The token and the address
// ----------------------------------------------------------------------------

test("a token is 256 bits of base64url, and never repeats", () => {
  const tokens = new Set(
    Array.from({ length: 200 }, () => newUserFacingToken())
  );
  assert.equal(tokens.size, 200, "two tokens collided — that is not a CSPRNG");

  for (const token of tokens) {
    assert.match(
      token,
      /^[A-Za-z0-9_-]+$/,
      "base64url survives a query string"
    );
    // 32 bytes → 43 base64url characters, unpadded.
    assert.equal(token.length, 43);
  }
});

function newUserFacingToken(): string {
  return newEmailChangeToken();
}

test("what the database stores is a digest — the token cannot be read back out", () => {
  const token = newEmailChangeToken();
  const digest = hashEmailChangeToken(token);

  assert.match(digest, /^[0-9a-f]{64}$/, "sha256 hex fills the column's width");
  assert.notEqual(digest, token);
  assert.ok(
    !digest.includes(token) && !token.includes(digest),
    "a database read must hand nobody a working link"
  );
  assert.equal(
    hashEmailChangeToken(token),
    digest,
    "the same token must resolve to the same point read"
  );
});

test("the confirmation path escapes its token", () => {
  // base64url never produces one, but the path builder must not be the thing
  // that assumes so — it is the ONE spelling both the email and the page use.
  assert.equal(
    emailChangeVerifyPath("a+b/c=d"),
    "/verify-email?token=a%2Bb%2Fc%3Dd"
  );
  assert.match(
    emailChangeVerifyPath(newEmailChangeToken()),
    /^\/verify-email\?token=/
  );
});

test("an address is normalised the way `users.email` is stored", () => {
  assert.equal(
    normalizeAccountEmail("  Planter@Example.COM "),
    "planter@example.com"
  );
});

test("what we will and will not mail", () => {
  assert.equal(isMailableAddress("planter@example.com"), true);
  assert.equal(isMailableAddress("first.last+tag@sub.example.co.uk"), true);
  assert.equal(isMailableAddress("no-at-sign"), false);
  assert.equal(isMailableAddress("two@@example.com"), false);
  assert.equal(isMailableAddress("no@domain"), false);
  assert.equal(isMailableAddress("has space@example.com"), false);
  assert.equal(
    isMailableAddress(`${"x".repeat(250)}@example.com`),
    false,
    "the column is varchar(255) — a longer address would be truncated or rejected by the driver"
  );
});

// ----------------------------------------------------------------------------
// 2. The request's refusals — all of them before any write
// ----------------------------------------------------------------------------

async function ask(
  overrides: Record<string, unknown> & { limiter: AttemptLimiter }
) {
  return requestEmailChange({
    actor: await actor(),
    requestedEmail: NEW_EMAIL,
    currentPassword: PASSWORD,
    ip: IP,
    ...overrides,
  } as Parameters<typeof requestEmailChange>[0]);
}

test("a malformed address is refused by field, and costs no attempt", async () => {
  const { limiter, log } = limiterWithLog();

  assert.deepEqual(await ask({ requestedEmail: "not-an-address", limiter }), {
    ok: false,
    field: "email",
    message: EMAIL_CHANGE_INVALID_ADDRESS_MESSAGE,
  });
  assert.deepEqual(log, [], "a typo is not an attempt on the account");
});

test("asking for the address you already have is refused by field", async () => {
  const { limiter } = limiterWithLog();

  assert.deepEqual(
    // Mixed case, to prove the comparison is on the normalised value.
    await ask({ requestedEmail: "PLANTER@example.com", limiter }),
    {
      ok: false,
      field: "email",
      message: EMAIL_CHANGE_SAME_ADDRESS_MESSAGE,
    }
  );
});

test("a wrong current password is refused, named, and counted", async () => {
  const { limiter, log } = limiterWithLog();

  assert.deepEqual(await ask({ currentPassword: "wrong", limiter }), {
    ok: false,
    field: "currentPassword",
    message: CURRENT_PASSWORD_WRONG_MESSAGE,
  });
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, "email_change");
  assert.equal(log[0].success, false);
  assert.equal(
    log[0].identifier,
    "planter@example.com",
    "the guard keys on the account's own address, never on the address being asked for"
  );
});

test("a borrowed session alone cannot move the login identifier", async () => {
  const { limiter } = limiterWithLog();

  // The whole point of demanding the password here: everything a stolen cookie
  // supplies is present and correct, and it still gets nowhere.
  const outcome = await ask({ currentPassword: "", limiter });

  assert.equal(outcome.ok, false);
  assert.equal(
    outcome.ok === false && outcome.field,
    "currentPassword",
    "an empty password must not read as 'no password required'"
  );
});

test("repeated asks drive the shared window to refusal", async () => {
  const { limiter } = limiterWithLog();

  for (let i = 0; i < 3; i += 1) {
    const outcome = await ask({ currentPassword: `guess-${i}`, limiter });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.field, "currentPassword");
  }

  assert.deepEqual(await ask({ limiter }), {
    ok: false,
    field: null,
    message: EMAIL_CHANGE_RATE_LIMITED_MESSAGE,
  });
});

// ----------------------------------------------------------------------------
// 3. The swap — the SQL the database will be handed
// ----------------------------------------------------------------------------

const NOW = new Date("2026-08-22T09:00:00.000Z");

test("the claim is single-use AND inside the window", () => {
  const { sql, params } = consumeRequestStatement("req-1", NOW).toSQL();

  assert.match(sql, /update "email_change_requests"/);
  assert.match(sql, /"consumed_at" = \$\d/, "the claim sets the marker");
  assert.match(
    sql,
    /"consumed_at" is null/,
    "…only while the row is still live"
  );
  assert.match(
    sql,
    /"expires_at" > \$\d/,
    "…and only inside the window — the earlier read is a separate round trip, so a row that expired between the two must not redeem"
  );
  assert.match(
    sql,
    /returning "id"/,
    "the rowcount is what says who won the token"
  );
  assert.ok(params.includes("req-1"));
});

test("the swap re-asserts the address it is moving off", () => {
  const { sql, params } = swapLoginIdentifierStatement(
    USER_ID,
    "planter@example.com",
    NEW_EMAIL,
    NOW
  ).toSQL();

  assert.match(sql, /update "users" set "email" = \$\d/);
  assert.match(sql, /"users"\."id" = \$\d/);
  assert.match(
    sql,
    /"users"\."email" = \$\d/,
    "a compare-and-set on the row being changed — without it a replay re-applies a swap whose starting point has moved"
  );
  assert.ok(params.includes("planter@example.com"));
  assert.ok(params.includes(NEW_EMAIL));
});

test("the supersede is scoped to the account and to LIVE rows only", () => {
  const { sql, params } = supersedeLiveRequestsStatement(USER_ID, NOW).toSQL();

  assert.match(sql, /"user_id" = \$\d/);
  assert.match(
    sql,
    /"consumed_at" is null/,
    "already-settled rows must not be re-stamped — `consumed_at` is when the token died"
  );
  assert.ok(params.includes(USER_ID));
});

test("the confirm's order is claim first, then the dependent swap", () => {
  const body = READER.span(
    "export async function confirmEmailChange",
    "// THE OLD ADDRESS IS TOLD"
  );

  assertInOrder(
    body,
    "email-change.ts",
    [
      'limiter.check(previousEmail, ip, "email_change")',
      "hashEmailChangeToken(token)",
      "consumeRequestStatement(request.id, now)",
      "swapLoginIdentifierStatement(",
    ],
    "memory/invariants.md → Transactions: in a batch the compare-and-set goes FIRST and the dependent write re-asserts what the claim set"
  );

  assert.match(
    body,
    /isUniqueViolation\(error, "users_email_unique"\)/,
    "whether the new address is free is decided by the unique index, at redemption — see the module header"
  );
});

test("the request supersedes BEFORE it inserts — the partial index refuses the other order", () => {
  const body = READER.span(
    "export async function requestEmailChange",
    "export type EmailChangeConfirmOutcome"
  );

  // The refusals, then the write. `limiter.record(..., false)` is deliberately
  // NOT an anchor here: it occurs twice — once on the wrong-password refusal and
  // once on the way out — and `assertInOrder` resolves first occurrences.
  assertInOrder(
    body,
    "email-change.ts",
    [
      'limiter.check(identifier, ip, "email_change")',
      "isMailableAddress(newEmail)",
      "verifyPassword(actor.passwordHash, currentPassword)",
      "supersedeLiveRequestsStatement(actor.id, now)",
      "db.insert(emailChangeRequests)",
      "sendEmailChangeVerification(",
    ],
    "email_change_requests_live_user_unique_idx is partial on consumed_at IS NULL, so a second live row cannot commit; and the mail must follow the durable row"
  );

  // The tail on its own, so the SECOND record is the one being read.
  assertInOrder(
    READER.after("const token = newEmailChangeToken()"),
    "email-change.ts",
    [
      "db.insert(emailChangeRequests)",
      "sendEmailChangeVerification(",
      'limiter.record(identifier, ip, "email_change", false)',
    ],
    "an outstanding request is an attempt that has not succeeded — recorded after the row exists, so a failed write leaves no phantom attempt behind"
  );
});

test("a link with no token at all gets the same sentence, from the page", () => {
  // The fifth dead case, and it is the page's rather than the action's: a URL
  // with no `?token=` never reaches `confirmEmailChange`. It must still read as
  // the same dead link, or the product has two vocabularies for one situation.
  const page = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/verify-email/page.tsx"),
    "utf8"
  );

  assert.ok(
    page.includes("EMAIL_CHANGE_LINK_DEAD_MESSAGE"),
    "the page must render the shared constant, never a sentence of its own"
  );
  assert.match(
    EMAIL_CHANGE_LINK_DEAD_MESSAGE,
    /ask for the change again/i,
    "the one sentence has to carry the remedy, because it is all five cases' only answer"
  );
});

test("every dead-link case gets the one sentence", () => {
  // COMMENTS STRIPPED: the guard's own docblock NAMES the constant to explain
  // the rule, so counting over the raw source would count the explanation and
  // make documenting the rule break the test that enforces it.
  const body = stripComments(
    READER.span(
      "export async function confirmEmailChange",
      "const newEmail = request.newEmail"
    )
  );

  for (const clause of [
    "!request",
    "request.userId !== actor.id",
    "request.consumedAt !== null",
    "request.expiresAt.getTime() <= now.getTime()",
  ]) {
    assert.ok(
      body.includes(clause),
      `the dead-link guard must still cover \`${clause}\` — a case that falls through is a token that opens something`
    );
  }

  assert.equal(
    body.match(/EMAIL_CHANGE_LINK_DEAD_MESSAGE/g)?.length,
    1,
    "one refusal for all four, so nothing here reports on a row the reader may have no claim to"
  );
});

// ----------------------------------------------------------------------------
// The two messages, at the email-service seam
// ----------------------------------------------------------------------------

const BASE_URL = "https://app.everyfield.test";

async function verification(): Promise<EmailChangeMessage> {
  return buildEmailChangeVerification(
    {
      to: NEW_EMAIL,
      currentEmail: "planter@example.com",
      recipientName: "Bryan",
      token: "tok-en-value",
      expiresAt: new Date(NOW.getTime() + EMAIL_CHANGE_EXPIRY_HOURS * 3600_000),
    },
    BASE_URL
  );
}

test("the confirmation link goes to the NEW address, and carries the token", async () => {
  const message = await verification();

  assert.equal(
    message.to,
    NEW_EMAIL,
    "the link must reach the mailbox being proven"
  );
  assert.ok(
    message.html.includes(`${BASE_URL}/verify-email?token=tok-en-value`),
    "the absolute, token-bound URL — a relative href means nothing in an inbox"
  );
  assert.ok(
    message.text.includes("tok-en-value"),
    "the plain-text part carries the link too"
  );
});

test("the verification names the account it is about, and what ignoring it does", async () => {
  const { html, text } = await verification();

  assert.ok(html.includes("planter@example.com"), "whose account this is");
  assert.ok(html.includes(NEW_EMAIL), "where it would move to");
  assert.match(
    text,
    /Did not ask for this\?/,
    "the one question an unexpecting reader has"
  );
});

test("the provider key is the token's DIGEST, never the token", async () => {
  const message = await verification();

  assert.equal(
    message.idempotencyKey,
    `email-change-verify-${hashEmailChangeToken("tok-en-value")}`
  );
  assert.ok(
    !message.idempotencyKey.includes("tok-en-value"),
    "an idempotency key travels to a third party and a credential must not"
  );
});

test("two requests never share a provider key", async () => {
  const first = hashEmailChangeToken(newEmailChangeToken());
  const second = hashEmailChangeToken(newEmailChangeToken());
  assert.notEqual(
    first,
    second,
    "a shared key lets the provider swallow the second message and leaves the row holding a digest nobody received"
  );
});

test("the notice goes to the OLD address and names the change", async () => {
  const message = await buildEmailChangeNotice({
    to: "planter@example.com",
    newEmail: NEW_EMAIL,
    recipientName: "Bryan",
    changedAt: NOW,
  });

  assert.equal(message.to, "planter@example.com");
  assert.ok(
    message.html.includes(NEW_EMAIL),
    "the destination in full — a masked address leaves the reader nothing to act on"
  );
  assert.ok(message.html.includes("planter@example.com"));
  assert.match(message.subject, /sign-in address was changed/i);
  assert.match(message.text, /Did not do this\?/);
});

test("the notice carries no link and no token", async () => {
  const message = await buildEmailChangeNotice({
    to: "planter@example.com",
    newEmail: NEW_EMAIL,
    recipientName: null,
    changedAt: NOW,
  });

  assert.ok(
    !message.html.includes("/verify-email"),
    "the change has already happened — a control here is a control offered to whoever now holds the account"
  );
  assert.ok(!message.idempotencyKey.includes("verify"));
});

test("a nameless account still gets readable copy", async () => {
  const message = await buildEmailChangeNotice({
    to: "planter@example.com",
    newEmail: NEW_EMAIL,
    recipientName: "   ",
    changedAt: NOW,
  });

  assert.ok(
    !message.text.includes("undefined") && !message.text.includes("null"),
    "`users.name` is nullable — a blank one must not print as a word"
  );
  assert.ok(message.text.includes(NEW_EMAIL));
});
