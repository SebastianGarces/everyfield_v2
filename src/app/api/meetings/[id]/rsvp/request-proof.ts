import assert from "node:assert/strict";
import { mock } from "node:test";
import { NextRequest } from "next/server";
import type { SeatFields } from "@/lib/auth/tenancy";

const member = {
  id: "11111111-1111-4111-8111-111111111111",
  churchId: "22222222-2222-4222-8222-222222222222",
  sendingChurchId: null,
  sendingNetworkId: null,
  seat: "member",
} satisfies SeatFields & { id: string };
let user: (SeatFields & { id: string }) | null = null;
const events: string[] = [];
const writes: unknown[][] = [];
let allowedSubject = true;
mock.module("@/lib/auth/session", {
  namedExports: {
    getCurrentSession: async () => {
      events.push("session");
      return { user };
    },
  },
});
mock.module("@/lib/meetings/own-rsvp", {
  namedExports: {
    saveOwnRsvp: async (...args: unknown[]) => {
      events.push("write");
      writes.push(args);
      return allowedSubject;
    },
  },
});

async function main() {
  const { POST } = await import("./route");
  const meetingId = "33333333-3333-4333-8333-333333333333";
  async function post(body: unknown, id = meetingId) {
    events.length = 0;
    writes.length = 0;
    const request = new NextRequest(
      `https://everyfield.test/api/meetings/${id}/rsvp`,
      { method: "POST" }
    );
    Object.defineProperty(request, "json", {
      value: async () => {
        events.push("parse");
        return body;
      },
    });
    return POST(request, { params: Promise.resolve({ id }) });
  }
  // Malformed inputs must not change the unauthenticated/unauthorized answer.
  for (const body of [{ response: "confirmed" }, { response: "invalid" }]) {
    user = null;
    const anonymous = await post(body, "invalid-id");
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), {
      error: "Sign in again to save your RSVP.",
    });
    assert.deepEqual(events, ["session"]);
    assert.equal(writes.length, 0);

    for (const denied of [
      { ...member, seat: null },
      { ...member, churchId: null, sendingChurchId: member.churchId },
      { ...member, churchId: null, sendingNetworkId: member.churchId },
      { ...member, sendingChurchId: member.churchId },
    ]) {
      user = denied;
      const response = await post(body, "invalid-id");
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: "Your account cannot update this RSVP.",
      });
      assert.deepEqual(events, ["session"]);
      assert.equal(writes.length, 0);
    }
  }
  user = member;
  const invalid = await post({ response: "attended" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(events, ["session", "parse"]);
  assert.equal(writes.length, 0);
  const forged = await post({
    response: "confirmed",
    personId: "another-person",
  });
  assert.equal(forged.status, 400);
  assert.equal(writes.length, 0);
  const valid = await post({ response: "confirmed" });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { success: true });
  assert.deepEqual(events, ["session", "parse", "write"]);
  assert.deepEqual(writes, [[member, meetingId, "confirmed"]]);
  allowedSubject = false;
  const unavailable = await post({ response: "declined" });
  assert.equal(unavailable.status, 404);
  assert.deepEqual(await unavailable.json(), {
    error: "Your invitation is unavailable. Reload the meeting.",
  });
  console.log("RSVP HTTP authorization proof passed");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
