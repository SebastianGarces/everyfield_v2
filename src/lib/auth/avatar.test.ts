import assert from "node:assert/strict";
import { test } from "node:test";

import {
  removeUserAvatar,
  setUserAvatar,
  uploadUserAvatar,
  type UserAvatarEffects,
} from "./avatar";

// ----------------------------------------------------------------------------
// THE OBJECT GOES UP BEFORE THE ROW NAMES IT, AND DOWN AFTER THE ROW LETS IT GO
// (P-024, CS-004, #617).
//
// The asymmetry is the whole rule. An object no row names is garbage a sweep
// collects; a row naming an object that is gone is a picture the avatar route
// answers 404 for and nothing inside the app can repair. Reversing any two of
// these lines still compiles, still typechecks, and still reads fine in review —
// which is why these tests RUN the functions and read back the order they
// actually took, the way `people/photo-ordering.test.ts` does for the person
// half and `documents/service.ts` does for generated documents.
//
// `calls` is that order.
// ----------------------------------------------------------------------------

const USER_A = "44444444-4444-4444-4444-444444444444";
const OLD_KEY = `avatars/${USER_A}/old.png`;
const NEW_KEY = `avatars/${USER_A}/new.png`;

type Effect =
  | { kind: "load" }
  | { kind: "write"; key: string | null }
  | { kind: "upload"; key: string }
  | { kind: "remove"; key: string };

/**
 * `stored` is the key the row holds when the call starts — `undefined` for an
 * account that is not there at all. `fails` names the ONE effect that throws.
 */
function effectHarness(
  stored: string | null | undefined,
  fails?: "load" | "write" | "upload" | "remove"
) {
  const calls: Effect[] = [];

  const effects: UserAvatarEffects = {
    async load() {
      calls.push({ kind: "load" });
      if (fails === "load") throw new Error("select … failed");
      return stored;
    },
    async write(_userId, key) {
      calls.push({ kind: "write", key });
      if (fails === "write") throw new Error("update … failed");
      return stored !== undefined;
    },
    async upload(key) {
      calls.push({ kind: "upload", key });
      if (fails === "upload") throw new Error("PutObject refused");
    },
    async remove(key) {
      calls.push({ kind: "remove", key });
      if (fails === "remove") throw new Error("DeleteObject refused");
    },
  };

  return { effects, calls, kinds: () => calls.map((call) => call.kind) };
}

/** A `File` as far as these functions read one. */
function pngFile(size = 200_000) {
  return {
    type: "image/png",
    size,
    arrayBuffer: async () => new ArrayBuffer(8),
  };
}

const ACTOR = { id: USER_A };

// ----------------------------------------------------------------------------
// The writer
// ----------------------------------------------------------------------------

test("a replacement writes the row FIRST, then drops the object it stopped naming", async () => {
  const harness = effectHarness(OLD_KEY);

  assert.equal(await setUserAvatar(USER_A, NEW_KEY, harness.effects), true);

  assert.deepEqual(harness.kinds(), ["load", "write", "remove"]);
  assert.deepEqual(harness.calls[1], { kind: "write", key: NEW_KEY });
  assert.deepEqual(harness.calls[2], { kind: "remove", key: OLD_KEY });
});

test("a removal is the same writer with a null key, and still deletes last", async () => {
  const harness = effectHarness(OLD_KEY);

  assert.equal(await setUserAvatar(USER_A, null, harness.effects), true);

  assert.deepEqual(harness.kinds(), ["load", "write", "remove"]);
  assert.deepEqual(harness.calls[1], { kind: "write", key: null });
  assert.deepEqual(harness.calls[2], { kind: "remove", key: OLD_KEY });
});

test("a first picture deletes nothing — there is no object to strand", async () => {
  const harness = effectHarness(null);

  await setUserAvatar(USER_A, NEW_KEY, harness.effects);

  assert.deepEqual(harness.kinds(), ["load", "write"]);
});

test("removing a picture that was never there deletes nothing", async () => {
  const harness = effectHarness(null);

  await setUserAvatar(USER_A, null, harness.effects);

  assert.deepEqual(harness.kinds(), ["load", "write"]);
});

test("re-writing the SAME key deletes nothing — the row still names that object", async () => {
  const harness = effectHarness(OLD_KEY);

  await setUserAvatar(USER_A, OLD_KEY, harness.effects);

  assert.deepEqual(
    harness.kinds(),
    ["load", "write"],
    "deleting here would delete the object the row is pointing AT"
  );
});

test("a refused delete leaves garbage, NOT a failed write", async () => {
  const harness = effectHarness(OLD_KEY, "remove");

  // The row has already landed when the bucket refuses. Propagating here would
  // report a removal the reader can see happened, as a failure.
  assert.equal(await setUserAvatar(USER_A, null, harness.effects), true);

  assert.deepEqual(harness.kinds(), ["load", "write", "remove"]);
});

