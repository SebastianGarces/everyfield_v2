export const meta = {
  name: "verify-and-ship",
  description:
    "One integration verify→ship attempt for an assembled track branch: push+sha assert, integration DoD, G6 review-fix loop, HR4 lenses, PR, CI anchor, label settle, auto-merge gate.",
  whenToUse:
    "Child of build-until-done only — never invoke directly. Receives one track's assembled branch per integration attempt.",
};

// ---------------------------------------------------------------------------
// Child workflow. ONE level of workflow() nesting is the runtime limit, and
// build-until-done.js is the parent — so this script calls only agent(),
// parallel() and log(), NEVER workflow(). Attempt accounting, attribution
// re-entry (byWorkstream + priorReport) and the token reserve live in the
// parent; this file is one attempt of the guarantee tail, start to finish.
// ---------------------------------------------------------------------------
const A = typeof args === "string" ? JSON.parse(args) : args;
if (!A || !A.track || !A.branch || !A.wt)
  throw new Error(
    "verify-and-ship is a child of build-until-done and takes its assembled args: " +
      "{track, branch, wt, base, attempt, labelAttempts, autoMerge, conventions, criteria, wsSummaries, wsIds, carriedFindings, survivingTrees}"
  );

const track = A.track; // { id, issues, risk, hold, lane }
const branch = A.branch;
const wt = A.wt;
// The base is a REMOTE ref, and that is not a detail.
//
// `BASE` is the left-hand side of every merge-base this file takes, and the
// one that matters is `migrationProofsOwed`'s: its output names the files
// spliced into the verifier brief, so a merge-base against the wrong ancestor
// does not merely widen a log line — it collects HR1–HR3 for migrations this
// track never wrote, and HR3's DDL delta then MISDESCRIBES the change in the
// PR body, which is worse than omitting it.
//
// A bare `main` is the worktree-shared LOCAL ref. Nothing in this loop updates
// it, and track prep merges `origin/<base>`, so in a checkout whose local
// `main` lags the remote, `merge-base(main, HEAD)` lands on the stale ancestor
// and the diff prints every path merged to `origin/main` since. `origin/main`
// is also what the PR merges into, which is the ref every other gate reasons
// about (`ops/agent-os/dod.md`, G5). Normalised here rather than trusted from
// the caller: the parent normalises its own copy the same way, and this script
// is also driven directly by its tests. An explicit `origin/…`, a SHA, a `refs/`
// path or a version tag is already unambiguous and is taken literally.
const BASE_INPUT = A.base || "main";
const BASE = /^(origin\/|[0-9a-f]{7,40}$|refs\/|v\d)/.test(BASE_INPUT)
  ? BASE_INPUT
  : `origin/${BASE_INPUT}`;
const attempt = A.attempt || 1;
const LABEL_ATTEMPTS = A.labelAttempts || 3;
const AUTO_MERGE = A.autoMerge === true;
const CONVENTIONS = A.conventions || "";
const criteria = A.criteria || "";
const wsSummaries = A.wsSummaries || [];
const wsIds = A.wsIds || [];
const carriedFindings = A.carriedFindings || [];
const survivingTrees = A.survivingTrees || [];

// The fix-loop cap. TWIN: build-until-done.js declares the same constant for
// the scoped-site loop — change one, change both; frd-workflows.test.mjs
// asserts every TWIN:BEGIN/END block is text-identical across the two files.
// TWIN:BEGIN QUALITY_ROUNDS
const QUALITY_ROUNDS = 2;
// TWIN:END QUALITY_ROUNDS

const DOD_SCHEMA = {
  type: "object",
  required: ["verdict", "gates", "acceptanceCriteria", "summary"],
  properties: {
    verdict: { type: "string", enum: ["PASS", "PASS_WITH_WARNINGS", "FAIL"] },
    highRisk: { type: "boolean" },
    gates: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status", "evidence"],
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["PASS", "FAIL", "SKIPPED"] },
          evidence: { type: "string" },
        },
      },
    },
    acceptanceCriteria: {
      type: "array",
      items: {
        type: "object",
        required: ["ac", "status", "evidence"],
        properties: {
          ac: { type: "string" },
          status: { type: "string", enum: ["PASS", "FAIL"] },
          evidence: { type: "string" },
        },
      },
    },
    screenshots: { type: "array", items: { type: "string" } },
    // Warnings are SPEC-QUESTIONS ONLY, and they decide whether a passing
    // track may merge without a human.
    //
    // The DoD proves the code does what the SPEC said. It cannot prove the
    // spec was right — only a human can rule on WHAT should have been built,
    // so a spec-question holds the track. Everything decidable from the
    // codebase alone belongs in `findings` and is FIXED IN THIS PASS by the
    // review-fix loop (RULED 2026-08-10, #399): never filed as debt, never
    // merged unfixed without a ruling.
    warnings: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "summary"],
        properties: {
          kind: {
            type: "string",
            enum: ["spec-question"],
            description:
              "spec-question = answering it could change WHAT was built (product intent, an AC that did not say, a requirement read two ways). Anything decidable from the codebase alone is a FINDING, not a warning.",
          },
          summary: { type: "string" },
          detail: {
            type: "string",
            description: "the decision the human must make, and the options.",
          },
          files: { type: "array", items: { type: "string" } },
        },
      },
    },
    // The reviewer's actionable output, mapped from the code-reviewer brief:
    // Critical → "critical", structural Warnings → "structural", Suggestions →
    // "suggestion". Critical ∪ structural are fixed in-pass by the quality
    // rounds; suggestions never gate and never trigger a round.
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "summary", "remedy"],
        properties: {
          severity: {
            type: "string",
            enum: ["critical", "structural", "suggestion"],
          },
          summary: { type: "string" },
          detail: {
            type: "string",
            description:
              "exact lines and the defect, stated so an implementer can act on it directly",
          },
          files: { type: "array", items: { type: "string" } },
          remedy: {
            type: "string",
            description:
              'what "fixed" looks like, concretely — the re-review verifies against this',
          },
        },
      },
    },
    failingGate: { type: "string" },
    failingWorkstream: {
      type: "string",
      description:
        "the workstream id a failure belongs to, when it belongs to exactly one. Empty for failures of the assembly itself — misattributing one of those sends the fix to an agent that cannot see the other half.",
    },
    fixInstructions: { type: "string" },
    summary: { type: "string" },
  },
};
const MERGE_SCHEMA = {
  type: "object",
  required: ["merged", "state"],
  properties: {
    merged: { type: "boolean" },
    state: {
      type: "string",
      enum: ["merged", "queued-for-auto-merge", "refused", "failed"],
      description: "what GitHub actually reported — not what was attempted",
    },
    detail: { type: "string" },
  },
};

// ---------------------------------------------------------------------------
// The preview must contain the code that is being validated.
//
// G3 drives the branch's Vercel preview, and the preview is built from what
// `origin/<branch>` holds — not from what the worktree holds. On #307 the later
// attempts validated a preview built from f604b2b while the worktree sat on
// a4c5ede, so two attempts were spent proving things about code the fix had
// already replaced. The loop now pushes and asserts the two shas match BEFORE
// the integration verifier runs, and reports what `git rev-parse` printed rather
// than whether the push felt successful.
// ---------------------------------------------------------------------------
const PUSH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pushed", "headSha", "remoteSha"],
  properties: {
    pushed: { type: "boolean" },
    headSha: {
      type: "string",
      description: "what `git -C <wt> rev-parse HEAD` printed, verbatim",
    },
    remoteSha: {
      type: "string",
      description:
        "what `git -C <wt> rev-parse origin/<branch>` printed AFTER the push and a fetch, verbatim",
    },
    detail: { type: "string" },
  },
};

// ---------------------------------------------------------------------------
// The HR1–HR3 trigger: the DIFF, never the label — see ops/agent-os/dod.md,
// "Migration proofs and high-risk units (extra gates)".
//
// The migration proofs are proofs ABOUT THE DDL, not privileges `risk:high`
// buys, so they fire whenever the track's diff carries a file under
// `src/db/migrations/` — at ANY risk tier. HR4, attended-only dispatch and
// never-auto-merge stay keyed to `risk:high`; that split is the policy.
//
// Never re-key this on `track.risk`: `risk:high` no longer covers schema
// work, so a label test would be false for exactly the tracks that carry
// migrations and the proofs would silently never be asked for.
// ---------------------------------------------------------------------------
const DIFF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["carriesMigration", "migrationFiles"],
  properties: {
    carriesMigration: {
      type: "boolean",
      description:
        "whether the printed paths included any file under src/db/migrations/",
    },
    migrationFiles: {
      type: "array",
      items: { type: "string" },
      description:
        "every printed path that starts with src/db/migrations/, verbatim",
    },
    detail: { type: "string" },
  },
};

