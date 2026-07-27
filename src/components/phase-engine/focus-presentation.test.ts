import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildArticleLinks,
  deltaFieldLabel,
  readBooleanSignals,
  readDelta,
  readinessMeta,
  severityMeta,
  slugToLabel,
  transitionDirectionLabel,
} from "./focus-presentation";

// ----------------------------------------------------------------------------
// readDelta — the stored what-changed delta (PE-016).
// ----------------------------------------------------------------------------

test("readDelta returns the persisted _delta from the stored snapshot", () => {
  const delta = {
    isFirstAssessment: false,
    changed: [
      {
        path: "coreGroup.committedCount",
        previous: 7,
        current: 10,
        delta: 3,
      },
    ],
  };

  const result = readDelta({ snapshotVersion: "1", _delta: delta });
  assert.deepEqual(result, delta);
});

test("readDelta returns null when no delta is present", () => {
  assert.equal(readDelta({ snapshotVersion: "1" }), null);
  assert.equal(readDelta(null), null);
  assert.equal(readDelta(undefined), null);
  assert.equal(readDelta("not an object"), null);
});

test("readDelta tolerates a present-but-undefined _delta", () => {
  assert.equal(readDelta({ _delta: undefined }), null);
});

// ----------------------------------------------------------------------------
// readBooleanSignals — manual self-attestations (PE-005).
// ----------------------------------------------------------------------------

test("readBooleanSignals keeps only boolean attestations, keyed by signal key", () => {
  const values = readBooleanSignals([
    { signalKey: "values_documented", value: true },
    { signalKey: "financial_base_established", value: false },
    { signalKey: "note", value: "free text is ignored" },
    { signalKey: "count", value: 3 },
  ]);

  assert.deepEqual(values, {
    values_documented: true,
    financial_base_established: false,
  });
});

test("readBooleanSignals returns an empty map for no signals", () => {
  assert.deepEqual(readBooleanSignals([]), {});
});

// ----------------------------------------------------------------------------
// Severity presentation (PE-009) — plain language, never a raw enum.
// ----------------------------------------------------------------------------

test("severityMeta maps every DB severity to a plain-language label + variant", () => {
  assert.equal(severityMeta("critical").badgeVariant, "destructive");
  assert.equal(severityMeta("high").badgeVariant, "destructive");
  assert.equal(severityMeta("medium").badgeVariant, "outline");
  assert.equal(severityMeta("low").badgeVariant, "secondary");
  assert.equal(severityMeta("info").label, "Going well");
});

// ----------------------------------------------------------------------------
// Readiness presentation (PE-015) — advisory only.
// ----------------------------------------------------------------------------

test("readinessMeta maps each readiness state to a label + variant", () => {
  assert.equal(readinessMeta("ready").badgeVariant, "secondary");
  assert.equal(readinessMeta("approaching").badgeVariant, "outline");
  assert.equal(readinessMeta("not_ready").badgeVariant, "destructive");
  assert.equal(readinessMeta("unknown").label, "Readiness unknown");
});

// ----------------------------------------------------------------------------
// What-changed field labels (PE-016).
// ----------------------------------------------------------------------------

test("deltaFieldLabel humanizes known paths and falls back to the raw path", () => {
  assert.equal(deltaFieldLabel("coreGroup.committedCount"), "Core group");
  assert.equal(deltaFieldLabel("launch.daysUntilLaunch"), "Days until launch");
  assert.equal(deltaFieldLabel("unknown.path"), "unknown.path");
});

// ----------------------------------------------------------------------------
// Transition direction labels (PE-001) — advance / regress / correct.
// ----------------------------------------------------------------------------

test("transitionDirectionLabel describes advance, jump, regress, and noop", () => {
  assert.equal(transitionDirectionLabel(1, 2), "advance to");
  assert.equal(transitionDirectionLabel(1, 4), "jump to");
  assert.equal(transitionDirectionLabel(3, 1), "move back to");
  assert.equal(transitionDirectionLabel(2, 2), "stay in");
});

// ----------------------------------------------------------------------------
// Wiki slug labels (PE-008).
// ----------------------------------------------------------------------------

test("slugToLabel produces a readable label from a slug", () => {
  assert.equal(slugToLabel("core-group"), "Core group");
  assert.equal(slugToLabel("phases/launch_team"), "Launch team");
  assert.equal(slugToLabel("vision"), "Vision");
});

