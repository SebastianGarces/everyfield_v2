import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  sessions,
  passwordResetRequests,
  emailChangeRequests,
} from "@/db/schema";
import { hashPassword, verifyPassword } from "./password";
import { createSession, generateSessionToken } from "./session";
import {
  requestPasswordReset,
  resetPassword,
  newPasswordResetToken,
  hashPasswordResetToken,
} from "./password-reset";
import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_LINK_DEAD_MESSAGE,
} from "./password-reset-policy";
import { changeOwnPassword } from "./password-change";
import { confirmEmailChange, requestEmailChange } from "./email-change";
import { hashEmailChangeToken } from "./account-email";
import type { AttemptLimiter } from "./attempt-limiter";
import type { PasswordResetMailDeps } from "./password-reset-email";
const skip = process.env.LIVE_DB_TESTS !== "1";
const ids: string[] = [];
const password = "Recovery original local password";
const limiter: AttemptLimiter = {
  count: async () => 0,
  record: async () => {},
};
const dead = {
  ok: false,
  field: null,
  message: PASSWORD_RESET_LINK_DEAD_MESSAGE,
};
async function account() {
  const connection = new URL(process.env.DATABASE_URL!);
  if (process.env.EVERYFIELD_OWNED_PREVIEW === "1") {
    assert.equal(connection.hostname, "localhost");
    assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  } else {
    // The standard live lane gives this file its own explicitly named scratch DB.
    assert.equal(connection.pathname, "/live_lib_auth_password_reset_live");
    const endpoint = new URL(
      process.env.NEON_HTTP_PROXY_URL ?? "http://localhost:4444/sql"
    );
    assert.ok(["localhost", "127.0.0.1"].includes(endpoint.hostname));
  }
  const [u] = await db
    .insert(users)
    .values({
      email: `reset-${randomUUID()}@example.test`,
      name: "Recovery QA",
      passwordHash: await hashPassword(password),
    })
    .returning();
  ids.push(u.id);
  return u;
}
function capture() {
  const messages: string[] = [];
  const mail: PasswordResetMailDeps = {
    baseUrl: "http://recovery.localhost",
    send: async (m) => {
      messages.push(m.text);
      return { success: true };
    },
  };
  return {
    messages,
    mail,
    token: () => {
      const value = messages
        .join("\n")
        .match(/\/reset-password\?token=([a-f0-9]{64})/);
      assert.ok(value, "captured reset link");
      return value[1];
    },
  };
}
async function issue(u: Awaited<ReturnType<typeof account>>, c = capture()) {
  assert.deepEqual(
    await requestPasswordReset({
      requestedEmail: u.email,
      ip: null,
      mail: c.mail,
      limiter,
    }),
    { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE }
  );
  return { ...c, value: c.token() };
}
async function redeem(
  token: string,
  mail: PasswordResetMailDeps = { send: async () => ({ success: true }) }
) {
  return resetPassword({
    token,
    password: "Recovery replacement password",
    confirmPassword: "Recovery replacement password",
    ip: null,
    mail,
    limiter,
  });
}
after(async () => {
  if (skip) return;
  for (const id of ids) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});