// A merged track owns its own leftovers; a held or blocked one hands them over.
const CLEANUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["removed"],
  properties: {
    removed: {
      type: "array",
      items: { type: "string" },
      description: "worktree paths and local branches actually gone afterwards",
    },
    remaining: {
      type: "array",
      items: { type: "string" },
      description: "anything still there, with the reason",
    },
    note: { type: "string" },
  },
};
const PR_SCHEMA = {
  type: "object",
  required: ["opened", "url", "checkConclusion"],
  properties: {
    opened: { type: "boolean" },
    url: { type: "string" },
    reason: { type: "string", description: "if not opened, why" },
    // The anchor. Everything else in this loop is an agent's account of its own
    // work; this is the one field a model cannot talk its way past. A track is
    // not shipped until GitHub says the required check is green.
    checkConclusion: {
      type: "string",
      enum: ["success", "failure", "timed_out", "none"],
      description:
        "conclusion of the required check on the PR, from `gh pr checks` — NOT the agent's opinion",
    },
    checkSummary: {
      type: "string",
      description: "if not success: which step failed and the error excerpt",
    },
    // HR3's landing site. `migrationProofsMissing` runs before a PR exists, so
    // it can only prove a DDL delta was COLLECTED — never that it reached a
    // reader. This pair is the read-back: what `gh pr view <number> --json body`
    // printed, not what the body-writing agent believes it wrote.
    bodyHasSchemaDiff: {
      type: "boolean",
      description:
        "only when the diff carries a migration: whether the PR BODY, read back with `gh pr view <number> --json body`, contains the `Schema diff` block with non-empty SQL inside it",
    },
    schemaDiffExcerpt: {
      type: "string",
      description:
        "the SQL that block actually contained, verbatim from the body you read back",
    },
  },
};

// ---------------------------------------------------------------------------
// DUPLICATED from build-until-done.js (the two-table pattern, like dispatch /
// token-preflight): the parent keeps its copy for blockTrack and the claim
// path; this child needs the same guards for its own label writes and exit
// comments. Change one, change both.
// ---------------------------------------------------------------------------
// TWIN:BEGIN BLOCK_SCHEMA
const BLOCK_SCHEMA = {
  type: "object",
  required: ["commented"],
  properties: { commented: { type: "boolean" }, note: { type: "string" } },
};
// TWIN:END BLOCK_SCHEMA

// ---------------------------------------------------------------------------
// The label is the outcome — so it is read back, not assumed.
//
// On 2026-07-26 the loop wrote its narrative (PR body / issue comment) and its
// LABEL as two steps, and on 2 of 8 tracks the second one silently did not
// happen: #110 shipped a full evidence bundle and #74 was blocked, and both
// issues stayed on `agent:in-progress`. Neither step reported an error.
//
// `ops/agent-os/labels.md` declares the labels canonical and the Project board
// derived, so a missed label is not cosmetic — it is the system of record
// telling a lie that a human cannot distinguish from the truth. The fix is the
// #139 claim-guard shape: the writing agent reports what `gh issue view`
// PRINTED after the write, the loop asserts that observation, retries, and on
// final failure the track is ERRORED rather than reported as success.
// (DUPLICATED from build-until-done.js — change one, change both.)
// ---------------------------------------------------------------------------
// TWIN:BEGIN LABEL_STATE_SCHEMA
const LABEL_STATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observed"],
  properties: {
    observed: {
      type: "array",
      description:
        "One row per issue, holding the labels `gh issue view` printed AFTER the write. Transcribe what you saw; do not report what you intended.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issue", "labels"],
        properties: {
          issue: { type: "integer" },
          labels: { type: "array", items: { type: "string" } },
        },
      },
    },
    prLabels: {
      type: "array",
      items: { type: "string" },
      description:
        "Labels `gh pr view` printed after the write, when a PR was in scope.",
    },
    note: { type: "string" },
  },
};
// TWIN:END LABEL_STATE_SCHEMA
const LENS_SCHEMA = {
  type: "object",
  required: ["verdict", "lens", "findings", "summary"],
  properties: {
    verdict: { type: "string", enum: ["PASS", "FAIL"] },
    lens: { type: "string" },
    findings: { type: "array", items: { type: "string" } },
    failingGate: { type: "string" },
    fixInstructions: { type: "string" },
    summary: { type: "string" },
  },
};

// ---------------------------------------------------------------------------
// HR4 — diverse-lens sign-off for high-risk tracks.
//
// This replaced a SECOND IDENTICAL code-reviewer pass. Two identical reviewers
// mostly reproduce each other's blind spots: the second agrees with the first
// for the same reasons the first was wrong. Three different QUESTIONS do not
// correlate that way — each lens is the only one looking down its own axis.
//
// Which is exactly why these votes are NOT majority-pooled. Majority voting is
// the right aggregation for REDUNDANT verifiers (identical skeptics produce
// correlated noise, so outvoting filters it). With DIVERSE verifiers a security
// FAIL is not noise the other two can outvote — they never looked at security.
// So: any lens FAIL blocks, and a lens that DIED counts as a NO, because
// dod.md's own rule is to default to FAIL when evidence is missing.
// ---------------------------------------------------------------------------
const HIGH_RISK_LENSES = [
  {
    key: "correctness",
    brief: `Read the diff against the acceptance criteria and the data model. Does it actually do what was asked, including the edge cases nobody wrote an AC for — empty states, the second call, concurrent writes, null/missing rows? For migrations: is the DDL itself right (nullability, defaults, indexes, cascade behaviour), and does existing data survive it?`,
  },
  {
    key: "security",
    brief: `Attack the diff. Auth and permission checks on every new entrypoint; multi-tenant boundaries (can org A read or write org B's rows through anything this adds?); injection and unsafe interpolation; secrets or internal data reaching a client bundle or a log; over-broad SELECTs that widen what a response exposes. Read memory/invariants.md and every file under memory/invariants/, and treat every rule in them as a hard requirement, not a guideline. You are the ONLY reviewer looking down this axis — if you pass this, nobody else will catch it.`,
  },
  {
    key: "reproducibility",
    brief: `Do NOT reason about the code — RE-RUN the evidence. Execute the migration dry-run, the rollback, and \`pnpm test\` yourself in the worktree, and re-derive the schema diff. Then compare what you observed against what the first verifier's report claims. Any claim you cannot reproduce is a FAIL, and say which claim and what you got instead.`,
  },
];

// (DUPLICATED from build-until-done.js — change one, change both.)
// TWIN:BEGIN hashes
const hashes = (issues) => issues.map((n) => `#${n}`).join(", ");
// TWIN:END hashes

// (DUPLICATED from build-until-done.js — change one, change both.)
// TWIN:BEGIN treeLines
const treeLines = (trees) =>
  (trees || [])
    .map(
      (t) => `  - worktree \`${t.path}\` on branch \`${t.branch}\` — ${t.holds}`
    )
    .join("\n") || "  (none — nothing was created)";
// TWIN:END treeLines

/**
 * The reviewer's findings, VERBATIM — the fix agent and the hold comment quote
 * these rather than paraphrasing them, for the same reason evidenceBlock exists
 * in the parent: a paraphrase is where a named defect becomes a vague hunch.
 */
// TWIN:BEGIN findingsBlock
function findingsBlock(findings) {
  return (
    (findings || [])
      .map(
        (f, i) =>
          `--- finding ${i + 1} [${f.severity}]${f.workstream ? ` (from ${f.workstream})` : ""} ---\n` +
          `${f.summary}\n` +
          `${f.detail || "(no further detail given)"}\n` +
          `Files: ${(f.files || []).join(", ") || "(none named)"}\n` +
          `What "fixed" looks like: ${f.remedy || "(not stated)"}`
      )
      .join("\n\n") || "(no findings)"
  );
}
// TWIN:END findingsBlock

// The per-finding analogue of `rootCauseAddressed` (the #307 discipline): a fix
// that cannot say what it did about each finding is refused before a re-review
// is spent on it. TWIN: build-until-done.js carries the same schema for the
// scoped-site loop — change one, change both.
// TWIN:BEGIN FIX_SCHEMA
const FIX_SCHEMA = {
  type: "object",
  required: ["committed", "filesChanged", "summary", "perFinding"],
  properties: {
    committed: {
      type: "boolean",
      description: "the fix is committed on the branch",
    },
    filesChanged: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    perFinding: {
      type: "array",
      items: {
        type: "object",
        required: ["finding", "addressed"],
        properties: {
          finding: {
            type: "string",
            description: "the finding, restated in your own words",
          },
          addressed: {
            type: "string",
            description:
              "what you changed so this finding is gone, and how you proved it — or a plain 'not addressed, here is why'. Empty means the round is refused.",
          },
        },
      },
    },
  },
};
// TWIN:END FIX_SCHEMA

/**
 * Which of `issues` do NOT demonstrably read `target`.
 * (DUPLICATED from build-until-done.js — change one, change both.)
 */
// TWIN:BEGIN labelViolations
function labelViolations(issues, observed, target) {
  return (issues || []).filter((n) => {
    const row = (observed || []).find((o) => Number(o?.issue) === Number(n));
    if (!row) return true;
    const labels = row.labels || [];
    return !labels.includes(target) || labels.includes("agent:in-progress");
  });
}
// TWIN:END labelViolations

/**
 * Write `target` onto the track's issues (and, for the review queue, its PR),
 * then READ THE LABELS BACK and assert them. Retries, and reports failure
 * instead of a cheerful boolean.
 * (DUPLICATED from build-until-done.js — change one, change both. The child's
 * copy keeps the `trk`/`att` names to avoid shadowing its top-level `track`
 * and `attempt`; the twin test normalizes exactly those two renames.)
 *
 * Returns { settled, observed, prLabels, attempts, missing }.
 */
