import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { assertBatchedWrites } from "@/lib/testing/db-atomicity";
import { assertInOrder, sourceReader } from "@/lib/testing/source-span";

import type { AttemptLimiter } from "./attempt-limiter";
import { changeOwnPassword } from "./password-change";
import { hashPassword, verifyPassword } from "./password";
import {
  CURRENT_PASSWORD_WRONG_MESSAGE,
  MIN_PASSWORD_LENGTH,
  PASSWORD_CHANGE_RATE_LIMITED_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORD_UNCHANGED_MESSAGE,
} from "./password-policy";
import { checkRateLimit, type FailureCounter } from "./rate-limit";
import { authAttempts } from "@/db/schema";

// ============================================================================
// CS-003 / CS-005 — a password change with a wrong current password is refused,
// and repeated attempts meet the guard sign-in meets (#616).
//
// EVERY REFUSAL BELOW EXECUTES FOR REAL. `changeOwnPassword` refuses before it
// reaches its `db.batch`, so the whole refusal surface is reachable with no
// database — argon2 runs, the real `checkRateLimit` runs, and the only thing
// standing in for production is WHERE the attempts are counted
// (`AttemptLimiter`, whose default is the `auth_attempts` table).
//
// THE SUCCESS PATH IS THE ONE THING SOURCE HAS TO ANSWER FOR: it writes, and a
// unit test's process cannot. So its two properties are asserted over the
// function body — that the rotation and the session revocation are ONE batch
// (`memory/invariants.md` → Transactions), and that the success is recorded so
// the identifier's failed rows are cleared (ruled 405-4b).
// ============================================================================

const SOURCE = readFileSync(
  path.join(process.cwd(), "src/lib/auth/password-change.ts"),
  "utf8"
);
const READER = sourceReader(SOURCE, "password-change.ts");
const BODY = READER.after("export async function changeOwnPassword");

const REAL_PASSWORD = "correct horse battery";
const ACCOUNT_EMAIL = "Planter@Example.com";
const SESSION_ID = "session-abc";
const IP = "203.0.113.9";

/** The account row the flow is handed. Its hash is a REAL argon2 hash. */
async function actor() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: ACCOUNT_EMAIL,
    passwordHash: await hashPassword(REAL_PASSWORD),
  };
}

interface Recorded {
  identifier: string;
  ip: string | null;
  kind: string;
  success: boolean;
  at: number;
}

/**
 * The shared guard over an in-memory attempt list — the REAL `checkRateLimit`
 * and a real record, so the flow's own calls are what drive the window.
 */
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

function attempt(
  overrides: Partial<Parameters<typeof changeOwnPassword>[0]> & {
    limiter: AttemptLimiter;
  }
) {
  return changeOwnPassword({
    currentSessionId: SESSION_ID,
    currentPassword: REAL_PASSWORD,
    newPassword: "a different password",
    ip: IP,
    ...overrides,
  } as Parameters<typeof changeOwnPassword>[0]);
}

test("a wrong current password is refused, and it names the field", async () => {
  const { limiter, log } = limiterWithLog();

  const outcome = await attempt({
    actor: await actor(),
    currentPassword: "not the password",
    limiter,
  });

  assert.deepEqual(outcome, {
    ok: false,
    field: "currentPassword",
    message: CURRENT_PASSWORD_WRONG_MESSAGE,
  });

  // AND IT IS COUNTED. A refusal that left no attempt behind would be a guess
  // the guard never sees, which is the whole of CS-005 on this path.
  assert.deepEqual(log, [
    {
      identifier: "planter@example.com",
      ip: IP,
      kind: "password_change",
      success: false,
      at: log[0].at,
    },
  ]);
});

test("the identifier recorded is the account's own address, lowercased", async () => {
  const { limiter, log } = limiterWithLog();

  await attempt({
    actor: await actor(),
    currentPassword: "wrong",
    limiter,
  });

  assert.equal(
    log[0].identifier,
    "planter@example.com",
    "`users.email` is stored lowercased and the guard keys on it — a mixed-case identifier would count in its own bucket"
  );
});

