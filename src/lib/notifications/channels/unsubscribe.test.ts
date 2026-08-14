import assert from "node:assert/strict";
import { test } from "node:test";

import type { NotificationPreference } from "@/db/schema";

import {
  defaultChannelEnabled,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "../categories";
import {
  preferenceOwnerFromUnsubscribeToken,
  preferenceValueIsInheritable,
  resolvePreference,
  UNSUBSCRIBE_CHANNEL,
} from "../preferences";
import {
  applyEmailOptIn,
  applyEmailOptOut,
  describeUnsubscribeSubject,
  unsubscribeWriteQuery,
  type UnsubscribeStore,
} from "./unsubscribe";
import {
  mintUnsubscribeToken,
  RESUBSCRIBE_TOKEN_TTL_MS,
  verifyUnsubscribeToken,
} from "./unsubscribe-token";

// ============================================================================
// Scope of effect on the unauthenticated surface (N-007).
//
// The statements below are rendered with `.toSQL()` and inspected, so what is
// asserted is the UPDATE that would actually reach Postgres — parameters
// included — rather than a description of it. Nothing is EXECUTED: `.toSQL()`
// renders, it does not connect.
//
// The claim under test is the one the FRD makes and the one a reviewer of an
// unauthenticated mutation has to be able to check by reading: following an
// unsubscribe link disables ONE category's email channel for ONE user, and
// touches nothing else.
// ============================================================================

const SECRET = "test-unsubscribe-secret-0123456789";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-07-30T09:00:00.000Z");

function ownerFor(category: "tasks" | "meetings", userId = USER) {
  const token = mintUnsubscribeToken({
    userId,
    category,
    now: NOW,
    secret: SECRET,
  });
  const resolved = preferenceOwnerFromUnsubscribeToken(token, {
    now: NOW,
    secret: SECRET,
  });
  assert.ok(resolved.ok);
  return resolved;
}

test("the write names exactly one user, one category and the email channel", () => {
  const resolved = ownerFor("tasks");
  const { sql, params } = unsubscribeWriteQuery(
    resolved.owner,
    resolved.category,
    false
  ).toSQL();

  assert.match(sql, /insert into "notification_preferences"/i);
  assert.match(sql, /on conflict/i);

  // The three coordinates of the affected cell, and the value.
  assert.ok(params.includes(USER));
  assert.ok(params.includes("tasks"));
  assert.ok(params.includes("email"));
  assert.ok(params.includes(false));

  // Nothing that would widen it: no other user, no other category, and above
  // all no `in_app` — a link that could reach the feed would be a different
  // and much larger capability.
  assert.ok(!params.includes(OTHER_USER));
  assert.ok(!params.includes("meetings"));
  assert.ok(!params.includes("in_app"));
});

test("the category written is the token's, not a parameter a caller chose", () => {
  const tasks = ownerFor("tasks");
  const meetings = ownerFor("meetings");

  const tasksParams = unsubscribeWriteQuery(
    tasks.owner,
    tasks.category,
    false
  ).toSQL().params;
  const meetingsParams = unsubscribeWriteQuery(
    meetings.owner,
    meetings.category,
    false
  ).toSQL().params;

  assert.ok(tasksParams.includes("tasks"));
  assert.ok(!tasksParams.includes("meetings"));
  assert.ok(meetingsParams.includes("meetings"));
  assert.ok(!meetingsParams.includes("tasks"));
});

test("two users' links produce writes that cannot reach each other", () => {
  const mine = ownerFor("tasks", USER);
  const theirs = ownerFor("tasks", OTHER_USER);

  const mineParams = unsubscribeWriteQuery(
    mine.owner,
    mine.category,
    false
  ).toSQL().params;
  const theirsParams = unsubscribeWriteQuery(
    theirs.owner,
    theirs.category,
    false
  ).toSQL().params;

  assert.ok(mineParams.includes(USER) && !mineParams.includes(OTHER_USER));
  assert.ok(theirsParams.includes(OTHER_USER) && !theirsParams.includes(USER));
});

test("undo is the same one-cell write in the other direction", () => {
  const resolved = ownerFor("tasks");

  const off = unsubscribeWriteQuery(resolved.owner, resolved.category, false);
  const on = unsubscribeWriteQuery(resolved.owner, resolved.category, true);

  // Same statement, same coordinates — only the value differs. There is no
  // second code path for the undo to get wrong.
  assert.equal(off.toSQL().sql, on.toSQL().sql);
  assert.ok(off.toSQL().params.includes(false));
  assert.ok(on.toSQL().params.includes(true));
});

test("a tampered token yields no owner, so no write can be built at all", () => {
  const raw = Buffer.from(
    mintUnsubscribeToken({
      userId: USER,
      category: "tasks",
      now: NOW,
      secret: SECRET,
    }),
    "base64url"
  );
  raw[raw.length - 2] ^= 0b0000_0001;

  const resolved = preferenceOwnerFromUnsubscribeToken(
    raw.toString("base64url"),
    { now: NOW, secret: SECRET }
  );

  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.reason, "tampered");
  // `unsubscribeWriteQuery` takes a `PreferenceOwner`, which only a successful
  // resolution can mint — there is nothing to pass it here, and the compiler
  // says so. That is what makes "a tampered token changes nothing" structural
  // rather than a branch someone has to remember to write.
});

