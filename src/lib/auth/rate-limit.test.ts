import assert from "node:assert/strict";
import { test } from "node:test";

import { authAttempts, authAttemptKinds } from "@/db/schema";

import { checkRateLimit, type FailureCounter } from "./rate-limit";

// ============================================================================
// CS-005 — the email and password changes ride the SAME sliding-window guard
// sign-in rides, and the window really does drive to refusal (#616).
//
// WHAT IS UNDER TEST IS THE PRODUCTION POLICY, NOT A COPY OF IT. `checkRateLimit`
// takes its failure count as a parameter (`FailureCounter`) whose default is the
// `auth_attempts` query; everything else — which axes a kind is limited on, the
// thresholds, the window arithmetic, the order the axes are checked in — is the
// real function, executing. A neon-http client cannot answer a count without a
// live Postgres, so this seam is what makes the criterion checkable at all;
// without it the assertions below could only be about source text.
//
// THE STORE IS AN IN-MEMORY LIST OF ATTEMPTS with timestamps, and the counter
// applies the `windowMs` IT IS GIVEN. So "drive the window to refusal" is
// literally that: push failures, ask, push one more, ask again — and a failure
// old enough to have fallen out of the window stops counting because the real
// policy handed the fake a smaller `since`.
//
// WHAT THIS FILE DOES NOT RE-PROVE: that a successful attempt clears the
// identifier's failed rows (ruled 405-4b). That is `recordAttempt`'s, shipped
// with sign-in long before this issue, and re-implementing it in the fake would
// be exactly the second copy CS-005 forbids. What the flows OWE that behaviour
// is that they call `record(..., true)` on their success paths, and that is
// asserted where it happens — `email-change.test.ts` and `password-change.test.ts`.
// ============================================================================

/** One recorded attempt, as the table would hold it. */
interface Attempt {
  identifier: string;
  ip: string | null;
  kind: (typeof authAttemptKinds)[number];
  success: boolean;
  at: number;
}

/**
 * The production query's stand-in: same signature, same meaning, counting the
 * list instead of the table. The column identity is what says which axis is
 * being asked about — the real function passes `authAttempts.identifier` or
 * `authAttempts.ip`, so a policy that stopped checking one is visible here.
 */
function counterOver(rows: Attempt[], now: () => number): FailureCounter {
  return async (column, value, kind, windowMs) => {
    const since = now() - windowMs;
    const axis = column === authAttempts.identifier ? "identifier" : "ip";
    return rows.filter(
      (row) =>
        row[axis] === value &&
        row.kind === kind &&
        !row.success &&
        row.at > since
    ).length;
  };
}

const IDENTIFIER = "planter@example.com";
const IP = "203.0.113.7";

function failures(
  count: number,
  over: Partial<Attempt>,
  at: number
): Attempt[] {
  return Array.from({ length: count }, () => ({
    identifier: IDENTIFIER,
    ip: IP,
    kind: "login" as const,
    success: false,
    at,
    ...over,
  }));
}

test("the policy table is total over the attempt kinds — a new kind has no default", () => {
  // The compiler holds this (`Record<AuthAttemptKind, …>` in rate-limit.ts), and
  // the assertion is here so the CLOSED union is visible as a fact of the
  // product: these four and nothing else is what the guard knows how to answer.
  assert.deepEqual(
    [...authAttemptKinds],
    ["login", "register", "email_change", "password_change"]
  );
});

test("password_change drives to refusal on the identifier, at login's threshold", async () => {
  const rows: Attempt[] = [];
  const now = Date.now();
  const count = counterOver(rows, () => now);

  // Four wrong current passwords inside the window: still allowed through.
  rows.push(...failures(4, { kind: "password_change" }, now - 60_000));
  assert.deepEqual(
    await checkRateLimit(IDENTIFIER, IP, "password_change", count),
    { limited: false },
    "four failures is under the threshold"
  );

  // The fifth is the one that closes it.
  rows.push(...failures(1, { kind: "password_change" }, now - 60_000));
  assert.deepEqual(
    await checkRateLimit(IDENTIFIER, IP, "password_change", count),
    { limited: true },
    "the fifth failure in the window refuses the next attempt"
  );
});

