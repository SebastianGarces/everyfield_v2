export const meta = {
  name: "build-until-done",
  description:
    "The loop. Per file-disjoint track: implement → validate against the Definition of Done (independent verifier + MCP) → feed failures back and retry → on PASS open a PR with the evidence bundle. On exhaustion (max attempts / token reserve) label the issue agent:blocked and alert — never a silent stop, never a PR that isn't proven done.",
  whenToUse:
    "After spec-intake + token-preflight, to actually build a wave of tracks autonomously to PR. Pass args = the wave's units array (each: {id,title,lane,files,summary,acceptanceCriteria,issue,risk}), optionally {units, base, maxAttempts}.",
  phases: [
    {
      title: "Build",
      detail: "implementer codes the track in an isolated worktree",
    },
    {
      title: "Verify",
      detail:
        "independent code-reviewer runs the DoD gates incl. MCP G3; high-risk adds three diverse lenses (correctness / security / reproducibility), every one of which must clear",
    },
    {
      title: "Ship",
      detail:
        "open-pr — gated on a PASS verdict, with the evidence bundle — then write the outcome label and READ IT BACK; an unconfirmed label errors the track instead of shipping it",
      model: "opus",
    },
  ],
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const parsed = typeof args === "string" ? JSON.parse(args) : args;
const units = Array.isArray(parsed) ? parsed : parsed?.units;
if (!Array.isArray(units) || units.length === 0)
  throw new Error(
    "Pass the wave's units array as args, e.g. [{id,title,lane,files,summary,acceptanceCriteria,issue,risk}, ...]"
  );
const MAX_ATTEMPTS = parsed?.maxAttempts || 3;
// How many times a label write is re-attempted before the track is errored.
// A label write is idempotent, so retrying is free; NOT retrying is what left
// two tracks lying on 2026-07-26.
const LABEL_ATTEMPTS = parsed?.labelAttempts || 3;
// Opt-in per run. Off by default so a direct `/deliver` call cannot merge to
// main by surprise; `dispatch` turns it on explicitly.
const AUTO_MERGE = parsed?.autoMerge === true;
const BASE = parsed?.base || "the repository's current branch (HEAD)";
// Stop starting a NEW attempt if we can't safely finish one. Tunable per run.
const RESERVE = parsed?.reserve || 150_000;

const CONVENTIONS = `Read AGENTS.md and CLAUDE.md, then memory/entrypoints.md, memory/invariants.md, and relevant memory/contracts/*.md before opening source files. Hard rules: pnpm; Drizzle migrations via db:generate+db:migrate (NEVER db:push); shadcn via pnpm dlx shadcn@latest add; cursor-pointer on clickables; never start a dev server (the human keeps localhost:3000 running).`;

const IMPL_SCHEMA = {
  type: "object",
  required: ["committed", "filesChanged", "summary", "selfCheckPassed"],
  properties: {
    committed: {
      type: "boolean",
      description: "code committed to the track branch",
    },
    filesChanged: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    selfCheckPassed: {
      type: "boolean",
      description: "tsc + lint passed in the worktree",
    },
    deviations: {
      type: "string",
      description: "any files touched outside the declared set, justified",
    },
  },
};
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
    // Warnings decide whether a passing track may merge without a human.
    //
    // The DoD proves the code does what the SPEC said. It cannot prove the spec
    // was right. Every warning in the 2026-07-26 batch that genuinely needed the
    // human was of the second kind — "is a church-wide packet the intended read
    // of DOC-014?" — while the code-quality ones (a UTC date format, a contrast
    // ratio, a duplicated constant) were real but decidable without them. So the
    // classification below, not the severity, is what gates auto-merge.
    warnings: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "summary"],
        properties: {
          kind: {
            type: "string",
            enum: ["code-quality", "spec-question"],
            description:
              "spec-question = answering it could change WHAT was built (product intent, an AC that did not say, a requirement read two ways). code-quality = a defect or improvement in HOW it was built, decidable from the codebase alone. When genuinely torn, choose spec-question.",
          },
          summary: { type: "string" },
          detail: {
            type: "string",
            description:
              "for code-quality: enough to file as a standalone issue. for spec-question: the decision the human must make, and the options.",
          },
          files: { type: "array", items: { type: "string" } },
        },
      },
    },
    failingGate: { type: "string" },
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
    followUpIssues: { type: "array", items: { type: "integer" } },
    detail: { type: "string" },
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
  },
};
const CLAIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claimed", "inProgressNow"],
  properties: {
    claimed: {
      type: "array",
      items: { type: "integer" },
      description: "The issue numbers this step actually edited.",
    },
    inProgressNow: {
      type: "array",
      items: { type: "integer" },
      description:
        "Every issue currently carrying agent:in-progress, for blast-radius verification.",
    },
  },
};

