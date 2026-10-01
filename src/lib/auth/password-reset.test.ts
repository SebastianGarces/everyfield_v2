import assert from "node:assert/strict";
import { test } from "node:test";
import {
  newPasswordResetToken,
  hashPasswordResetToken,
  requestPasswordReset,
  resetPassword,
} from "./password-reset";
import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_LINK_DEAD_MESSAGE,
} from "./password-reset-policy";
import type { AttemptLimiter } from "./attempt-limiter";
import { authAttempts } from "@/db/schema";

const limited: AttemptLimiter = {
  count: async () => 3,
  record: async () => {
    throw new Error("limited requests must not write");
  },
};
test("recovery tokens have 256 random bits and only digests are stored", () => {
  const a = newPasswordResetToken(),
    b = newPasswordResetToken();
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
  assert.match(hashPasswordResetToken(a), /^[a-f0-9]{64}$/);
  assert.notEqual(hashPasswordResetToken(a), a);
});
test("limited and malformed request addresses have the same public outcome", async () => {
  const expected = { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE };
  assert.deepEqual(
    await requestPasswordReset({
      requestedEmail: "known@example.test",
      ip: null,
      limiter: limited,
    }),
    expected
  );
  assert.deepEqual(
    await requestPasswordReset({
      requestedEmail: "not an email",
      ip: null,
      limiter: limited,
    }),
    expected
  );
});
test("the recovery limit checks both identifier and IP using the common policy", async () => {
  const axes: unknown[] = [];
  const limiter: AttemptLimiter = {
    count: async (column, _value, kind, window) => {
      axes.push(column);
      assert.equal(kind, "password_reset");
      assert.equal(window, 3600000);
      return column === authAttempts.ip ? 10 : 0;
    },
    record: async () => {
      assert.fail("limited request wrote");
    },
  };
  assert.deepEqual(
    await requestPasswordReset({
      requestedEmail: "anything@example.test",
      ip: "192.0.2.1",
      limiter,
    }),
    { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE }
  );
  assert.deepEqual(axes, [authAttempts.identifier, authAttempts.ip]);
});
test("bad token shape gives the common dead-link refusal without database work", async () => {
  for (const token of ["", "unknown", "a".repeat(65)])
    assert.deepEqual(
      await resetPassword({
        token,
        password: "long password",
        confirmPassword: "long password",
        ip: null,
      }),
      { ok: false, field: null, message: PASSWORD_RESET_LINK_DEAD_MESSAGE }
    );
});
test("password shape and mismatch refuse without consuming a syntactically valid token", async () => {
  const token = "a".repeat(64);
  assert.equal(
    (
      (await resetPassword({
        token,
        password: "short",
        confirmPassword: "short",
        ip: null,
      })) as any
    ).field,
    "password"
  );
  assert.equal(
    (
      (await resetPassword({
        token,
        password: "x".repeat(1025),
        confirmPassword: "x".repeat(1025),
        ip: null,
      })) as any
    ).field,
    "password"
  );
  assert.equal(
    (
      (await resetPassword({
        token,
        password: "long password",
        confirmPassword: "different password",
        ip: null,
      })) as any
    ).field,
    "confirmPassword"
  );
});