// TWIN:BEGIN settleLabels
async function settleLabels(trk, target, { phase = "Ship", pr = null } = {}) {
  if (!trk.issues.length)
    return { settled: true, observed: [], attempts: 0, missing: [] };

  const list = trk.issues.join(", ");
  const wantsPrLabel = Boolean(pr?.url) && target === "agent:in-review";
  let observed = [];
  let prLabels = [];

  for (let att = 1; att <= LABEL_ATTEMPTS; att++) {
    const reply = await agent(
      `Put the board in its true state. The issues are ${list} and the target status label is \`${target}\`.
${att > 1 ? `\nATTEMPT ${att}: a previous attempt did NOT land. The issues that still do not read \`${target}\` are ${labelViolations(trk.issues, observed, target).join(", ") || "(none reported — the last attempt returned nothing)"}. Re-run the edit for those and read them back again.\n` : ""}
1. For EACH issue n in ${list}:
   \`gh issue edit n --add-label ${target} --remove-label agent:in-progress\`
   The status labels are mutually exclusive, so also remove any OTHER \`agent:*\`
   label the issue still carries. If a \`--remove-label\` fails because the label
   was already gone, that is fine — re-run it as an \`--add-label\` only.
${wantsPrLabel ? `2. Ensure the PR ${pr.url} carries \`${target}\` too: \`gh pr edit ${pr.url} --add-label ${target}\`.\n` : ""}
${wantsPrLabel ? "3" : "2"}. Now READ IT BACK. Do not skip this and do not answer from what you
   intended. For each issue n run:
   \`gh issue view n --json labels --jq '[.labels[].name]'\`
${wantsPrLabel ? `   and \`gh pr view ${pr.url} --json labels --jq '[.labels[].name]'\`\n` : ""}
   Report EXACTLY what those commands printed, even if it is not what you expected —
   the loop compares your report against the target and will retry. A wrong answer
   here is worse than a failed edit, because it makes a broken board look settled.

Return {"observed":[{"issue":n,"labels":[...]} for every issue in ${list}]${wantsPrLabel ? ', "prLabels":[...]' : ""}}.`,
      {
        label: `label:${target.replace("agent:", "")}:${trk.id}#${att}`,
        phase,
        // Cheap is safe here ONLY because the answer is verified below. The
        // 2026-07-26 failure was a cheap agent silently no-opping; the guard,
        // not the model tier, is what makes that survivable.
        model: "haiku",
        effort: "low",
        schema: LABEL_STATE_SCHEMA,
      }
    );

    observed = reply?.observed || [];
    prLabels = reply?.prLabels || [];
    const missing = labelViolations(trk.issues, observed, target);
    const prMissing = wantsPrLabel && !prLabels.includes(target);

    if (!missing.length && !prMissing)
      return { settled: true, observed, prLabels, attempts: att, missing: [] };

    log(
      `🏷️  ${trk.id} label write did not stick on attempt ${att}/${LABEL_ATTEMPTS} — ` +
        `${missing.length ? `issue(s) ${missing.join(", ")} do not read ${target}` : ""}` +
        `${missing.length && prMissing ? "; " : ""}${prMissing ? `the PR does not carry ${target}` : ""}`
    );
  }

  return {
    settled: false,
    observed,
    prLabels,
    attempts: LABEL_ATTEMPTS,
    missing: labelViolations(trk.issues, observed, target),
  };
}
// TWIN:END settleLabels

// ---------------------------------------------------------------------------
// Push FIRST, and prove the remote has what the worktree has.
//
// ORDERING guarantee (ruling designNote 5): no verifier runs against a preview
// until `HEAD == origin/<branch>` has been observed. Called (a) before the
// integration verify and (b) after every fix-loop round that commits, so the
// preview/PR always holds the sha under test. Review this as an ORDERED block,
// not a presence check.
// ---------------------------------------------------------------------------
async function pushAndAssert(round = 0) {
  const push = await agent(
    `Publish branch ${branch} from worktree ${wt} so its preview deployment contains what is about to be validated.

1. \`git -C ${wt} push -u origin ${branch}\`
2. \`git -C ${wt} fetch origin ${branch}\`
3. Report, VERBATIM, what these printed:
   - \`git -C ${wt} rev-parse HEAD\` → \`headSha\`
   - \`git -C ${wt} rev-parse origin/${branch}\` → \`remoteSha\`

The loop compares those two and will NOT run the functional gate until they are equal, so transcribe what you saw rather than what you expect. If the push was rejected, say why in \`detail\` and report the shas anyway — the mismatch is the diagnosis. Do NOT open a PR and do NOT merge. Return strictly the schema.`,
    {
      label: `push:${track.id}#${attempt}${round ? `r${round}` : ""}`,
      phase: "Verify",
      // Two git commands and two rev-parses, and the answer is asserted below.
      model: "haiku",
      effort: "low",
      schema: PUSH_SCHEMA,
    }
  );

  const headSha = String(push?.headSha || "").trim();
  const remoteSha = String(push?.remoteSha || "").trim();
  if (!push?.pushed || !headSha || !remoteSha || headSha !== remoteSha) {
    const failReport = {
      verdict: "FAIL",
      gates: [
        {
          id: "G3",
          status: "FAIL",
          evidence:
            `git -C ${wt} rev-parse HEAD → ${headSha || "(nothing reported)"}\n` +
            `git -C ${wt} rev-parse origin/${branch} → ${remoteSha || "(nothing reported)"}\n` +
            `${push?.detail || "no detail returned"}`,
        },
      ],
      acceptanceCriteria: [],
      failingGate: "G3/preview-sync",
      fixInstructions: `The preview is built from \`origin/${branch}\`, which does not match the worktree. Push ${branch} from ${wt} and re-check before anything validates it.`,
      summary: `${track.id}: the branch was not published, so the preview would not contain the code under test`,
    };
    log(
      `🔁 ${track.id} attempt ${attempt}: worktree is at ${headSha || "?"} but origin/${branch} is at ${remoteSha || "?"} — not validating a stale preview`
    );
    return { ok: false, failReport };
  }
  return { ok: true, remoteSha };
}

/**
 * Does this track's diff carry a migration? Read off `git diff --name-only`
 * against the merge-base with the base branch — never off `track.risk`, never
 * off the issue labels (see DIFF_SCHEMA's header for the policy).
 *
 * Returns `null` when the diff carries none, otherwise `{ line, files }`:
 * `line` is the sentence spliced into the verifier brief, `files` is what
 * made the trigger fire — the log and the HR1–HR3 assertion below both need
 * the list, and deriving it twice is how the brief and the check drift apart.
 *
 * Called ONCE PER SHA UNDER REPORT, not once per attempt: a quality-round fix
 * can edit a migration or add the first one, so the G3 re-anchor asks again at
 * the tip. `stage` only distinguishes the two calls' labels.
 *
 * FAILS CLOSED. An undecided diff owes the proofs: a missing answer must never
 * be the reason a DDL change shipped without a dry-run or a rollback.
 */
async function migrationProofsOwed(stage = "") {
  const diff = await agent(
    `Report whether branch ${branch} in worktree ${wt} changes any database migration file.

Run exactly this, and read the answer off what it prints:
\`git -C ${wt} diff --name-only $(git -C ${wt} merge-base ${BASE} HEAD)...HEAD\`

Put every printed path beginning with \`src/db/migrations/\` into \`migrationFiles\`, and set \`carriesMigration\` to whether that list is non-empty. Transcribe what git printed — do NOT infer from the issue, its labels, the branch name or the commit messages. If the command failed, explain in \`detail\`, return \`carriesMigration: true\` and an empty list: an undecided diff owes the migration proofs rather than skipping them. Do not push, do not commit, do not open a PR. Return strictly the schema.`,
    {
      label: `diff:${stage}${track.id}#${attempt}`,
      phase: "Verify",
      // One diff and one merge-base, and the answer is a substring test.
      model: "haiku",
      effort: "low",
      schema: DIFF_SCHEMA,
    }
  );
  // A dead agent is an undecided diff, which fails closed exactly as above.
  const files = Array.isArray(diff?.migrationFiles) ? diff.migrationFiles : [];
  const carries = diff ? diff.carriesMigration !== false : true;
  if (!carries) return null;
  const named = files.length
    ? files.join(", ")
    : `the diff could not be read (${diff?.detail || "no detail returned"}), so it is treated as carrying one`;
  return {
    files,
    named,
    line: `THIS DIFF CARRIES A MIGRATION (${named}): also run HR1–HR3 — migration dry-run against a scratch DB, rollback proof, and the exact DDL delta in the PR body. That trigger is the DIFF, not the label (\`ops/agent-os/dod.md\`, RULED 2026-08-13 #435), so it applies at ANY risk tier — \`risk:medium\` included. Report each one as its own entry in \`gates\` with \`id\` "HR1", "HR2" and "HR3", \`status\` "PASS" and the evidence you actually collected; a report that omits them is rejected mechanically, so an unrun proof cannot read as a clean pass.`,
  };
}

