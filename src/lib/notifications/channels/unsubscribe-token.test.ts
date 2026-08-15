import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import {
  mintUnsubscribeToken,
  MissingUnsubscribeSecretError,
  RESUBSCRIBE_TOKEN_TTL_MS,
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
  // The default is the LESS powerful direction — the one that goes in an email.
  assert.equal(verified.purpose, "disable");
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

// ----------------------------------------------------------------------------
// AC: the emailed token cannot re-enable; the undo token cannot disable
// (the capability split, ruled 2026-08-01)
// ----------------------------------------------------------------------------

test("the emailed (disable) token cannot re-enable anything", () => {
  const emailed = mint({ purpose: "disable" });

  // It opens as what it is...
  const asDisable = verifyUnsubscribeToken(emailed, {
    purpose: "disable",
    now: NOW,
    secret: SECRET,
  });
  assert.ok(asDisable.valid);
  assert.equal(asDisable.purpose, "disable");

  // ...and is not merely refused as the other direction — it is undecryptable,
  // because `enable` uses a different key. A six-month-old email in a forwarded
  // thread therefore cannot switch a category the user deliberately turned off
  // back on.
  const asEnable = verifyUnsubscribeToken(emailed, {
    purpose: "enable",
    now: NOW,
    secret: SECRET,
  });
  assert.equal(asEnable.valid, false);
  assert.ok(!asEnable.valid);
  assert.equal(asEnable.reason, "tampered");
});

test("the undo (enable) token cannot disable anything", () => {
  const undo = mint({ purpose: "enable" });

  const asEnable = verifyUnsubscribeToken(undo, {
    purpose: "enable",
    now: NOW,
    secret: SECRET,
  });
  assert.ok(asEnable.valid);
  assert.equal(asEnable.purpose, "enable");
  assert.equal(asEnable.userId, USER);
  assert.equal(asEnable.category, "tasks");

  const asDisable = verifyUnsubscribeToken(undo, {
    purpose: "disable",
    now: NOW,
    secret: SECRET,
  });
  assert.equal(asDisable.valid, false);
  assert.ok(!asDisable.valid);
  assert.equal(asDisable.reason, "tampered");
});

test("the two directions do not even produce the same token for the same pair", () => {
  // Not just different ciphertexts (the IV guarantees that) — different KEYS.
  // Proven by the cross-direction refusals above; this pins that the mint path
  // really is producing two distinct artefacts rather than one relabelled one.
  const disable = mint({ purpose: "disable" });
  const enable = mint({ purpose: "enable" });
  assert.notEqual(disable, enable);
});

test("the undo token expires in an hour, and expiry is reported as expiry", () => {
  const undo = mint({ purpose: "enable" });

  const fresh = verifyUnsubscribeToken(undo, {
    purpose: "enable",
    now: NOW,
    secret: SECRET,
  });
  assert.ok(fresh.valid);
  assert.equal(
    fresh.expiresAt.getTime(),
    NOW.getTime() + RESUBSCRIBE_TOKEN_TTL_MS
  );
  assert.equal(RESUBSCRIBE_TOKEN_TTL_MS, 60 * 60 * 1000);

  // Still good a minute before the hour is up.
  assert.equal(
    verifyUnsubscribeToken(undo, {
      purpose: "enable",
      now: new Date(NOW.getTime() + RESUBSCRIBE_TOKEN_TTL_MS - 60_000),
      secret: SECRET,
    }).valid,
    true
  );

  // Gone a minute after. The disable token minted at the same instant is still
  // valid — which is the asymmetry the ruling asked for.
  const stale = verifyUnsubscribeToken(undo, {
    purpose: "enable",
    now: new Date(NOW.getTime() + RESUBSCRIBE_TOKEN_TTL_MS + 60_000),
    secret: SECRET,
  });
  assert.equal(stale.valid, false);
  assert.ok(!stale.valid);
  assert.equal(stale.reason, "expired");

  assert.equal(
    verifyUnsubscribeToken(mint({ purpose: "disable" }), {
      purpose: "disable",
      now: new Date(NOW.getTime() + RESUBSCRIBE_TOKEN_TTL_MS + 60_000),
      secret: SECRET,
    }).valid,
    true
  );
});

test("a tampered undo token is rejected, byte by byte", () => {
  const raw = Buffer.from(mint({ purpose: "enable" }), "base64url");

  for (const index of [0, 3, 15, raw.length - 1]) {
    const edited = Buffer.from(raw);
    edited[index] ^= 0b0000_0001;

    assert.equal(
      verifyUnsubscribeToken(edited.toString("base64url"), {
        purpose: "enable",
        now: NOW,
        secret: SECRET,
      }).valid,
      false,
      `byte ${index} was not covered by authentication on the enable token`
    );
  }
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

  // CRON_SECRET is the documented fallback OUTSIDE PRODUCTION, and only when
  // the dedicated variable is absent. The production rule is asserted below.
  delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.CRON_SECRET = OTHER_SECRET;
  assert.equal(unsubscribeTokenSecret(), OTHER_SECRET);
});

// ============================================================================
// THE SECRET'S FLOOR AND ITS PROVENANCE (#263 items 3 and 4, via #324 WS2)
//
// Two separate hardenings of the same lookup, and they fail in different ways,
// so they are asserted separately.
//
// ITEM 3 — the floor. The key is a SINGLE SHA-256 of this value, not a KDF, so
// one genuine token in an attacker's hands is an offline verification oracle
// they can run billions of times a second with no request to us. The old floor
// of 16 accepted a human-typed string. The new floor is the length that carries
// ~128 bits under the weakest encoding an operator plausibly pastes (hex, at 4
// bits a character), and `.env.example`'s `openssl rand -base64 32` clears it
// with 44 characters — which is what turns that advice into an enforced rule.
//
// ITEM 4 — the provenance. `CRON_SECRET` stood in for the dedicated variable
// everywhere, which made one set of bytes guard two unrelated capabilities: the
// scheduler's bearer token and every unsubscribe link in flight. Domain
// separation makes the two KEYS independent and can do nothing about the two
// SECRETS being the same bytes. In production the dedicated variable is now
// required outright.
// ============================================================================

/**
 * `NODE_ENV` is typed read-only by `@types/node`, which is right for
 * application code and wrong for a test whose whole subject is what the value
 * changes. One narrow escape hatch, here, rather than a cast at each site.
 */
function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

/** Save and restore the three variables the lookup reads. */
function withCleanEnv(t: import("node:test").TestContext): void {
  const previous = {
    dedicated: process.env.UNSUBSCRIBE_TOKEN_SECRET,
    cron: process.env.CRON_SECRET,
    nodeEnv: process.env.NODE_ENV as string | undefined,
  };
  t.after(() => {
    if (previous.dedicated === undefined)
      delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    else process.env.UNSUBSCRIBE_TOKEN_SECRET = previous.dedicated;
    if (previous.cron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous.cron;
    setNodeEnv(previous.nodeEnv);
  });

  delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
  delete process.env.CRON_SECRET;
  setNodeEnv(undefined);
}

test("a secret shorter than 32 characters is refused, in every runtime", (t) => {
  withCleanEnv(t);

  // 31 random-looking characters: long enough to look serious, short enough to
  // be brute-forcible against a single SHA-256 if it came from a human.
  const justUnder = "Kj8mQ2wR7tYp4Zx9Lc3Vb6Nn1Fh5Gd0";
  assert.equal(justUnder.length, 31, "fixture drifted off the boundary");

  process.env.UNSUBSCRIBE_TOKEN_SECRET = justUnder;
  assert.throws(() => unsubscribeTokenSecret(), MissingUnsubscribeSecretError);

  // The same value with one more character clears the floor, so the refusal is
  // the LENGTH RULE and not something else about the string.
  process.env.UNSUBSCRIBE_TOKEN_SECRET = `${justUnder}A`;
  assert.equal(unsubscribeTokenSecret(), `${justUnder}A`);

  // The old floor is genuinely gone: a value that used to pass no longer does.
  process.env.UNSUBSCRIBE_TOKEN_SECRET = "0123456789abcdef";
  assert.equal(process.env.UNSUBSCRIBE_TOKEN_SECRET.length, 16);
  assert.throws(() => unsubscribeTokenSecret(), MissingUnsubscribeSecretError);

  // A short CRON_SECRET is no way around it either, in the one runtime where
  // CRON_SECRET is consulted at all.
  delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.CRON_SECRET = "0123456789abcdef";
  assert.throws(() => unsubscribeTokenSecret(), MissingUnsubscribeSecretError);
});

test("what `.env.example` tells an operator to generate is accepted", (t) => {
  withCleanEnv(t);

  // `openssl rand -base64 32` — 32 bytes, base64, 44 characters including the
  // single `=` pad. Generated here rather than pasted so the test states the
  // rule instead of a sample.
  const generated = randomBytes(32).toString("base64");
  assert.equal(generated.length, 44, "base64 of 32 bytes is 44 characters");

  process.env.UNSUBSCRIBE_TOKEN_SECRET = generated;
  assert.equal(unsubscribeTokenSecret(), generated);

  // And it seals a real token, so the floor did not become a shape rule that
  // only some encodings survive.
  const token = mintUnsubscribeToken({ userId: USER, category: "tasks" });
  const verified = verifyUnsubscribeToken(token);
  assert.ok(verified.valid);
  assert.equal(verified.userId, USER);
});

test("production REQUIRES the dedicated variable — CRON_SECRET is not accepted", (t) => {
  withCleanEnv(t);
  setNodeEnv("production");

  // A perfectly good CRON_SECRET, long enough to clear the floor. Outside
  // production this is the sanctioned fallback; here it must buy nothing.
  process.env.CRON_SECRET = OTHER_SECRET;
  assert.ok(OTHER_SECRET.length >= 32, "fixture is below the floor");

  assert.throws(
    () => unsubscribeTokenSecret(),
    (error: unknown) => {
      assert.ok(error instanceof MissingUnsubscribeSecretError);
      assert.match(
        error.message,
        /UNSUBSCRIBE_TOKEN_SECRET is required in production/,
        "the production refusal must say which variable is missing — a deploy reads this line and nothing else"
      );
      return true;
    },
    "a production runtime accepted CRON_SECRET as the unsubscribe key — one set of bytes now guards the scheduler AND every unsubscribe link in flight"
  );

  // Setting the dedicated variable is the only thing that fixes it.
  process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET;
  assert.equal(unsubscribeTokenSecret(), SECRET);
});

test("the mint path in production fails fast rather than sending a dead link", (t) => {
  withCleanEnv(t);
  setNodeEnv("production");
  process.env.CRON_SECRET = OTHER_SECRET;

  // The observable consequence of the rule: composing an email throws, which
  // `deliverEmailGroup` records as a delivery failure. The alternative — a
  // token sealed under the cron bearer — is the thing being refused.
  assert.throws(
    () => mintUnsubscribeToken({ userId: USER, category: "tasks", now: NOW }),
    MissingUnsubscribeSecretError
  );

  // And the public read path still degrades rather than 500ing at a stranger,
  // exactly as it does for every other unusable environment.
  const verified = verifyUnsubscribeToken("not-a-token", { now: NOW });
  assert.equal(verified.valid, false);
});

test("outside production CRON_SECRET still stands in, and only then", (t) => {
  withCleanEnv(t);

  for (const runtime of ["development", "test"]) {
    setNodeEnv(runtime);
    delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    process.env.CRON_SECRET = OTHER_SECRET;
    assert.equal(
      unsubscribeTokenSecret(),
      OTHER_SECRET,
      `the local fallback stopped working in NODE_ENV=${runtime}`
    );

    // The dedicated variable always wins where both are set.
    process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET;
    assert.equal(unsubscribeTokenSecret(), SECRET);
  }
});

test("verification REFUSES rather than throws when the environment has no secret", (t) => {
  // The asymmetry that matters in production. Minting fails closed — an email
  // must never go out with a dead opt-out link. Verifying is reached from a
  // public URL with no session, so an unconfigured environment has to render
  // the ordinary refusal card, not a 500 in front of whoever clicked the link
  // in their inbox.
  const previousDedicated = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  const previousCron = process.env.CRON_SECRET;
  t.after(() => {
    if (previousDedicated === undefined)
      delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    else process.env.UNSUBSCRIBE_TOKEN_SECRET = previousDedicated;
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
  });

  // Mint a genuine token BEFORE unsetting, so what the assertions below see is
  // a well-formed token failing only because the environment cannot open it.
  const genuine = mint();

  delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
  delete process.env.CRON_SECRET;

  // The mint path still throws. That fail-closed choice is the point.
  assert.throws(
    () => mintUnsubscribeToken({ userId: USER, category: "tasks", now: NOW }),
    MissingUnsubscribeSecretError
  );

  // The read path degrades, for every shape of input a public URL can carry.
  for (const token of [genuine, "", "not-a-token", "a".repeat(200)]) {
    const verified = verifyUnsubscribeToken(token, { now: NOW });
    assert.equal(
      verified.valid,
      false,
      "a missing secret must never verify anything"
    );
    assert.ok(!verified.valid);
    assert.equal(verified.reason, "malformed");
  }

  // And an explicit secret still works while the environment is empty, so the
  // degradation is scoped to the lookup and has not disabled verification.
  const withSecret = verifyUnsubscribeToken(genuine, {
    now: NOW,
    secret: SECRET,
  });
  assert.ok(withSecret.valid);
  assert.equal(withSecret.userId, USER);
});