test("a failed write deletes nothing — the row still names the object", async () => {
  const harness = effectHarness(OLD_KEY, "write");

  await assert.rejects(() => setUserAvatar(USER_A, null, harness.effects));

  assert.deepEqual(harness.kinds(), ["load", "write"]);
});

test("an account that is not there is never written to and never deletes", async () => {
  const harness = effectHarness(undefined);

  assert.equal(await setUserAvatar(USER_A, NEW_KEY, harness.effects), false);

  assert.deepEqual(harness.kinds(), ["load"]);
});

// ----------------------------------------------------------------------------
// The upload, which owns the FRONT half of the ordering
// ----------------------------------------------------------------------------

test("the object is uploaded BEFORE any row names it", async () => {
  const harness = effectHarness(OLD_KEY);

  const outcome = await uploadUserAvatar(
    { actor: ACTOR, file: pngFile() },
    harness.effects
  );

  assert.equal(outcome.ok, true);
  assert.deepEqual(harness.kinds(), ["upload", "load", "write", "remove"]);

  const uploaded = harness.calls[0];
  const written = harness.calls[2];
  assert.equal(uploaded.kind, "upload");
  assert.equal(written.kind, "write");
  assert.equal(
    written.key,
    uploaded.key,
    "the row must point at the object THIS call just put in the bucket"
  );
  assert.deepEqual(
    harness.calls[3],
    { kind: "remove", key: OLD_KEY },
    "and the picture it replaced comes down only after that"
  );
});

test("a failed upload writes no row — the account keeps the picture it had", async () => {
  const harness = effectHarness(OLD_KEY, "upload");

  await assert.rejects(() =>
    uploadUserAvatar({ actor: ACTOR, file: pngFile() }, harness.effects)
  );

  assert.deepEqual(
    harness.kinds(),
    ["upload"],
    "a row pointing at an object that was never stored is the one state P-024 forbids"
  );
});

test("the key the upload mints carries the account and a fresh uuid, never the file's name", async () => {
  const harness = effectHarness(null);

  await uploadUserAvatar({ actor: ACTOR, file: pngFile() }, harness.effects);
  const first = harness.calls[0];
  assert.equal(first.kind, "upload");
  assert.match(
    first.key,
    new RegExp(`^avatars/${USER_A}/[0-9a-f-]{36}\\.png$`)
  );

  // Fresh per upload: that is what makes a replacement a NEW object, and what
  // the browser sees change when the bytes do.
  const second = effectHarness(null);
  await uploadUserAvatar({ actor: ACTOR, file: pngFile() }, second.effects);
  const again = second.calls[0];
  assert.equal(again.kind, "upload");
  assert.notEqual(
    again.key,
    first.key,
    "two uploads sharing a key would overwrite the object in place, and the browser would keep showing the picture that was replaced"
  );
});

// ----------------------------------------------------------------------------
// The gate
// ----------------------------------------------------------------------------

test("a file that is not an image never reaches the bucket", async () => {
  const harness = effectHarness(OLD_KEY);

  const outcome = await uploadUserAvatar(
    {
      actor: ACTOR,
      file: {
        type: "application/pdf",
        size: 1000,
        arrayBuffer: async () => new ArrayBuffer(8),
      },
    },
    harness.effects
  );

  assert.equal(outcome.ok, false);
  assert.deepEqual(
    harness.kinds(),
    [],
    "the gate is the FIRST thing the upload does — a refused file costs no bucket call and no row read"
  );
});

test("an oversized image never reaches the bucket, and says why", async () => {
  const harness = effectHarness(null);

  const outcome = await uploadUserAvatar(
    { actor: ACTOR, file: pngFile(4 * 1024 * 1024) },
    harness.effects
  );

  assert.equal(outcome.ok, false);
  assert.match(outcome.ok === false ? outcome.message : "", /3MB/);
  assert.deepEqual(harness.kinds(), []);
});

test("an empty file is not a picture", async () => {
  const harness = effectHarness(null);

  const outcome = await uploadUserAvatar(
    { actor: ACTOR, file: pngFile(0) },
    harness.effects
  );

  assert.equal(outcome.ok, false);
  assert.deepEqual(harness.kinds(), []);
});

// ----------------------------------------------------------------------------
// The removal entry point
// ----------------------------------------------------------------------------

test("removeUserAvatar is setUserAvatar with a null key and nothing else", async () => {
  const harness = effectHarness(OLD_KEY);

  const outcome = await removeUserAvatar({ actor: ACTOR }, harness.effects);

  assert.deepEqual(outcome, { ok: true, avatarKey: null });
  assert.deepEqual(harness.kinds(), ["load", "write", "remove"]);
  assert.deepEqual(harness.calls[1], { kind: "write", key: null });
});

test("removing twice is removing once — the second call finds nothing to drop", async () => {
  const harness = effectHarness(null);

  const outcome = await removeUserAvatar({ actor: ACTOR }, harness.effects);

  assert.deepEqual(outcome, { ok: true, avatarKey: null });
  assert.deepEqual(harness.kinds(), ["load", "write"]);
});
