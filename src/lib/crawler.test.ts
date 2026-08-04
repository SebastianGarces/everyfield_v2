import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { isCrawlerUserAgent } from "./crawler";

// ============================================================================
// #240. The crawler signal is derived from the request's own `user-agent`, in
// one shared predicate, by both the proxy and the dashboard layout. The second
// half of this file is the part that actually pins the fix: the app may not
// read `x-is-crawler` off a request anywhere, because that header is written by
// nothing in this codebase and so can only ever have come from the client.
// ============================================================================

const KNOWN_CRAWLERS = [
  "facebookexternalhit/1.1",
  "Twitterbot/1.0",
  "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
  "Slackbot-LinkExpanding 1.0",
  "TelegramBot (like TwitterBot)",
  "WhatsApp/2.23.20.0",
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

test("a missing or empty user-agent is not a crawler", () => {
  // `headers().get()` returns null when the header is absent, and the predicate
  // takes that value raw so no caller has to remember to normalise it.
  assert.equal(isCrawlerUserAgent(null), false);
  assert.equal(isCrawlerUserAgent(undefined), false);
  assert.equal(isCrawlerUserAgent(""), false);
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
