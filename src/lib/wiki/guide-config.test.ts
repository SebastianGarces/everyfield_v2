import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveGuideEntry, wikiGuideConfig } from "./guide-config";
import { wikiHref } from "./href";

// ============================================================================
// The guide config is the contract between a route and the articles its panel
// offers. Two things about it are load-bearing and neither is visible from the
// type, so both are pinned here.
//
// 1. A SLUG THAT DOES NOT RESOLVE IS A VISIBLE ERROR, NOT A NO-OP.
//    Unlike the insight card — which resolves stored slugs against the
//    published set and silently drops the stale ones
//    (`components/phase-engine/focus-presentation.ts` → `buildArticleLinks`) —
//    this config is trusted verbatim: the provider fetches `slugs[0]` and the
//    panel renders "Article not found" when the read layer returns 404
//    (`wiki-guide-panel.tsx`). `getArticle` reads through `articleBySlugQuery`,
//    which filters `status = "published"`,
//    so an unpublished article fails exactly like a missing one.
//
//    The published set lives in the database, and this harness is pure — no
//    test here opens a connection. So publication cannot be ASSERTED here; it
//    is verified out of band and pinned below, which is the point of
//    `LAUNCH_GUIDE_SLUGS`: editing the config without re-verifying fails this
//    file rather than shipping an error panel.
//
// 2. THE PANEL'S LINKS ARE BUILT WITH `wikiHref`, SO THE CONFIG MUST HOLD RAW
//    SLUGS. The header link and footer link both call `wikiHref(slug)` (#310).
//    A pre-encoded or `/wiki/`-prefixed entry would be encoded twice and 404.
// ============================================================================

/**
 * The Launch Sunday list, verified published against the wiki read layer on
 * 2026-08-08 (`visibleArticlesQuery(null)`, `status = "published"`, global
 * articles). Order is the panel's: `slugs[0]` is what opens by default.
 *
 * If you change `/launch` in the config, re-run that check and update this
 * list — do not just make the test green.
 */
const LAUNCH_GUIDE_SLUGS = [
  "launch-sunday/launch-day-guide",
  "launch-sunday/5-priority-details",
  "pre-launch/final-checklist-review",
  "pre-launch/operations-setup-teardown",
  "pre-launch/launch-team-spiritual-preparation",
  "pre-launch/the-promotion-plan",
];

test("/launch resolves to the Launch Sunday guide entry", () => {
  const entry = resolveGuideEntry("/launch");

  assert.ok(entry, "/launch has no guide entry — the panel button never shows");
  assert.equal(entry.label, "Launch Sunday Guide");
  assert.deepEqual(entry.slugs, LAUNCH_GUIDE_SLUGS);
});

test("the Launch Sunday entry opens on the day itself", () => {
  // The provider fetches `slugs[0]` when the panel opens, so the first slug is
  // a UI decision, not list order: a planter opening the guide from the
  // countdown gets the launch day overview, not a pre-launch sub-topic.
  const entry = resolveGuideEntry("/launch");
  assert.equal(entry?.slugs[0], "launch-sunday/launch-day-guide");
});

test("the Launch Sunday entry names each of the board's readiness areas", () => {
  // The three areas the milestone board renders
  // (`src/lib/launch/milestone-areas.ts`). Each one has an article behind it,
  // so the panel answers the question the board raises.
  const entry = resolveGuideEntry("/launch");
  const slugs = entry?.slugs ?? [];

  for (const area of [
    "pre-launch/operations-setup-teardown",
    "pre-launch/launch-team-spiritual-preparation",
    "pre-launch/the-promotion-plan",
  ]) {
    assert.ok(slugs.includes(area), `readiness area unrepresented: ${area}`);
  }
});

test("/launch does not swallow deeper or sibling routes", () => {
  // `matchPattern` compares segment counts, so a bare "/launch" pattern must
  // not claim a nested route that will want its own entry later.
  assert.equal(resolveGuideEntry("/launch/settings"), null);
  assert.equal(resolveGuideEntry("/launches"), null);
  assert.equal(resolveGuideEntry("/tasks"), null);
});

test("/launch still matches when the URL carries unrelated search params", () => {
  // Pattern params are a subset test — a pattern with no params must match
  // whatever the page happens to carry, or a stray `?ref=` hides the button.
  const entry = resolveGuideEntry("/launch", { ref: "email", tab: "anything" });
  assert.equal(entry?.label, "Launch Sunday Guide");
});

// ----------------------------------------------------------------------------
// Meetings, teams and the onboarding journey step (#318, from #21 + #209).
//
// Same rule as `LAUNCH_GUIDE_SLUGS` above: publication cannot be asserted from a
// pure harness, so each list below was verified published against the wiki read
// layer on 2026-08-09 (all 96 articles are global and published) and is pinned
// here. Change the config and you must re-verify, not just re-paste.
// ----------------------------------------------------------------------------

