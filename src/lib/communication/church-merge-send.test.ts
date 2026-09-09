import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { db } from "@/db";
import { resend } from "@/lib/email/client";
import { sendCommunication } from "./send";

test("a referenced merge-shaped Owner name refuses before communication persistence or provider calls", async () => {
  let reads = 0;
  let writes = 0;
  let sends = 0;
  const select = mock.method(db, "select", () => {
    const rows =
      reads++ === 0
        ? [
            {
              name: "828 Test Church",
              ownerName: "Pastor {{first_name}}",
              leadershipStatus: "planter_confirmed",
            },
          ]
        : [{ targetDate: "2026-09-13" }];
    const chain = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      limit: async () => rows,
    };
    return chain;
  });
  const insert = mock.method(db, "insert", () => {
    writes++;
    throw new Error("Unexpected persistence");
  });
  const send = mock.method(resend.batch, "send", async () => {
    sends++;
    throw new Error("Unexpected provider call");
  });
  try {
    await assert.rejects(
      sendCommunication("828-plant", "828-actor", {
        subject: "From {{pastor_name}}",
        body: "<p>Hello {{first_name}}</p>",
        channel: "email",
        recipientIds: ["828-recipient"],
      }),
      /Cannot send with.*pastor_name/
    );
    assert.equal(reads, 2);
    assert.equal(writes, 0);
    assert.equal(sends, 0);
  } finally {
    select.mock.restore();
    insert.mock.restore();
    send.mock.restore();
  }
});