// The three proofs a migration diff buys, in the order dod.md states them.
const MIGRATION_PROOFS = [
  { id: "HR1", owes: "a migration dry-run against a scratch/shadow DB" },
  { id: "HR2", owes: "a rollback proof" },
  { id: "HR3", owes: "the exact DDL delta in the PR body" },
];

// ONE spelling of "is this `gates` entry the HR<n> proof?", shared by the
// assertion and the re-anchor splice. A verifier may report `id` as "HR1" or
// "HR1 — dry-run"; anything else is not this gate.
const isProofGate = (gate, id) =>
  new RegExp(`^\\s*${id}\\b`, "i").test(String(gate?.id || ""));

const anyProofGate = (gate) =>
  MIGRATION_PROOFS.some(({ id }) => isProofGate(gate, id));

/**
 * Replace the report's HR1–HR3 entries with the ones collected at the tip.
 *
 * The proofs are SHA-ANCHORED EVIDENCE — HR1 is a dry-run of the SQL as it
 * stands and HR3 IS the DDL delta the PR body quotes — so a fix round that
 * edited a migration leaves entries describing SQL the branch no longer
 * carries. Passing an empty `fresh` list DROPS them, which is the right answer
 * when the tip carries no migration at all: nothing is owed, so nothing may be
 * quoted.
 */
function withReanchoredProofs(gates, fresh) {
  const kept = (Array.isArray(gates) ? gates : []).filter(
    (g) => !anyProofGate(g)
  );
  const proofs = (Array.isArray(fresh) ? fresh : []).filter(anyProofGate);
  return [...kept, ...proofs];
}

/**
 * The HR1–HR3 assertion. The brief ASKS for the proofs; this is what makes
 * them owed — without it the whole product of `migrationProofsOwed()` is a
 * sentence, and a verifier that silently skipped the dry-run still returns a
 * clean PASS. Mirrors the HR4 tally below: every proof must clear, and a
 * missing one is missing evidence rather than an implicit pass.
 *
 * Returns null when the report carries all three, otherwise a FAIL report.
 */
function migrationProofsMissing(report, migration) {
  const gates = Array.isArray(report?.gates) ? report.gates : [];
  const owed = MIGRATION_PROOFS.map(({ id, owes }) => {
    const gate = gates.find((g) => isProofGate(g, id));
    return {
      id,
      owes,
      why: !gate
        ? "no gate with this id in the report"
        : gate.status !== "PASS"
          ? `reported ${gate.status}`
          : !String(gate.evidence || "").trim()
            ? "reported PASS with no evidence"
            : null,
    };
  });
  const failed = owed.filter((p) => p.why);
  if (!failed.length) return null;
  return {
    ...report,
    verdict: "FAIL",
    failingGate: "HR1-HR3/missing-proofs",
    // No `failingWorkstream`: the proofs are owed by the VERIFIER of the
    // assembled branch, so attributing them to one workstream would send the
    // re-run to an agent that never had the whole diff.
    fixInstructions: `This track's diff carries a migration (${migration.named}), so HR1–HR3 are owed and the report did not carry them:
${failed.map((p) => `  - ${p.id} (${p.owes}) — ${p.why}`).join("\n")}
Run each proof against the migration files above and report it as its own \`gates\` entry with \`id\` "${failed.map((p) => p.id).join('"/"')}", \`status\` "PASS" and the transcript as \`evidence\`. Do not restate the verdict without running them.`,
    summary: `${report?.summary || "verify"} — but HR1–HR3 were not proven for ${migration.named}.`,
  };
}

// Independent verifier (G6): a DIFFERENT agent runs the integration gates.
async function integrationVerify(remoteSha, hrLine) {
  return agent(
    `You are the code-reviewer and the INDEPENDENT verifier. Use the \`definition-of-done\` skill and \`ops/agent-os/dod.md\`. Validate branch ${branch} in worktree ${wt} for issue(s) ${track.issues.map((n) => `#${n}`).join(", ")}.
This track was built by ${wsSummaries.length} workstream(s), each of which already passed its OWN scoped gates (G0, a G2 subset, and G5 against its own declared files) in its own worktree. Those verdicts are inputs, not conclusions — your job is the whole assembled branch, which no scoped verifier has ever seen:

${wsSummaries.map((r) => `- **${r.id}** (issue(s) ${hashes(r.issues)}) — ${r.summary}`).join("\n")}

Run every INTEGRATION gate yourself — do not trust the implementers, and do not re-run the scoped ones:
- G1 \`pnpm typecheck && pnpm lint && pnpm build\` in ${wt} (hermetic, the way CI runs it)
- G2 \`pnpm test\` — the FULL suite, not a subset. Two workstreams that each passed their own tests can still break each other's, and this is the first moment that is visible. If the worktree has no \`.env.local\`, run \`scripts/worktree-env.sh ${wt}\` first and re-run. A missing env is not a test failure, and reporting it as one blames the track for the harness.
- G3 functional: use \`${track.lane === "backend" ? "validate-backend" : "validate-frontend"}\` and PROVE each acceptance criterion with an assertion + screenshot/transcript; console must be error-free; lighthouse a11y ≥ 90 for UI. Frontend validates against the branch's VERCEL PREVIEW (scripts/preview-url.sh --wait --bypass), never localhost:3000 — localhost serves main and would pass code this track never wrote. Backend prefers a tsx harness in the worktree.
  ${branch} has ALREADY been pushed for you and \`origin/${branch}\` is at \`${remoteSha}\`, which equals the worktree HEAD. Before you trust a preview, confirm the deployment you are driving was built from that sha (\`scripts/preview-url.sh\` resolves the latest deployment for the branch) — a preview one commit behind is how #307 spent two attempts proving things about code that had already been replaced. If they differ, FAIL on G3 and say which sha the preview was built from rather than validating it anyway.
- G4 conventions, and G5 across the WHOLE track (the union of every workstream's declared files, against \`origin/main\`).
Acceptance criteria to prove — all of them, across every workstream:
${criteria}
${hrLine || ""}
Default to FAIL when evidence is missing or unconvincing.

**If a failure belongs to one workstream, say which** in \`failingWorkstream\` — one of: ${wsIds.join(", ")}. That sends the fix to that workstream alone and spends only its attempt, instead of re-opening the whole track. Leave it empty when the failure is genuinely of the assembly — a contradiction between two workstreams, a build that only breaks once both are present — because attributing that to one of them sends the fix to an agent that cannot see the other half.

FINALLY — two channels for everything else you saw, and the split decides who acts:

- **warnings** — SPEC-QUESTIONS ONLY: answering it could change WHAT was built. A requirement that reads two ways, an AC that did not say, a product judgement, a behaviour that satisfies the letter of the AC while arguably missing its intent. Anything you would want the requirement's owner to rule on. A spec-question warning holds the track for a human. When genuinely torn about whether something is a spec question, it is one.
- **findings** — anything decidable from the codebase alone. It WILL BE FIXED IN THIS PASS by a fix agent and re-reviewed — do not file it, do not soften it, and do not put it in warnings. Map your review output onto \`severity\`: Critical → \`critical\`, structural Warnings → \`structural\`, Suggestions → \`suggestion\`. Critical and structural findings trigger fix rounds; suggestions never gate and never trigger a round. State each finding so an implementer can act on it directly: exact files and lines, the defect, and \`remedy\` — what "fixed" looks like.

Do not invent warnings or findings to seem thorough, and do not suppress one to get a clean merge. Empty lists are a real answer.

Return strictly the DoD report schema.`,
    {
      label: `verify:${track.id}#${attempt}`,
      phase: "Verify",
      agentType: "code-reviewer",
      schema: DOD_SCHEMA,
    }
  );
}

/**
 * The review-fix loop (#399): reviewer findings are fixed IN-PASS, never filed
 * as debt (RULED 2026-08-10). Runs only on a passing verdict with actionable
 * findings; gate/AC FAILs take the parent's attempt machinery. Runs BEFORE HR4
 * so every lens examines final code.
 *
 * TWIN: build-until-done.js carries the byte-identical function for the
 * scoped site — change one, change both; frd-workflows.test.mjs asserts the
 * two copies are text-identical. The sites differ only through `opts` — see
 * the parent's copy for the full doc.
 */
// TWIN:BEGIN review-fix-loop
const actionableFindings = (findings) =>
  (findings || []).filter(
    (f) => f?.severity === "critical" || f?.severity === "structural"
  );

