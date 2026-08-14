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
// SCOPE NOTE. The scan below covers the four factory docs #435 declared. Other
// files still describe risk:high the retired way and are deliberately NOT in the
// list, because they belong to other workstreams' declared file sets:
//   .claude/workflows/frd-plan.js (:77, :168)
//   .claude/workflows/verify-and-ship.js (:1032, a comment)
//   .claude/skills/definition-of-done/SKILL.md (:35)
//   ops/agent-os/workflow.md (:104), ops/agent-os/README.md (:114)
//   product-docs/board-design-2026-07.md (:599, a dated design record)
// Widening RULE_SITES / SCANNED to them is the follow-up, and it is a widening
// of the LIST, never of the instances.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SPEC_INTAKE = ".claude/skills/spec-intake/SKILL.md";
const DISPATCH = ".claude/skills/dispatch/SKILL.md";
const LABELS = "ops/agent-os/labels.md";
const DOD = "ops/agent-os/dod.md";
const LEDGER = "product-docs/decisions.md";

// The docs that STATE the risk rule (as opposed to merely obeying it). Each one
// must carry the ruling AND its revert condition — a reader who meets the
// narrowing without the condition that reverses it reads a permanent rule.
const RULE_SITES = [SPEC_INTAKE, LABELS, DOD];

// Every doc in the declared set, for the retired-phrasing sweep.
const SCANNED = [SPEC_INTAKE, DISPATCH, LABELS, DOD];

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

test("no declared factory doc still lists schema as risk:high", () => {
  // The retired phrasings, by their exact spellings. A hand-list of INSTANCES
  // is what rots; this is a list of FORMS, and a new spelling is added here
  // rather than fixed only where it was found.
  const RETIRED = [
    /schema\/auth\/tenancy/i,
    /schema, auth and tenancy/i,
    /schema\/migrations, auth/i,
    /touches schema/i,
  ];
  for (const rel of SCANNED) {
    const text = read(rel);
    for (const pattern of RETIRED)
      assert.doesNotMatch(
        text,
        pattern,
        `${rel} still describes risk:high the pre-#435 way (${pattern})`
      );
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