const BLOCK_SCHEMA = {
  type: "object",
  required: ["commented"],
  properties: { commented: { type: "boolean" }, note: { type: "string" } },
};

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
// telling a lie that a human cannot distinguish from the truth (in-progress
// with an open PR reads identically as passed, failed and still-running). A
// reviewer acting on it promoted a blocked PR into the review queue.
//
// The fix is the #139 claim-guard shape: the writing agent reports what
// `gh issue view` PRINTED after the write, the loop asserts that observation,
// retries, and on final failure the track is ERRORED rather than reported as
// success. An agent's "I labelled it" is not evidence; the read-back is.
// ---------------------------------------------------------------------------
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
    brief: `Attack the diff. Auth and permission checks on every new entrypoint; multi-tenant boundaries (can org A read or write org B's rows through anything this adds?); injection and unsafe interpolation; secrets or internal data reaching a client bundle or a log; over-broad SELECTs that widen what a response exposes. Read memory/invariants.md and treat every rule in it as a hard requirement, not a guideline. You are the ONLY reviewer looking down this axis — if you pass this, nobody else will catch it.`,
  },
  {
    key: "reproducibility",
    brief: `Do NOT reason about the code — RE-RUN the evidence. Execute the migration dry-run, the rollback, and \`pnpm test\` yourself in the worktree, and re-derive the schema diff. Then compare what you observed against what the first verifier's report claims. Any claim you cannot reproduce is a FAIL, and say which claim and what you got instead.`,
  },
];

// ---------------------------------------------------------------------------
// Defensive regroup: merge any units that share a file into ONE track/branch
// so parallel worktrees can never collide. (Same DSU as frd-implement.)
// ---------------------------------------------------------------------------
const normFile = (f) =>
  String(f)
    .replace(/\s*\((new|modified|edit|edited)\)\s*$/i, "")
    .trim();
function makeDSU(ids) {
  const p = new Map(ids.map((i) => [i, i]));
  const find = (x) => {
    let r = x;
    while (p.get(r) !== r) r = p.get(r);
    while (p.get(x) !== r) {
      const n = p.get(x);
      p.set(x, r);
      x = n;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) p.set(ra, rb);
  };
  return { find, union };
}
const ids = units.map((u) => u.id);
const dsu = makeDSU(ids);
const owners = new Map();
for (const u of units)
  for (const raw of u.files || []) {
    const f = normFile(raw);
    if (!owners.has(f)) owners.set(f, []);
    owners.get(f).push(u.id);
  }
for (const [, o] of owners)
  if (o.length > 1) for (let i = 1; i < o.length; i++) dsu.union(o[0], o[i]);
const groups = new Map();
for (const u of units) {
  const r = dsu.find(u.id);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(u);
}
const tracks = [...groups.values()].map((us) => ({
  id: us[0].id,
  units: us,
  issues: [...new Set(us.map((u) => u.issue).filter((x) => x != null))],
  risk: us.some((u) => u.risk === "high") ? "high" : us[0].risk || "low",
  lane:
    [...new Set(us.map((u) => u.lane))].length === 1 ? us[0].lane : "fullstack",
}));
log(
  `${units.length} unit(s) → ${tracks.length} track(s); max ${MAX_ATTEMPTS} attempt(s) each.`
);

// Every issue this pass is permitted to touch. Any `agent:in-progress` outside
// this set means a labelling step overreached — see board-design-2026-07.md §11.
const PASS_ISSUES = [...new Set(tracks.flatMap((t) => t.issues))];

// ---------------------------------------------------------------------------
// Per-track verify-until-done loop
// ---------------------------------------------------------------------------
function unitBlocks(track) {
  return track.units
    .map(
      (
        u,
        i
      ) => `### Unit ${i + 1}: ${u.title} (${u.lane}) — issue #${u.issue ?? "?"}
Summary: ${u.summary}
Files: ${(u.files || []).join(", ")}
Acceptance criteria:
${(u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n")}`
    )
    .join("\n\n");
}

/**
 * Which of `issues` do NOT demonstrably read `target`.
 *
 * A missing row counts as a violation: an issue nobody reported on is an issue
 * nobody looked at. `agent:in-progress` surviving alongside the target counts
 * too — the status labels are mutually exclusive (labels.md), and the observed
 * failure mode was exactly a stale `agent:in-progress` left in place.
 */