async function runReviewFixLoop(holder, branch, wt, firstFindings, opts) {
  const journal = [];
  let current = firstFindings;
  for (let round = 1; round <= QUALITY_ROUNDS && current.length; round++) {
    log(
      `🔧 ${holder.id} quality round ${round}/${QUALITY_ROUNDS}: ${current.length} actionable finding(s)`
    );
    const fix = await agent(
      `You are fixing review findings on branch ${branch} in worktree ${wt} (issue(s) ${hashes(holder.issues)}). ${CONVENTIONS}

The ${opts.reviewerNoun} PASSED the gates but returned findings that are fixed IN THIS PASS — quality round ${round} of ${QUALITY_ROUNDS}. They are quoted below VERBATIM; address each one.

${findingsBlock(current)}

Work in ${wt} on ${branch}. Fix the findings and nothing else${opts.scopeLine}. Run \`pnpm typecheck\` and the tests covering the files you touch, and commit (conventional commits). Do NOT push, do NOT open a PR, do NOT edit labels or issues, and do NOT merge — the loop ${opts.shipVerb} and ships.

For EVERY finding above, fill \`perFinding\`: restate the finding and say exactly what you changed so it is addressed, with the command output proving it — or say plainly that you did not address it and why. A report whose \`perFinding\` answers nothing is refused without spending a re-review on it, exactly like an unanswered root cause. Return strictly the schema.`,
      {
        label: `fix:${holder.id}#r${round}`,
        phase: "Build",
        agentType: opts.fixAgentType,
        schema: FIX_SCHEMA,
      }
    );
    const answered = (fix?.perFinding || []).filter((p) =>
      String(p?.addressed || "").trim()
    );
    journal.push({
      round,
      fix: fix
        ? {
            summary: fix.summary,
            filesChanged: fix.filesChanged || [],
            perFinding: fix.perFinding || [],
          }
        : null,
    });
    if (!fix || !answered.length) {
      log(
        `↩️  ${holder.id} quality round ${round}: the fix answered no finding — round counts, re-review skipped, findings stand`
      );
      continue;
    }

    if (fix.committed && opts.afterFixCommit) {
      const push = await opts.afterFixCommit(round);
      if (!push.ok)
        return { pushFail: push.failReport, journal, leftovers: current };
    }

    const rereview = await agent(
      `You are the code-reviewer, re-reviewing quality round ${round}/${QUALITY_ROUNDS} on branch ${branch} in worktree ${wt} (issue(s) ${hashes(holder.issues)}). A fix agent just addressed the findings below. Re-verify ONLY those findings and the new diff — do not re-run the whole ${opts.dodNoun}.

The findings that were to be fixed, verbatim:

${findingsBlock(current)}

The fix agent's report:
${JSON.stringify({ summary: fix.summary, filesChanged: fix.filesChanged, perFinding: fix.perFinding })}

Run \`pnpm typecheck\` in ${wt} and the tests covering the changed files yourself — a fix that breaks the build or the tests is a FAIL, not a smaller finding, and a FAIL from you re-enters the attempt machinery as a real gate failure. Otherwise: re-examine each finding against the code as it now stands. A finding that is genuinely fixed disappears; one that is not comes back in \`findings\` at the same severity; a new problem the fix INTRODUCED is a finding too. Return strictly the schema, verdict PASS or PASS_WITH_WARNINGS unless a gate actually broke.`,
      {
        label: `re-review:${holder.id}#r${round}`,
        phase: "Verify",
        agentType: "code-reviewer",
        schema: opts.reviewSchema,
      }
    );
    journal[journal.length - 1].reReview = rereview
      ? { verdict: rereview.verdict, findings: rereview.findings || [] }
      : null;
    if (!rereview) {
      log(
        `↩️  ${holder.id} quality round ${round}: the re-reviewer died — missing evidence is not a fix, findings stand`
      );
      continue;
    }
    if (rereview.verdict === "FAIL")
      return { gateFail: rereview, journal, leftovers: current };
    current = actionableFindings(rereview.findings);
  }
  return { journal, leftovers: current };
}
// TWIN:END review-fix-loop

// ---------------------------------------------------------------------------
// The child's return shapes. `"verify-failed"` covers: push/sha mismatch,
// a verifier FAIL, a re-review FAIL, HR4 dissent, CI red, and a dead verifier
// (report null — the parent still counts the attempt).
// ---------------------------------------------------------------------------
let finalSha = null;
const failResult = (report) => ({
  outcome: "verify-failed",
  report,
  pr: null,
  merge: null,
  cleanup: null,
  labelState: null,
  warnings: report?.warnings || [],
  unresolvedFindings: [],
  finalSha,
});

// ORDERED: push+assert, THEN verify. See pushAndAssert.
const firstPush = await pushAndAssert();
if (!firstPush.ok) return failResult(firstPush.failReport);
finalSha = firstPush.remoteSha;

log(
  `🧪 ${track.id} — integration verify attempt ${attempt} (origin/${branch} @ ${finalSha.slice(0, 7)})`
);

// Keyed on the DIFF, not on `track.risk` — see DIFF_SCHEMA's header.
const migration = await migrationProofsOwed();
if (migration)
  log(
    `🧱 ${track.id} — the diff carries a migration (${migration.named}); HR1–HR3 apply`
  );

// What the SHIPPING sha owes, which is not always what the first verify owed.
// The G3 re-anchor below re-reads the trigger at the tip — a fix round can add
// the branch's first migration, or remove its last — and everything downstream
// of that point (the PR brief, the HR3 body assertion) must key on the tip's
// answer, never on this one. Reassigned there, and only there.
let effectiveMigration = migration;

const verify = await integrationVerify(finalSha, migration?.line || "");
if (!verify) return failResult(null);

if (!(verify.verdict === "PASS" || verify.verdict === "PASS_WITH_WARNINGS"))
  return failResult(verify);

// The proofs are CHECKED, not merely requested. A verifier that never ran the
// dry-run returns a report with no HR1–HR3 entries, and nothing downstream —
// not the merge gate, which holds only on `risk:high` — would see it.
if (migration) {
  const missing = migrationProofsMissing(verify, migration);
  if (missing) {
    log(
      `❌ ${track.id} attempt ${attempt}: the diff carries a migration but HR1–HR3 were not proven — ${missing.summary}`
    );
    return failResult(missing);
  }
}

const unresolved = [...carriedFindings];
// Set by the afterFixCommit hook when a fix round actually landed (and
// re-published) commits — the trigger for the G3 re-anchor below.
let fixCommitsLanded = false;
const loop = await runReviewFixLoop(
  track,
  branch,
  wt,
  actionableFindings(verify.findings),
  {
    // The integration site: the track's lane fixes, the re-review runs the
    // full DoD schema, and every committed fix is re-published + sha-asserted
    // BEFORE the re-review — the preview-sha discipline extends to fix
    // commits, so the PR and preview always hold the sha under report.
    fixAgentType: track.lane === "backend" ? "backend" : "frontend",
    reviewSchema: DOD_SCHEMA,
    reviewerNoun: "independent reviewer",
    scopeLine: "",
    shipVerb: "publishes",
    dodNoun: "DoD",
    afterFixCommit: async (round) => {
      const push = await pushAndAssert(round);
      if (push.ok) {
        finalSha = push.remoteSha;
        fixCommitsLanded = true;
      }
      return push;
    },
  }
);
verify.fixRounds = loop.journal;
if (loop.pushFail)
  return failResult({ ...loop.pushFail, fixRounds: loop.journal });
if (loop.gateFail)
  return failResult({ ...loop.gateFail, fixRounds: loop.journal });
unresolved.push(
  ...loop.leftovers.map((f) => ({ ...f, rounds: f.rounds || loop.journal }))
);