test(
  "recovery request is generic for known, unknown, rate limited and provider failure",
  { skip },
  async () => {
    const u = await account();
    const expected = { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE };
    for (const email of [u.email, `unknown-${randomUUID()}@example.test`])
      assert.deepEqual(
        await requestPasswordReset({
          requestedEmail: email,
          ip: null,
          limiter,
          mail: {
            send: async () => {
              throw new Error("local provider outage");
            },
          },
        }),
        expected
      );
    assert.deepEqual(
      await requestPasswordReset({
        requestedEmail: u.email,
        ip: null,
        limiter: { ...limiter, count: async () => 3 },
      }),
      expected
    );
  }
);
test(
  "request snapshots credentials, expires in one hour and defers mail only after durable write",
  { skip },
  async () => {
    const u = await account();
    const c = capture();
    let deferred: (() => Promise<void>) | undefined;
    const now = new Date();
    await requestPasswordReset({
      requestedEmail: u.email.toUpperCase(),
      ip: null,
      now,
      mail: c.mail,
      limiter,
      deferSend: (send) => {
        deferred = send;
      },
    });
    assert.equal(c.messages.length, 0);
    const [r] = await db
      .select()
      .from(passwordResetRequests)
      .where(eq(passwordResetRequests.userId, u.id));
    assert.equal(r.emailSnapshot, u.email);
    assert.equal(r.passwordHashSnapshot, u.passwordHash);
    assert.equal(r.expiresAt.getTime() - now.getTime(), 3600000);
    assert.ok(deferred);
    await deferred();
    assert.equal(r.tokenHash, hashPasswordResetToken(c.token()));
    assert.notEqual(r.tokenHash, c.token());
    assert.equal(
      (await db.select().from(users).where(eq(users.id, u.id)))[0].passwordHash,
      u.passwordHash
    );
  }
);
test(
  "successful recovery consumes links, invalidates pending email changes and every session without login",
  { skip },
  async () => {
    const u = await account();
    const c = await issue(u);
    await createSession(generateSessionToken(), u.id);
    await createSession(generateSessionToken(), u.id);
    await db.insert(emailChangeRequests).values({
      userId: u.id,
      newEmail: `new-${randomUUID()}@example.test`,
      tokenHash: hashEmailChangeToken(randomUUID()),
      expiresAt: new Date(Date.now() + 3600000),
    });
    assert.deepEqual(await redeem(c.value), { ok: true });
    const [updated] = await db.select().from(users).where(eq(users.id, u.id));
    assert.ok(
      await verifyPassword(
        updated.passwordHash,
        "Recovery replacement password"
      )
    );
    assert.equal(
      (await db.select().from(sessions).where(eq(sessions.userId, u.id)))
        .length,
      0
    );
    assert.equal(
      (
        await db
          .select()
          .from(passwordResetRequests)
          .where(
            and(
              eq(passwordResetRequests.userId, u.id),
              isNull(passwordResetRequests.consumedAt)
            )
          )
      ).length,
      0
    );
    assert.equal(
      (
        await db
          .select()
          .from(emailChangeRequests)
          .where(
            and(
              eq(emailChangeRequests.userId, u.id),
              isNull(emailChangeRequests.consumedAt)
            )
          )
      ).length,
      0
    );
    assert.deepEqual(await redeem(c.value), dead);
  }
);
test(
  "malformed password does not burn a valid recovery token",
  { skip },
  async () => {
    const c = await issue(await account());
    const bad = await resetPassword({
      token: c.value,
      password: "short",
      confirmPassword: "short",
      ip: null,
      limiter,
    });
    assert.equal(bad.ok, false);
    assert.deepEqual(await redeem(c.value), { ok: true });
  }
);
test(
  "a second request supersedes the first and dead tokens share one response",
  { skip },
  async () => {
    const u = await account();
    const a = await issue(u),
      b = await issue(u);
    assert.notEqual(a.value, b.value);
    assert.deepEqual(await redeem(a.value), dead);
    assert.deepEqual(await redeem(newPasswordResetToken()), dead);
    assert.deepEqual(await redeem(b.value), { ok: true });
  }
);
test(
  "expired token and exact expiry boundary refuse without credential changes",
  { skip },
  async () => {
    const u = await account();
    const c = await issue(u);
    await db
      .update(passwordResetRequests)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(passwordResetRequests.userId, u.id));
    assert.deepEqual(await redeem(c.value), dead);
    assert.equal(
      (await db.select().from(users).where(eq(users.id, u.id)))[0].passwordHash,
      u.passwordHash
    );
  }
);
test(
  "email or password snapshot changes invalidate a recovery link",
  { skip },
  async () => {
    for (const field of ["email", "passwordHash"]) {
      const u = await account();
      const c = await issue(u);
      await db
        .update(users)
        .set(
          field === "email"
            ? { email: `changed-${randomUUID()}@example.test` }
            : { passwordHash: await hashPassword("changed local password") }
        )
        .where(eq(users.id, u.id));
      assert.deepEqual(await redeem(c.value), dead);
    }
  }
);
test(
  "concurrent token redemptions grant exactly one password rotation",
  { skip },
  async () => {
    const c = await issue(await account());
    const results = await Promise.all([redeem(c.value), redeem(c.value)]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok).length, 1);
  }
);
test(
  "authenticated password change invalidates pending recovery and email links and keeps only its own session",
  { skip },
  async () => {
    const u = await account(),
      c = await issue(u);
    const session = await createSession(generateSessionToken(), u.id);
    await createSession(generateSessionToken(), u.id);
    await db.insert(emailChangeRequests).values({
      userId: u.id,
      newEmail: `new-${randomUUID()}@example.test`,
      tokenHash: hashEmailChangeToken(randomUUID()),
      expiresAt: new Date(Date.now() + 3600000),
    });
    const result = await changeOwnPassword({
      actor: u,
      currentSessionId: session.id,
      currentPassword: password,
      newPassword: "Authenticated replacement password",
      ip: null,
      limiter,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(await redeem(c.value), dead);
    assert.equal(
      (await db.select().from(sessions).where(eq(sessions.userId, u.id)))
        .length,
      1
    );
    assert.equal(
      (
        await db
          .select()
          .from(emailChangeRequests)
          .where(
            and(
              eq(emailChangeRequests.userId, u.id),
              isNull(emailChangeRequests.consumedAt)
            )
          )
      ).length,
      0
    );
  }
);
test(
  "confirmed email change invalidates recovery tokens",
  { skip },
  async () => {
    const u = await account(),
      c = await issue(u);
    let token = "";
    const mail = {
      baseUrl: "http://recovery.localhost",
      send: async (m: { text: string }) => {
        token = m.text.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? token;
        return { success: true };
      },
    };
    assert.equal(
      (
        await requestEmailChange({
          actor: u,
          requestedEmail: `new-${randomUUID()}@example.test`,
          currentPassword: password,
          ip: null,
          limiter,
          mail,
        })
      ).ok,
      true
    );
    assert.ok(token);
    assert.equal(
      (await confirmEmailChange({ actor: u, token, ip: null, limiter, mail }))
        .ok,
      true
    );
    assert.deepEqual(await redeem(c.value), dead);
  }
);
test(
  "notification provider failure cannot undo a committed recovery",
  { skip },
  async () => {
    const c = await issue(await account());
    assert.deepEqual(
      await redeem(c.value, {
        send: async () => {
          throw new Error("local notice failure");
        },
      }),
      { ok: true }
    );
    assert.deepEqual(await redeem(c.value), dead);
  }
);

test(
  "stale pre-recovery actor cannot create or supersede an email-change request",
  { skip },
  async () => {
    const u = await account(),
      c = await issue(u);
    assert.deepEqual(await redeem(c.value), { ok: true });
    const [fresh] = await db.select().from(users).where(eq(users.id, u.id));
    const mail = {
      baseUrl: "http://recovery.localhost",
      send: async () => ({ success: true }),
    };
    assert.equal(
      (
        await requestEmailChange({
          actor: fresh,
          requestedEmail: `legitimate-${randomUUID()}@example.test`,
          currentPassword: "Recovery replacement password",
          ip: null,
          limiter,
          mail,
        })
      ).ok,
      true
    );
    const [before] = await db
      .select()
      .from(emailChangeRequests)
      .where(
        and(
          eq(emailChangeRequests.userId, u.id),
          isNull(emailChangeRequests.consumedAt)
        )
      );
    let sent = 0;
    const result = await requestEmailChange({
      actor: u,
      requestedEmail: `stale-${randomUUID()}@example.test`,
      currentPassword: password,
      ip: null,
      limiter,
      mail: {
        ...mail,
        send: async () => {
          sent++;
          return { success: true };
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(sent, 0);
    const rows = await db
      .select()
      .from(emailChangeRequests)
      .where(
        and(
          eq(emailChangeRequests.userId, u.id),
          isNull(emailChangeRequests.consumedAt)
        )
      );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, before.id);
  }
);
