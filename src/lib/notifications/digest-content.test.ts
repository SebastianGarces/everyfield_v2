import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  composePlanterDigestBody,
  composePlanterDigestTitle,
  currentDigestDedupeKeys,
  DEFAULT_WEEKLY_DIGEST_WEEKDAY,
  digestLinesFromBody,
  digestPeriodFor,
  DIGEST_SECTION_KEYS,
  DIGEST_SECTIONS,
  planterDigestDedupeKey,
  PLANTER_DIGEST_TYPE,
  totalOutstanding,
  widestPeriodEnd,
  type DigestCounts,
} from "./digest-content";

// ============================================================================
// WHAT THE PLANTER DIGEST SAYS (N-013) — the pure half.
//
// These cases moved out of `digest.test.ts` with the code they cover. They need
// no database, no injected dependency and no environment variable: the period
// arithmetic, the dedupe keys and the body/title round trip are functions of
// their arguments alone, and the module under test imports `@/lib/datetime` and
// one erased type.
//
// That is the point of the split being visible here as well as in `src/`. A
// suite that has to set `UNSUBSCRIBE_TOKEN_SECRET` before its first import (see
// `digest.test.ts`) is testing something else.
// ============================================================================

/** The instant every case below is measured from. A Wednesday. */
const NOW = new Date("2026-08-19T09:00:00.000Z");

const BUSY: DigestCounts = {
  overdue_tasks: 2,
  tasks_due_soon: 3,
  upcoming_meetings: 1,
};

// ----------------------------------------------------------------------------
// The default cadence day — FRD Open Question 2, decided here
// ----------------------------------------------------------------------------

test("a weekly digest defaults to landing on a Monday", () => {
  assert.equal(DEFAULT_WEEKLY_DIGEST_WEEKDAY, 1, "1 is Monday in UTC");

  // Every day of one week resolves to the SAME Monday, which is both halves of
  // the ruling: the day it lands on, and the fact that the period is stable.
  const monday = "2026-08-17";
  for (let offset = 0; offset < 7; offset += 1) {
    const at = new Date(`2026-08-${17 + offset}T13:45:00.000Z`);
    const period = digestPeriodFor("weekly", at);
    assert.equal(period.key, monday, `day +${offset} belongs to ${monday}`);
    assert.equal(period.start.getUTCDay(), DEFAULT_WEEKLY_DIGEST_WEEKDAY);
  }

  // ...and the next day opens the next period, seven days later.
  const next = digestPeriodFor("weekly", new Date("2026-08-24T00:00:00.000Z"));
  assert.equal(next.key, "2026-08-24");
});

test("a daily period is the calendar day, and the two cadences never share a key", () => {
  const daily = digestPeriodFor("daily", NOW);
  assert.equal(daily.key, "2026-08-19");
  assert.equal(daily.end.toISOString(), "2026-08-20T00:00:00.000Z");

  // A Monday is both the DAY 2026-08-17 and the WEEK of 2026-08-17, so only the
  // cadence in the key keeps a cadence switch from swallowing a digest.
  const monday = new Date("2026-08-17T06:00:00.000Z");
  assert.notEqual(
    planterDigestDedupeKey(digestPeriodFor("daily", monday)),
    planterDigestDedupeKey(digestPeriodFor("weekly", monday))
  );

  assert.deepEqual(currentDigestDedupeKeys(monday).sort(), [
    `${PLANTER_DIGEST_TYPE}:daily:2026-08-17`,
    `${PLANTER_DIGEST_TYPE}:weekly:2026-08-17`,
  ]);
});

test("the sweep's lookahead is the widest any cadence could ask for", () => {
  for (const at of [
    new Date("2026-08-17T00:00:00.000Z"),
    NOW,
    new Date("2026-08-23T23:59:59.000Z"),
  ]) {
    const widest = widestPeriodEnd(at);
    assert.ok(widest >= digestPeriodFor("daily", at).end);
    assert.ok(widest >= digestPeriodFor("weekly", at).end);
  }
});

// ----------------------------------------------------------------------------
// AC — content and links
// ----------------------------------------------------------------------------

test("the body summarises the outstanding work, and omits what is zero", () => {
  assert.equal(
    composePlanterDigestBody(BUSY),
    [
      "2 tasks are overdue",
      "3 tasks are due before your next digest",
      "1 meeting is coming up",
    ].join("\n")
  );

  assert.equal(
    composePlanterDigestBody({
      overdue_tasks: 0,
      tasks_due_soon: 0,
      upcoming_meetings: 1,
    }),
    "1 meeting is coming up",
    "a zero section is omitted, never printed as 0"
  );
});

