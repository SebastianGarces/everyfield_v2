import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { ownRsvpInput } from "./own-rsvp-input";

test("own RSVP accepts only the public confirm/decline answers", () => {
  for (const response of ["confirmed", "declined"]) {
    assert.deepEqual(ownRsvpInput.parse({ response }), { response });
  }
  for (const response of [
    "attended",
    "absent",
    "pending",
    "invited",
    null,
    1,
  ]) {
    assert.equal(ownRsvpInput.safeParse({ response }).success, false);
  }
});

test("a caller cannot select another Person, church, or attendance field", () => {
  for (const field of [
    "personId",
    "userId",
    "churchId",
    "attendanceStatus",
    "notes",
  ]) {
    assert.equal(
      ownRsvpInput.safeParse({ response: "confirmed", [field]: "forged" })
        .success,
      false
    );
  }
});

test("the HTTP write authenticates before parsing and returns JSON refusals", () => {
  const route = readFileSync("src/app/api/meetings/[id]/rsvp/route.ts", "utf8");
  const guard = route.indexOf('holdsSeatFor(user, "meetings.rsvp")');
  const session = route.indexOf("await getCurrentSession()");
  assert.ok(session > 0 && session < guard);
  assert.ok(guard > 0 && guard < route.indexOf("safeParse"));
  assert.ok(guard < route.indexOf("req.json"));
  for (const status of [400, 401, 403, 404, 500])
    assert.ok(route.includes(`status: ${status}`));
  assert.match(route, /saveOwnRsvp\(user, id.data, input.data.response\)/);
});
