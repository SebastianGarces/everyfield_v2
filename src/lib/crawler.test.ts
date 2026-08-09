import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  isCrawlerPreviewableRoute,
  isCrawlerPreviewRequest,
  isCrawlerUserAgent,
} from "./crawler";

// ============================================================================
// #240. The crawler signal is derived from the request's own `user-agent`, in
// one shared predicate, by both the proxy and the dashboard layout. The second
// half of this file is the part that actually pins the fix: the app may not
// read `x-is-crawler` off a request anywhere, because that header is written by
// nothing in this codebase and so can only ever have come from the client.
// ============================================================================

/**
 * WhatsApp's link-preview fetcher: a bot. The token IS the whole UA, and the
 * trailing letter is the platform (A|I|N for Android/iOS/native).
 */
const WHATSAPP_FETCHER = "WhatsApp/2.23.20.0";

/**
 * WhatsApp's in-app browser: a HUMAN who tapped a shared link inside the app.
 * An ordinary WebView UA that merely mentions WhatsApp after the `Mozilla/5.0`
 * prefix — which is why the bare `whatsapp` substring used to misclassify them,
 * and why the token is anchored to the start of the UA (#297).
 */
const WHATSAPP_IN_APP =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 WhatsApp/2.24.15.78";

const KNOWN_CRAWLERS = [
  "facebookexternalhit/1.1",
  "Twitterbot/1.0",
  "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
  "Slackbot-LinkExpanding 1.0",
  "TelegramBot (like TwitterBot)",
  WHATSAPP_FETCHER,
  "Mozilla/5.0 (compatible; Applebot/0.1)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0)",
  "Mozilla/5.0 (compatible; Discordbot/2.0)",
];

test("a known crawler user-agent is recognised, case-insensitively", () => {
  for (const ua of KNOWN_CRAWLERS) {
    assert.equal(isCrawlerUserAgent(ua), true, ua);
    assert.equal(isCrawlerUserAgent(ua.toUpperCase()), true, ua);
  }
});

test("an ordinary browser is not a crawler", () => {
  const browsers = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    "curl/8.4.0",
  ];
  for (const ua of browsers) {
    assert.equal(isCrawlerUserAgent(ua), false, ua);
  }
});

// ============================================================================
// The WhatsApp token (#297, ruled 2026-08-04). WhatsApp sends two different
// User-Agents and only one of them is a bot. One real example of each is pinned
// below, because the whole tightening turns on what actually separates them:
// the fetcher's UA STARTS with the token, the in-app browser's starts with
// `Mozilla/5.0` and only mentions it later.
// ============================================================================

test("WhatsApp's link-preview fetcher is a crawler", () => {
  for (const ua of [
    WHATSAPP_FETCHER,
    "WhatsApp/2.24.15.78 A", // Android
    "WhatsApp/2.18.61 i", // iOS
    "WhatsApp/2.2412.54 N", // native/desktop
  ]) {
    assert.equal(isCrawlerUserAgent(ua), true, ua);
    assert.equal(isCrawlerUserAgent(ua.toUpperCase()), true, ua);
  }

  // A leading space is not a different client — the anchor is on the token, not
  // on the raw byte the header happens to begin with.
  assert.equal(isCrawlerUserAgent(`  ${WHATSAPP_FETCHER}`), true);
});

test("WhatsApp's in-app browser is NOT a crawler — it is a person", () => {
  // The defect the tightening fixes: a human tapping a shared link inside
  // WhatsApp was classified as a bot by the bare `whatsapp` substring.
  assert.equal(isCrawlerUserAgent(WHATSAPP_IN_APP), false);
  assert.equal(isCrawlerUserAgent(WHATSAPP_IN_APP.toUpperCase()), false);

  // Other shapes of the same mistake: the token anywhere but the start.
  for (const ua of [
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/;WhatsApp/2.23]",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsAppBusiness/2.24",
    "Mozilla/5.0 whatsapp",
  ]) {
    assert.equal(isCrawlerUserAgent(ua), false, ua);
  }
});

test("a missing or empty user-agent is not a crawler", () => {
  // `headers().get()` returns null when the header is absent, and the predicate
  // takes that value raw so no caller has to remember to normalise it.
  assert.equal(isCrawlerUserAgent(null), false);
  assert.equal(isCrawlerUserAgent(undefined), false);
  assert.equal(isCrawlerUserAgent(""), false);
});

// ============================================================================
// The route scope (ruled 2026-08-04). A crawler User-Agent is only half the
// allowance: the other half is being on a route that renders without a session.
// Every other route under `(dashboard)` needs one, so a crawler there gets the
// same redirect a human gets — not the bare shell and the 500 that follows it.
// ============================================================================

const GOOGLEBOT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** The routes the proxy admits a session-less crawler to. */
const PREVIEWABLE = [
  "/wiki",
  "/wiki/getting-started",
  "/wiki/church-planting/first-steps",
  "/oversight",
  "/oversight/health",
];

/** Everything else under `(dashboard)` — each one needs a session. */
const NOT_PREVIEWABLE = [
  // `/dashboard` is protected but NOT previewable (#297): the page calls
  // `verifySession()`, so the listing promised what the page could not keep and
  // every crawler-UA request to it 500'd. Off the list, a crawler gets the
  // proxy's 307 to /login exactly like a session-less browser.
  "/dashboard",
  "/dashboard/overview",
  "/people",
  "/people/abc-123",
  "/settings",
  "/settings/sharing",
  "/tasks",
  "/teams",
  "/teams/org-chart",
  "/meetings",
  "/notifications",
  "/communication",
  "/documents",
  "/phase",
  "/admin/feedback",
];

