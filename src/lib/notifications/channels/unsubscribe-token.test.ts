import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mintUnsubscribeToken,
  MissingUnsubscribeSecretError,
  UNSUBSCRIBE_TOKEN_TTL_MS,
  unsubscribeTokenSecret,
  verifyUnsubscribeToken,
} from "./unsubscribe-token";

// ============================================================================
// The unsubscribe capability's crypto (N-007).
//
// The token is the ONLY thing standing between a public URL and a write to
// someone's consent record, so these tests are about what it must REFUSE at
// least as much as what it must accept. Every test below passes the secret
// explicitly: the environment is a deployment concern and has no business
// deciding whether these assertions hold.
// ============================================================================

const SECRET = "test-unsubscribe-secret-0123456789";
const OTHER_SECRET = "another-unsubscribe-secret-987654";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-07-30T09:00:00.000Z");

function mint(
  overrides: Partial<Parameters<typeof mintUnsubscribeToken>[0]> = {}
) {
  return mintUnsubscribeToken({
    userId: USER,
    category: "tasks",
    now: NOW,
    secret: SECRET,
    ...overrides,
  });
}

test("a minted token round-trips to exactly the pair it was minted for", () => {
  const token = mint();
  const verified = verifyUnsubscribeToken(token, {
    now: NOW,
    secret: SECRET,
  });

  assert.equal(verified.valid, true);
  assert.ok(verified.valid);
  assert.equal(verified.userId, USER);
  assert.equal(verified.category, "tasks");
  assert.equal(
    verified.expiresAt.getTime(),
    NOW.getTime() + UNSUBSCRIBE_TOKEN_TTL_MS
  );
});

test("the token never contains the user id in readable form", () => {
  const token = mint();

  // The literal id, and the id in every encoding a URL could plausibly carry.
  assert.ok(!token.includes(USER));
  assert.ok(!token.includes(USER.replace(/-/g, "")));
  assert.ok(!token.includes(Buffer.from(USER, "utf8").toString("base64url")));

  // And the decoded bytes are opaque too — this is ciphertext, not base64 of
  // a payload. "tasks" would be readable if the token were merely signed.
  const decoded = Buffer.from(token, "base64url").toString("utf8");
  assert.ok(!decoded.includes(USER));
  assert.ok(!decoded.includes("tasks"));
});

test("two tokens for the same pair differ, so a link is not a user identifier", () => {
  assert.notEqual(mint(), mint());
});

test("a tampered token is rejected — every byte is authenticated", () => {
  const token = mint();
  const raw = Buffer.from(token, "base64url");

  // Flip one bit in each region in turn: version byte, IV, auth tag, and the
  // ciphertext the payload actually lives in.
  for (const index of [0, 3, 15, raw.length - 1]) {
    const edited = Buffer.from(raw);
    edited[index] ^= 0b0000_0001;

    const verified = verifyUnsubscribeToken(edited.toString("base64url"), {
      now: NOW,
      secret: SECRET,
    });

    assert.equal(
      verified.valid,
      false,
      `byte ${index} was not covered by authentication`
    );
  }
});

test("a token truncated or extended is rejected", () => {
  const raw = Buffer.from(mint(), "base64url");

  for (const candidate of [
    raw.subarray(0, raw.length - 1),
    Buffer.concat([raw, Buffer.from([0])]),
    raw.subarray(0, 8),
    Buffer.alloc(0),
  ]) {
    assert.equal(
      verifyUnsubscribeToken(candidate.toString("base64url"), {
        now: NOW,
        secret: SECRET,
      }).valid,
      false
    );
  }
});

test("garbage that is not a token at all is rejected without throwing", () => {
  for (const candidate of [
    "",
    "not-a-token",
    "....",
    USER,
    JSON.stringify({ u: USER, c: "tasks", x: 99999999999 }),
    Buffer.from(
      JSON.stringify({ u: USER, c: "tasks", x: 99999999999 })
    ).toString("base64url"),
  ]) {
    const verified = verifyUnsubscribeToken(candidate, {
      now: NOW,
      secret: SECRET,
    });
    assert.equal(
      verified.valid,
      false,
      `accepted ${JSON.stringify(candidate)}`
    );
  }
});

test("a token minted under a different secret is rejected", () => {
  const foreign = mint({ secret: OTHER_SECRET });

  assert.equal(
    verifyUnsubscribeToken(foreign, { now: NOW, secret: SECRET }).valid,
    false
  );
  // And it is a genuine token — it opens under its own secret. The rejection
  // above is the key, not a malformed input.
  assert.equal(
    verifyUnsubscribeToken(foreign, { now: NOW, secret: OTHER_SECRET }).valid,
    true
  );
});

test("an expired token is rejected, and it is rejected as expired", () => {
  const token = mint({ ttlMs: 60_000 });

  const beforeExpiry = verifyUnsubscribeToken(token, {
    now: new Date(NOW.getTime() + 59_000),
    secret: SECRET,
  });
  assert.equal(beforeExpiry.valid, true);

  const afterExpiry = verifyUnsubscribeToken(token, {
    now: new Date(NOW.getTime() + 61_000),
    secret: SECRET,
  });
  assert.equal(afterExpiry.valid, false);
  assert.ok(!afterExpiry.valid);
  assert.equal(afterExpiry.reason, "expired");
});

test("one user's token never opens as another user's", () => {
  const mine = verifyUnsubscribeToken(mint(), { now: NOW, secret: SECRET });
  const theirs = verifyUnsubscribeToken(mint({ userId: OTHER_USER }), {
    now: NOW,
    secret: SECRET,
  });

  assert.ok(mine.valid && theirs.valid);
  assert.equal(mine.userId, USER);
  assert.equal(theirs.userId, OTHER_USER);
});

test("the category is carried by the token, not by the request", () => {
  const tasks = verifyUnsubscribeToken(mint(), { now: NOW, secret: SECRET });
  const meetings = verifyUnsubscribeToken(mint({ category: "meetings" }), {
    now: NOW,
    secret: SECRET,
  });

  assert.ok(tasks.valid && meetings.valid);
  assert.equal(tasks.category, "tasks");
  assert.equal(meetings.category, "meetings");
});

test("the secret fails closed when the environment supplies neither variable", (t) => {
  const previousDedicated = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  const previousCron = process.env.CRON_SECRET;
  t.after(() => {
    if (previousDedicated === undefined)
      delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    else process.env.UNSUBSCRIBE_TOKEN_SECRET = previousDedicated;
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
  });

  delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
  delete process.env.CRON_SECRET;
  assert.throws(() => unsubscribeTokenSecret(), MissingUnsubscribeSecretError);

  // A placeholder short enough to be someone's idea of a default is refused
  // too — a weak capability key is worse than a loud failure.
  process.env.UNSUBSCRIBE_TOKEN_SECRET = "changeme";
  assert.throws(() => unsubscribeTokenSecret(), MissingUnsubscribeSecretError);

  process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET;
  assert.equal(unsubscribeTokenSecret(), SECRET);

  // CRON_SECRET is the documented fallback, and only when the dedicated
  // variable is absent.
  delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.CRON_SECRET = OTHER_SECRET;
  assert.equal(unsubscribeTokenSecret(), OTHER_SECRET);
});