test("an expired token yields no owner either", () => {
  const token = mintUnsubscribeToken({
    userId: USER,
    category: "tasks",
    now: NOW,
    ttlMs: 1_000,
    secret: SECRET,
  });

  const resolved = preferenceOwnerFromUnsubscribeToken(token, {
    now: new Date(NOW.getTime() + 2_000),
    secret: SECRET,
  });

  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok);
  assert.equal(resolved.reason, "expired");
});

// ============================================================================
// Direction, and who may travel in it (ruled 2026-08-01).
//
// The tests below execute the REAL `applyEmailOptOut` / `applyEmailOptIn` /
// `describeUnsubscribeSubject` against a recording store, so "this path wrote
// nothing" is an observation about code that ran, not a claim about which
// function someone remembered not to call.
// ============================================================================

interface Write {
  owner: string;
  category: NotificationCategory;
  enabled: boolean;
}

function recordingStore(
  initial: { email?: string | null; rows?: NotificationPreference[] } = {}
): UnsubscribeStore & { writes: Write[] } {
  const writes: Write[] = [];
  const rows = initial.rows ?? [];

  return {
    writes,
    async loadRecipientEmail() {
      return initial.email === undefined
        ? "planter@example.test"
        : initial.email;
    },
    async loadPreferences() {
      return rows;
    },
    async writeEmailPreference(owner, category, enabled) {
      writes.push({ owner, category, enabled });
    },
  };
}

/** An explicit stored row, the way the settings screen or an opt-out writes it. */
function preferenceRow(
  category: NotificationCategory,
  enabled: boolean
): NotificationPreference {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    userId: USER,
    category,
    channel: "email",
    enabled,
    digestCadence: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as NotificationPreference;
}

/**
 * Change a CODED DEFAULT for the duration of one test, and hand back the undo.
 *
 * The registry `defaultChannelEnabled` reads is the thing mutated, so what runs
 * afterwards is the real resolver against a real default — not a stub agreeing
 * with the assertion. This is the only honest way to test "survives a later flip
 * of the default" without waiting for the product to make one.
 */
function flipCodedDefault(
  category: NotificationCategory,
  channel: "email" | "in_app",
  value: boolean
): () => void {
  const defaults = NOTIFICATION_CATEGORIES[category].defaults;
  const previous = defaults[channel];
  defaults[channel] = value;
  return () => {
    defaults[channel] = previous;
  };
}

function emailedToken(userId = USER, category: NotificationCategory = "tasks") {
  return mintUnsubscribeToken({
    userId,
    category,
    purpose: "disable",
    now: NOW,
    secret: SECRET,
  });
}

function undoToken(userId = USER, category: NotificationCategory = "tasks") {
  return mintUnsubscribeToken({
    userId,
    category,
    purpose: "enable",
    now: NOW,
    secret: SECRET,
  });
}

// ----------------------------------------------------------------------------
// AC: the GET an emailed link lands on changes nothing
// ----------------------------------------------------------------------------