function labelViolations(issues, observed, target) {
  return (issues || []).filter((n) => {
    const row = (observed || []).find((o) => Number(o?.issue) === Number(n));
    if (!row) return true;
    const labels = row.labels || [];
    return !labels.includes(target) || labels.includes("agent:in-progress");
  });
}

/**
 * Write `target` onto the track's issues (and, for the review queue, its PR),
 * then READ THE LABELS BACK and assert them. Retries, and reports failure
 * instead of a cheerful boolean.
 *
 * Returns { settled, observed, prLabels, attempts, missing }.
 */
async function settleLabels(track, target, { phase = "Ship", pr = null } = {}) {
  if (!track.issues.length)
    return { settled: true, observed: [], attempts: 0, missing: [] };

  const list = track.issues.join(", ");
  const wantsPrLabel = Boolean(pr?.url) && target === "agent:in-review";
  let observed = [];
  let prLabels = [];

  for (let attempt = 1; attempt <= LABEL_ATTEMPTS; attempt++) {
    const reply = await agent(
      `Put the board in its true state. The issues are ${list} and the target status label is \`${target}\`.
${attempt > 1 ? `\nATTEMPT ${attempt}: a previous attempt did NOT land. The issues that still do not read \`${target}\` are ${labelViolations(track.issues, observed, target).join(", ") || "(none reported — the last attempt returned nothing)"}. Re-run the edit for those and read them back again.\n` : ""}
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
        label: `label:${target.replace("agent:", "")}:${track.id}#${attempt}`,
        phase,
        // Cheap is safe here ONLY because the answer is verified below. The
        // 2026-07-26 failure was a cheap agent silently no-opping; the guard,
        // not the model tier, is what makes that survivable — which is why
        // haiku is fine here while blockTrack (unverified prose) stays sonnet.
        model: "haiku",
        effort: "low",
        schema: LABEL_STATE_SCHEMA,
      }
    );

    observed = reply?.observed || [];
    prLabels = reply?.prLabels || [];
    const missing = labelViolations(track.issues, observed, target);
    const prMissing = wantsPrLabel && !prLabels.includes(target);

    if (!missing.length && !prMissing)
      return {
        settled: true,
        observed,
        prLabels,
        attempts: attempt,
        missing: [],
      };

    log(
      `🏷️  ${track.id} label write did not stick on attempt ${attempt}/${LABEL_ATTEMPTS} — ` +
        `${missing.length ? `issue(s) ${missing.join(", ")} do not read ${target}` : ""}` +
        `${missing.length && prMissing ? "; " : ""}${prMissing ? `the PR does not carry ${target}` : ""}`
    );
  }

  return {
    settled: false,
    observed,
    prLabels,
    attempts: LABEL_ATTEMPTS,
    missing: labelViolations(track.issues, observed, target),
  };
}

