// Pins for the three factory rulings of 2026-08-13:
//
//   #435 — `risk:high` narrows to auth/permissions, multi-tenant isolation and
//          payments. Schema and migrations are NOT high-risk pre-release, and
//          the migration proofs (HR1-HR3) re-key from the LABEL onto the DIFF.
//   #430 — the 2-round review-fix cap counts PER REVIEW SITE (ruled on PR #428).
//   #435 (b) — a source comment states a constraint; provenance (issue numbers,
//          ruling dates, round stamps) lives in commit messages, PR bodies and
//          `memory/`, never in source (ruled while reviewing PR #432).
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
// THE RULING HAS TWO HALVES, AND THE SWEEP OWES A FORM FOR EACH.
//   1. CLASSIFICATION — "schema ⇒ `risk:high`". Retired.
//   2. PROOF KEYING   — "the migration proofs ⇒ high-risk". Also retired: the
//      proofs re-key onto the diff, at any tier.
// Only half 1 had forms at first, so the sweep reported the ruling fully
// applied while `open-pr`'s PR-body template still said `Schema diff
// (high-risk only)` and `spec-intake`'s issue template still said
// `Extra (high-risk): migration dry-run + rollback + schema diff` — twelve
// lines below the paragraph that repeals it. That pairing is the dangerous
// one, not a cosmetic one: half 1 makes a migration track `risk:medium`
// (unattended-dispatchable, auto-mergeable, no HR4), which removes every human
// checkpoint EXCEPT the PR body — and half 2, left unapplied, is what hides the
// DDL from that body. `open-pr` is the only writer of the PR body, so it is
// where HR3 actually lands or does not. Both halves now carry forms, and a new
// spelling is added to the form list rather than fixed only where it was found.
//
// Exactly one live exemption, and it is a record rather than a rule:
//   product-docs/board-design-2026-07.md — a DATED design record of what the
//   board looked like in July 2026. Rewriting it would falsify the record, so
//   it is frozen on purpose; #435 changed the policy, not that day's minutes.
//   The exemption is not a hole: §12 carries a dated superseding note directly
//   beneath the retired sentence (the "what actually landed" house style §10
//   and §11 already use), because dispatch/SKILL.md points an agent at §12 at
//   exactly the decision the ruling changed.
// Plus this suite itself, which QUOTES the retired spellings in order to forbid
// them (the same exemption `memory/` takes). Both exemptions are asserted to
// still MATCH, so a rename or a rewrite fails the test instead of silently
// exempting nothing.
//
// WHY THIS TRACK'S DIFF IS WIDER THAN ITS DECLARED FILE LIST. #435 declared
// seven likely files, guessed at intake the way `spec-intake` step 4 asks. The
// diff is eighteen. That gap is a property of the work, not a slip: applying a
// ruling touches every file that STATES it, and only the sweep knows which
// files those are — a list guessed by reading cannot be the answer to a
// question only a walk of the tree can ask. Each extra file is load-bearing and
// the claim is checkable one file at a time:
//
//   git show <base>:<file> > <file> && npx tsx --test ops/agent-os/tests/risk-policy-docs.test.mjs
//
// Reverting any of the nine — definition-of-done, grilling, validate-backend,
// frd-plan.js, verify-and-ship.js, ops README.md, workflow.md, the onboarding
// FRD, open-pr — turns this suite RED, because each states or routes to the
// rule. The tenth, board-design-2026-07.md, is the one exception: reverting it
// keeps the suite green, because it is the exempt dated record and its edit is
// the §12 superseding note, which is a courtesy to a reader dispatch sends
// there, not a pin. Anyone shrinking this diff should start (and end) there.
//
// The lesson for the next mechanical-amendment issue: declare the SWEEP, not a
// file list. The files are its output.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SPEC_INTAKE = ".claude/skills/spec-intake/SKILL.md";
const DISPATCH = ".claude/skills/dispatch/SKILL.md";
const GRILLING = ".claude/skills/grilling/SKILL.md";
const DOD_SKILL = ".claude/skills/definition-of-done/SKILL.md";
const VALIDATE_BACKEND = ".claude/skills/validate-backend/SKILL.md";
const OPEN_PR = ".claude/skills/open-pr/SKILL.md";
const DELEGATION = "ops/agent-os/delegation-rules.md";
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
// `grilling` belongs here even though it is an INTAKE skill rather than a gate:
// it states the classification to the user it is interviewing, so it routes to
// the rule as surely as spec-intake does, and the negative sweep below can only
// forbid the retired form — it cannot require the citation.
// `open-pr` belongs here for the same reason `validate-backend` does: it is not
// a doc about the rule, it is a gate that ACTS on it. HR3 is "the exact DDL
// delta in the PR body", and this skill writes every PR body the loop produces
// (`verify-and-ship.js` hands it the evidence bundle on PASS). If it keys the
// DDL block on the label, HR3 silently does not happen for the `risk:medium`
// migration tracks #435 just created.
const POINTER_SITES = [
  DISPATCH,
  DOD_SKILL,
  VALIDATE_BACKEND,
  OPEN_PR,
  FRD_PLAN,
  VERIFY_AND_SHIP,
  WORKFLOW,
  README,
  GRILLING,
];