// ----------------------------------------------------------------------------
// "How to improve" wiki links (PE-024) — a stored slug must resolve to a real
// published article or render nothing at all (never a 404).
// ----------------------------------------------------------------------------

const PUBLISHED = [
  { slug: "core-group/what-is-a-vision-meeting", title: "The vision meeting" },
  { slug: "core-group/building-momentum", title: "Building momentum" },
];

test("buildArticleLinks links a slug that resolves to a published article", () => {
  const links = buildArticleLinks(
    ["core-group/what-is-a-vision-meeting"],
    PUBLISHED
  );

  assert.deepEqual(links, [
    {
      slug: "core-group/what-is-a-vision-meeting",
      href: "/wiki/core-group/what-is-a-vision-meeting",
      label: "The vision meeting",
    },
  ]);
});

test("buildArticleLinks renders no link for a stale slug rather than a 404", () => {
  // Deliberately stale: persisted when the article existed, since renamed.
  const links = buildArticleLinks(
    ["core-group/renamed-away", "core-group/building-momentum"],
    PUBLISHED
  );

  assert.deepEqual(
    links.map((l) => l.slug),
    ["core-group/building-momentum"]
  );
});

test("buildArticleLinks yields nothing when every stored slug is stale", () => {
  assert.deepEqual(buildArticleLinks(["gone", "also-gone"], PUBLISHED), []);
});

test("buildArticleLinks yields nothing for an insight with no stored slugs", () => {
  assert.deepEqual(buildArticleLinks([], PUBLISHED), []);
  assert.deepEqual(buildArticleLinks(null, PUBLISHED), []);
  assert.deepEqual(buildArticleLinks(undefined, PUBLISHED), []);
});

test("buildArticleLinks dedupes repeated slugs and keeps stored order", () => {
  const links = buildArticleLinks(
    [
      "core-group/building-momentum",
      "core-group/what-is-a-vision-meeting",
      "core-group/building-momentum",
    ],
    PUBLISHED
  );

  assert.deepEqual(
    links.map((l) => l.slug),
    ["core-group/building-momentum", "core-group/what-is-a-vision-meeting"]
  );
});

test("buildArticleLinks falls back to a humanized slug when the title is blank", () => {
  const links = buildArticleLinks(
    ["core-group/building-momentum"],
    [{ slug: "core-group/building-momentum", title: "   " }]
  );

  assert.equal(links[0].label, "Building momentum");
});

// ----------------------------------------------------------------------------
// Href encoding (#152).
//
// A slug is authored content, not a sanitized identifier. Today's published
// corpus happens to hold only URL-safe slugs, so raw interpolation *looked*
// fine — but that is a property of the data, not of the code, and stale slugs
// with spaces already sit in this DB. The href must be well-formed for any slug
// that resolves, and unchanged for every slug that is already safe.
// ----------------------------------------------------------------------------

test("buildArticleLinks encodes a space, # and ? in the article href", () => {
  const published = [
    { slug: "core group/first steps", title: "First steps" },
    { slug: "notes/draft #2", title: "Draft two" },
    { slug: "faq/what now?", title: "What now" },
  ];

  const links = buildArticleLinks(
    published.map((a) => a.slug),
    published
  );

  assert.deepEqual(
    links.map((l) => l.href),
    [
      "/wiki/core%20group/first%20steps",
      "/wiki/notes/draft%20%232",
      "/wiki/faq/what%20now%3F",
    ]
  );

  // The encoded path still resolves: `/wiki/[...slug]` decodes each segment and
  // rejoins them, so the page looks up exactly the slug that was stored.
  for (const link of links) {
    const resolved = link.href
      .slice("/wiki/".length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
    assert.equal(resolved, link.slug);
  }
});

test("buildArticleLinks keeps `slug` raw while `href` is encoded", () => {
  // `slug` is the React key and the identity used against the published set —
  // encoding it would break dedupe and stale-slug resolution.
  const links = buildArticleLinks(
    ["notes/draft #2"],
    [{ slug: "notes/draft #2", title: "Draft two" }]
  );

  assert.equal(links[0].slug, "notes/draft #2");
  assert.equal(links[0].href, "/wiki/notes/draft%20%232");
});
