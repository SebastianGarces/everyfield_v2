import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { db } from "@/db";
import { resend } from "@/lib/email/client";
import { sendCommunication, resendToNonOpeners } from "./send";

for (const unsafe of [
  { ownerName: "Pastor {{first_name}}", subject: "From {{pastor_name}}" },
  { ownerName: "{{first_", subject: "From {{pastor_name}}name}}" },
  { ownerName: "name}}", subject: "From {{first_{{pastor_name}}" },
  { ownerName: "first_name", subject: "From {{{{pastor_name}}}}" },
  { ownerName: "", subject: "From {{first_{{pastor_name}}name}}" },
]) {
  test(`unsafe Owner value ${JSON.stringify(unsafe.ownerName)} refuses before persistence/provider calls`, async () => {
    let reads = 0;
    let writes = 0;
    let sends = 0;
    const select = mock.method(db, "select", () => {
      const rows =
        reads++ === 0
          ? [
              {
                name: "828 Test Church",
                ownerName: unsafe.ownerName,
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
          subject: unsafe.subject,
          body: "<p>Hello {{first_name}}</p>",
          channel: "email",
          recipientIds: ["828-recipient"],
        }),
        /Cannot send with plant merge fields/
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
}

for (const scenario of [
  {
    name: "historical plain-text message",
    subject: "{{pastor_name}} | {{launch_date}} | {{first_name}}",
    body: "Hello {{first_name}}\n{{pastor_name}}\n{{launch_date}}",
    bodyHtml: null,
    expectedSubject: "| | {{first_name}}",
    expectedBody: "Hello {{first_name}}",
  },
  {
    name: "Evri-shaped unresolved message",
    subject: "{{pastor_name}} | {{launch_date}} | {{first_name}}",
    body: "Hello {{first_name}}\n{{pastor_name}}\n{{launch_date}}",
    bodyHtml:
      "<p>Hello {{first_name}}</p><p>{{pastor_name}}</p><p>{{launch_date}}</p>",
    expectedSubject: "| | {{first_name}}",
    expectedBody: "Hello {{first_name}}",
  },
  {
    name: "new ordinary frozen message",
    subject: "Original Pastor | September 13, 2026 | {{first_name}}",
    body: "Hello {{first_name}}\nOriginal Pastor\nSeptember 13, 2026",
    bodyHtml:
      "<p>Hello {{first_name}}</p><p>Original Pastor</p><p>September 13, 2026</p>",
    expectedSubject: "Original Pastor | September 13, 2026 | {{first_name}}",
    expectedBody:
      "Hello {{first_name}}\n\nOriginal Pastor\n\nSeptember 13, 2026",
  },
]) {
  test(`resend preserves ${scenario.name} before persistence`, async () => {
    let reads = 0;
    let writes = 0;
    const stop = new Error("Captured resend insert");
    const responses = [
      [
        {
          ...scenario,
          status: "sent",
          sentAt: new Date("2020-01-01"),
          channel: "email",
        },
      ],
      [{ total: 1, delivered: 1, opened: 0 }],
      [
        {
          name: "828 Plant",
          ownerName: "Replacement Pastor",
          leadershipStatus: "planter_confirmed",
        },
      ],
      [{ targetDate: "2027-01-03" }],
      [
        {
          id: "828-recipient",
          firstName: "Jo",
          lastName: "Test",
          email: "owned@example.invalid",
        },
      ],
    ];
    function query(rows: unknown[]) {
      const promise = Promise.resolve(rows);
      const chain = {
        from: () => chain,
        leftJoin: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: () => promise,
        then: promise.then.bind(promise),
      };
      return chain;
    }
    const select = mock.method(db, "select", () => query(responses[reads++]));
    const distinct = mock.method(db, "selectDistinct", () =>
      query([{ personId: "828-recipient" }])
    );
    const insert = mock.method(db, "insert", () => ({
      values(value: { subject: string; body: string; bodyHtml: string }) {
        writes++;
        assert.equal(value.subject, scenario.expectedSubject);
        assert.equal(value.body, scenario.expectedBody);
        assert.doesNotMatch(
          value.bodyHtml,
          /Replacement Pastor|January 3, 2027|\{\{pastor_name\}\}|\{\{launch_date\}\}/
        );
        assert.match(value.bodyHtml, /\{\{first_name\}\}/);
        throw stop;
      },
    }));
    try {
      await assert.rejects(
        resendToNonOpeners("828-plant", "828-actor", "828-original"),
        (error) => error === stop
      );
      assert.equal(reads, 5);
      assert.equal(writes, 1);
    } finally {
      select.mock.restore();
      distinct.mock.restore();
      insert.mock.restore();
    }
  });
}
