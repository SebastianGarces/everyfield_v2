import assert from "node:assert/strict";
import { test } from "node:test";

import type { Person } from "@/db/schema";

import { setPersonPhoto, type PersonPhotoEffects } from "./service";

// ----------------------------------------------------------------------------
// THE ROW STOPS NAMING THE OBJECT BEFORE THE OBJECT GOES (P-024a, P-024b).
//
// The asymmetry is the whole rule, and it is not symmetrical: an object no row
// names is garbage a sweep collects, while a row naming an object that is gone
// is an avatar the photo route answers 404 for and nothing inside the app can
// repair. Reversing the two lines still compiles, still passes a typecheck, and
// still looks right in review — the generated documents path learned the same
// thing and says so at `src/lib/documents/service.ts` ("asserted by RUNNING the
// function against a forced failure instead of by reading its source").
//
// So these run the function. `calls` is the order it actually took.
// ----------------------------------------------------------------------------

const CHURCH_A = "11111111-1111-1111-1111-111111111111";
const PERSON_A = "22222222-2222-2222-2222-222222222222";
const OLD_KEY = `people/${CHURCH_A}/${PERSON_A}/old.png`;
const NEW_KEY = `people/${CHURCH_A}/${PERSON_A}/new.png`;

type Effect =
  | { kind: "load" }
  | { kind: "write"; key: string | null }
  | { kind: "remove"; key: string };

function personRow(photoUrl: string | null): Person {
  return {
    id: PERSON_A,
    churchId: CHURCH_A,
    firstName: "Lead",
    lastName: "Dayspring",
    photoUrl,
  } as Person;
}

/**
 * `stored` is the key the row holds when the call starts; `fails` names the ONE
 * effect that throws.
 */
function effectHarness(
  stored: string | null,
  fails?: "load" | "write" | "remove"
) {
  const calls: Effect[] = [];

  const effects: PersonPhotoEffects = {
    async load() {
      calls.push({ kind: "load" });
      if (fails === "load") throw new Error("select … failed");
      return personRow(stored);
    },
    async write(_churchId, _personId, key) {
      calls.push({ kind: "write", key });
      if (fails === "write") throw new Error("update … failed");
      return personRow(key);
    },
    async remove(key) {
      calls.push({ kind: "remove", key });
      if (fails === "remove") throw new Error("DeleteObject refused");
    },
  };

  return { effects, calls, kinds: () => calls.map((call) => call.kind) };
}

test("a replacement writes the row FIRST, then drops the object it stopped naming", async () => {
  const harness = effectHarness(OLD_KEY);

  const person = await setPersonPhoto(
    CHURCH_A,
    PERSON_A,
    NEW_KEY,
    harness.effects
  );

  assert.deepEqual(harness.kinds(), ["load", "write", "remove"]);
  assert.deepEqual(harness.calls[1], { kind: "write", key: NEW_KEY });
  assert.deepEqual(harness.calls[2], { kind: "remove", key: OLD_KEY });
  assert.equal(person?.photoUrl, NEW_KEY);
});

test("a removal is the same writer with a null key, and still deletes last", async () => {
  const harness = effectHarness(OLD_KEY);

  const person = await setPersonPhoto(
    CHURCH_A,
    PERSON_A,
    null,
    harness.effects
  );

  assert.deepEqual(harness.kinds(), ["load", "write", "remove"]);
  assert.deepEqual(harness.calls[1], { kind: "write", key: null });
  assert.deepEqual(harness.calls[2], { kind: "remove", key: OLD_KEY });
  assert.equal(person?.photoUrl, null);
});

test("a first upload deletes nothing — there is no object to strand", async () => {
  const harness = effectHarness(null);

  await setPersonPhoto(CHURCH_A, PERSON_A, NEW_KEY, harness.effects);

  assert.deepEqual(harness.kinds(), ["load", "write"]);
});

test("removing a photo that was never there deletes nothing", async () => {
  const harness = effectHarness(null);

  await setPersonPhoto(CHURCH_A, PERSON_A, null, harness.effects);

  assert.deepEqual(harness.kinds(), ["load", "write"]);
});

test("a refused delete leaves garbage, NOT a failed write", async () => {
  const harness = effectHarness(OLD_KEY, "remove");

  // The row has already landed when the bucket refuses. Propagating here would
  // report a removal the planter can see happened, as a failure.
  const person = await setPersonPhoto(
    CHURCH_A,
    PERSON_A,
    null,
    harness.effects
  );

  assert.equal(person?.photoUrl, null);
  assert.deepEqual(harness.kinds(), ["load", "write", "remove"]);
});

test("a failed write deletes nothing — the row still names the object", async () => {
  const harness = effectHarness(OLD_KEY, "write");

  await assert.rejects(() =>
    setPersonPhoto(CHURCH_A, PERSON_A, null, harness.effects)
  );

  assert.deepEqual(harness.kinds(), ["load", "write"]);
});

test("a person the church does not own is never written to and never deletes", async () => {
  const calls: Effect[] = [];
  const effects: PersonPhotoEffects = {
    async load() {
      calls.push({ kind: "load" });
      // What the church-scoped read answers for another tenant's person.
      return null;
    },
    async write(_churchId, _personId, key) {
      calls.push({ kind: "write", key });
      return personRow(key);
    },
    async remove(key) {
      calls.push({ kind: "remove", key });
    },
  };

  const person = await setPersonPhoto(CHURCH_A, PERSON_A, null, effects);

  assert.equal(person, null);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["load"]
  );
});
