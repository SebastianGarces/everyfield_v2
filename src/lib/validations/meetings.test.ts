import assert from "node:assert/strict";
import { test } from "node:test";

import {
  meetingCreateSchema,
  meetingDatetimeSchema,
  meetingUpdateSchema,
} from "./meetings";

/** Run `fn` as if the process had been started with `TZ=<timeZone>`. */
function withTimeZone<T>(timeZone: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

// ----------------------------------------------------------------------------
// `<input type="datetime-local">` submits a naive wall clock. `z.coerce.date()`
// handed that to `new Date()`, which reads it as the *server's* local time — so
// the instant a meeting was stored at depended on the `TZ` of whichever machine
// served the post, and the detail page then rendered a time nobody typed.
// ----------------------------------------------------------------------------

test("a submitted wall clock is stored as that wall clock, wherever the server runs", () => {
  for (const zone of ["UTC", "America/Chicago", "Pacific/Kiritimati"]) {
    const parsed = withTimeZone(zone, () =>
      meetingCreateSchema.safeParse({
        type: "vision_meeting",
        datetime: "2026-07-30T19:00",
      })
    );

    assert.ok(parsed.success, `failed to parse under TZ=${zone}`);
    assert.equal(
      parsed.data.datetime.toISOString(),
      "2026-07-30T19:00:00.000Z",
      `TZ=${zone} moved the stored instant`
    );
  }
});

test("a meeting scheduled at 23:30 stays on the day it was scheduled for", () => {
  const parsed = meetingCreateSchema.safeParse({
    type: "orientation",
    datetime: "2026-07-30T23:30",
  });

  assert.ok(parsed.success);
  assert.equal(parsed.data.datetime.toISOString(), "2026-07-30T23:30:00.000Z");
});

test("editing a meeting parses its datetime the same way creating one does", () => {
  const parsed = withTimeZone("Pacific/Niue", () =>
    meetingUpdateSchema.safeParse({ datetime: "2026-07-30T19:00" })
  );

  assert.ok(parsed.success);
  assert.equal(parsed.data.datetime?.toISOString(), "2026-07-30T19:00:00.000Z");
});

test("an omitted datetime is still optional on update", () => {
  const parsed = meetingUpdateSchema.safeParse({ title: "Renamed" });
  assert.ok(parsed.success);
  assert.equal(parsed.data.datetime, undefined);
});

test("a Date instance passes through untouched", () => {
  const instant = new Date("2026-07-30T19:00:00Z");
  const parsed = meetingDatetimeSchema.safeParse(instant);

  assert.ok(parsed.success);
  assert.equal((parsed.data as Date).toISOString(), instant.toISOString());
});

test("a missing or unusable datetime is reported, not silently coerced", () => {
  for (const bad of ["", "   ", "whenever"]) {
    const parsed = meetingCreateSchema.safeParse({
      type: "team_meeting",
      teamId: "11111111-1111-4111-8111-111111111111",
      datetime: bad,
    });
    assert.equal(parsed.success, false, `accepted ${JSON.stringify(bad)}`);
  }
});