test("repeated wrong passwords drive the shared window to refusal", async () => {
  const { limiter } = limiterWithLog();
  const account = await actor();

  // The first five are refused for being wrong…
  for (let i = 0; i < 5; i += 1) {
    const outcome = await attempt({
      actor: account,
      currentPassword: `guess-${i}`,
      limiter,
    });
    assert.equal(outcome.ok, false);
    assert.equal(
      outcome.ok === false && outcome.field,
      "currentPassword",
      `attempt ${i + 1} should still be answering about the password`
    );
  }

  // …and the sixth never reaches argon2 at all: the guard refuses first, with
  // no field, because the failure is no longer about anything that was typed.
  const sixth = await attempt({
    actor: account,
    currentPassword: REAL_PASSWORD,
    limiter,
  });

  assert.deepEqual(sixth, {
    ok: false,
    field: null,
    message: PASSWORD_CHANGE_RATE_LIMITED_MESSAGE,
  });
});

test("the guard runs BEFORE argon2, so a limited caller costs no hash", async () => {
  const { limiter } = limiterWithLog();
  const account = await actor();

  for (let i = 0; i < 5; i += 1) {
    await attempt({ actor: account, currentPassword: "no", limiter });
  }

  // A garbage hash: `verifyPassword` would answer `false` rather than throw, so
  // the proof is in the MESSAGE — a refusal about the password would mean the
  // comparison happened after the guard had already said no.
  const outcome = await attempt({
    actor: { ...account, passwordHash: "not-a-hash" },
    limiter,
  });

  assert.equal(
    outcome.ok === false && outcome.message,
    PASSWORD_CHANGE_RATE_LIMITED_MESSAGE
  );
});

test("a short new password is refused by field, and costs no attempt", async () => {
  const { limiter, log } = limiterWithLog();

  const outcome = await attempt({
    actor: await actor(),
    newPassword: "x".repeat(MIN_PASSWORD_LENGTH - 1),
    limiter,
  });

  assert.deepEqual(outcome, {
    ok: false,
    field: "newPassword",
    message: PASSWORD_TOO_SHORT_MESSAGE,
  });
  assert.deepEqual(
    log,
    [],
    "a password the reader typed too short is a typo, not an attempt on the account"
  );
});

test("re-using the current password is refused — and only after it is proven", async () => {
  const { limiter } = limiterWithLog();

  const outcome = await attempt({
    actor: await actor(),
    newPassword: REAL_PASSWORD,
    limiter,
  });

  assert.deepEqual(outcome, {
    ok: false,
    field: "newPassword",
    message: PASSWORD_UNCHANGED_MESSAGE,
  });
});

test("the same-password refusal is not an oracle for a caller who does not know it", async () => {
  const { limiter } = limiterWithLog();

  // Somebody probing: they submit a guess as BOTH fields. If the "already using
  // it" check ran first, a correct guess would be distinguishable from a wrong
  // one without ever proving the password.
  const outcome = await attempt({
    actor: await actor(),
    currentPassword: "a wrong guess",
    newPassword: "a wrong guess",
    limiter,
  });

  assert.equal(
    outcome.ok === false && outcome.message,
    CURRENT_PASSWORD_WRONG_MESSAGE,
    "the current-password check must answer first"
  );
});

test("argon2 really is what decides — the right password gets past every refusal", async () => {
  // The guard against a test that passes because everything is refused: prove
  // the real hash verifies, so the refusals above are about their own subjects.
  const account = await actor();
  assert.equal(await verifyPassword(account.passwordHash, REAL_PASSWORD), true);
  assert.equal(
    await verifyPassword(account.passwordHash, "something else"),
    false
  );
});

// ----------------------------------------------------------------------------
// The success path — properties of source, because it writes
// ----------------------------------------------------------------------------

test("the rotation and the session revocation are ONE batch", () => {
  assertBatchedWrites(BODY, "changeOwnPassword");
});

test("the caller's own session is the one kept, by id", () => {
  assert.match(
    BODY,
    /ne\(sessions\.id, currentSessionId\)/,
    "every other session ends; the tab doing the asking must not, or the confirmation is unreadable"
  );
  assert.match(
    BODY,
    /eq\(sessions\.userId, actor\.id\)/,
    "the revocation is scoped to this account — a missing scope signs out the product"
  );
});

test("the order is guard, shape, secret, write, record", () => {
  assertInOrder(
    BODY,
    "password-change.ts",
    [
      'limiter.check(identifier, ip, "password_change")',
      "newPassword.length < MIN_PASSWORD_LENGTH",
      "verifyPassword(actor.passwordHash, currentPassword)",
      "await db.batch([",
      'limiter.record(identifier, ip, "password_change", true)',
    ],
    "the guard must precede argon2 (CPU), the secret must precede the write, and the success must be recorded so the identifier's failed rows are cleared (ruled 405-4b)"
  );
});