// ---------------------------------------------------------------------------
// G3 re-anchor: no sha ships whose functional gate never ran at that sha.
//
// A quality-round fix that COMMITTED moved the branch tip, so the G3 evidence
// in `verify` was produced against the pre-fix sha. CI re-anchors G1/G2 at the
// final sha, but nothing else re-runs G3 there — and verify-follows-last-push
// is an ORDERING guarantee (ruling designNote 5), not a presence check. So
// when any fix round landed commits, G3 re-runs against the re-pushed
// finalSha BEFORE HR4/PR/merge. A FAIL re-enters the parent's attempt
// machinery like any gate failure; the passing entry rides into the PR body
// via `verify.g3Reanchor`, pinned to the sha that will merge.
//
// HR1–HR3 RIDE ALONG, because they are the same class of evidence: the trigger
// is re-read from the diff at the tip (a fix round can edit a migration, or add
// the branch's first one), the same assertion runs on the re-anchored report,
// and the proofs the PR body quotes are replaced with the ones collected here.
// The re-anchor is what makes those two failures impossible: proofs about SQL
// the branch no longer carries, and DDL that was never asked for a proof at all.
// ---------------------------------------------------------------------------
if (fixCommitsLanded) {
  log(
    `🧪 ${track.id} — fix rounds moved the tip; re-running G3 at ${finalSha.slice(0, 7)} before anything ships it`
  );
  const migrationAtTip = await migrationProofsOwed("g3:");
  // The tip's answer REPLACES the first verify's, including when it is `null`.
  // Everything after this point — the PR brief and the HR3 body assertion —
  // keys on the re-anchored state, so a fix round that dropped the last
  // migration cannot leave a DDL block owed, and one that added the first
  // cannot ship its DDL unasked-for.
  effectiveMigration = migrationAtTip;
  if (migrationAtTip)
    log(
      `🧱 ${track.id} — the diff at ${finalSha.slice(0, 7)} carries a migration (${migrationAtTip.named}); HR1–HR3 are re-anchored too`
    );
  const g3 = await agent(
    `You are the INDEPENDENT verifier, re-running ONLY the functional gate (G3) for branch ${branch} in worktree ${wt}, issue(s) ${hashes(track.issues)}. Quality-round fixes committed new code AFTER the first integration verify, so the G3 evidence already collected belongs to an older sha — nothing may ship a sha whose functional gate never ran at that sha, and your job is to re-anchor it.

\`origin/${branch}\` is at \`${finalSha}\`, which equals the worktree HEAD. Use \`${track.lane === "backend" ? "validate-backend" : "validate-frontend"}\` and PROVE each acceptance criterion with an assertion + screenshot/transcript; console must be error-free; lighthouse a11y ≥ 90 for UI. Frontend validates against the branch's VERCEL PREVIEW (scripts/preview-url.sh --wait --bypass), never localhost:3000. Before you trust a preview, confirm the deployment you drive was built from \`${finalSha}\` — if it was built from anything else, FAIL on G3 and say which sha it was built from rather than validating it anyway.

Acceptance criteria to prove — all of them:
${criteria}

Do NOT re-run G1/G2/G4/G5 — CI re-anchors the build and the full suite at this sha, and the diff-level review already ran; only the sha-anchored evidence went stale.
${migrationAtTip?.line || ""}
Default to FAIL when evidence is missing or unconvincing. If a failure belongs to one workstream, name it in \`failingWorkstream\` — one of: ${wsIds.join(", ")}. Return strictly the DoD report schema.`,
    {
      label: `verify:g3:${track.id}#${attempt}`,
      phase: "Verify",
      agentType: "code-reviewer",
      schema: DOD_SCHEMA,
    }
  );
  if (!g3) return failResult(null);
  if (!(g3.verdict === "PASS" || g3.verdict === "PASS_WITH_WARNINGS"))
    return failResult({ ...g3, fixRounds: loop.journal });
  if (migrationAtTip) {
    const missing = migrationProofsMissing(g3, migrationAtTip);
    if (missing) {
      log(
        `❌ ${track.id} attempt ${attempt}: the diff at the tip carries a migration but HR1–HR3 were not re-proven — ${missing.summary}`
      );
      return failResult({ ...missing, fixRounds: loop.journal });
    }
  }
  // The PR body quotes `verify.gates`, so HR3's DDL delta must be the one
  // collected at `finalSha` — not the entry the first verify produced for SQL a
  // fix round may have rewritten, and never one left standing for a migration
  // the tip no longer carries.
  verify.gates = withReanchoredProofs(
    verify.gates,
    migrationAtTip ? g3.gates : []
  );
  // Spec-questions from the re-run hold exactly like first-pass ones, and any
  // actionable finding it raises cannot get fix rounds (that would loop) — it
  // joins `unresolved` and holds the merge for a ruling instead.
  if ((g3.warnings || []).length)
    verify.warnings = [...(verify.warnings || []), ...g3.warnings];
  unresolved.push(...actionableFindings(g3.findings));
  verify.g3Reanchor = {
    sha: finalSha,
    verdict: g3.verdict,
    gates: g3.gates,
    acceptanceCriteria: g3.acceptanceCriteria,
  };
}

// High-risk → diverse-lens sign-off (HR4). Every lens must clear. Runs AFTER
// the fix loop settles, so every lens examines final code.
if (track.risk === "high") {
  const votes = await parallel(
    HIGH_RISK_LENSES.map(
      (lens) => () =>
        agent(
          `You are an independent adversarial reviewer of HIGH-RISK branch ${branch} (worktree ${wt}), issue(s) ${track.issues.map((n) => `#${n}`).join(", ")}. ${CONVENTIONS}

You review through ONE lens only: **${lens.key}**. Stay in it — other reviewers cover the other axes, and anything you wave through on your axis ships unexamined.

${lens.brief}

The first verifier reported PASS. Do not assume it was right; its report is below so you can check it, not so you can agree with it.
${JSON.stringify({ gates: verify.gates, acceptanceCriteria: verify.acceptanceCriteria, summary: verify.summary })}

Acceptance criteria in scope:
${criteria}

Default to FAIL when evidence is missing or unconvincing. Set lens to "${lens.key}". Return strictly the schema.`,
          {
            label: `lens:${lens.key}:${track.id}#${attempt}`,
            // Explicit — nested inside parallel(), so don't race the global phase().
            phase: "Verify",
            agentType: "code-reviewer",
            schema: LENS_SCHEMA,
          }
        ).then((v) => ({ lens: lens.key, report: v }))
    )
  );

  // A dead lens is missing evidence, not a pass. Fail closed.
  const tally = HIGH_RISK_LENSES.map((lens, i) => {
    const r = votes[i];
    return {
      lens: lens.key,
      report: r?.report ?? null,
      cleared: r?.report?.verdict === "PASS",
      died: !r?.report,
    };
  });
  const dissent = tally.filter((t) => !t.cleared);
  log(
    `🔎 ${track.id} HR4 lenses: ${tally.map((t) => `${t.lens}=${t.died ? "DIED" : t.report.verdict}`).join(" ")}`
  );

  if (dissent.length) {
    const first = dissent.find((d) => !d.died) || dissent[0];
    const report = {
      ...verify,
      verdict: "FAIL",
      failingGate: `HR4/${first.lens}`,
      fixInstructions: dissent
        .map((d) =>
          d.died
            ? `[${d.lens}] lens agent died — no evidence on this axis; it must be re-reviewed.`
            : `[${d.lens}] ${d.report.fixInstructions || d.report.summary}\n${(d.report.findings || []).map((f) => `  - ${f}`).join("\n")}`
        )
        .join("\n\n"),
      summary: `HR4 rejected by ${dissent.map((d) => d.lens).join(", ")}.`,
      lenses: tally.map(({ lens, cleared, died, report: rep }) => ({
        lens,
        cleared,
        died,
        findings: rep?.findings || [],
      })),
    };
    log(
      `❌ ${track.id} attempt ${attempt}: HR4 rejected by ${dissent.map((d) => d.lens).join(", ")} — retrying`
    );
    return failResult(report);
  }

  // Cleared by every lens — carry their findings into the PR body so the
  // human reviewer sees what each axis actually looked at.
  verify.lensFindings = tally.map(({ lens, report: rep }) => ({
    lens,
    summary: rep.summary,
    findings: rep.findings || [],
  }));
}

// PASS (per the verifier) → push, open the PR, and WAIT FOR THE REAL CHECK.
log(`✅ ${track.id} passed DoD on attempt ${attempt} — opening PR`);
const pr = await agent(
  `You are the release agent. Use the \`open-pr\` skill. Branch ${branch} (worktree ${wt}) PASSED the Definition of Done. The verifier's evidence report:
${JSON.stringify(verify)}
Push the branch. If a PR for this branch already EXISTS (an earlier attempt opened one), do NOT open a second — the push updates it. Otherwise open a PR against main with --label agent:in-review${track.risk === "high" ? " and --label risk:high" : ""}. Build the PR body from the evidence bundle (the DoD table + AC checklist + screenshots/lighthouse/migration). Include "Closes ${track.issues.map((n) => `#${n}`).join(", Closes ")}". Then flip each issue label agent:in-progress → agent:in-review — and do not report the flip you did not verify: the loop re-reads every one of those labels after you and will error this track if the board does not agree with you.

The body MUST include the skill's **## 👀 Manual QA** section: the preview URL and exact path(s), a numbered happy-path walkthrough, and — the part that matters — **what the automation could NOT check**. Do NOT restate the acceptance criteria there; G3 already proved those, and a reviewer re-reading them learns nothing. Name the judgement calls instead (does it look right, read right, feel fast) and any edge case no AC asserted. Human attention is the scarcest resource in this system: spend it on what a gate cannot decide. If this track genuinely has nothing to eyeball, say so in one line.
${
  effectiveMigration
    ? `
THIS TRACK'S DIFF CARRIES A MIGRATION (${effectiveMigration.named}), so the body owes HR3 — "the exact DDL delta is shown to the reviewer" (\`ops/agent-os/dod.md\`, "Migration proofs and high-risk units"). That trigger is the DIFF and not the label, so it applies at ANY risk tier, and this body is where HR3 lands or does not: a migration is deliberately not an auto-merge hold, so a body without the delta merges DDL nobody was ever shown. Put the \`open-pr\` skill's \`Schema diff\` block in the body with the real SQL inside it — the delta the verifier's HR3 gate collected, never a placeholder.

THEN READ THE BODY BACK AND REPORT WHAT IT ACTUALLY CONTAINS, not what you intended to write: run \`gh pr view <number> --json body\`, set \`bodyHasSchemaDiff\` to whether that output carries the \`Schema diff\` block with non-empty SQL inside it, and copy that SQL VERBATIM into \`schemaDiffExcerpt\`. The loop asserts this answer and FAILS the attempt when it is false or absent, so an honest "false" costs one retry while a guess ships unreviewed DDL.
`
    : ""
}
THEN WAIT FOR CI AND REPORT WHAT IT SAID, NOT WHAT YOU BELIEVE:
\`gh pr checks <number> --watch --fail-fast\`, then read the conclusion of the "Format, Lint, Typecheck, Build" check. Put it in checkConclusion verbatim (success | failure | timed_out | none). If it is not success, pull the failing step and its error with \`gh run view <run-id> --log-failed\` and put that in checkSummary. Do not summarise it as "probably unrelated" and do not claim success you did not observe. Return strictly the schema.`,
  // Pinned to opus, the executor tier. This node transcribes the CI
  // conclusion, and the anchoring story rests on it reporting what GitHub
  // said instead of summarising it into "probably unrelated" — so it must
  // not drop to the quick-command tier. It also must not inherit the
  // session model: shipping is executor work, not frontier work.
  {
    label: `pr:${track.id}#${attempt}`,
    phase: "Ship",
    model: "opus",
    schema: PR_SCHEMA,
  }
);

