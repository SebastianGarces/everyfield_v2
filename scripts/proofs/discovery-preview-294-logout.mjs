import assert from "node:assert/strict";

// Uses the context's cookie jar without exposing cookies or response bodies.
export async function logoutSession(context, page, origin, outcome) {
  const endpoint = new URL("/api/settings/sections/profile", origin).href;
  async function probe() {
    const response = await context.request.get(endpoint, {
      maxRedirects: 0,
      timeout: 10000,
      headers: { "cache-control": "no-cache" },
    });
    try {
      return response.status();
    } finally {
      await response.dispose();
    }
  }
  outcome.status = "CHECKING_AUTHENTICATION";
  const before = await probe();
  if (before === 401) {
    outcome.status = "NOT_AUTHENTICATED";
    return;
  }
  assert.equal(before, 200, "Authentication probe must return 200 or 401");
  outcome.status = "LOGOUT_PENDING";
  // Leave any modal/error route before using the normal account menu action.
  await page.goto(new URL("/dashboard", origin).href);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/login");
  const after = await probe();
  outcome.probeStatus = after;
  assert.equal(after, 401, "Authenticated endpoint must refuse after logout");
  outcome.status = "LOGGED_OUT_VERIFIED";
}