// The two sweep exemptions, by repo-relative path, each with why.
const SWEEP_EXEMPT = new Map([
  [
    "product-docs/board-design-2026-07.md",
    "a dated design record — rewriting it would falsify the record; §12 carries " +
      "its own dated superseding note beside the retired sentence, so the " +
      "exemption freezes the minutes without leaving a reader misinformed",
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
  // The CLASSIFICATION stated affirmatively, in whatever words: "schema
  // changes ⇒ … are risk:high", "does this need schema? then the unit is
  // risk:high". Four literal spellings missed both, because neither used any
  // of them — a live FRD and a live skill kept instructing the planner to
  // re-mint the retired label while this suite reported the ruling applied.
  //
  // The gap is tempered against `not` so the sentence the ruling REQUIRES
  // ("schema is not `risk:high`", "schema/migrations return to `risk:high`")
  // stays sayable: a form that forbids the correction as loudly as the error
  // fails every doc that states the narrowing.
  /schema[^\n]{0,60}(?:\b(?:is|are)\b|⇒|=>)(?:(?!\bnot\b)[^\n]){0,12}`?risk:high/i,

  // --- The ruling's SECOND half: the PROOF KEYING. ------------------------
  // "the migration proofs are owed by high-risk units" — retired by #435 (a).
  // HR1–HR3 key on the diff carrying a migration, at ANY tier; only HR4 still
  // keys on the label. The four forms below are ordered by the shape of the
  // sentence, not by the file it was found in.
  //
  // The label parenthesised as a gate: `(high-risk only)`, `Extra (high-risk):`.
  // This is the exact shape both survivors used. It does not fire on prose that
  // merely mentions the tier in parens with other content — `(high-risk ~450k)`
  // in token-preflight, `(2 verifiers)` in dispatch — because the paren must
  // close on the label itself.
  /\((?:only )?high[- ]risk(?: only)?\)/i,
  // A proof noun GATED on the label, in that order. The gate word is required
  // so the section title "Migration proofs and high-risk units" — which
  // correctly covers both triggers — stays sayable.
  /\b(?:dry-run|roll ?back|DDL delta|schema diff|migration proofs?)\b[^\n]{0,40}\b(?:only|iff?|when|for|on)\b[^\n]{0,20}\bhigh[- ]risk\b/i,
  // The same claim with the clauses swapped: "high-risk only: dry-run + rollback".
  /\bhigh[- ]risk\b[^\n]{0,25}\b(?:only|tracks|units)\b[^\n]{0,60}\b(?:dry-run|roll ?back|DDL delta|schema diff|migration proofs?)\b/i,
  // The gates named directly. Scoped to HR1-HR3: "HR4 if high-risk" is the
  // ruled sentence, so a form that caught any HR would forbid the correction.
  /\bHR[123]\b[^\n]{0,24}\b(?:only|if|when|for)\b[^\n]{0,24}\bhigh[- ]risk\b/i,
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

test("the sweep catches the classification in whatever words, and permits its correction", () => {
  // The sweep exempts this suite, so nothing else can check the FORMS
  // themselves. Both directions matter: a form that misses a rephrasing lets
  // a live doc keep instructing the planner (which is how the onboarding FRD
  // and the grilling skill survived four literal spellings), and a form that
  // fires on the correction makes the ruling unstateable.
  const hits = (s) => RETIRED.some((p) => p.test(s));
  for (const retired of [
    "Schema changes ⇒ requirement issues carrying them are `risk:high` per board convention.",
    "does this need schema? If yes the unit is `risk:high`; say so during the session",
    "Any schema work is risk:high.",
    "schema changes are always `risk:high`",
  ])
    assert.ok(hits(retired), `the sweep must catch: ${retired}`);

  for (const ruled of [
    "Schema changes are not `risk:high` pre-release; the schema consolidation is an ordering prerequisite.",
    "**Schema and migrations are NOT `risk:high` pre-release** — RULED 2026-08-13 (#435).",
    "the moment alpha or beta serves real client data, schema/migrations return to `risk:high`",
    "`ordering` = the schema consolidation; it is NOT risk:high and gets no approval gate.",
  ])
    assert.ok(!hits(ruled), `the sweep must permit: ${ruled}`);
});

test("the sweep catches the PROOF KEYING half too, and permits its correction", () => {
  // The half that had no form. The first two strings are verbatim the lines
  // that survived every quality round: `open-pr`'s PR-body template and
  // `spec-intake`'s issue template. Both were MISSED by all five
  // classification forms, because neither line mentions `risk:high` at all —
  // they key a PROOF on the tier, which is a different sentence about the same
  // ruling.
  const hits = (s) => RETIRED.some((p) => p.test(s));
  for (const retired of [
    "<details><summary>Schema diff (high-risk only)</summary>",
    "- Extra (high-risk): migration dry-run + rollback + schema diff",
    "Run the migration dry-run and rollback for high-risk units.",
    "HR1-HR3 only when high-risk.",
    "high-risk only: migration dry-run + rollback",
  ])
    assert.ok(hits(retired), `the sweep must catch: ${retired}`);

  // The corrections have to survive, including the two sentences that name the
  // tier for the one gate it still buys (HR4) and the section heading that
  // covers both triggers at once.
  for (const ruled of [
    "## Migration proofs and high-risk units (extra gates)",
    "(+ HR1..HR3 if the diff carries a migration; + HR4 if high-risk)",
    "- **HR4 Diverse-lens sign-off** *(`risk:high` only)* — after G6, three independent reviewers",
    "- **HR3 Schema diff in PR body** *(any tier, whenever the diff carries a migration)*",
    "they still owe the HR1–HR3 migration proofs at verify time, because that trigger is the DIFF",
    "Schema/migrations are not high-risk pre-release (#435, 2026-08-13) — they owe HR1–HR3 instead",
    "| large / high-risk (2 verifiers) | ~450k |",
    "deferred #18 (high-risk ~450k) — needs more budget.",
  ])
    assert.ok(!hits(ruled), `the sweep must permit: ${ruled}`);
});

test("open-pr's body template makes the DDL delta unconditional on the label", () => {
  // HR3 is "the exact DDL delta in the PR body". This skill writes the body, so
  // this template IS where HR3 lands. #435 made migration tracks `risk:medium`
  // — unattended-dispatchable and auto-mergeable — which leaves the PR body as
  // the last human checkpoint; a label-gated DDL block removes that one too.
  const text = read(OPEN_PR);
  assert.match(
    text,
    /<summary>Schema diff[^\n]*whenever the diff carries a migration, ANY risk tier[^\n]*<\/summary>/,
    "the collapsible's summary is the trigger a body-writing agent reads"
  );
  assert.match(
    text,
    /\*\*If the diff carries a migration, the DDL delta goes in the body — at ANY risk tier\.\*\*/,
    "and the Rules list must say it outright, not only in the template"
  );
  assert.match(
    text,
    /git diff --name-only \$\(git merge-base origin\/main HEAD\)\.\.\.HEAD -- src\/db\/migrations\//,
    "the trigger is computable, so the skill must compute it rather than ask the agent to recall the risk tier"
  );
  // …and computed against the REMOTE ref. Local `main` is worktree-shared and
  // nothing in the build loop updates it, so `merge-base main HEAD` on a
  // checkout whose local main lags reports every file merged to origin/main
  // since as this branch's own — and the DDL pasted into the body would then
  // describe an already-merged track. A body that misdescribes the schema
  // change is worse than one that omits it.
  assert.doesNotMatch(
    text,
    /merge-base main HEAD/,
    "the bare local ref is exactly the stale-ancestor bug this pin exists to prevent"
  );
});

test("the workflow asserts HR3 on the PR BODY, keyed on the migration trigger", () => {
  // `migrationProofsMissing` runs against a report produced BEFORE a PR exists,
  // so it can only prove a DDL delta was computed — never that it reached a
  // reader. dod.md defines HR3 as "the exact DDL delta is shown to the
  // reviewer", and `open-pr` writes the only body there is. Nothing else closes
  // the loop: the auto-merge hold list is risk:high / hold / spec-question /
  // unresolved findings, and a migration is deliberately none of them. So the
  // skill-prose pin above is only half the guard — this is the other half.
  const text = read(VERIFY_AND_SHIP);

  assert.match(
    text,
    /bodyHasSchemaDiff: \{\s*type: "boolean"/,
    "the PR schema must carry the body read-back, or the answer has nowhere to land"
  );
  assert.match(
    text,
    /gh pr view <number> --json body/,
    "the release agent must READ the body back, not report what it believes it wrote"
  );
  assert.match(
    text,
    /effectiveMigration && pr\?\.opened && pr\.bodyHasSchemaDiff !== true/,
    "keyed on the migration trigger, and `!== true` fails closed on an unanswered field exactly as migrationProofsOwed does"
  );
  assert.match(
    text,
    /failingGate: "HR3\/pr-body"/,
    "and it fails as its own gate, distinguishable from the report-side HR1-HR3 assertion"
  );

  // ORDERING is the whole guarantee: an assertion after the merge gate proves
  // nothing about what merged.
  const gate = text.indexOf('failingGate: "HR3/pr-body"');
  const settle = text.indexOf('settleLabels(track, "agent:in-review"');
  const autoMerge = text.indexOf("if (AUTO_MERGE) {");
  assert.ok(gate > 0 && settle > 0 && autoMerge > 0);
  assert.ok(
    gate < settle && gate < autoMerge,
    "the body assertion must run BEFORE settleLabels and the auto-merge gate"
  );

  // The tip governs. A fix round can add the branch's first migration or drop
  // its last, so the state the PR is judged against is the re-anchored one.
  assert.match(
    text,
    /effectiveMigration = migrationAtTip;/,
    "the G3 re-anchor must hand its answer forward, including when it is null"
  );

  // And dod.md, which DEFINES HR3, must say where it is asserted — a rule
  // recorded with no named enforcement is the shape that produced this gap.
  assert.match(
    read(DOD),
    /\*\*HR3 Schema diff in PR body\*\*[^\n]*Asserted on the BODY, not on the report/,
    "dod.md's HR3 bullet must name the body as the landing site it is checked at"
  );
});

test("the spec-intake issue template keys the extra proofs on the diff", () => {
  // §3 of this skill repeals the label keying; twelve lines later the template
  // an agent actually copies still asked for the proofs "(high-risk)". The
  // template is the half that gets pasted into every new issue.
  const text = read(SPEC_INTAKE);
  const plan = text.slice(text.indexOf("## Validation plan"));
  assert.match(
    plan,
    /- Extra \(HR1[–-]HR3 — owed whenever the diff carries a migration, at ANY risk tier; RULED 2026-08-13, #435\)/,
    "the minted issue must carry the ruled trigger, or every issue re-mints the repealed rule"
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

test("the G3 backend skill owes HR1-HR3 on the diff, in its body AND its description", () => {
  // This skill is what a backend verifier actually executes, and its frontmatter
  // description is what the agent reads before opening it. Both said "high-risk",
  // so the running gate asked for the proofs on a strictly narrower set than
  // dod.md now owes them on.
  const text = read(VALIDATE_BACKEND);
  const [, frontmatter] = text.split("---");
  assert.match(
    frontmatter,
    /roll back whenever the diff carries a migration/,
    "the description is the summary an agent routes on; it must not still say high-risk"
  );
  assert.match(
    text,
    /\*\*HR1[–-]HR3 — owed whenever the diff carries a migration, at ANY risk tier\*\*/,
    "the migration step's own heading carries the trigger"
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
// #435 (b) — a comment states a constraint; provenance lives outside the source
// ---------------------------------------------------------------------------

test("delegation-rules.md states the comment-provenance rule as a numbered rule", () => {
  const text = read(DELEGATION);
  assert.match(
    text,
    /^## R7 — A comment states a constraint; provenance lives outside the source$/m,
    "the rule is R7, so it is citable the way R2/R4/R5 already are"
  );
  assert.match(
    text,
    /RULED 2026-08-13 \(Sebastian, while reviewing PR #432\)/,
    "a ruling with no date and no origin is an opinion by the time it is read"
  );
  assert.doesNotMatch(
    text,
    /^Six rules that decide/m,
    "the header counts the rules; a seventh rule that the opening paragraph does not count is a rule readers skip"
  );
  assert.match(text, /^Seven rules that decide/m);
  // The three homes for provenance are the point of the rule — a version that
  // only forbids it in source tells an agent to delete the sentence instead of
  // to move it.
  for (const home of [/commit\s+message/i, /PR bod(y|ies)/i, /`memory\/`/])
    assert.match(
      text,
      home,
      `the rule must name where provenance does live (${home})`
    );
  assert.match(
    text,
    /enforcement pointer/i,
    "citing the invariant or test that pins a constraint must be exempted by name, or the rule eats R5"
  );
  assert.match(
    text,
    /Test files are outside the rule/,
    "the G4 check runs over non-test lines; the rule must say so where the rule is stated"
  );
  assert.match(
    text,
    /\*\*Enforced:\*\* G4's convention checklist runs the check over the track's \*\*added non-test source\s+lines\*\*/,
    "R5 requires every recorded rule to name its enforcement, and this one's is G4"
  );
});

test("dod.md G4 carries the matching check, computed over added non-test source lines", () => {
  const text = read(DOD);
  const g4 = text.slice(
    text.indexOf("### G4 — Conventions & invariants"),
    text.indexOf("### G5 — Diff hygiene")
  );
  assert.ok(g4.length > 0, "G4 must still be its own section above G5");
  assert.match(
    g4,
    /\*\*No provenance in source comments\*\*/,
    "the check belongs on G4's checklist, which is what a verifier walks"
  );
  assert.match(
    g4,
    /added non-test source lines/i,
    "the scope is added lines, not the whole tree — the rule is not retroactive"
  );
  assert.match(
    g4,
    /delegation-rules\.md` R7/,
    "the check points at the rule rather than restating it in full"
  );
  assert.match(g4, /RULED 2026-08-13/, "and dates it");
  assert.match(
    g4,
    /git diff -U0 \$\(git merge-base <track-branch> HEAD\)\.\.\.HEAD/,
    "G4 is an attested gate, so the one thing that can be computed must be computed — cf. G5's 'compute the file list, do not recall it'"
  );
});

// ---------------------------------------------------------------------------
// The ledger — where a ruling is supposed to be findable from
// ---------------------------------------------------------------------------

test("all three rulings have dated ledger rows", () => {
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
  assert.match(
    section,
    /\| 435 \(b\) \| \*\*A source comment states a constraint; provenance never appears in source\.\*\*/,
    "the comment-provenance row"
  );
  assert.match(
    section,
    /Prompt-level wiring[^|]*deliberately deferred/,
    "the row must say what was deliberately NOT done, or the next pass reads the gap as an oversight and closes it unasked"
  );
  assert.match(
    section,
    /^Three rulings about the delivery factory itself/m,
    "the section preamble counts its own rows"
  );
});