async function blockTrack(track, reason, lastReport) {
  log(`⛔ ${track.id} blocked: ${reason}`);
  await agent(
    `A build loop for issue(s) ${track.issues.map((n) => `#${n}`).join(", ")} could not reach the Definition of Done.
Reason: ${reason}.
Failing gate / findings: ${lastReport ? JSON.stringify({ failingGate: lastReport.failingGate, fixInstructions: lastReport.fixInstructions, summary: lastReport.summary }) : "no verifier report"}.
For EACH issue, post a comment (\`gh issue comment <n>\`) with the failing gate + the concrete evidence + what a human needs to do. Do NOT open a PR. Do NOT edit labels — the loop writes and verifies the \`agent:blocked\` label itself in the next step. Return strictly the schema.`,
    {
      label: `block:${track.id}`,
      phase: "Verify",
      // Mechanical: a comment transcribed from the report it was handed. It
      // reformats findings, it does not produce them.
      model: "sonnet",
      effort: "low",
      schema: BLOCK_SCHEMA,
    }
  );

  // The narrative is only half the outcome. Without this the issue keeps
  // reading `agent:in-progress` and a human reads the failure as a success.
  const labelState = await settleLabels(track, "agent:blocked", {
    phase: "Verify",
  });
  if (!labelState.settled)
    log(
      `🚨 ${track.id} is blocked but its label did NOT settle after ${labelState.attempts} attempt(s): ` +
        `issue(s) ${labelState.missing.join(", ")} still do not read agent:blocked. ` +
        `Fix them by hand — the board is currently lying about this track.`
    );
  return { track, status: "blocked", reason, lastReport, labelState };
}

async function buildTrack(track) {
  const branch = `feature/${track.id}`;
  const wt = `.claude/worktrees/bud-${track.id}`;
  const implAgent = track.lane === "backend" ? "backend" : "frontend";
  let lastReport = null;

  // Claim this track's issues — and ONLY this track's issues.
  //
  // On 2026-07-26 this step swept the entire `agent:queued` label, claiming 35
  // issues for a 2-unit pass and jamming dispatch's "nothing in flight" gate
  // (board-design-2026-07.md §11). The prompt was already scoped to
  // `track.issues`; a cheap model still enumerated the label and "helpfully"
  // claimed the frontier. The old comment here read "No judgment involved",
  // which is precisely the assumption that failed — so the blast radius is now
  // asserted rather than assumed.
  if (track.issues.length) {
    const claim = await agent(
      `Label EXACTLY these issues and no others: ${track.issues.join(", ")}

For each number n in that list, run:
\`gh issue edit n --remove-label agent:queued --add-label agent:in-progress\`

HARD CONSTRAINTS — violating any of these corrupts the board:
- Do NOT run \`gh issue list\`, \`gh search\`, or anything else that enumerates issues by label in order to decide what to edit. The list above is the complete and only input.
- Do NOT edit any issue outside that list, even if it looks queued, unblocked, ready, or related.
- The number of issues you edit must be exactly ${track.issues.length}.

Then, purely to report state, run ONCE:
\`gh issue list --state open --label agent:in-progress --limit 200 --json number --jq '[.[].number]'\`

Return {"claimed": [the numbers you edited], "inProgressNow": [every number that last command printed]}.`,
      {
        label: `start:${track.id}`,
        phase: "Build",
        model: "haiku",
        effort: "low",
        schema: CLAIM_SCHEMA,
      }
    );

    const strays = (claim?.inProgressNow || []).filter(
      (n) => !PASS_ISSUES.includes(n)
    );
    if (strays.length)
      throw new Error(
        `claim step overreached: ${strays.length} issue(s) carry agent:in-progress that this pass does not own (${strays.join(", ")}). ` +
          `This pass owns ${PASS_ISSUES.join(", ") || "(none)"}. Aborting ${track.id} rather than building against a corrupted board. ` +
          `Revert the strays to agent:queued, then re-run. (If a human is genuinely mid-flight on an unrelated issue, that is what dispatch's gate 2 exists to catch before this point.)`
      );
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (budget.total && budget.remaining() < RESERVE)
      return blockTrack(
        track,
        `token reserve hit before attempt ${attempt} (remaining ${Math.round(budget.remaining() / 1000)}k < reserve ${Math.round(RESERVE / 1000)}k)`,
        lastReport
      );

    log(`🔨 ${track.id} — attempt ${attempt}/${MAX_ATTEMPTS}`);
    const fixBlock =
      attempt === 1
        ? `Create the worktree and branch:\n\`git worktree add -b ${branch} ${wt} <HEAD of ${BASE}>\` (skip add if ${wt} already exists; just \`cd\` into it).\nThen give it a test env — \`scripts/worktree-env.sh ${wt}\` (idempotent; read its header for what it does and why). A fresh worktree has no \`.env.local\`, so \`pnpm test\` fails every DB suite until you run it. Do not improvise your own env file.`
        : `The branch ${branch} and worktree ${wt} already exist with your prior work. The verifier REJECTED the last attempt. Fix ONLY what's needed:\nFailing gate: ${lastReport?.failingGate}\nFix instructions: ${lastReport?.fixInstructions}`;

    const impl = await agent(
      `You are a ${track.lane} engineer. ${CONVENTIONS}

Work inside the git worktree ${wt} on branch ${branch}. ${fixBlock}

Implement the following so it satisfies every acceptance criterion:

${unitBlocks(track)}

Write code AND tests. Run \`pnpm typecheck\` and \`pnpm lint\` in the worktree and fix what you can. Commit to ${branch} (conventional commits). Do NOT push and do NOT open a PR — the loop handles that after validation. Stay within the declared files unless strictly necessary (note deviations). Return strictly the schema.`,
      {
        label: `impl:${track.id}#${attempt}`,
        phase: "Build",
        agentType: implAgent,
        schema: IMPL_SCHEMA,
      }
    );
    if (!impl)
      return blockTrack(
        track,
        `implementer died on attempt ${attempt}`,
        lastReport
      );

    // Independent verifier (G6): a DIFFERENT agent runs the full DoD.
    const verify = await agent(
      `You are the code-reviewer and the INDEPENDENT verifier. Use the \`definition-of-done\` skill and \`ops/agent-os/dod.md\`. Validate branch ${branch} in worktree ${wt} for issue(s) ${track.issues.map((n) => `#${n}`).join(", ")}.
Run every gate yourself — do not trust the implementer's claims:
- G1 \`pnpm typecheck && pnpm lint && pnpm build\` in ${wt}
- G2 \`pnpm test\` — if the worktree has no \`.env.local\`, run \`scripts/worktree-env.sh ${wt}\` first and re-run. A missing env is not a test failure, and reporting it as one blames the track for the harness.
- G3 functional: use \`${track.lane === "backend" ? "validate-backend" : "validate-frontend"}\` and PROVE each acceptance criterion with an assertion + screenshot/transcript; console must be error-free; lighthouse a11y ≥ 90 for UI. Frontend validates against the branch's VERCEL PREVIEW (scripts/preview-url.sh --wait --bypass), never localhost:3000 — localhost serves main and would pass code this track never wrote. Backend prefers a tsx harness in the worktree.
- G4 conventions, G5 diff hygiene.
Acceptance criteria to prove:
${track.units.map((u) => (u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n")).join("\n")}
${track.risk === "high" ? "This is HIGH-RISK: also run HR1–HR3 (migration dry-run + schema diff + rollback proof)." : ""}
Default to FAIL when evidence is missing or unconvincing.

FINALLY — classify every warning you raise, because this decides whether the track merges without a human:

- **spec-question** — answering it could change WHAT was built. A requirement that reads two ways, an AC that did not say, a product judgement, a behaviour that satisfies the letter of the AC while arguably missing its intent. Anything you would want the requirement's owner to rule on.
- **code-quality** — a defect or improvement in HOW it was built, decidable from the codebase alone: a wrong date format, a contrast ratio, a duplicated constant, dead code, an overclaiming comment.

A **spec-question warning holds the track for a human**; code-quality warnings are filed as follow-up issues and the track merges. So the cost is asymmetric: a code-quality item wrongly marked spec-question wastes a little of the human's attention, while a spec-question wrongly marked code-quality ships a product decision they never made. **When genuinely torn, choose spec-question.**

Do not invent warnings to seem thorough, and do not suppress one to get a clean merge. An empty list is a real answer.

Return strictly the DoD report schema.`,
      {
        label: `verify:${track.id}#${attempt}`,
        phase: "Verify",
        agentType: "code-reviewer",
        schema: DOD_SCHEMA,
      }
    );
    lastReport = verify;
    if (!verify) continue;

    const passed =
      verify.verdict === "PASS" || verify.verdict === "PASS_WITH_WARNINGS";
    if (!passed) {
      log(
        `❌ ${track.id} attempt ${attempt}: ${verify.failingGate || "FAIL"} — retrying`
      );
      continue;
    }

    // High-risk → diverse-lens sign-off (HR4). Every lens must clear.
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
${track.units.map((u) => (u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n")).join("\n")}

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
        lastReport = {
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
          lenses: tally.map(({ lens, cleared, died, report }) => ({
            lens,
            cleared,
            died,
            findings: report?.findings || [],
          })),
        };
        log(
          `❌ ${track.id} attempt ${attempt}: HR4 rejected by ${dissent.map((d) => d.lens).join(", ")} — retrying`
        );
        continue;
      }

      // Cleared by every lens — carry their findings into the PR body so the
      // human reviewer sees what each axis actually looked at.
      verify.lensFindings = tally.map(({ lens, report }) => ({
        lens,
        summary: report.summary,
        findings: report.findings || [],
      }));
    }

    // PASS (per the verifier) → push, open the PR, and WAIT FOR THE REAL CHECK.
    log(`✅ ${track.id} passed DoD on attempt ${attempt} — opening PR`);
    const pr = await agent(
      `You are the release agent. Use the \`open-pr\` skill. Branch ${branch} (worktree ${wt}) PASSED the Definition of Done. The verifier's evidence report:
${JSON.stringify(verify)}
Push the branch. If a PR for this branch already EXISTS (an earlier attempt opened one), do NOT open a second — the push updates it. Otherwise open a PR against main with --label agent:in-review${track.risk === "high" ? " and --label risk:high" : ""}. Build the PR body from the evidence bundle (the DoD table + AC checklist + screenshots/lighthouse/migration). Include "Closes ${track.issues.map((n) => `#${n}`).join(", Closes ")}". Then flip each issue label agent:in-progress → agent:in-review — and do not report the flip you did not verify: the loop re-reads every one of those labels after you and will error this track if the board does not agree with you.

The body MUST include the skill's **## 👀 Manual QA** section: the preview URL and exact path(s), a numbered happy-path walkthrough, and — the part that matters — **what the automation could NOT check**. Do NOT restate the acceptance criteria there; G3 already proved those, and a reviewer re-reading them learns nothing. Name the judgement calls instead (does it look right, read right, feel fast) and any edge case no AC asserted. Human attention is the scarcest resource in this system: spend it on what a gate cannot decide. If this track genuinely has nothing to eyeball, say so in one line.

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
      lastReport = {
        ...verify,
        verdict: "FAIL",
        failingGate: "CI",
        notes: `CI reported "${pr.checkConclusion}" on ${pr.url}. ${pr.checkSummary || "no summary returned"}`,
      };
      log(
        `🔴 ${track.id} attempt ${attempt}: DoD passed but CI said "${pr.checkConclusion}" — retrying against the real failure`
      );
      continue;
    }

    const shipped = pr?.opened && pr.checkConclusion === "success";

    // -----------------------------------------------------------------------
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
    // -----------------------------------------------------------------------
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
Do NOT open a PR yourself and do NOT edit labels — the loop writes and verifies the \`agent:delivery-failed\` label itself in the next step. Return strictly the schema.`,
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
        track,
        status: "pr-failed",
        reason: `the PR step did not open a PR (${why})`,
        pr,
        report: verify,
        attempts: attempt,
        labelState,
      };
    }

    // -----------------------------------------------------------------------
    // Settle the label BEFORE anything downstream trusts "shipped".
    //
    // This is the step that was missing. It runs before auto-merge on purpose:
    // merging on the strength of a board state nobody verified is how a blocked
    // PR got promoted into the review queue in the first place.
    // -----------------------------------------------------------------------
    const labelState = await settleLabels(track, "agent:in-review", { pr });
    if (!labelState.settled) {
      log(
        `🚨 ${track.id} opened ${pr.url} with a green check, but the board does NOT say so after ${labelState.attempts} attempt(s): ` +
          `issue(s) ${labelState.missing.join(", ") || "(none reported)"} do not read agent:in-review. ` +
          `Reporting this track as ERRORED rather than shipped — a PR whose issue still reads agent:in-progress is indistinguishable from a failure.`
      );
      return {
        track,
        status: "errored",
        reason: `PR ${pr.url} is open and green, but agent:in-review could not be confirmed on issue(s) ${labelState.missing.join(", ") || "(unreported)"} after ${labelState.attempts} attempt(s)`,
        pr,
        report: verify,
        warnings: verify.warnings || [],
        attempts: attempt,
        labelState,
      };
    }

    // -----------------------------------------------------------------------
    // Auto-merge — the review queue, not the budget, is what caps this factory.
    //
    // Three things must all hold, and each is a different kind of guarantee:
    //   1. the DoD passed AND the real CI check is green (proven above),
    //   2. the track is not risk:high — schema/auth/tenancy is where a bad
    //      merge is unrecoverable, so those keep a human regardless,
    //   3. no warning is a spec-question — see DOD_SCHEMA.warnings.
    //
    // Code-quality warnings do NOT hold the merge. They are filed as issues and
    // re-enter this same loop, which is the whole point: small known defects
    // become tracked work instead of a reason to stall a good branch.
    // -----------------------------------------------------------------------
    let merge = null;
    if (AUTO_MERGE) {
      const warnings = verify.warnings || [];
      const specQuestions = warnings.filter((w) => w.kind === "spec-question");
      const codeQuality = warnings.filter((w) => w.kind === "code-quality");
      const holds = [];
      if (track.risk === "high") holds.push("risk:high — never auto-merges");
      if (specQuestions.length)
        holds.push(
          `${specQuestions.length} spec-question warning(s): ${specQuestions.map((w) => w.summary).join(" | ")}`
        );

      if (holds.length) {
        log(`⏸️  ${track.id} held for review — ${holds.join("; ")}`);
        await agent(
          `PR ${pr.url} passed the DoD but is deliberately NOT auto-merged. Comment on it with \`gh pr comment\` explaining exactly why. Do NOT touch labels — the loop has already written and verified \`agent:in-review\` on this PR and its issue(s).

Reason(s) it is held:
${holds.map((h) => `- ${h}`).join("\n")}

${specQuestions.length ? `The decisions the human must make:\n${specQuestions.map((w) => `- **${w.summary}** — ${w.detail || "(no detail given)"}`).join("\n")}\n\nPresent each as a decision with its options, not as a defect report. The reviewer's job here is to RULE, not to hunt.\n\nIf a decision is a DIRECTION question — two or more plausible directions where trying them beats reading about them — invoke the prototype skill (.claude/skills/prototype/SKILL.md) BEFORE commenting: build 3-4 candidates into this PR's branch (UI question → variants behind the prototype switcher, then ./scripts/preview-url.sh --wait --bypass for the link; behavior question → a throwaway CLI under prototypes/), verify each one works, and write the DECISION comment in the skill's format so the reviewer can operate the options instead of imagining them.` : ""}
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
          `Auto-merge PR ${pr.url} (issue(s) ${track.issues.map((n) => `#${n}`).join(", ")}). It passed the full DoD and the required check is green, with no spec-question warnings.

1. ${
            codeQuality.length
              ? `FIRST file each of these as its own follow-up issue with \`gh issue create --label agent:queued\`, parented to the same feature parent as the track's issue (\`gh issue view <n> --json parent\`). Title it as the defect, body = the detail plus a link to ${pr.url}. They must exist BEFORE the merge, so a merge cannot lose them:\n${codeQuality.map((w) => `   - **${w.summary}** — ${w.detail || ""} ${(w.files || []).join(", ")}`).join("\n")}`
              : `No follow-up issues to file.`
          }
2. Then merge: \`gh pr merge <number> --squash --delete-branch --auto\`.
   \`--auto\` is deliberate: the main ruleset requires branches to be up to date, so if this PR is behind main GitHub will re-run the checks and merge only when they pass green against what it actually lands on. If the merge is refused because the branch is behind and auto-merge is unavailable, run \`gh pr update-branch\` first and then retry with \`--auto\`.
3. Report what GitHub ACTUALLY did — \`merged\` if it merged now, \`queued-for-auto-merge\` if it is waiting on checks, \`failed\` if it refused. Do NOT report success you did not observe; re-read with \`gh pr view <number> --json state,mergedAt\` before answering.

Return strictly the schema, with followUpIssues listing every issue number you created.`,
          {
            // Opus: this one mutates main and transcribes GitHub's answer, so
            // it stays at the executor tier — same reasoning as the PR node.
            label: `merge:${track.id}`,
            phase: "Ship",
            model: "opus",
            schema: MERGE_SCHEMA,
          }
        );
      }
    }

    return {
      track,
      status: "shipped",
      pr,
      merge,
      warnings: verify.warnings || [],
      report: verify,
      attempts: attempt,
      labelState,
    };
  }

  return blockTrack(
    track,
    `did not reach DoD in ${MAX_ATTEMPTS} attempts`,
    lastReport
  );
}