// The anchor decides, not the verifier. A green DoD with a red check is a
// failed attempt — the PR stays open and the next attempt pushes a fix to
// it. This is the cycle that stops "done" from meaning "an agent said so".
if (pr?.opened && pr.checkConclusion !== "success") {
  log(
    `🔴 ${track.id} attempt ${attempt}: DoD passed but CI said "${pr.checkConclusion}" — retrying against the real failure`
  );
  return {
    ...failResult({
      ...verify,
      verdict: "FAIL",
      failingGate: "CI",
      notes: `CI reported "${pr.checkConclusion}" on ${pr.url}. ${pr.checkSummary || "no summary returned"}`,
    }),
    pr,
  };
}

// ---------------------------------------------------------------------------
// HR3 is asserted WHERE IT LANDS — the PR body.
//
// `migrationProofsMissing` above runs against a report produced before a PR
// exists, so all it can ever prove is that the verifier COMPUTED a DDL delta.
// HR3 is not "a delta was computed", it is "the exact DDL delta is shown to the
// reviewer" (`ops/agent-os/dod.md`), and the only writer of a PR body is the
// release agent that just ran. Nothing else downstream closes that loop: the
// auto-merge gate holds on `risk:high`, `hold`, spec-questions and unresolved
// findings, and a migration is deliberately none of those — so an unattended
// `risk:medium` migration track auto-merges on the strength of this body alone.
//
// ORDERED: this runs after the PR call and BEFORE settleLabels and the merge
// gate, so a body with no delta fails the attempt instead of landing. Review it
// as an ORDERED block, not a presence check.
//
// FAILS CLOSED, exactly like `migrationProofsOwed`: a missing answer is not a
// yes. `!== true` catches the release agent that omitted the field as well as
// the one that reported `false`.
if (effectiveMigration && pr?.opened && pr.bodyHasSchemaDiff !== true) {
  log(
    `❌ ${track.id} attempt ${attempt}: the diff carries a migration (${effectiveMigration.named}) but ${pr.url || "the PR"} has no Schema diff block in its body — not shipping DDL nobody was shown`
  );
  return {
    ...failResult({
      ...verify,
      verdict: "FAIL",
      failingGate: "HR3/pr-body",
      // No `failingWorkstream`: the body is written by the release agent for
      // the whole assembled branch, so this is never one workstream's failure.
      fixInstructions: `This track's diff carries a migration (${effectiveMigration.named}), so HR3 owes the exact DDL delta in the PR BODY, and reading ${pr.url || "the PR"} back reported \`bodyHasSchemaDiff: ${pr.bodyHasSchemaDiff === false ? "false" : "(not answered)"}\`${pr.schemaDiffExcerpt ? ` with excerpt: ${pr.schemaDiffExcerpt}` : ""}. Update the PR body to include the \`open-pr\` skill's \`Schema diff\` block containing the real DDL delta for those files — not a placeholder — then re-read the body with \`gh pr view <number> --json body\` and report what it printed. The verifier's HR3 gate evidence holds the delta to quote: ${
        (verify.gates || [])
          .filter((g) => isProofGate(g, "HR3"))
          .map((g) => g.evidence)
          .join("\n") || "(no HR3 evidence in the report — collect it again)"
      }`,
      notes: `HR3 was proven on the report but not on the body of ${pr.url || "the PR"}.`,
      summary: `${verify.summary || "verify"} — but the PR body did not show the reviewer the DDL delta for ${effectiveMigration.named}.`,
    }),
    pr,
  };
}

const shipped = pr?.opened && pr.checkConclusion === "success";

// ---------------------------------------------------------------------------
// The DoD passed and the PR step still produced no PR.
//
// This is NOT `agent:blocked`. Blocked means the work did not reach the
// Definition of Done, and it sends a human to read a failing gate and fix
// code. Here the gates all passed and the commit is sitting on its branch —
// only the push/PR call failed (auth, a network blip, a rejected push, a
// dead `gh`). The human action is to retry the delivery, and telling them
// to go debug a build that already passed wastes the scarcest resource in
// this system. So the outcome gets its own label (`labels.md`) and its own
// bucket in the report.
// ---------------------------------------------------------------------------
if (!shipped) {
  const why = pr?.reason || "no reason given";
  log(`📦 ${track.id} passed the DoD but delivery failed: ${why}`);
  await agent(
    `A build loop for issue(s) ${track.issues.map((n) => `#${n}`).join(", ")} PASSED the Definition of Done, but the delivery step failed to open a PR.
Delivery failure: ${why}.
The evidence bundle the DoD produced: ${JSON.stringify({ verdict: verify.verdict, summary: verify.summary, gates: verify.gates })}.
Branch \`${branch}\` (worktree ${wt}) holds the committed work.
For EACH issue, post a comment (\`gh issue comment <n>\`) that makes these three things unmissable:
  1. The DoD PASSED — quote the evidence above. Nothing is known to be wrong with the code.
  2. The DELIVERY step failed, and exactly why: ${why}.
  3. What the human should do: retry the delivery (push \`${branch}\` and open the PR). Do NOT re-review or re-build the code; it already passed its gates.
  4. A **Surviving worktrees** section, listing each of these verbatim — path, branch, and what it holds. They were left in place deliberately: they are where the passing work lives.
${treeLines(survivingTrees)}
Do NOT remove any worktree or branch yourself. Do NOT open a PR yourself and do NOT edit labels — the loop writes and verifies the \`agent:delivery-failed\` label itself in the next step. Return strictly the schema.`,
    {
      label: `delivery-failed:${track.id}`,
      phase: "Ship",
      // Mechanical: it transcribes a verdict and a failure string it was
      // handed. It produces no judgement of its own.
      model: "sonnet",
      effort: "low",
      schema: BLOCK_SCHEMA,
    }
  );

  const labelState = await settleLabels(track, "agent:delivery-failed");
  if (!labelState.settled)
    log(
      `🚨 ${track.id} failed to open a PR AND its agent:delivery-failed label did not settle — issue(s) ${labelState.missing.join(", ")} need a manual fix.`
    );
  return {
    outcome: "delivery-failed",
    report: verify,
    pr,
    merge: null,
    cleanup: null,
    labelState,
    warnings: verify.warnings || [],
    unresolvedFindings: unresolved,
    finalSha,
  };
}

// ---------------------------------------------------------------------------
// Settle the label BEFORE anything downstream trusts "shipped".
//
// ORDERING guarantee: settle-labels-before-auto-merge. It runs before the
// merge gate on purpose: merging on the strength of a board state nobody
// verified is how a blocked PR got promoted into the review queue in the
// first place. Review this as an ORDERED block, not a presence check.
// ---------------------------------------------------------------------------
const labelState = await settleLabels(track, "agent:in-review", { pr });
if (!labelState.settled) {
  log(
    `🚨 ${track.id} opened ${pr.url} with a green check, but the board does NOT say so after ${labelState.attempts} attempt(s): ` +
      `issue(s) ${labelState.missing.join(", ") || "(none reported)"} do not read agent:in-review. ` +
      `Reporting this track as ERRORED rather than shipped — a PR whose issue still reads agent:in-progress is indistinguishable from a failure.`
  );
  return {
    outcome: "errored",
    report: verify,
    pr,
    merge: null,
    cleanup: null,
    labelState,
    warnings: verify.warnings || [],
    unresolvedFindings: unresolved,
    finalSha,
  };
}

// ---------------------------------------------------------------------------
// Auto-merge — the review queue, not the budget, is what caps this factory.
//
// Five things must all hold, and each is a different kind of guarantee:
//   1. the DoD passed AND the real CI check is green (proven above),
//   2. the track is not risk:high — auth/permissions, multi-tenant isolation
//      and payments are where a bad merge is unrecoverable, so those keep a
//      human regardless. A migration is deliberately NOT on that list: what
//      guards a DDL merge is HR1–HR3, asserted TWICE above — on the verify
//      report (`migrationProofsMissing`) and, for HR3, on the PR body read
//      back from GitHub (`failingGate: "HR3/pr-body"`) — not a hold here.
//      Both are load-bearing for this list to stay four entries long: the
//      body is the only place a reviewer of an auto-merged migration track
//      ever sees the DDL,
//   3. the track is not `hold` — the standing policy is that a change to
//      the factory itself (this loop, the delivery-OS skills, ops/agent-os)
//      keeps a human, because the thing being changed is the thing that
//      would have caught the mistake,
//   4. no warning is a spec-question — see DOD_SCHEMA.warnings,
//   5. no review finding survived the quality rounds unresolved — an
//      unresolved finding is a defect nobody ruled on, and merging it would
//      be merge-with-debt by another name.
// ---------------------------------------------------------------------------
let merge = null;
let cleanup = null;

