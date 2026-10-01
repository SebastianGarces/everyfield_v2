import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPasswordResetLink,
  buildPasswordResetNotice,
  sendPasswordResetLink,
  sendPasswordResetNotice,
} from "./password-reset-email";
const facts = {
  to: "synthetic@preview.example.test",
  recipientName: "<script>never</script>",
  token: "a".repeat(64),
  expiresAt: new Date("2026-10-01T12:00:00Z"),
};
test("reset message gives exact trusted URL, expiry and ignore advice in HTML and text", async () => {
  const message = await buildPasswordResetLink(facts, "https://example.test");
  for (const body of [message.html, message.text]) {
    assert.ok(
      body.includes("https://example.test/reset-password?token=" + facts.token)
    );
    assert.ok(body.includes("ignore this message"));
    assert.ok(body.includes("existing session"));
    assert.ok(body.includes("expires"));
  }
  assert.ok(!message.html.includes("<script>never</script>"));
  assert.ok(message.html.length < 102400);
  assert.ok(!message.idempotencyKey.includes(facts.token));
});
test("rotating reset links gets distinct provider deduplication keys", async () => {
  assert.notEqual(
    (await buildPasswordResetLink(facts, "https://example.test"))
      .idempotencyKey,
    (
      await buildPasswordResetLink(
        { ...facts, token: "b".repeat(64) },
        "https://example.test"
      )
    ).idempotencyKey
  );
});
test("successful capture transport receives full message exactly once", async () => {
  const sent: unknown[] = [];
  assert.equal(
    await sendPasswordResetLink(facts, {
      baseUrl: "https://example.test",
      send: async (m) => {
        sent.push(m);
        return { success: true };
      },
    }),
    true
  );
  assert.equal(sent.length, 1);
});
test("refused and thrown provider responses stay best effort without credential logs", async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args) => {
    logged.push(args);
  };
  try {
    assert.equal(
      await sendPasswordResetLink(facts, {
        send: async () => ({ success: false, error: facts.token }),
      }),
      false
    );
    assert.equal(
      await sendPasswordResetLink(facts, {
        send: async () => {
          throw new Error(facts.token);
        },
      }),
      false
    );
    assert.ok(!JSON.stringify(logged).includes(facts.token));
    assert.ok(!JSON.stringify(logged).includes(facts.to));
  } finally {
    console.error = original;
  }
});
test("reset notice contains no bearer credential and names session revocation", async () => {
  const message = await buildPasswordResetNotice({
    to: facts.to,
    recipientName: null,
    changedAt: facts.expiresAt,
  });
  assert.ok(message.text.includes("All existing sessions"));
  assert.ok(!message.html.includes("token="));
  assert.ok(!message.text.includes(facts.token));
  assert.equal(
    await sendPasswordResetNotice(
      { to: facts.to, recipientName: null, changedAt: facts.expiresAt },
      { send: async () => ({ success: true }) }
    ),
    true
  );
});