phase("Build");
const results = await parallel(tracks.map((t) => () => buildTrack(t)));

// ---------------------------------------------------------------------------
// Fan-in guard
//
// parallel() resolves a thunk that threw to null, so a track whose buildTrack
// died — an agent erroring out after retries, the token budget throwing mid-run
// — comes back as a hole. `.filter(Boolean)` then removes it from the report
// entirely, and the run ends looking tidy while a unit nobody mentioned simply
// never happened: no PR, no agent:blocked label, no alert. The count that went
// in must equal the count that comes out; anything else gets named, loudly.
// ---------------------------------------------------------------------------
const lost = tracks.filter((_, i) => !results[i]);
if (lost.length) {
  log(
    `🚨 FAN-IN GAP: launched ${tracks.length} track(s), ${results.length - lost.length} returned. ` +
      `${lost.length} vanished without a verdict: ${lost.map((t) => `${t.id} (issues ${t.issues.map((n) => `#${n}`).join(", ") || "none"})`).join("; ")}. ` +
      `These are NOT blocked and NOT shipped — their issues still read agent:in-progress and no one was told. Re-run them or take them manually.`
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const done = results.filter(Boolean);

// ---------------------------------------------------------------------------
// Label guard, at the fan-in.
//
// `shipped` is a claim about the BOARD, not only about the PR — labels.md makes
// the label canonical, so a track whose issue still reads `agent:in-progress`
// has not shipped in any sense a consumer can act on. buildTrack already
// refuses to return "shipped" without a verified read-back; this re-asserts it
// over the aggregate so no future edit can reintroduce the lie one layer up.
// ---------------------------------------------------------------------------
for (const r of done) {
  if (r.status !== "shipped") continue;
  const missing = r.labelState?.settled
    ? labelViolations(r.track.issues, r.labelState.observed, "agent:in-review")
    : r.track.issues;
  if (!missing.length) continue;
  log(
    `🚨 ${r.track.id} reported shipped while issue(s) ${missing.join(", ")} do not read agent:in-review — demoting to errored.`
  );
  r.status = "errored";
  r.reason =
    r.reason ||
    `shipped was claimed but issue(s) ${missing.join(", ")} were never confirmed on agent:in-review`;
}

const shipped = done.filter((r) => r.status === "shipped");
const blocked = done.filter((r) => r.status === "blocked");
// Separate from `blocked` because the human action is different: these passed
// every gate and only the push/PR call failed, so they want a retried delivery,
// not a code review. Folding them into `blocked` sent a reader to look for a
// failing gate that does not exist (`failingGate` came out undefined).
const deliveryFailed = done.filter((r) => r.status === "pr-failed");
// Neither shipped nor cleanly blocked: the work exists but the board cannot be
// trusted about it. Loud and separate, because it needs a hand, not a re-run.
const errored = done.filter((r) => r.status === "errored");
log(
  `Done: ${shipped.length} shipped (PR opened), ${blocked.length} blocked${deliveryFailed.length ? `, ${deliveryFailed.length} delivery-failed (DoD passed, no PR)` : ""}${errored.length ? `, ${errored.length} ERRORED (label unsettled)` : ""}${lost.length ? `, ${lost.length} LOST` : ""}.`
);
return {
  summary: `${shipped.length}/${tracks.length} tracks shipped to PR; ${blocked.length} blocked${deliveryFailed.length ? `; 📦 ${deliveryFailed.length} passed the DoD but failed to deliver` : ""}${errored.length ? `; 🚨 ${errored.length} errored with an unsettled label` : ""}${lost.length ? `; ⚠️ ${lost.length} lost without a verdict` : ""}.`,
  lost: lost.map((t) => ({
    track: t.id,
    issues: t.issues,
    reason:
      "track returned no result (agent died or the budget threw) — still labelled agent:in-progress",
  })),
  shipped: shipped.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    pr: r.pr?.url,
    attempts: r.attempts,
    merge: r.merge?.state || (AUTO_MERGE ? "held-for-review" : "not-attempted"),
    // Not decoration: "shipped" is only true of the board if this is true.
    labelsConfirmed: r.labelState?.settled === true,
    followUpIssues: r.merge?.followUpIssues || [],
    heldBy: (r.warnings || [])
      .filter((w) => w.kind === "spec-question")
      .map((w) => w.summary),
  })),
  blocked: blocked.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    reason: r.reason,
    failingGate: r.lastReport?.failingGate,
    labelSettled: r.labelState?.settled !== false,
  })),
  deliveryFailed: deliveryFailed.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    // The work is committed here and nowhere else — a retry needs it by name.
    branch: `feature/${r.track.id}`,
    reason: r.reason,
    // Not a gate name: every gate passed. Naming the step that failed is what
    // stops this being read as a code failure.
    failingGate: "delivery",
    dodVerdict: r.report?.verdict,
    labelSettled: r.labelState?.settled !== false,
  })),
  errored: errored.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    pr: r.pr?.url,
    reason: r.reason,
    unlabelledIssues: r.labelState?.missing || r.track.issues,
    observedLabels: r.labelState?.observed || [],
  })),
  nextStep:
    (errored.length
      ? `🚨 FIRST: ${errored.length} track(s) errored because their label could not be confirmed. Their PRs may be open and green while their issues still read agent:in-progress — set the labels by hand before reading anything else on the board, because until then the board is lying about them. `
      : "") +
    (AUTO_MERGE
      ? "Your queue is ONLY the held PRs — each is held because a warning raises a question about what should have been built, so it needs a ruling rather than a code review. Auto-merged PRs need no action; their code-quality warnings were filed as issues and are back on the frontier."
      : "Review the opened PRs (your queue).") +
    " For blocked issues, read the issue comment for the failing gate + evidence and decide: tighten the spec, raise budget (+Nk), or take it manually." +
    (deliveryFailed.length
      ? ` 📦 ${deliveryFailed.length} track(s) read agent:delivery-failed: they PASSED the DoD and only the push/PR step failed, so do NOT review or rebuild the code — push the named branch and open the PR. The issue comment has the delivery error.`
      : "") +
    (lost.length
      ? " ⚠️ FIRST: the lost tracks got no verdict and no issue comment — nothing told you about them except this field. Re-queue them (their issues are stuck on agent:in-progress)."
      : ""),
};