const MEETINGS_LIST_SLUGS = [
  "core-group/vision-meetings/what-is-a-vision-meeting",
  "frameworks/meeting-objectives",
  "core-group/building-your-core-group/core-group-meeting-format",
  "training/launch-team-meeting-objectives",
];

const MEETING_DETAIL_SLUGS = [
  "core-group/vision-meetings/planning-your-vision-meeting",
  "core-group/vision-meetings/vision-meeting-agenda-deep-dive",
  "core-group/vision-meetings/the-vision-meeting-kit",
  "core-group/vision-meetings/invitation-strategies",
  "core-group/vision-meetings/running-the-meeting",
  "core-group/vision-meetings/8-critical-success-factors-for-vision-meetings",
];

const TEAMS_LIST_SLUGS = [
  "launch-team/leadership/key-leadership-roles-overview",
  "launch-team/launch-date/transitioning-to-launch-team",
  "training/training-programs-overview",
];

const TEAM_DETAIL_SLUGS = [
  "launch-team/leadership/key-leadership-roles-overview",
  "training/ministry-specific-training",
  "training/launch-team-meeting-objectives",
];

const JOURNEY_SLUGS = [
  "getting-started/welcome-to-the-launch-playbook",
  "getting-started/launch-process-goals",
  "launch-team/launch-date/setting-your-launch-date",
  "launch-team/launch-date/variables-that-drive-your-launch-date",
];

test("/meetings resolves to the meetings list guide", () => {
  const entry = resolveGuideEntry("/meetings");

  assert.ok(
    entry,
    "/meetings has no guide entry — the panel button never shows"
  );
  assert.equal(entry.label, "Meetings Guide");
  assert.deepEqual(entry.slugs, MEETINGS_LIST_SLUGS);
});

test("the meetings list guide represents every meeting type the page lists", () => {
  // `meetingTypes` in `src/db/schema/meetings.ts` is vision_meeting,
  // orientation and team_meeting, and the list page renders all three. One
  // article per type, so no type on the page is unanswered by its guide.
  const slugs = resolveGuideEntry("/meetings")?.slugs ?? [];

  for (const [type, slug] of [
    ["vision_meeting", "core-group/vision-meetings/what-is-a-vision-meeting"],
    [
      "orientation",
      "core-group/building-your-core-group/core-group-meeting-format",
    ],
    ["team_meeting", "training/launch-team-meeting-objectives"],
  ]) {
    assert.ok(slugs.includes(slug), `meeting type unrepresented: ${type}`);
  }
});

test("a single meeting resolves to the meeting guide, whatever its id", () => {
  for (const id of ["abc123", "550e8400-e29b-41d4-a716-446655440000"]) {
    const entry = resolveGuideEntry(`/meetings/${id}`);
    assert.equal(entry?.label, "Meeting Guide", `no entry for /meetings/${id}`);
    assert.deepEqual(entry?.slugs, MEETING_DETAIL_SLUGS);
  }
});

test("the meeting guide opens on planning and ends on the evaluation rubric", () => {
  // `slugs[0]` is what the provider fetches when the panel opens, and a meeting
  // is created in `planning` status onto this page. The last slug is the
  // rubric behind the evaluation tab's eight scores.
  const slugs = resolveGuideEntry("/meetings/abc123")?.slugs ?? [];

  assert.equal(
    slugs[0],
    "core-group/vision-meetings/planning-your-vision-meeting"
  );
  assert.ok(
    slugs.includes(
      "core-group/vision-meetings/8-critical-success-factors-for-vision-meetings"
    ),
    "the evaluation tab's eight scores have no article behind them"
  );
});

test("/meetings/new inherits the meeting guide rather than showing none", () => {
  // One wildcard segment claims the create form too. Documented in the config:
  // the planning article is the right first read there as well.
  const entry = resolveGuideEntry("/meetings/new");
  assert.equal(entry?.label, "Meeting Guide");
});

test("the meeting tabs are left free for their own entries", () => {
  // `matchPattern` compares segment counts, so a one-wildcard pattern must not
  // claim the deeper tabs — they can be configured separately later.
  for (const tab of [
    "/meetings/abc123/attendance",
    "/meetings/abc123/evaluation",
    "/meetings/abc123/logistics",
    "/meetings/abc123/invitations",
    "/meetings/abc123/analytics",
  ]) {
    assert.equal(resolveGuideEntry(tab), null, `unexpected entry for ${tab}`);
  }
});

