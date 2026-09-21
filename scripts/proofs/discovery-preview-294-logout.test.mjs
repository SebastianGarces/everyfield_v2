import assert from "node:assert/strict";
import test from "node:test";
import { logoutSession } from "./discovery-preview-294-logout.mjs";

function fixture(statuses, clickFails = false) {
  const actions = [];
  let disposed = 0;
  const context = {
    request: {
      async get(url, options) {
        assert.equal(
          url,
          "https://proof.vercel.app/api/settings/sections/profile"
        );
        assert.equal(options.maxRedirects, 0);
        const status = statuses.shift();
        return {
          status: () => status,
          dispose: async () => {
            disposed++;
          },
        };
      },
    },
  };
  const page = {
    async goto(url) {
      actions.push(url);
    },
    getByRole(role, options) {
      assert.equal(role, "button");
      return {
        async click() {
          actions.push(options.name);
          if (clickFails) throw new Error("UI unavailable");
        },
      };
    },
    async waitForURL(predicate) {
      assert.equal(predicate(new URL("https://proof.vercel.app/login")), true);
      actions.push("login");
    },
  };
  return { context, page, actions, disposed: () => disposed, outcome: {} };
}

test("authenticated session uses app logout and verifies same-cookie-jar 401", async () => {
  const f = fixture([200, 401]);
  await logoutSession(f.context, f.page, "https://proof.vercel.app", f.outcome);
  assert.deepEqual(f.actions, [
    "https://proof.vercel.app/dashboard",
    "Account menu",
    "Log out",
    "login",
  ]);
  assert.deepEqual(f.outcome, {
    status: "LOGGED_OUT_VERIFIED",
    probeStatus: 401,
  });
  assert.equal(f.disposed(), 2);
});
test("never-authenticated context skips logout without failure", async () => {
  const f = fixture([401]);
  await logoutSession(f.context, f.page, "https://proof.vercel.app", f.outcome);
  assert.deepEqual(f.actions, []);
  assert.equal(f.outcome.status, "NOT_AUTHENTICATED");
});
test("remaining session or redirect does not pass logout verification", async () => {
  for (const status of [200, 302, 403, 500]) {
    const f = fixture([200, status]);
    await assert.rejects(
      logoutSession(f.context, f.page, "https://proof.vercel.app", f.outcome)
    );
    assert.equal(f.outcome.probeStatus, status);
    assert.notEqual(f.outcome.status, "LOGGED_OUT_VERIFIED");
  }
});
test("probe and UI failures cannot become successful logout", async () => {
  for (const f of [fixture([302]), fixture([200], true)]) {
    await assert.rejects(
      logoutSession(f.context, f.page, "https://proof.vercel.app", f.outcome)
    );
    assert.notEqual(f.outcome.status, "LOGGED_OUT_VERIFIED");
  }
});