// The unresolved-findings DECISION menu. Posted on the PR WHEREVER findings
// survived the quality rounds — on the dispatch path it rides the hold
// comment; on a direct /deliver run (autoMerge=false) it is posted on its own
// below, because otherwise the findings surface only in the workflow return
// payload and the human reviews the PR without ever seeing them.
const findingsMenu = (list) =>
  list.length
    ? `Unresolved review findings — each survived ${QUALITY_ROUNDS} quality round(s). Present EACH as a DECISION with this menu, never as a defect dump:
  (a) merge as-is — rule the finding accepted;
  (b) direct a named fix — the branch and worktree survive exactly so it can be applied;
  (c) take it manually.

For each one, quote the finding VERBATIM (severity and all), then what the fix rounds actually did:
${list
  .map(
    (
      f,
      i
    ) => `${i + 1}. [${f.severity}]${f.workstream ? ` (from ${f.workstream})` : ""} ${f.summary}
   The finding, verbatim: ${f.detail || f.summary}
   What "fixed" looks like: ${f.remedy || "(not stated)"}
   What the fix rounds did: ${
     (f.rounds || [])
       .map((r) =>
         (r.fix?.perFinding || [])
           .map((p) => p.addressed)
           .filter((s) => String(s || "").trim())
           .join("; ")
       )
       .filter(Boolean)
       .join(" | ") || "no round produced an answer for it"
   }`
  )
  .join("\n")}`
    : "";

if (AUTO_MERGE) {
  const warnings = verify.warnings || [];
  const specQuestions = warnings.filter((w) => w.kind === "spec-question");
  const holds = [];
  if (track.risk === "high") holds.push("risk:high — never auto-merges");
  if (track.hold)
    holds.push(
      "hold — declared never-auto-merge (factory policy or issue directive)"
    );
  if (specQuestions.length)
    holds.push(
      `${specQuestions.length} spec-question warning(s): ${specQuestions.map((w) => w.summary).join(" | ")}`
    );
  if (unresolved.length)
    holds.push(
      `${unresolved.length} unresolved review finding(s) after ${QUALITY_ROUNDS} quality rounds`
    );

  if (holds.length) {
    log(`⏸️  ${track.id} held for review — ${holds.join("; ")}`);
    await agent(
      `PR ${pr.url} passed the DoD but is deliberately NOT auto-merged. Comment on it with \`gh pr comment\` explaining exactly why. Do NOT touch labels — the loop has already written and verified \`agent:in-review\` on this PR and its issue(s).

Reason(s) it is held:
${holds.map((h) => `- ${h}`).join("\n")}

${specQuestions.length ? `The decisions the human must make:\n${specQuestions.map((w) => `- **${w.summary}** — ${w.detail || "(no detail given)"}`).join("\n")}\n\nPresent each as a decision with its options, not as a defect report. The reviewer's job here is to RULE, not to hunt.\n\nIf a decision is a DIRECTION question — two or more plausible directions where trying them beats reading about them — invoke the prototype skill (.claude/skills/prototype/SKILL.md) BEFORE commenting: build 3-4 candidates into this PR's branch (UI question → variants behind the prototype switcher, then ./scripts/preview-url.sh --wait --bypass for the link; behavior question → a throwaway CLI under prototypes/), verify each one works, and write the DECISION comment in the skill's format so the reviewer can operate the options instead of imagining them.` : ""}
${
  unresolved.length
    ? `${findingsMenu(unresolved)}
The prototype-skill branch above is for direction-shaped spec-questions only — findings get the (a)/(b)/(c) menu, not prototypes.`
    : ""
}
End the comment with a **Surviving worktrees** section, listing each of these verbatim — path, branch, and what it holds. A held track keeps its trees on purpose: whoever rules on this may want to re-run or extend them, and PR #333 was held with nobody told what was still on disk.
${treeLines(survivingTrees)}
Say plainly that these are the reviewer's to remove (\`git worktree remove <path>\` once the PR merges), and do NOT remove them yourself.

Return strictly {"merged": false, "state": "refused", "detail": "<one line>"}.`,
      {
        label: `hold:${track.id}`,
        phase: "Ship",
        // Opus, not the session model: building prototypes and writing a
        // DECISION comment is executor work. Not "low" effort either — a
        // direction-shaped spec-question means this agent builds live
        // prototypes before it comments, not just a comment.
        model: "opus",
        effort: "medium",
        schema: MERGE_SCHEMA,
      }
    );
  } else {
    log(`🟢 ${track.id} clean pass — auto-merging`);
    merge = await agent(
      `Auto-merge PR ${pr.url} (issue(s) ${track.issues.map((n) => `#${n}`).join(", ")}). It passed the full DoD and the required check is green, with no spec-question warnings and no unresolved review findings.

1. Merge: \`gh pr merge <number> --squash --delete-branch --auto\`.
   \`--auto\` is deliberate: the main ruleset requires branches to be up to date, so if this PR is behind main GitHub will re-run the checks and merge only when they pass green against what it actually lands on. If the merge is refused because the branch is behind and auto-merge is unavailable, run \`gh pr update-branch\` first and then retry with \`--auto\`.
2. Report what GitHub ACTUALLY did — \`merged\` if it merged now, \`queued-for-auto-merge\` if it is waiting on checks, \`failed\` if it refused. Do NOT report success you did not observe; re-read with \`gh pr view <number> --json state,mergedAt\` before answering.

Return strictly the schema.`,
      {
        // Opus: this one mutates main and transcribes GitHub's answer, so
        // it stays at the executor tier — same reasoning as the PR node.
        label: `merge:${track.id}`,
        phase: "Ship",
        model: "opus",
        schema: MERGE_SCHEMA,
      }
    );

    // ---------------------------------------------------------------
    // Merged and done → the track owns its own leftovers.
    //
    // Only on `merged`. `queued-for-auto-merge` means GitHub is still
    // waiting on checks, and deleting the worktree under a branch that
    // has not landed is how the work disappears. The held and blocked
    // paths never reach here: they hand their trees over in the exit
    // comment instead, because those trees ARE the work.
    // ---------------------------------------------------------------
    if (merge?.state === "merged") {
      cleanup = await agent(
        `PR ${pr.url} for issue(s) ${hashes(track.issues)} is MERGED into main. Its build trees are now dead weight — remove them.

For each of these, in order:
${treeLines(survivingTrees)}

  1. \`git worktree remove <path> --force\` (the tree is disposable; the work is on main).
  2. \`git branch -D <branch>\` — the local branch only. Never touch \`main\`, never touch a remote branch, and never touch a path that is not in the list above: other tracks are building in sibling worktrees right now.
  3. \`git worktree prune\`.

Then run \`git worktree list\` and report what it PRINTED: every path from the list above that is gone belongs in \`removed\`, and anything still there belongs in \`remaining\` with the reason (an uncommitted change you did not expect is a reason to leave it and say so, not to force harder). Return strictly the schema.`,
        {
          label: `cleanup:${track.id}`,
          phase: "Ship",
          // Mechanical git, over an explicit list, verified by a listing.
          model: "haiku",
          effort: "low",
          schema: CLEANUP_SCHEMA,
        }
      );
      log(
        `🧹 ${track.id} merged — removed ${cleanup?.removed?.length ?? 0} worktree/branch entr(ies)` +
          (cleanup?.remaining?.length
            ? `; ${cleanup.remaining.length} left behind: ${cleanup.remaining.join("; ")}`
            : "")
      );
    }
  }
} else if (unresolved.length) {
  // autoMerge=false — a direct /deliver run. Nothing merges here, but the
  // ruling's exhaust path is "HOLD with a DECISION comment": the reviewer on
  // this path reads the PR, not the workflow return payload, so findings that
  // survived the quality rounds (including carriedFindings from the scoped
  // sites, which the PR body's `verify` object never contains) must still
  // arrive on the PR as the same (a)/(b)/(c) menu.
  log(
    `📋 ${track.id}: ${unresolved.length} unresolved review finding(s) — posting the DECISION menu on ${pr.url}`
  );
  await agent(
    `PR ${pr.url} passed the DoD, but review findings survived the quality rounds unresolved. This run does not auto-merge, so a human will review the PR directly — put the findings in front of them with \`gh pr comment\`. Do NOT touch labels — the loop has already written and verified \`agent:in-review\` on this PR and its issue(s).

${findingsMenu(unresolved)}

End the comment with a **Surviving worktrees** section, listing each of these verbatim — path, branch, and what it holds. A track carrying open decisions keeps its trees on purpose: whoever rules on this may want to re-run or extend them.
${treeLines(survivingTrees)}
Say plainly that these are the reviewer's to remove (\`git worktree remove <path>\` once the PR merges), and do NOT remove them yourself.

Return strictly {"merged": false, "state": "refused", "detail": "<one line>"}.`,
    {
      label: `findings:${track.id}`,
      phase: "Ship",
      // Opus, same reasoning as the hold comment: writing a DECISION a human
      // will rule from is executor work, not quick-command work.
      model: "opus",
      effort: "medium",
      schema: MERGE_SCHEMA,
    }
  );
}

return {
  outcome: "shipped",
  report: verify,
  pr,
  merge,
  cleanup,
  labelState,
  warnings: verify.warnings || [],
  unresolvedFindings: unresolved,
  finalSha,
};
