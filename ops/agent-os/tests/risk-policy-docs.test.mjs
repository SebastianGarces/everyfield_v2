// Pins for the two factory rulings of 2026-08-13:
//
//   #435 — `risk:high` narrows to auth/permissions, multi-tenant isolation and
//          payments. Schema and migrations are NOT high-risk pre-release, and
//          the migration proofs (HR1-HR3) re-key from the LABEL onto the DIFF.
//   #430 — the 2-round review-fix cap counts PER REVIEW SITE (ruled on PR #428).
//
// Both are doc-only rulings, so nothing a stubbed workflow run can observe
// enforces them: the sentences ARE the mechanism, which is exactly the shape
// this repo pins as text (see the "file-level mechanisms" block at the bottom of
// frd-workflows.test.mjs). Prose is what agents read at intake and at dispatch,
// and a ruling that survives only in a ledger row gets re-derived wrong on the
// next pass — #430 exists because two tracks had to guess at the cap.
//
// SCOPE NOTE. The retired-phrasing sweep below is not a LIST of files — a list
// is what let five factory sites keep the pre-#435 classification while this
// suite reported the ruling applied. It WALKS `.claude/`, `ops/` and
// `product-docs/` and fails on any file that still spells it the old way.
//
// Exactly one live exemption, and it is a record rather than a rule:
//   product-docs/board-design-2026-07.md — a DATED design record of what the
//   board looked like in July 2026. Rewriting it would falsify the record, so
//   it is frozen on purpose; #435 changed the policy, not that day's minutes.
// Plus this suite itself, which QUOTES the retired spellings in order to forbid
// them (the same exemption `memory/` takes). Both exemptions are asserted to
// still MATCH, so a rename or a rewrite fails the test instead of silently
// exempting nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SPEC_INTAKE = ".claude/skills/spec-intake/SKILL.md";
const DISPATCH = ".claude/skills/dispatch/SKILL.md";
const DOD_SKILL = ".claude/skills/definition-of-done/SKILL.md";
const FRD_PLAN = ".claude/workflows/frd-plan.js";
const VERIFY_AND_SHIP = ".claude/workflows/verify-and-ship.js";
const LABELS = "ops/agent-os/labels.md";
const DOD = "ops/agent-os/dod.md";
const WORKFLOW = "ops/agent-os/workflow.md";
const README = "ops/agent-os/README.md";
const LEDGER = "product-docs/decisions.md";

// The docs that STATE the risk rule (as opposed to merely obeying it). Each one
// must carry the ruling AND its revert condition — a reader who meets the
// narrowing without the condition that reverses it reads a permanent rule.
const RULE_SITES = [SPEC_INTAKE, LABELS, DOD];

// The sites that ROUTE to the rule: they act on the classification (a verifier
// brief, a planner prompt, a merge gate) and point at the ruling rather than
// restating it in full. They owe the citation, not the whole paragraph.
const POINTER_SITES = [
  DISPATCH,
  DOD_SKILL,
  FRD_PLAN,
  VERIFY_AND_SHIP,
  WORKFLOW,
  README,
];

// The two sweep exemptions, by repo-relative path, each with why.
const SWEEP_EXEMPT = new Map([
  [
    "product-docs/board-design-2026-07.md",
    "a dated design record — rewriting it would falsify the record",
  ],
  [
    "ops/agent-os/tests/risk-policy-docs.test.mjs",
    "this suite quotes the retired spellings in order to forbid them",
  ],
]);

// Directories the walk must not descend into: other checkouts of this same
// repo (a worktree holds a whole tree, including pre-#435 branches) and vendor
// trees. Without this the sweep would grade other branches' files.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "worktrees",
  ".next",
  "dist",
]);

/** Every text file under the given repo-relative roots, repo-relative. */
function filesUnder(...roots) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.posix.join(rel, entry.name));
      } else if (entry.isFile()) {
        out.push(path.posix.join(rel, entry.name));
      }
    }
  };
  for (const r of roots) walk(r);
  return out;
}

// ---------------------------------------------------------------------------
// #435 — the narrowing, and the revert condition that travels with it
// ---------------------------------------------------------------------------