test("the title names the period, never 'today'", () => {
  const weekly = composePlanterDigestTitle(digestPeriodFor("weekly", NOW));
  const daily = composePlanterDigestTitle(digestPeriodFor("daily", NOW));

  assert.match(weekly, /^What needs your attention — week of /);
  assert.match(daily, /^What needs your attention — /);
  assert.doesNotMatch(weekly, /today/i);
  assert.doesNotMatch(daily, /today/i);
});

test("composing and re-reading a body is a lossless round trip", () => {
  // Every combination of "present / absent" across the three sections, with a
  // singular and a plural count so both phrases are exercised.
  for (const overdue of [0, 1, 7]) {
    for (const dueSoon of [0, 1, 4]) {
      for (const meetings of [0, 1, 2]) {
        const counts: DigestCounts = {
          overdue_tasks: overdue,
          tasks_due_soon: dueSoon,
          upcoming_meetings: meetings,
        };
        if (totalOutstanding(counts) === 0) continue;

        const lines = digestLinesFromBody(composePlanterDigestBody(counts));

        assert.deepEqual(
          Object.fromEntries(lines.map((line) => [line.section, line.count])),
          Object.fromEntries(
            DIGEST_SECTION_KEYS.filter((key) => counts[key] > 0).map((key) => [
              key,
              counts[key],
            ])
          ),
          `round trip failed for ${JSON.stringify(counts)}`
        );

        for (const line of lines) {
          assert.equal(line.path, DIGEST_SECTIONS[line.section].path);
          assert.equal(line.linkLabel, DIGEST_SECTIONS[line.section].linkLabel);
        }
      }
    }
  }
});

test("a line this module did not write resolves to nothing, never to a wrong link", () => {
  assert.deepEqual(digestLinesFromBody("3 widgets need polishing"), []);
  assert.deepEqual(digestLinesFromBody("tasks are overdue"), []);
  assert.deepEqual(digestLinesFromBody(""), []);
  assert.deepEqual(digestLinesFromBody("constructor"), []);
  // A count that does not match the phrase's grammar is not that section.
  assert.deepEqual(digestLinesFromBody("2 task is overdue"), []);
});

// ============================================================================
// THE LEAF RULE — the property that makes the split worth anything
// ============================================================================

const NOTIFICATIONS_DIR = path.join(process.cwd(), "src/lib/notifications");

function read(file: string): string {
  return readFileSync(path.join(NOTIFICATIONS_DIR, file), "utf8");
}

test("the content module imports nothing but datetime and erased types", () => {
  // A leaf that grows a `@/db` edge stops being one, and the modules that
  // depend on it — `dispatch.ts` for one string constant, `channels/digest-
  // email.ts` for one parser — silently get the whole schema graph back.
  const source = read("digest-content.ts");
  const specifiers = [
    ...source.matchAll(/^import\s+([\s\S]*?)from\s+"([^"]+)"/gm),
  ];

  assert.ok(specifiers.length > 0, "no imports found — check the path");

  for (const [, clause, specifier] of specifiers) {
    if (clause.trimStart().startsWith("type ")) continue;
    assert.equal(
      specifier,
      "@/lib/datetime",
      `digest-content.ts imports ${specifier} as a VALUE — the leaf is closed to everything but @/lib/datetime`
    );
  }

  assert.doesNotMatch(
    source.replace(/^import type[\s\S]*?from "[^"]+";$/gm, ""),
    /from "@\/db/,
    "a value edge to the database reached the leaf"
  );
});

test("digest.ts re-exports nothing from the leaf — every importer names it", () => {
  // `permanent-failure.ts`'s own rule: a leaf whose contents are also served
  // from the trunk is not a leaf, because callers keep reaching for the trunk
  // and the graph closes over again.
  assert.doesNotMatch(
    read("digest.ts"),
    /^export\s[\s\S]*?from "\.\/digest-content"/m,
    "digest.ts re-exports the leaf — import it directly instead"
  );
});

test("the dispatcher takes the digest type from the leaf, not from the trunk", () => {
  // The cycle this split cut: `digest.ts` reaches `dispatch.ts` transitively
  // through the tasks feature's F11 registration, and `dispatch.ts` reached
  // back into `digest.ts` for one string. That is what made a module-scope
  // composer table throw a TDZ ReferenceError.
  const dispatch = read("dispatch.ts");

  assert.match(
    dispatch,
    /import \{ PLANTER_DIGEST_TYPE \} from "\.\/digest-content";/
  );
  assert.doesNotMatch(
    dispatch,
    /from "\.\/digest"/,
    "dispatch.ts imports the digest trunk again — the cycle is back"
  );
  assert.doesNotMatch(
    read("channels/digest-email.ts"),
    /from "\.\.\/digest"/,
    "the email composer imports the digest trunk again"
  );
});