test("describing the subject — what the GET renders — performs no write at all", async () => {
  const store = recordingStore();

  const result = await describeUnsubscribeSubject(emailedToken(), {
    now: NOW,
    secret: SECRET,
    store,
  });

  assert.equal(result.status, "ok");
  assert.ok(result.status === "ok");
  // The page can name the category and the address, which is what the FRD
  // requires of it...
  assert.equal(result.subject.category, "tasks");
  assert.equal(result.subject.email, "planter@example.test");
  // ...and the reader is still subscribed, because rendering is not consent.
  assert.equal(result.subject.enabled, true);

  // The property the whole ruling turns on: a mail scanner fetching this URL
  // changes nothing, so nobody is opted out without seeing the page.
  assert.deepEqual(store.writes, []);
});

test("rendering the page repeatedly still writes nothing", async () => {
  const store = recordingStore();
  for (let i = 0; i < 5; i += 1) {
    await describeUnsubscribeSubject(emailedToken(), {
      now: NOW,
      secret: SECRET,
      store,
    });
  }
  assert.equal(store.writes.length, 0);
});

// ----------------------------------------------------------------------------
// AC: the POST opts out exactly one (user, category, email) cell
// ----------------------------------------------------------------------------

test("the opt-out writes exactly one cell, and it is the token's own", async () => {
  const store = recordingStore();

  const result = await applyEmailOptOut(emailedToken(), {
    now: NOW,
    secret: SECRET,
    store,
  });

  assert.equal(result.status, "ok");
  assert.equal(store.writes.length, 1);
  assert.deepEqual(store.writes[0], {
    owner: USER,
    category: "tasks",
    enabled: false,
  });
});

test("a second opt-out is idempotent — one cell, same value", async () => {
  const store = recordingStore({ rows: [preferenceRow("tasks", false)] });

  await applyEmailOptOut(emailedToken(), { now: NOW, secret: SECRET, store });
  await applyEmailOptOut(emailedToken(), { now: NOW, secret: SECRET, store });

  assert.equal(store.writes.length, 2);
  assert.ok(store.writes.every((write) => write.enabled === false));
  assert.ok(store.writes.every((write) => write.category === "tasks"));
});

test("a token for a deleted user writes nothing", async () => {
  const store = recordingStore({ email: null });

  const result = await applyEmailOptOut(emailedToken(), {
    now: NOW,
    secret: SECRET,
    store,
  });

  assert.equal(result.status, "rejected");
  assert.ok(result.status === "rejected");
  assert.equal(result.reason, "unknown_recipient");
  assert.deepEqual(store.writes, []);
});

// ----------------------------------------------------------------------------
// AC: the emailed token cannot re-enable; the undo token cannot disable
// ----------------------------------------------------------------------------

test("the emailed token is refused by the opt-IN path, and writes nothing", async () => {
  const store = recordingStore({ rows: [preferenceRow("tasks", false)] });

  const result = await applyEmailOptIn(emailedToken(), {
    now: NOW,
    secret: SECRET,
    store,
  });

  assert.equal(result.status, "rejected");
  assert.ok(result.status === "rejected");
  assert.equal(result.reason, "tampered");
  assert.deepEqual(store.writes, []);
});

test("the undo token is refused by the opt-OUT path, and writes nothing", async () => {
  const store = recordingStore();

  const result = await applyEmailOptOut(undoToken(), {
    now: NOW,
    secret: SECRET,
    store,
  });

  assert.equal(result.status, "rejected");
  assert.ok(result.status === "rejected");
  assert.equal(result.reason, "tampered");
  assert.deepEqual(store.writes, []);
});

