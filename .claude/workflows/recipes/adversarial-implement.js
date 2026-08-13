export const meta = {
  name: "adversarial-implement",
  description:
    "Build recipe: one implementer writes the diff, then an independent adversary attacks it in the same worktree (the HR4 security lens, run PRE-gate) and the implementer fixes what it finds — looping until the adversary reports no new findings, capped at 3 rounds.",
  whenToUse:
    "Child recipe of build-until-done only — never invoke directly. One call = one workstream attempt; dispatch selects it per unit (`recipe: adversarial-implement`) and it is the DEFAULT for risk:high units. Costs ~3x implement-straight and counts as 3 agents against the concurrency cap. Contract: ops/agent-os/recipes.md.",
};

// ---------------------------------------------------------------------------
// Recipe contract (ops/agent-os/recipes.md): implement the unit(s), commit to
// `branch` in `worktree`, return { summary, commits, warnings } — plus
// { rootCause, rootCauseAddressed } when priorReport is set. MUST NOT push,
// open PRs, edit labels or issues, merge to any branch other than `branch`,
// or call workflow() — nesting is one level and build-until-done is the
// parent. The parent snapshots origin refs around this call and fails the
// attempt on any drift.
//
// Strategy: the security lens that HR4 runs at the END of a track runs HERE,
// INSIDE the attempt, before a single gate is spent. #304 burned ~8 integration
// rounds on holes an in-attempt adversary would have caught — each round paid
// for a full verify + review cycle to re-learn something a reader of the diff
// could have said in one pass. So: implementer → adversary → fix → adversary …
// until the adversary reports NO NEW findings, capped at ADVERSARY_ROUNDS.
//
// Two properties make this a pre-gate rather than a second reviewer:
//   - The adversary is a DIFFERENT agent with ONE question (attack this diff),
//     the same reason HR4's lenses are diverse rather than redundant. It never
//     writes code; it names findings and the implementer fixes them, so the
//     attacker never marks its own homework.
//   - It is CAPPED and the cap is REPORTED. A loop that quietly gave up looks
//     exactly like a loop that converged, and the difference is whether known
//     findings are still open when the gates run — so hitting the cap with
//     findings outstanding is recorded in the returned warnings, which the
//     parent logs to the journal AND renders into the scoped verifier's prompt
//     as evidence (build-until-done.js, right after the empty-commits gate).
//     `summary` carries the same distinction: only a completed round that
//     returned an empty `newFindings` may report the diff converged.
// All work happens in the parent-provided worktree on `branch`: this recipe
// cuts no scratch trees and no scratch branches, so there is nothing to sweep.
// ---------------------------------------------------------------------------
const A = typeof args === "string" ? JSON.parse(args) : args;
if (!A || !A.workstream || !A.worktree || !A.branch)
  throw new Error(
    "adversarial-implement is a child recipe of build-until-done and takes recipeArgs: " +
      "{track, workstream, worktree, branch, base, stageIndex, attempt, priorReport, retryBlock, conventions, implAgentType, unitBlocksRendered}"
  );

const workstream = A.workstream;
const worktree = A.worktree;
const branch = A.branch;
const attempt = A.attempt || 1;
const retryBlock = A.retryBlock || null;
const isRetry = A.priorReport != null;
const conventions = A.conventions || "";
const unitBlocksRendered = A.unitBlocksRendered || "";
// The ref the track is built against. The adversary's range is anchored on it
// rather than on the implementer's own commit count — see the range comment at
// the attack prompt. `origin/main` is the parent's own default, restated here
// only so the recipe still reads a REF if the field ever goes missing.
const base = A.base || "origin/main";
// The declared file set crosses the seam in exactly ONE form (recipes.md):
// as workstream.files, never as a second top-level field.
const declaredFiles = workstream.files || [];
const declaredFileList =
  declaredFiles.map((f) => `  - ${f}`).join("\n") || "  (none declared)";