test("/teams resolves to the ministry teams guide", () => {
  const entry = resolveGuideEntry("/teams");

  assert.ok(entry, "/teams has no guide entry — the panel button never shows");
  assert.equal(entry.label, "Ministry Teams Guide");
  assert.deepEqual(entry.slugs, TEAMS_LIST_SLUGS);
});

test("a single team resolves to the team guide, whatever its id", () => {
  const entry = resolveGuideEntry("/teams/team-42");

  assert.equal(entry?.label, "Team Guide");
  assert.deepEqual(entry?.slugs, TEAM_DETAIL_SLUGS);
});

test("the team guide answers each tab of a team", () => {
  // `components/ministry-teams/team-tabs.tsx`: Members & Roles (the landing
  // tab, hence `slugs[0]`), Responsibilities, Training, Meetings.
  const slugs = resolveGuideEntry("/teams/team-42")?.slugs ?? [];

  assert.equal(
    slugs[0],
    "launch-team/leadership/key-leadership-roles-overview"
  );
  assert.ok(slugs.includes("training/ministry-specific-training"));
  assert.ok(slugs.includes("training/launch-team-meeting-objectives"));
});

test("the teams siblings inherit the team guide instead of showing none", () => {
  // `/teams/health` and `/teams/org-chart` are real pages that the one-wildcard
  // pattern also matches. Both ask who fills which role, which is what this
  // list answers — so the inheritance is intended, and pinned so a future
  // narrower entry is a deliberate change here.
  for (const sibling of ["/teams/health", "/teams/org-chart"]) {
    assert.equal(
      resolveGuideEntry(sibling)?.label,
      "Team Guide",
      `no entry for ${sibling}`
    );
  }
});

test("the team tabs are left free for their own entries", () => {
  for (const tab of [
    "/teams/team-42/responsibilities",
    "/teams/team-42/training",
    "/teams/team-42/meetings",
  ]) {
    assert.equal(resolveGuideEntry(tab), null, `unexpected entry for ${tab}`);
  }
});

// ----------------------------------------------------------------------------
// Onboarding: the journey step (OB-014 / FRD AC 8), as RULED on PR #367
// (2026-08-09), option C — step-scoped.
//
// The flow renders as the dashboard while `onboarding_completed_at` is null and
// the step is client state, so the bare `/dashboard` path is every onboarding
// step AND the finished dashboard at once. The ruling is that the guide belongs
// to ONE step, so the bare path carries no entry at all and the guide waits on
// `/dashboard?step=journey` — dormant until the flow syncs its step into the
// URL (#373).
//
// The pair of tests below is the whole ruling: nothing on the bare path, the
// step-scoped entry ready and correct. Deleting either one lets the guide leak
// back onto every step and onto the finished dashboard.
// ----------------------------------------------------------------------------

test("the bare dashboard has no guide, on any of the surfaces it renders", () => {
  // The finished dashboard and onboarding steps 1/2/4 all resolve to exactly
  // this pathname. No entry may match it — a bare `/dashboard` entry would show
  // the journey guide on all of them, which is what the ruling rejected.
  assert.equal(
    resolveGuideEntry("/dashboard"),
    null,
    "the bare dashboard matched a guide entry — the guide leaks onto the finished dashboard and onboarding steps 1/2/4"
  );

  // Other steps once #373 lands, and a stray unrelated param today. Only
  // `step=journey` may match.
  const nonJourney: Record<string, string>[] = [
    { step: "welcome" },
    { step: "leadership" },
    { step: "invite" },
    { ref: "email" },
  ];

  for (const params of nonJourney) {
    assert.equal(
      resolveGuideEntry("/dashboard", params),
      null,
      `unexpected guide entry for /dashboard with ${JSON.stringify(params)}`
    );
  }
});

test("the journey step resolves to the phase-discernment guide once ?step=journey is in the URL", () => {
  const entry = resolveGuideEntry("/dashboard", { step: "journey" });

  assert.ok(entry, "the journey step has no guide entry — FRD AC 8 fails");
  assert.equal(entry.label, "Your Journey Guide");
  assert.deepEqual(entry.slugs, JOURNEY_SLUGS);

  // The step's first question is "which stage of the journey are you in", and
  // this is the one article that lays out phases 0-6 and tells the reader to
  // find their own. It must be `slugs[0]` — that is what the panel fetches.
  assert.equal(
    entry.slugs[0],
    "getting-started/welcome-to-the-launch-playbook"
  );

  // The step's second question — a target launch date, or no date yet.
  for (const slug of [
    "launch-team/launch-date/setting-your-launch-date",
    "launch-team/launch-date/variables-that-drive-your-launch-date",
  ]) {
    assert.ok(
      entry.slugs.includes(slug),
      `launch-date question unanswered: ${slug}`
    );
  }

  // The entry survives whatever else the URL carries — pattern params are a
  // subset test, so a stray `?ref=` must not hide the button once #373 lands.
  assert.equal(
    resolveGuideEntry("/dashboard", { step: "journey", ref: "email" })?.label,
    "Your Journey Guide"
  );
});