test("the undo token re-enables exactly the one cell it names", async () => {
  const store = recordingStore({ rows: [preferenceRow("tasks", false)] });

  const result = await applyEmailOptIn(undoToken(), {
    now: NOW,
    secret: SECRET,
    store,
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(store.writes, [
    { owner: USER, category: "tasks", enabled: true },
  ]);
});

// ----------------------------------------------------------------------------
// AC (revised 2026-08-01, HR4 finding): the undo token is minted by the ACT of
// opting out — never by rendering. If a render could mint, the 180-day emailed
// disable token would transitively re-enable for its entire lifetime: present
// it to the page for an already-off category at any point, receive a fresh
// enable capability, spend it. These tests pin the closed door.
// ----------------------------------------------------------------------------

test("rendering never mints an undo token — not even for an off category", async () => {
  const subscribed = recordingStore();
  // The defect's exact posture: the category is ALREADY off (opted out long
  // ago, or switched off in /settings), and a months-old emailed link is
  // presented for a plain GET.
  const alreadyOff = recordingStore({ rows: [preferenceRow("tasks", false)] });

  const whileSubscribed = await describeUnsubscribeSubject(emailedToken(), {
    now: NOW,
    secret: SECRET,
    store: subscribed,
  });
  assert.ok(whileSubscribed.status === "ok");
  assert.equal(whileSubscribed.subject.undoToken, null);

  const whileAlreadyOff = await describeUnsubscribeSubject(emailedToken(), {
    now: NOW,
    secret: SECRET,
    store: alreadyOff,
  });
  assert.ok(whileAlreadyOff.status === "ok");
  assert.equal(whileAlreadyOff.subject.enabled, false);
  assert.equal(
    whileAlreadyOff.subject.undoToken,
    null,
    "a READ handed out a re-enable capability — the emailed disable token is bidirectional again"
  );
});

test("the opt-out's own result carries the one-hour enable token; the opt-in's carries none", async () => {
  const store = recordingStore();

  const optedOut = await applyEmailOptOut(emailedToken(), {
    now: NOW,
    secret: SECRET,
    store,
  });
  assert.ok(optedOut.status === "ok");
  const minted = optedOut.subject.undoToken;
  assert.ok(minted, "the act of opting out owes the reader an undo");

  // It is a genuine ENABLE token for the same pair, and it is not the emailed
  // one being handed back.
  assert.notEqual(minted, emailedToken());
  const verified = verifyUnsubscribeToken(minted, {
    purpose: "enable",
    now: NOW,
    secret: SECRET,
  });
  assert.ok(verified.valid);
  assert.equal(verified.userId, USER);
  assert.equal(verified.category, "tasks");
  assert.equal(
    verified.expiresAt.getTime(),
    NOW.getTime() + RESUBSCRIBE_TOKEN_TTL_MS
  );

  // Undoing mints nothing further — there is no "undo the undo" capability,
  // so a spent enable token's redirect ends the chain.
  const undone = await applyEmailOptIn(undoToken(), {
    now: NOW,
    secret: SECRET,
    store: recordingStore({ rows: [preferenceRow("tasks", false)] }),
  });
  assert.ok(undone.status === "ok");
  assert.equal(undone.subject.undoToken, null);
});

test("an expired undo token re-enables nothing", async () => {
  const store = recordingStore({ rows: [preferenceRow("tasks", false)] });

  const result = await applyEmailOptIn(undoToken(), {
    now: new Date(NOW.getTime() + RESUBSCRIBE_TOKEN_TTL_MS + 1_000),
    secret: SECRET,
    store,
  });

  assert.equal(result.status, "rejected");
  assert.ok(result.status === "rejected");
  assert.equal(result.reason, "expired");
  assert.deepEqual(store.writes, []);
});

test("a tampered token changes nothing in either direction", async () => {
  for (const [token, apply] of [
    [emailedToken(), applyEmailOptOut],
    [undoToken(), applyEmailOptIn],
  ] as const) {
    const raw = Buffer.from(token, "base64url");
    raw[raw.length - 2] ^= 0b0000_0001;

    const store = recordingStore();
    const result = await apply(raw.toString("base64url"), {
      now: NOW,
      secret: SECRET,
      store,
    });

    assert.equal(result.status, "rejected");
    assert.ok(result.status === "rejected");
    assert.equal(result.reason, "tampered");
    assert.deepEqual(store.writes, []);
  }
});

test("an expired emailed token opts nobody out", async () => {
  const store = recordingStore();
  const shortLived = mintUnsubscribeToken({
    userId: USER,
    category: "tasks",
    purpose: "disable",
    ttlMs: 1_000,
    now: NOW,
    secret: SECRET,
  });

  const result = await applyEmailOptOut(shortLived, {
    now: new Date(NOW.getTime() + 2_000),
    secret: SECRET,
    store,
  });

  assert.equal(result.status, "rejected");
  assert.ok(result.status === "rejected");
  assert.equal(result.reason, "expired");
  assert.deepEqual(store.writes, []);
});

test("one reader's link cannot reach another reader's preferences", async () => {
  const store = recordingStore();

  await applyEmailOptOut(emailedToken(OTHER_USER, "meetings"), {
    now: NOW,
    secret: SECRET,
    store,
  });

  assert.deepEqual(store.writes, [
    { owner: OTHER_USER, category: "meetings", enabled: false },
  ]);
});

test("an unconfigured environment refuses the token instead of throwing at the page", async (t) => {
  // `/unsubscribe` is a Server Component rendered for a stranger with no
  // session. If a missing secret escaped as an exception it would be an HTTP
  // 500 on a public page rather than the refusal card, so the read path has to
  // resolve — never reject — when the deployment forgot the variable.
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

  // Both arms of the fallback are empty, and both of these reject before any
  // query is built — which is also why this test needs no database.
  for (const token of ["", "not-a-token"]) {
    const result = await describeUnsubscribeSubject(token);
    assert.equal(result.status, "rejected");
    assert.ok(result.status === "rejected");
    assert.equal(result.reason, "malformed");
  }
});

test("the undo records a CHOICE, not a value that agrees with today's default", () => {
  // Ruled 2026-08-13 (#411 → #427), reversing what this test used to pin. The
  // undo writes `enabled: true`, which EQUALS the coded default for every
  // category's email channel, and #237's value-equality rule therefore read it
  // as `source: "default"` — a row that says nothing. For a reader who pressed
  // "keep sending these" that reading is wrong: they made a decision about
  // their own consent, and `UNSUBSCRIBE_CHANNEL` is now exempt from the rule.
  const resolved = resolvePreference(
    [preferenceRow("tasks", true)],
    "tasks",
    "email"
  );

  assert.equal(resolved.enabled, true);
  assert.equal(
    resolved.source,
    "explicit",
    "the undo's write is the reader's own choice and is recorded as one"
  );

  // The opt-OUT was always explicit — it disagrees with the default — and the
  // exemption must not have disturbed it.
  const optedOut = resolvePreference(
    [preferenceRow("tasks", false)],
    "tasks",
    "email"
  );
  assert.equal(optedOut.enabled, false);
  assert.equal(optedOut.source, "explicit");
});

test("the undo survives a later flip of the coded default", () => {
  // The scenario the ruling exists for, run rather than described: the reader
  // unsubscribed, changed their mind, and LATER the product reconsiders whether
  // this category's email is on by default.
  //
  // The flip is simulated at the seam the resolver reads defaults through
  // (`defaultChannelEnabled`), so the fixture cannot pass by agreeing with a
  // hand-written expectation — it is the real resolver answering against a real
  // default of `false`.
  const row = preferenceRow("tasks", true);

  assert.equal(
    defaultChannelEnabled("tasks", "email"),
    true,
    "the premise: today's coded default is what the undo happened to write"
  );

  const beforeFlip = resolvePreference([row], "tasks", "email");
  assert.equal(beforeFlip.enabled, true);

  const restore = flipCodedDefault("tasks", "email", false);
  try {
    assert.equal(defaultChannelEnabled("tasks", "email"), false);

    // Absence follows the new default — that is #237's rule, untouched.
    assert.equal(resolvePreference([], "tasks", "email").enabled, false);

    // The reader who pressed "keep sending these" still receives them.
    const afterFlip = resolvePreference([row], "tasks", "email");
    assert.equal(
      afterFlip.enabled,
      true,
      "a flipped default silently unsubscribed the reader who had undone it"
    );
    assert.equal(afterFlip.source, "explicit");
  } finally {
    restore();
  }
});

test("the exempt channel IS the channel this module writes to", () => {
  // The ruling names a channel, and two modules have to agree on which one:
  // the resolver exempts `UNSUBSCRIBE_CHANNEL`, and every write here is pinned
  // to it. They are one constant, and this asserts it from both ends — the SQL
  // the link actually issues, and the rule the resolver actually applies.
  const resolved = ownerFor("tasks");
  const { params } = unsubscribeWriteQuery(
    resolved.owner,
    resolved.category,
    true
  ).toSQL();

  assert.ok(params.includes(UNSUBSCRIBE_CHANNEL));
  assert.equal(
    preferenceValueIsInheritable(
      "tasks",
      UNSUBSCRIBE_CHANNEL,
      defaultChannelEnabled("tasks", UNSUBSCRIBE_CHANNEL)
    ),
    false
  );
});