test("the window SLIDES — failures older than it stop counting", async () => {
  const rows: Attempt[] = [];
  const now = Date.now();
  const count = counterOver(rows, () => now);

  // Five failures, but sixteen minutes ago. `password_change` shares login's
  // 15-minute window, so every one of them has fallen out of it.
  rows.push(...failures(5, { kind: "password_change" }, now - 16 * 60_000));

  assert.deepEqual(
    await checkRateLimit(IDENTIFIER, IP, "password_change", count),
    { limited: false },
    "a window that did not slide would still be refusing this caller"
  );
});

test("email_change drives to refusal on the identifier, at its own lower threshold", async () => {
  const rows: Attempt[] = [];
  const now = Date.now();
  const count = counterOver(rows, () => now);

  // An email-change REQUEST is recorded as an attempt that has not succeeded —
  // see `RATE_LIMITS`. Two outstanding requests in the hour are fine.
  rows.push(...failures(2, { kind: "email_change" }, now - 10 * 60_000));
  assert.deepEqual(
    await checkRateLimit(IDENTIFIER, IP, "email_change", count),
    { limited: false }
  );

  rows.push(...failures(1, { kind: "email_change" }, now - 10 * 60_000));
  assert.deepEqual(
    await checkRateLimit(IDENTIFIER, IP, "email_change", count),
    { limited: true },
    "the third unconfirmed request in the hour closes the window"
  );
});

test("email_change's window is an HOUR, not login's fifteen minutes", async () => {
  const rows: Attempt[] = [];
  const now = Date.now();
  const count = counterOver(rows, () => now);

  // Half an hour old: outside login's window, inside this one.
  rows.push(...failures(3, { kind: "email_change" }, now - 30 * 60_000));

  assert.deepEqual(
    await checkRateLimit(IDENTIFIER, IP, "email_change", count),
    { limited: true },
    "a 15-minute window here would let a spammer send four confirmation emails an hour to strangers"
  );
});

test("the IP axis refuses a caller whose own identifier is clean", async () => {
  const rows: Attempt[] = [];
  const now = Date.now();
  const count = counterOver(rows, () => now);

  // Ten different accounts, one IP, all asking to change their address. The
  // per-identifier count for the eleventh is zero.
  for (let i = 0; i < 10; i += 1) {
    rows.push(
      ...failures(
        1,
        { kind: "email_change", identifier: `person${i}@example.com` },
        now - 5 * 60_000
      )
    );
  }

  assert.deepEqual(
    await checkRateLimit("fresh@example.com", IP, "email_change", count),
    { limited: true },
    "the per-IP axis is what stops one host walking a list of addresses"
  );
});

test("the kinds do not pool — sign-in failures never refuse a password change", async () => {
  const rows: Attempt[] = [];
  const now = Date.now();
  const count = counterOver(rows, () => now);

  rows.push(...failures(20, { kind: "login" }, now - 60_000));

  assert.deepEqual(
    await checkRateLimit(IDENTIFIER, IP, "password_change", count),
    { limited: false },
    "each kind counts its own attempts — the `kind` predicate is load-bearing"
  );
  assert.deepEqual(
    await checkRateLimit(IDENTIFIER, IP, "login", count),
    { limited: true },
    "…and the login rows really are over login's own threshold"
  );
});

test("a null IP skips the IP axis instead of matching every row", async () => {
  const rows: Attempt[] = [];
  const now = Date.now();
  const count = counterOver(rows, () => now);

  rows.push(
    ...failures(20, { kind: "password_change", ip: null }, now - 60_000)
  );

  assert.deepEqual(
    await checkRateLimit(
      "someone-else@example.com",
      null,
      "password_change",
      count
    ),
    { limited: false },
    "rows with no IP must not all collapse onto one another"
  );
});