test("the previewable routes are exactly the ones the proxy admits", () => {
  for (const pathname of PREVIEWABLE) {
    assert.equal(isCrawlerPreviewableRoute(pathname), true, pathname);
  }
  for (const pathname of NOT_PREVIEWABLE) {
    assert.equal(isCrawlerPreviewableRoute(pathname), false, pathname);
  }
});

test("a prefix match is a path-segment match, not a string match", () => {
  // `/wikileaks` is not `/wiki`. A prefix that matched loosely would hand the
  // bare shell to any route someone names with the right first few letters.
  for (const pathname of [
    "/wikileaks",
    "/dashboards",
    "/oversight-report",
    "/not/wiki",
    "/people/wiki",
  ]) {
    assert.equal(isCrawlerPreviewableRoute(pathname), false, pathname);
  }
});

test("an unknown pathname is not previewable — the check fails closed", () => {
  // Null is what `headers().get()` returns when the proxy did not run. That is
  // never a licence to render the session-less shell.
  assert.equal(isCrawlerPreviewableRoute(null), false);
  assert.equal(isCrawlerPreviewableRoute(undefined), false);
  assert.equal(isCrawlerPreviewableRoute(""), false);
});

test("the allowance needs BOTH halves: a crawler AND a previewable route", () => {
  assert.equal(
    isCrawlerPreviewRequest(GOOGLEBOT, "/wiki/getting-started"),
    true
  );

  // A crawler somewhere it may not preview — the case that used to 500.
  for (const pathname of NOT_PREVIEWABLE) {
    assert.equal(isCrawlerPreviewRequest(GOOGLEBOT, pathname), false, pathname);
  }

  // A browser on a previewable route is still a browser: no bare shell for it.
  for (const pathname of PREVIEWABLE) {
    assert.equal(isCrawlerPreviewRequest(CHROME, pathname), false, pathname);
  }

  // No UA, no pathname, neither — all closed.
  assert.equal(isCrawlerPreviewRequest(null, "/wiki"), false);
  assert.equal(isCrawlerPreviewRequest(GOOGLEBOT, null), false);
  assert.equal(isCrawlerPreviewRequest(null, null), false);
});

test("a human in WhatsApp's in-app browser is never given the crawler shell", () => {
  // Belt and braces, and deliberately so: this person is now excluded by BOTH
  // halves of the allowance. The token no longer matches their UA at all (#297),
  // and even the routes a real fetcher may preview are closed to them.
  for (const pathname of [...NOT_PREVIEWABLE, ...PREVIEWABLE]) {
    assert.equal(
      isCrawlerPreviewRequest(WHATSAPP_IN_APP, pathname),
      false,
      pathname
    );
  }
});

test("WhatsApp's fetcher previews a wiki article and nothing else", () => {
  // The other side of the same tightening: the bot still gets what it came for.
  assert.equal(
    isCrawlerPreviewRequest(WHATSAPP_FETCHER, "/wiki/getting-started"),
    true
  );
  assert.equal(isCrawlerPreviewRequest(WHATSAPP_FETCHER, "/dashboard"), false);
  assert.equal(isCrawlerPreviewRequest(WHATSAPP_FETCHER, "/people"), false);
});

// --- the regression guard ---------------------------------------------------

const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Source with comments removed — crude, but this is only ever used to decide
 * whether a header name appears in CODE. The files that explain #240 name the
 * header in prose, and prose is not a read of it.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("no source file trusts an x-is-crawler request header", () => {
  // A grep, deliberately: the defect was one `headers().get(...)` in a Server
  // Component that no unit test can reach, and what has to stay true is a
  // property of the whole tree rather than of any one call. Nothing sets this
  // header either, so an occurrence anywhere is a read of client input — which
  // is exactly the trap #240 removed.
  const offenders = sourceFiles(SRC).filter((file) =>
    /x-is-crawler/i.test(code(file))
  );

  assert.deepEqual(
    offenders.map((f) => path.relative(process.cwd(), f)),
    [],
    "x-is-crawler is client-forgeable and is written by nothing in this app; derive the crawler signal from `user-agent` via isCrawlerUserAgent instead"
  );
});

test("the dashboard layout decides on the route as well as the user-agent", () => {
  // Also a grep, for the same reason: the branch lives in a Server Component
  // that renders behind a session and a proxy, so no unit test can execute it.
  // What must stay true is that the layout asks the two-input question. A bare
  // `isCrawlerUserAgent(...)` there is the group-wide allowance coming back —
  // the one that answered a crawler-shaped UA with a 500 on /people.
  const layout = code(
    path.join(SRC, "app", "(dashboard)", "layout.tsx")
  ).replace(/\s+/g, " ");

  assert.match(
    layout,
    /isCrawlerPreviewRequest\(/,
    "the dashboard layout must scope the crawler shell with isCrawlerPreviewRequest(user-agent, pathname)"
  );
  assert.doesNotMatch(
    layout,
    /isCrawlerUserAgent\(/,
    "the dashboard layout must not grant the session-less shell on the user-agent alone — that is the group-wide allowance ruled out on 2026-08-04"
  );
});