test("every doc that states the risk rule states its revert condition too", () => {
  for (const rel of RULE_SITES) {
    const text = read(rel);
    assert.match(
      text,
      /schema and migrations are (deliberately )?not/i,
      `${rel} must say schema/migrations are not risk:high`
    );
    assert.match(text, /2026-08-13/, `${rel} must date the ruling`);
    assert.match(text, /#435/, `${rel} must cite the issue`);
    assert.match(
      text,
      /revert condition/i,
      `${rel} states the rule, so it must state what reverses it`
    );
    assert.match(
      text,
      /separate production database/i,
      `${rel}'s revert condition must name the condition itself, not just point at one`
    );
  }
});

// The retired phrasings, by their exact spellings. A hand-list of INSTANCES is
// what rots; this is a list of FORMS, and a new spelling is added here rather
// than fixed only where it was found.
const RETIRED = [
  /schema\/auth\/tenancy/i,
  /schema, auth and tenancy/i,
  /schema\/migrations, auth/i,
  /touches schema/i,
];

test("nothing under .claude/, ops/ or product-docs/ still lists schema as risk:high", () => {
  const offenders = [];
  for (const rel of filesUnder(".claude", "ops", "product-docs")) {
    if (SWEEP_EXEMPT.has(rel)) continue;
    const text = read(rel);
    for (const pattern of RETIRED)
      if (pattern.test(text)) offenders.push(`${rel} (${pattern})`);
  }
  assert.deepEqual(
    offenders,
    [],
    `these still describe risk:high the pre-#435 way:\n${offenders.join("\n")}`
  );
});

test("both sweep exemptions still resolve to a file that actually matches", () => {
  // An exemption that no longer matches is an exemption that silently covers
  // nothing — and the next file to acquire the phrasing inherits the hole.
  for (const [rel, why] of SWEEP_EXEMPT) {
    assert.ok(
      fs.existsSync(path.join(ROOT, rel)),
      `${rel} is exempt (${why}) but does not exist — fix the path or drop the exemption`
    );
    const text = read(rel);
    assert.ok(
      RETIRED.some((p) => p.test(text)),
      `${rel} no longer carries any retired phrasing, so its exemption (${why}) is dead weight — drop it`
    );
  }
});

test("every site that routes to the risk rule cites the ruling", () => {
  for (const rel of POINTER_SITES) {
    const text = read(rel);
    assert.match(
      text,
      /#435/,
      `${rel} acts on the classification, so it must cite the ruling that narrowed it`
    );
    assert.match(text, /2026-08-13/, `${rel} must date the ruling it cites`);
  }
});

test("the dispatch attended sentences keep auth/tenancy and drop schema", () => {
  const text = read(DISPATCH);
  assert.match(
    text,
    /Auth, tenancy and payments\s+changes should start when someone is around to notice/,
    "the unattended-dispatch exclusion is about auth/tenancy/payments now"
  );
  assert.match(
    text,
    /Never merge a `risk:high` PR, auto or otherwise\.\*\* Auth, tenancy and payments keep a human\./,
    "the never-auto-merge rule names the narrowed set"
  );
});

test("the risk:high label description is auth/tenancy/payments in both places", () => {
  const text = read(LABELS);
  assert.match(
    text,
    /\| `risk:high`\s+\| Touches auth\/permissions, multi-tenant isolation, or payments/,
    "the modifier table"
  );
  assert.match(
    text,
    /gh label create "risk:high"[^\n]*--description "Auth\/tenancy\/payments"/,
    "the one-time setup block — the description GitHub actually shows"
  );
});

// ---------------------------------------------------------------------------
// #435 (a) — HR1-HR3 key on the diff, HR4 keys on the label
// ---------------------------------------------------------------------------

test("HR1-HR3 fire on a migration in the diff at any tier; HR4 stays risk:high-only", () => {
  const text = read(DOD);
  assert.match(
    text,
    /HR1[–-]HR3 fire whenever the track's diff carries a migration — at ANY risk tier/,
    "the trigger is the diff, not the label"
  );
  for (const gate of ["HR1", "HR2", "HR3"]) {
    const line = text.split("\n").find((l) => l.includes(`**${gate} `));
    assert.ok(line, `${gate} must still have its own bullet`);
    assert.match(
      line,
      /any tier, whenever the diff carries a migration/,
      `${gate}'s bullet must carry its own trigger — a reader who scans the list must not need the paragraph above it`
    );
  }
  const hr4 = text.split("\n").find((l) => l.includes("**HR4 "));
  assert.ok(hr4);
  assert.match(
    hr4,
    /\(`risk:high` only\)/,
    "HR4 is the gate the label still buys"
  );
});

test("the definition-of-done skill splits the triggers the same way dod.md does", () => {
  // verify-and-ship.js opens the integration brief with "Use the
  // `definition-of-done` skill and `ops/agent-os/dod.md`", so the verifier
  // reads both in one breath. A conflict between them is resolved by whichever
  // it read last — which is how the retired classification survived here.
  const text = read(DOD_SKILL);
  assert.match(
    text,
    /migration in the diff\*\* \(ANY risk tier/i,
    "HR1-HR3's trigger is the diff, at any tier"
  );
  assert.match(
    text,
    /\*\*HR1[–-]HR3\*\*/,
    "the skill must name the three gates the diff buys"
  );
  assert.match(
    text,
    /\*\*`risk:high`\*\*[^\n]*\*\*HR4\*\*/,
    "HR4 is the one gate still keyed to the label"
  );
  assert.doesNotMatch(
    text,
    /two verifiers/i,
    "HR4 has been three diverse lenses since the HR4 rework"
  );
});

test("the planner classifies and labels by the ruled policy", () => {
  const text = read(FRD_PLAN);
  assert.match(
    text,
    /risk "high" = auth\/permissions, multi-tenant isolation, payments/,
    "the decompose rule is what the planner applies to every unit"
  );
  assert.match(
    text,
    /gate: "ordering"/,
    "the schema consolidation survives as an ORDERING constraint (one db:generate), not a risk one"
  );
  // The publish prompt is what actually writes board state, so the label a
  // schema prerequisite gets is decidable from this file alone.
  const publish = text.slice(text.indexOf("**2. Publish the prerequisites"));
  assert.ok(publish.length > 0, "the publish step must still exist");
  const ordering = publish.slice(
    publish.indexOf("**2b. Ordering-gated prerequisites**")
  );
  assert.ok(ordering.length > 0, "the ordering-gated publish arm must exist");
  assert.match(
    ordering,
    /--label agent:queued/,
    "an ordering prerequisite is agent-buildable"
  );
  assert.match(
    ordering,
    /no \\`risk:high\\` and no \\`needs-spec\\`/,
    "the retired label must not come back on the very next plan"
  );
});

test("the TRACK DONE verdict splits the two triggers", () => {
  assert.match(
    read(DOD),
    /\(\+ HR1\.\.HR3 if the diff carries a migration; \+ HR4 if high-risk\)/,
    "the verdict block is what a verifier copies; it must not say HR1..HR4 if high-risk"
  );
});

// ---------------------------------------------------------------------------
// #430 — the per-review-site reading of the 2-round cap
// ---------------------------------------------------------------------------

test("dod.md records the per-site cap reading, its date, and all three sites", () => {
  const text = read(DOD);
  assert.match(text, /2 quality rounds per site/, "the cap itself survives");
  assert.match(
    text,
    /"Per site" is the ruled reading[^\n]*\n?[^\n]*RULED 2026-08-13, on PR #428/,
    "the reading must be dated and attributed, or it stays an interpretation"
  );
  for (const site of [
    /scoped\s+review/i,
    /integration verify|integration\*\* \(G6/i,
    /post-integration/i,
  ])
    assert.match(text, site, `all three review sites must be named (${site})`);
  assert.doesNotMatch(
    text,
    /at BOTH review sites/,
    "two sites was the pre-#430 reading"
  );
});

test("dispatch cites the same ruling rather than re-deriving the cap", () => {
  const text = read(DISPATCH);
  assert.match(text, /≤2 rounds per site/);
  assert.match(
    text,
    /scoped review, integration verify and post-integration quality/,
    "dispatch already read it per-site; it must now name the three sites the ruling named"
  );
  assert.match(text, /2026-08-13 on PR #428/);
});

// ---------------------------------------------------------------------------
// The ledger — where a ruling is supposed to be findable from
// ---------------------------------------------------------------------------

test("both rulings have dated ledger rows", () => {
  const text = read(LEDGER);
  const section = text.slice(
    text.indexOf(
      "## 2026-08-13 — Factory rulings: the pre-release risk policy (#435)"
    )
  );
  assert.ok(
    section.length > 0,
    "the 2026-08-13 factory-rulings section exists"
  );
  assert.match(
    section,
    /\| 435 \| \*\*`risk:high` narrows to auth\/permissions/,
    "the risk-policy row"
  );
  assert.match(
    section,
    /Revert condition: the moment alpha or beta serves real client data from a separate production database/,
    "the ledger row carries the revert condition — the ledger is the row a future reader reopens"
  );
  assert.match(
    section,
    /\| 435 \(a\) \| \*\*The migration proofs re-key/,
    "the HR re-key row"
  );
  assert.match(
    section,
    /\| 430 \| \*\*The 2-round review-fix cap counts PER REVIEW SITE/,
    "the per-site cap row"
  );
});
