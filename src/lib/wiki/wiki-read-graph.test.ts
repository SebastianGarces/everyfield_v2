import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { CRAWLER_PREVIEWABLE_ROUTE_PREFIXES } from "@/lib/crawler";
import {
  SRC,
  codeOf,
  isUseClientModule,
  isUseServerModule,
  rel,
  resolveModule,
  valueSpecifiers,
} from "@/lib/auth/server-action-surface";

// ============================================================================
// `/wiki` RENDERS WITHOUT A SESSION, AND ITS IMPORT GRAPH HAS TO AGREE.
//
// `/wiki` is the one entry in `CRAWLER_PREVIEWABLE_ROUTE_PREFIXES`, and being
// on that list is a promise: this route produces a session-less render worth
// previewing. The proxy's crawler branch is the only door into it without a
// cookie, so nothing on the render path may throw for want of one.
//
// #297 IS WHAT HAPPENS WHEN THE GRAPH DISAGREES. `/dashboard` was on that list
// while its page called `verifySession()`; every crawler-UA request 500'd, and
// the ruling of 2026-08-04 took the prefix off the list rather than keep a page
// that could not keep the promise. #498 re-created the same shape one route
// over — the wiki's bookmark and progress READS lived in `"use server"` modules
// and were converted to `requireSeat`, which throws — and nothing caught it,
// because every test that exercises those functions has a session.
//
// SO THE CLAIM IS ABOUT THE GRAPH, NOT ABOUT A CALL. A `"use server"` module is
// where the throwing guards are, and a server component that imports one is one
// edit away from calling it during render. The reads a page needs live in
// `./reads`, which carries no directive; the writes stay behind `requireSeat`
// and are imported by the CLIENT components that press them, which is the
// boundary this walk stops at.
// ============================================================================

/** Every server file `/wiki` renders through. */
const WIKI_ENTRIES = [
  ["app", "(dashboard)", "wiki", "layout.tsx"],
  ["app", "(dashboard)", "wiki", "page.tsx"],
  ["app", "(dashboard)", "wiki", "progress", "page.tsx"],
  ["app", "(dashboard)", "wiki", "[...slug]", "page.tsx"],
].map((segments) => path.join(SRC, ...segments));

/**
 * Every module reachable from `entry` on the SERVER render path.
 *
 * The walk stops at a `"use client"` boundary, and that is not a convenience:
 * a client component runs in the browser and reaches an action by POSTing to
 * it, so `bookmark-button.tsx` importing `toggleBookmark` is the shape the
 * product is supposed to have. What must not happen is a SERVER component
 * holding that import, because there the call is a function call during render.
 */
function serverGraphOf(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    if (file !== entry && isUseClientModule(file)) continue;

    for (const specifier of valueSpecifiers(codeOf(file))) {
      const target = resolveModule(file, specifier);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }

  return [...seen];
}

test('the /wiki render path imports no "use server" module', () => {
  assert.deepEqual(
    [...CRAWLER_PREVIEWABLE_ROUTE_PREFIXES],
    ["/wiki"],
    "the crawler-previewable list changed — this suite covers /wiki and only /wiki, so a new prefix needs its own entries here or its own suite"
  );

  const offenders: string[] = [];

  for (const entry of WIKI_ENTRIES) {
    for (const file of serverGraphOf(entry)) {
      if (isUseServerModule(file)) {
        offenders.push(`${rel(entry)} → … → ${rel(file)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a `"use server"` module is on the /wiki SERVER render path. Every export of one is guarded by `requireSeat`, which THROWS with no session — and /wiki is the one route a session-less crawler is admitted to (@/lib/crawler), so that throw is a 500 on a public URL. Move the read into `src/lib/wiki/reads.ts`, which has no directive and answers a null session with an empty result:\n  ' +
      offenders.join("\n  ")
  );
});

test("the reads module is a plain module and answers a session-less caller", () => {
  // The other half: the walk above is only meaningful while `reads.ts` stays
  // the place those functions live AND stays undirected. A directive added here
  // would move seven render-path calls behind a throwing guard in one edit.
  const reads = path.join(SRC, "lib", "wiki", "reads.ts");

  assert.equal(isUseServerModule(reads), false);
  assert.equal(isUseClientModule(reads), false);

  const code = codeOf(reads);

  assert.ok(
    !/\brequireSeat\s*\(/.test(code),
    "a read on the /wiki render path may not call the seat guard — it throws"
  );

  // Seven reads, each opening on the nullable session read. `getCurrentSession`
  // is the one whose failure shape is a null user rather than a throw.
  const opens = code.match(/await getCurrentSession\(\)/g) ?? [];
  assert.equal(opens.length, 7, "one nullable session read per exported read");

  const guards = code.match(/if \(!session\?\.user/g) ?? [];
  assert.equal(
    guards.length,
    7,
    "every read must answer a session-less caller with an empty result"
  );
});

test("the wiki barrel does not re-serve the two action modules", () => {
  // `@/lib/wiki` is what the pages import. A `export * from "./bookmarks"` here
  // puts an endpoint module in the graph of every one of them at once, which is
  // exactly how the reads and the writes came to share a file.
  const barrel = codeOf(path.join(SRC, "lib", "wiki", "index.ts"));

  assert.ok(!/from "\.\/bookmarks"/.test(barrel));
  assert.ok(!/from "\.\/progress"/.test(barrel));
  assert.match(barrel, /export \* from "\.\/reads"/);
});