// A literal, deliberately: 3 rounds is the recipe, not a knob. Round 1 is the
// one that pays; rounds 2 and 3 exist because a fix is itself new code the
// adversary has never read.
const ADVERSARY_ROUNDS = 3;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const RESULT_SCHEMA = {
  type: "object",
  required: [
    "committed",
    "filesChanged",
    "summary",
    "selfCheckPassed",
    "commits",
  ],
  properties: {
    committed: {
      type: "boolean",
      description: "code committed to the workstream branch",
    },
    filesChanged: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    selfCheckPassed: {
      type: "boolean",
      description: "tsc + lint passed in the worktree",
    },
    commits: {
      type: "array",
      items: { type: "string" },
      description: "shas from `git log --format=%H -n <count>`, verbatim",
    },
    deviations: {
      type: "string",
      description: "any files touched outside the declared set, justified",
    },
  },
};

// The retry contract — a fix must answer the ROOT CAUSE it was given. The
// retryBlock the parent renders carries the evidence verbatim; this schema is
// the other half: the implementer must restate the cause and say what it did
// about it, and the PARENT refuses the attempt before spending a verifier if
// `rootCauseAddressed` comes back empty (the #307 discipline).
const RETRY_RESULT_SCHEMA = {
  type: "object",
  required: [...RESULT_SCHEMA.required, "rootCause", "rootCauseAddressed"],
  properties: {
    ...RESULT_SCHEMA.properties,
    rootCause: {
      type: "string",
      description:
        "The root cause the verifier NAMED, restated in your own words. Not the symptom, not the gate id — the defect. If the evidence names an error, quote it.",
    },
    rootCauseAddressed: {
      type: "string",
      description:
        "What you changed so that NAMED cause is gone, and how you proved it is gone (the command you ran and what it printed). If you did not fix it, say so plainly here — a truthful 'not addressed, here is why' is worth more than a fix report for something else.",
    },
  },
};

const ADVERSARY_SCHEMA = {
  type: "object",
  required: ["newFindings", "summary"],
  properties: {
    newFindings: {
      type: "array",
      description:
        "Findings you have NOT been shown already. An empty array means you attacked the diff and it held — say so in `summary`. Never pad this to look thorough: a false finding costs a fix round.",
      items: {
        type: "object",
        required: ["severity", "summary", "attack", "files", "remedy"],
        properties: {
          severity: {
            type: "string",
            description: "critical | high | medium",
          },
          summary: { type: "string", description: "the defect, in one line" },
          attack: {
            type: "string",
            description:
              "the concrete route in: the request, the argument, the row, the sequence of calls. Name the file and the line. A finding you cannot state as an attack is a hunch — leave it out.",
          },
          files: { type: "array", items: { type: "string" } },
          remedy: {
            type: "string",
            description: "what 'fixed' looks like, concretely",
          },
        },
      },
    },
    summary: {
      type: "string",
      description:
        "what you attacked and what held — the axes you covered, so the journal shows the round happened",
    },
  },
};