test("the journey entry is keyed on the step, not the path", () => {
  // The config key itself is the contract with #373: the flow must write
  // exactly `?step=journey`. Pinned so a rename on either side is a deliberate
  // two-sided change rather than a guide that silently stops appearing.
  assert.ok(
    "/dashboard?step=journey" in wikiGuideConfig,
    "the step-scoped journey entry is missing from the config"
  );
  assert.ok(
    !("/dashboard" in wikiGuideConfig),
    "a bare /dashboard entry is back — the ruling on PR #367 forbids it"
  );
});

test("the dashboard entry stays on the dashboard", () => {
  // A pattern must not claim the routes nested under it, several of which
  // already have or will want their own guide.
  assert.equal(resolveGuideEntry("/dashboard/anything"), null);
  assert.equal(
    resolveGuideEntry("/dashboard/anything", { step: "journey" }),
    null
  );
});

// ----------------------------------------------------------------------------
// The /people entries predate this change and must survive it — the new
// patterns share no prefix with them, but `resolveGuideEntry` sorts the WHOLE
// config by specificity, so every addition is a chance to shadow an old entry.
// ----------------------------------------------------------------------------

test("the existing /people guides are unchanged", () => {
  const cases: [string, Record<string, string>, string, string[]][] = [
    [
      "/people",
      {},
      "Core Group Funnel",
      ["core-group/building-your-core-group/the-core-group-funnel"],
    ],
    [
      "/people/p1/assessments",
      { tab: "assessments" },
      "Assessments Overview",
      ["frameworks/the-4-cs"],
    ],
    [
      "/people/p1/assessments",
      { tab: "interviews" },
      "Interview Guide",
      [
        "frameworks/the-5-interview-criteria",
        "core-group/follow-up/interviewing-for-fit",
      ],
    ],
    [
      "/people/p1/assessments",
      { tab: "commitments" },
      "Commitment Guide",
      [
        "core-group/commitment/why-formalized-commitment-matters",
        "core-group/commitment/the-three-key-documents",
        "core-group/commitment/core-group-commitments-explained",
      ],
    ],
    [
      "/people/p1/assessments/new",
      {},
      "4Cs Assessment Guide",
      ["frameworks/the-4-cs"],
    ],
    [
      "/people/p1/assessments/interview",
      {},
      "Interview Guide",
      [
        "frameworks/the-5-interview-criteria",
        "core-group/follow-up/interviewing-for-fit",
      ],
    ],
    [
      "/people/p1/assessments/commitment",
      {},
      "Commitment Guide",
      [
        "core-group/commitment/why-formalized-commitment-matters",
        "core-group/commitment/the-three-key-documents",
        "core-group/commitment/core-group-commitments-explained",
      ],
    ],
  ];

  for (const [pathname, params, label, slugs] of cases) {
    const entry = resolveGuideEntry(pathname, params);
    assert.equal(entry?.label, label, `${pathname} lost its guide entry`);
    assert.deepEqual(entry?.slugs, slugs, `${pathname} changed articles`);
  }
});

// ----------------------------------------------------------------------------
// Whole-config invariants — cheap, and they catch a bad paste into any entry.
// ----------------------------------------------------------------------------

test("every configured slug is raw, so wikiHref encodes it exactly once", () => {
  for (const [pattern, entry] of Object.entries(wikiGuideConfig)) {
    for (const slug of entry.slugs) {
      assert.ok(
        !slug.startsWith("/"),
        `${pattern}: slug must not be a path: ${slug}`
      );
      assert.ok(
        !slug.startsWith("wiki/"),
        `${pattern}: slug must not carry the route prefix: ${slug}`
      );
      // Already-encoded entries would survive `wikiHref` visually but resolve
      // to a different stored slug once Next decodes the route param.
      assert.equal(
        wikiHref(slug),
        `/wiki/${slug}`,
        `${pattern}: slug needs escaping, so it is not a stored slug: ${slug}`
      );
    }
  }
});

test("no entry is empty or repeats a slug", () => {
  for (const [pattern, entry] of Object.entries(wikiGuideConfig)) {
    // `isAvailable` is false for an empty list, so the entry would be dead
    // config that reads as working.
    assert.ok(entry.slugs.length > 0, `${pattern}: has no slugs`);
    assert.ok(entry.label.trim().length > 0, `${pattern}: has no label`);
    assert.equal(
      new Set(entry.slugs).size,
      entry.slugs.length,
      `${pattern}: repeats a slug, which renders a duplicate related-article row`
    );
  }
});