// The per-finding analogue of `rootCauseAddressed` (the #307 discipline): a fix
// that cannot say what it did about each finding is a change, not a fix.
const ADVERSARY_FIX_SCHEMA = {
  type: "object",
  required: ["committed", "filesChanged", "summary", "commits", "perFinding"],
  properties: {
    committed: {
      type: "boolean",
      description: "the fixes are committed on the workstream branch",
    },
    filesChanged: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    commits: {
      type: "array",
      items: { type: "string" },
      description:
        "shas from `git log --format=%H -n <count>`, verbatim — the commits THIS round added",
    },
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
              "what you changed so this finding is gone, and how you proved it — or a plain 'not addressed, here is why'. A disagreement is a legitimate answer; silence is not.",
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Phase 1 — the implementer. Prompt semantics preserved from
// implement-straight: the adversary rounds are an ADDITION to the attempt, not
// a rewrite of what the implementer was asked for, so a unit reads the same
// brief under either recipe.
// ---------------------------------------------------------------------------
const impl = await agent(
  `${retryBlock ? `${retryBlock}\n\n` : ""}You are a ${workstream.lane} engineer. ${conventions}

Work in the existing worktree ${worktree}, which is already on branch ${branch} with a test env. Just \`cd\` into it.

You own ONE workstream of a larger track. Implement exactly the unit(s) below and NOTHING else — other agents are working other workstreams of this same track in parallel, and every file outside your declared list may be theirs. Touching one is how two worktrees collide at integration.

${unitBlocksRendered}

Your declared files — stay inside them:
${declaredFileList}

This unit is being built ADVERSARIALLY: when you are done, an independent agent will attack your diff — forged inputs, tenant boundaries, session checks, injection, over-broad reads — and you will be asked to fix whatever it finds, before any gate runs. Build it to survive that pass rather than to pass a first read.

Write code AND tests. Run \`pnpm typecheck\` and \`pnpm lint\` in ${worktree} and fix what you can. Commit to ${branch} (conventional commits). Do NOT push, do NOT open a PR, and do NOT merge anything — the loop integrates the workstreams and ships the track. Report every commit you made in \`commits\`, transcribed from \`git log --format=%H -n <count>\`. Return strictly the schema.`,
  {
    label: `impl:${workstream.id}#${attempt}`,
    phase: "Build",
    agentType: A.implAgentType,
    schema: isRetry ? RETRY_RESULT_SCHEMA : RESULT_SCHEMA,
  }
);

if (!impl)
  return {
    summary: `${workstream.id}: the implementer returned nothing on attempt ${attempt}`,
    commits: [],
    warnings: ["the implementer agent died — no commits were made"],
  };

// `git log --format=%H` prints newest first, and every later round prepends —
// so `commits[0]` stays the branch tip, which is the shape the parent and the
// other recipes assume.
let commits = impl.commits || [];
const warnings = impl.deviations ? [impl.deviations] : [];

// Nothing to attack. Return the empty result and let the parent's
// empty-commits gate fail the attempt — spending an adversary on a diff that
// does not exist proves nothing and costs a full agent.
if (!commits.length)
  return {
    summary: `${workstream.id}: the implementer committed nothing on attempt ${attempt} — no diff to attack`,
    commits: [],
    warnings: [
      ...warnings,
      "the implementer reported no commits, so the adversary rounds were skipped",
    ],
    ...(isRetry
      ? {
          rootCause: impl.rootCause || "",
          rootCauseAddressed: impl.rootCauseAddressed || "",
        }
      : {}),
  };

// ---------------------------------------------------------------------------
// Phase 2 — the adversary loop. One attacker per round, then one fixer for the
// findings it named. The loop ends when a round names nothing new; it is capped
// at ADVERSARY_ROUNDS, and hitting the cap with findings still open is a
// WARNING, never a silent stop.
//
// The brief is the HR4 security lens, moved forward: same axes, same "you are
// the only one looking down this axis" framing, run here where a finding costs
// one fix instead of one integration round.
// ---------------------------------------------------------------------------
const ADVERSARY_BRIEF = `Attack the diff. Work down these axes, and name the route in for each thing you find:
  - FORGED INPUT: every new entrypoint is reachable with a hand-written POST and no UI. Does a TypeScript parameter type stand in for a runtime parse? Does a client-supplied id get trusted, or stamped over?
  - AUTH: is a session minted BEFORE anything is parsed or read (SESSION FIRST, THEN THE PARSE)? Is an actor taken as an ARGUMENT anywhere it should have been minted? Is every export of a \`"use server"\` module meant to be a public endpoint, because that is what it is?
  - TENANT BOUNDARIES: can org A read or write org B's rows through anything this adds? Is \`church_id\` scoped in the WHERE clause rather than after the fact? Does an oversight surface name an org it does not own?
  - INJECTION AND UNSAFE INTERPOLATION: raw SQL, path building, HTML, redirect targets, log lines.
  - LEAKAGE: secrets, bearer credentials or internal data reaching a client bundle, a log, an error message or an analytics event. An error that answers differently for two inputs is an oracle — say what it distinguishes.
  - OVER-BROAD READS: a SELECT that widens what a response exposes; a returned row carrying fields the caller never needed.
  - CONCURRENCY: a check-then-write that a second caller can interleave; a marker written before the work it claims.
Read \`memory/invariants.md\` and every file under \`memory/invariants/\`, and treat every rule in them as a hard requirement, not a guideline. You are the ONLY agent looking down this axis before the gates run — if you pass this, it ships to a verifier that has a whole track to read.`;

const roundSummaries = [];
const openFindings = [];
let seenFindings = [];
let rounds = 0;
let cappedWithOpenFindings = false;
// Convergence is TRACKED, never inferred from what the loop happens to hold
// when it exits. An empty `seenFindings` means "no finding was ever named",
// which is what a clean round AND a dead round both look like — so only the
// clean-round break below may say the diff was signed off.
let cleanRoundConfirmed = false;

for (let round = 1; round <= ADVERSARY_ROUNDS; round++) {
  rounds = round;
  const alreadyReported = seenFindings.length
    ? `You (or a previous round) already reported the findings below, and the implementer has since answered them. Do NOT report them again — report only what is NEW, including anything the fix itself introduced:

${seenFindings.map((f, i) => `--- already reported ${i + 1} [${f.severity}] ---\n${f.summary}\n${f.attack}\nRemedy asked for: ${f.remedy}`).join("\n\n")}
`
    : "";

  const adversary = await agent(
    `You are the ADVERSARY for a build attempt on workstream ${workstream.id} (issue(s) ${(workstream.issues || []).map((n) => `#${n}`).join(", ") || "(none)"}). This is round ${round} of at most ${ADVERSARY_ROUNDS}. An implementer has committed a diff to branch ${branch} in the worktree ${worktree}. Your job is to break it — not to review it, not to improve it, and not to fix it.

Read the diff first, and DERIVE its range from refs — never from anybody's count of commits:
  \`git -C ${worktree} log --oneline ${base}..${branch}\` — every commit on this branch that is not on ${base}
  \`git -C ${worktree} diff ${base}...${branch}\` — the whole of that, as one diff
The implementer reported ${commits.length} commit(s). If the log shows more, the report is wrong and THE LOG WINS: attack everything the diff shows you, not the tail a count would have cut it down to. On a later stage this range also covers earlier stages already merged onto the track branch — deliberate, and the safe direction: reading more than the attempt added costs you time, reading less is the hole you were sent to find. Read the FULL files it touches, not just the hunks, because the hole is usually in what the diff assumed rather than in what it changed.

What was asked for:

${unitBlocksRendered}

Declared files:
${declaredFileList}

${ADVERSARY_BRIEF}

${alreadyReported}
You may run commands and read anything in ${worktree}. You MUST NOT write code, commit, push, merge, edit labels or issues, or touch any other worktree — the implementer fixes what you find, so that the attacker never marks its own homework. If the diff holds, return an EMPTY \`newFindings\` and say in \`summary\` what you attacked; that is a real answer and it ends the loop. Return strictly the schema.`,
    {
      label: `adv${round}:${workstream.id}#${attempt}`,
      phase: "Verify",
      model: "opus",
      agentType: "code-reviewer",
      schema: ADVERSARY_SCHEMA,
    }
  );

  if (!adversary) {
    warnings.push(
      `the adversary agent died in round ${round} — the diff went to the gates without a completed pre-gate attack`
    );
    break;
  }

  roundSummaries.push(
    `round ${round}: ${adversary.summary || "(no summary given)"}`
  );

  const found = (adversary.newFindings || []).filter(
    (f) => f && String(f.summary || "").trim()
  );
  // The ONE place convergence is established: a completed round that returned
  // an empty `newFindings`. No other exit may claim it.
  if (!found.length) {
    cleanRoundConfirmed = true;
    break;
  }

  seenFindings = [...seenFindings, ...found];

  // The cap binds on the ATTACK, not on the fix: a finding named in the last
  // allowed round is still fixed, and the loop then exits without paying for a
  // fourth attacker.
  const fix = await agent(
    `You are a ${workstream.lane} engineer. ${conventions}

An adversary attacked your workstream's diff on branch ${branch} in ${worktree} and found the problems below. Fix them. This is round ${round} of at most ${ADVERSARY_ROUNDS}, and it runs BEFORE any gate — a finding closed here costs one commit; the same finding found at integration costs a whole verify-and-review cycle.

The findings, VERBATIM:

${found.map((f, i) => `--- finding ${i + 1} [${f.severity}] ---\n${f.summary}\nAttack: ${f.attack}\nFiles: ${(f.files || []).join(", ") || "(none named)"}\nWhat "fixed" looks like: ${f.remedy}`).join("\n\n")}

Reproduce each one before you fix it — a fix aimed at a finding you did not reproduce is a guess, and the adversary reads your diff again next round.

Stay inside your declared files:
${declaredFileList}

Add or extend tests so each finding stays closed. Run \`pnpm typecheck\` and \`pnpm lint\` in ${worktree}. Commit to ${branch} (conventional commits). Do NOT push, do NOT open a PR, do NOT merge anything, do NOT rewrite history — append commits. Report the commits THIS round added in \`commits\`, transcribed from \`git log --format=%H -n <count>\`. Answer EVERY finding in \`perFinding\`: if you think one is wrong, say so there plainly — a reasoned disagreement is an answer, silence is not. Return strictly the schema.`,
    {
      label: `advfix${round}:${workstream.id}#${attempt}`,
      phase: "Build",
      agentType: A.implAgentType,
      schema: ADVERSARY_FIX_SCHEMA,
    }
  );

  if (!fix) {
    warnings.push(
      `the fix agent died in round ${round} — ${found.length} adversary finding(s) are still open: ${found.map((f) => `[${f.severity}] ${f.summary}`).join("; ")}`
    );
    openFindings.push(...found);
    break;
  }

  const roundCommits = (fix.commits || []).filter(
    (sha) => sha && !commits.includes(sha)
  );
  commits = [...roundCommits, ...commits];

  // Count the ANSWERS, one per finding — the #307 discipline per finding. A
  // fix that closed three findings and reported one is not three closures.
  const answered = (fix.perFinding || []).filter((p) =>
    String(p?.addressed || "").trim()
  ).length;
  if (!roundCommits.length)
    warnings.push(
      `adversary round ${round} named ${found.length} finding(s) but the fix committed nothing — they are recorded here rather than reported closed: ${found.map((f) => `[${f.severity}] ${f.summary}`).join("; ")}`
    );
  else if (answered < found.length)
    warnings.push(
      `adversary round ${round}: the fix answered ${answered} of ${found.length} finding(s) in \`perFinding\` — the rest are unaccounted for`
    );

  roundSummaries.push(
    `round ${round} fix: ${fix.summary || "(no summary given)"}`
  );

  // Hitting the cap is not convergence. Say so, in the warnings the journal and
  // the verifier both read.
  if (round === ADVERSARY_ROUNDS) {
    cappedWithOpenFindings = true;
    warnings.push(
      `adversarial-implement hit its ${ADVERSARY_ROUNDS}-round cap: round ${ADVERSARY_ROUNDS} still named ${found.length} finding(s) and was fixed, but no round confirmed the diff clean. The gates run on a diff that was never signed off by the adversary.`
    );
  }
}

const roundWord = rounds === 1 ? "round" : "rounds";
// `summary` is the recipe's most visible output, so it must not be able to say
// "converged" for a loop that stopped early. Every non-clean exit gets its own
// words: the cap, a fix that never landed, and an attack that never finished
// (a dead adversary) each read differently from a diff the adversary signed
// off, and none of them may read as "no findings".
const verdict = cleanRoundConfirmed
  ? seenFindings.length
    ? `${seenFindings.length} finding(s) closed`
    : "no findings"
  : cappedWithOpenFindings
    ? "cap reached without a clean round"
    : openFindings.length
      ? `${openFindings.length} finding(s) left open — the fix never landed`
      : seenFindings.length
        ? `${seenFindings.length} finding(s) fixed but never re-attacked`
        : "attack incomplete — no round confirmed the diff clean";

return {
  summary:
    `${impl.summary || `${workstream.id} implemented`} — adversarial-implement: ${rounds} ${roundWord}, ${verdict}` +
    (roundSummaries.length ? ` (${roundSummaries.join(" | ")})` : ""),
  commits,
  warnings: [
    ...warnings,
    ...openFindings.map(
      (f) =>
        `unfixed adversary finding [${f.severity}]: ${f.summary} — ${f.remedy}`
    ),
  ],
  ...(isRetry
    ? {
        rootCause: impl.rootCause || "",
        rootCauseAddressed: impl.rootCauseAddressed || "",
      }
    : {}),
};
