export const meta = {
  name: "repro-first",
  description:
    "Build recipe for bug work: one agent writes the failing repro FIRST and EXECUTES it (it must go red), the implementer then fixes the code without touching that repro, and an independent agent re-runs the SAME command (it must go green) — red→green discipline enforced by three agents instead of promised in a prompt.",
  whenToUse:
    "Child recipe of build-until-done only — never invoke directly. One call = one workstream attempt; dispatch selects it per unit (`recipe: repro-first`) and it is the DEFAULT for bug-labeled units. Weighs 1 in RECIPE_AGENT_COST — its agents are sequential and small, and the repro replaces test-writing the implementer would have done anyway. Contract: ops/agent-os/recipes.md.",
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
// Strategy: red → green, in that order, with the order MECHANISED rather than
// requested. A bug fix that was never observed failing is a change that
// happens to be green; #307 and #315 both shipped confident fixes for defects
// nobody had reproduced, and each cost a full verify + review cycle to learn
// that the test had been written after the fix and had therefore never had a
// chance to fail.
//
// Three agents, sequential:
//   1. REPRO   — writes the failing test/repro, RUNS it, transcribes the red
//                output, commits it. If it does not go red the recipe stops
//                HERE and returns commits: [] — a repro that passes on the
//                unfixed code proves the bug is elsewhere or the test is not
//                testing it, and either way there is nothing to fix yet. That
//                refusal is for attempt 1 ONLY; on a RETRY it becomes a warning
//                and the attempt goes on (see the carve-out below phase 1).
//   2. FIX     — fixes the CODE, given the red transcript verbatim, and is
//                told not to edit the repro. Editing the assertion is the one
//                cheat that turns this recipe back into implement-straight.
//   3. CONFIRM — a different agent re-runs the SAME command and transcribes
//                what it printed, and checks whether the repro file changed
//                after the commit that introduced it. The implementer never
//                marks its own homework, for the same reason
//                adversarial-implement's attacker never writes the fix.
//
// Green is TRACKED, never inferred: only the confirm agent's own run may set
// it. A dead confirmer, a confirmer that ran a different command, and a repro
// that is still red after the fix each read differently in `summary` and each
// return a warning — the parent logs those to the journal and renders them into
// the scoped verifier's prompt (build-until-done.js, right after the
// empty-commits gate), so nobody reads an unproven fix as a proven one.
//
// All work happens in the parent-provided worktree on `branch`: this recipe
// cuts no scratch trees and no scratch branches, so there is nothing to sweep.
// ---------------------------------------------------------------------------
const A = typeof args === "string" ? JSON.parse(args) : args;
if (!A || !A.workstream || !A.worktree || !A.branch)
  throw new Error(
    "repro-first is a child recipe of build-until-done and takes recipeArgs: " +
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
// The ref the track is built against. The confirm agent finds the repro commit
// by walking `base..branch` rather than by trusting the sha the repro agent
// transcribed — same doctrine as adversarial-implement's diff range: a
// self-reported anchor that is wrong points the check at the wrong commit and
// the agent reading it cannot tell.
const base = A.base || "origin/main";
// The declared file set crosses the seam in exactly ONE form (recipes.md):
// as workstream.files, never as a second top-level field.
const declaredFiles = workstream.files || [];
const declaredFileList =
  declaredFiles.map((f) => `  - ${f}`).join("\n") || "  (none declared)";

// Collapse whitespace before comparing two spellings of one command: an agent
// re-typing `pnpm test  src/x.test.ts` across a line break is the same command,
// and a shorter one is not.
const normalizeCommand = (c) =>
  String(c || "")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Phase 1. `wentRed` is a claim, so the schema demands the two things that make
// it checkable: the command anybody can re-run and the output it printed.
const REPRO_SCHEMA = {
  type: "object",
  required: [
    "wentRed",
    "reproCommand",
    "reproPaths",
    "redOutput",
    "redIsTheBug",
    "committed",
    "commits",
    "summary",
  ],
  properties: {
    wentRed: {
      type: "boolean",
      description:
        "You RAN the repro against the unfixed code and it FAILED. false means it passed, errored for an unrelated reason, or you could not run it — say which in `summary`. Never true because you expect it to fail.",
    },
    reproCommand: {
      type: "string",
      description:
        "The exact command that runs the repro and nothing else, runnable from the worktree root (e.g. `pnpm test src/lib/x/y.test.ts`). A different agent re-runs this string verbatim after the fix, so it must be complete and self-contained.",
    },
    reproPaths: {
      type: "array",
      items: { type: "string" },
      description:
        "The file(s) you wrote or extended to hold the repro, repo-relative.",
    },
    redOutput: {
      type: "string",
      description:
        "What the command printed when it failed, verbatim — the assertion, the diff of expected vs actual, or the error. Not a paraphrase: this is the evidence the bug existed.",
    },
    redIsTheBug: {
      type: "string",
      description:
        "Why that failure IS the defect rather than a broken harness — a missing import, a typo in the test, an unset env var and a syntax error are all red too, and a fix aimed at one of those fixes nothing.",
    },
    committed: {
      type: "boolean",
      description: "the repro is committed on the workstream branch",
    },
    commits: {
      type: "array",
      items: { type: "string" },
      description: "shas from `git log --format=%H -n <count>`, verbatim",
    },
    summary: { type: "string" },
    deviations: {
      type: "string",
      description: "any files touched outside the declared set, justified",
    },
  },
};

// Phase 2 — the implementer. Same shape as implement-straight's, so a unit
// reads the same brief and returns the same result under either recipe.
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

// Phase 3 — the confirmation. Every field exists to make "it is green now"
// checkable by somebody who was not there: which command ran, what it printed,
// and whether the thing that went red is still the thing that went green.
const CONFIRM_SCHEMA = {
  type: "object",
  required: ["ran", "command", "output", "passed", "reproChanged"],
  properties: {
    ran: {
      type: "boolean",
      description:
        "You executed the command yourself in this worktree just now. false if you could not run it — say why in `notes`; do NOT report somebody else's result as your own.",
    },
    command: {
      type: "string",
      description:
        "The command you ran, verbatim. It must be the repro command you were given — running a narrower or different one answers a different question.",
    },
    output: {
      type: "string",
      description:
        "What it printed, verbatim (the tail is enough, but it must include the pass/fail line).",
    },
    passed: {
      type: "boolean",
      description: "The repro passed. Exit status decides this, not your read.",
    },
    reproChanged: {
      type: "boolean",
      description:
        "The repro file(s) changed after the commit that introduced them. Derive it from the log, do not assume.",
    },
    reproChangeDiff: {
      type: "string",
      description:
        "If they changed: the diff, and your judgement on whether the change weakened what the repro asserts. Editing the assertion is how a red repro is made green without fixing anything.",
    },
    notes: {
      type: "string",
      description: "anything the numbers above do not say",
    },
  },
};

// ---------------------------------------------------------------------------
// Phase 1 — the repro. It runs BEFORE any fix exists, which is the whole
// recipe: a test written after the fix has never had the chance to fail, so it
// proves the code compiles and nothing else.
// ---------------------------------------------------------------------------
const repro = await agent(
  `${retryBlock ? `${retryBlock}\n\nThis is a RETRY, and the block above is the verifier's report on why the last attempt failed. If it names a failure you can reproduce, THAT is the repro to write first — reproduce it before anybody changes code again.\n\n` : ""}You are a ${workstream.lane} engineer. ${conventions}

Work in the existing worktree ${worktree}, which is already on branch ${branch} with a test env. Just \`cd\` into it.

Your job in this attempt is NOT to fix anything. It is to make the defect below REPRODUCE, on demand, as a failing test — and to prove it fails by running it. A different agent fixes the code after you, and a third re-runs your repro to prove it went green. Write no fix: if you fix the bug now, your repro can never be shown red, and the attempt is refused.

${unitBlocksRendered}

Your declared files — stay inside them:
${declaredFileList}

Do this, in this order:
1. Reproduce the defect by hand first, so you know what it actually does. A repro for a bug you have only read about is a guess.
2. Write the smallest test that FAILS because of it. Prefer a \`*.test.ts\` beside the code, inside your declared files. If the bug has no test seam, write the smallest runnable script that shows it and say so in \`summary\`.
3. RUN it: \`pnpm test <path>\` in ${worktree}. Transcribe what it printed into \`redOutput\` VERBATIM — that transcript is the evidence the defect existed, and no later agent can recover it once the fix lands.
4. Check WHY it is red. A missing import, an unset env var, a typo in your own test and a syntax error are all red, and a fix aimed at one of those fixes nothing. Say in \`redIsTheBug\` why this failure is the defect itself.
5. If it does NOT fail, stop and report \`wentRed: false\` with what you saw. That is a real and useful answer — it means the bug is not where the issue says it is, or the test is not testing it — and it is worth far more than a green test committed as if it were a repro.
6. Commit the repro to ${branch} (conventional commits, e.g. \`test(x): failing repro for #<issue>\`). Report the shas in \`commits\`, transcribed from \`git log --format=%H -n <count>\`.

Do NOT push, do NOT open a PR, do NOT merge anything. Return strictly the schema.`,
  {
    label: `repro:${workstream.id}#${attempt}`,
    phase: "Build",
    agentType: A.implAgentType,
    schema: REPRO_SCHEMA,
  }
);

// The refusal path, in one place. Every exit above the implementer returns
// commits: [] so the parent's empty-commits gate fails the attempt BEFORE a
// verifier is spent, and says in a warning exactly what could not be shown —
// the warning is what the journal prints and what rides `fixInstructions` into
// the next attempt.
const warnings = [];
const refuse = (verdict, why) => ({
  summary: `${workstream.id}: repro-first stopped before the fix on attempt ${attempt} — ${verdict}`,
  commits: [],
  warnings: [
    ...warnings,
    `${why} No fix was attempted this attempt: red→green is the whole recipe, and from here neither half can be shown. Anything the repro agent committed is still on ${branch} for the next attempt to build on.`,
  ],
});

const reproReport = repro || {};
const reproCommand = String(reproReport.reproCommand || "").trim();
const redOutput = String(reproReport.redOutput || "").trim();
const reproPaths = (reproReport.reproPaths || []).filter(Boolean);
const reproCommits = (reproReport.commits || []).filter(Boolean);
if (reproReport.deviations) warnings.push(reproReport.deviations);

log(
  `🔴 ${workstream.id} attempt ${attempt}: repro-first — repro ${reproReport.wentRed === true ? "went RED" : "did NOT go red"}${reproCommand ? ` (\`${reproCommand}\`)` : ""}`
);

// "Red" is a claim with three parts, and a claim missing any of them cannot be
// re-run by the confirm agent — which makes the whole recipe unfalsifiable. The
// checks run in order and the FIRST one that fires decides; each says which
// part was missing, because the sentence is what the next attempt reads.
const phaseOneFailure = !repro
  ? [
      "the repro agent died",
      "the repro agent returned nothing, so the defect was never reproduced.",
    ]
  : reproReport.wentRed !== true
    ? [
        "the repro never went red",
        `the repro reported \`wentRed: false\` — it did not fail against the unfixed code${reproReport.summary ? ` (${reproReport.summary})` : ""}.`,
      ]
    : !reproCommand
      ? [
          "the repro named no command",
          "the repro claimed to go red but named no command to re-run, so nobody can show it going green.",
        ]
      : !redOutput
        ? [
            "the repro transcribed no failure",
            "the repro claimed to go red but transcribed no failing output, so the red state is a claim with no evidence behind it.",
          ]
        : !reproCommits.length
          ? [
              "the repro was never committed",
              "the repro claimed to go red but committed nothing, so there is no commit that holds the failing test and no anchor to check it was not edited later.",
            ]
          : null;

// THE RETRY CARVE-OUT. On attempt 1 an unprovable red IS the recipe working:
// nothing is known yet, and an implementer sent in behind a green repro fixes
// the wrong thing. On a RETRY the situation is inverted — the scoped verifier
// has already NAMED the failure, and a named failure is frequently not
// test-shaped at all (a G5 deviation, a lint error, a G0 mis-report, or the
// previous attempt's own `wentRed: false`). There is then nothing that can be
// made to go red, the repro agent correctly says so, and refusing here would
// spend the LAST attempt (MAX_ATTEMPTS is 2 for any wave without a risk:high
// unit, and the branch is not reset between attempts) on a refusal instead of
// on the one-file fix the verifier asked for — a regression against both
// implement-straight and adversarial-implement, neither of which can refuse a
// retry before the implementer has seen the retryBlock. So the retry falls
// through to phase 2 carrying the named finding as its evidence, says in a
// warning exactly what could not be reproduced, and claims NO red→green: this
// is the same forgiveness the live-implementer path below already applies, for
// the same reason — a refusal here dead-ends the track.
if (phaseOneFailure && !isRetry) return refuse(...phaseOneFailure);

const reproProven = phaseOneFailure === null;
if (phaseOneFailure)
  warnings.push(
    `${phaseOneFailure[1]} This is a RETRY, so the attempt does NOT stop here: the verifier's finding is not test-shaped, and this attempt fixes it without a new repro. The named finding is the evidence in the repro's place, nothing claims a red→green this attempt did not show, and anything the repro agent committed is still on ${branch}.`
  );

if (reproProven && !String(reproReport.redIsTheBug || "").trim())
  warnings.push(
    `the repro did not say why its failure is the defect rather than a broken harness (\`redIsTheBug\` was empty) — a missing import and an unset env var are red too, so treat the red transcript as unattributed: ${redOutput.slice(0, 400)}`
  );

// ---------------------------------------------------------------------------
// Phase 2 — the fix. The red transcript goes in VERBATIM: the implementer is
// fixing a failure somebody else observed, and a paraphrase of a stack trace is
// where a defect turns back into a hunch. Prompt semantics are otherwise
// preserved from implement-straight, so a unit reads the same brief.
//
// Under the retry carve-out there is no transcript to hand over, and the brief
// must not pretend there is one — an implementer told "the defect is already
// reproduced" over an empty repro goes looking for a failure nobody observed.
// It gets the retryBlock (already prepended below) and the plain truth instead.
// ---------------------------------------------------------------------------
const reproBriefing = reproProven
  ? `THE DEFECT IS ALREADY REPRODUCED, and it is committed on ${branch}. Another agent wrote it, ran it, and watched it fail:

  repro command: ${reproCommand}
  repro file(s): ${reproPaths.join(", ") || "(none named)"}

What it printed when it failed, VERBATIM:
---
${redOutput}
---
${reproReport.redIsTheBug ? `\nWhy that failure is the defect and not a broken harness: ${reproReport.redIsTheBug}\n` : ""}
Fix the CODE so that command goes green.

- Run \`${reproCommand}\` yourself before you change anything, so you have seen it fail too.
- Do NOT edit, weaken, skip or delete the repro. Changing the assertion until it passes is the one move this recipe exists to prevent, and a third agent re-runs the same command and diffs the repro file afterwards. If you believe the repro is genuinely wrong, say so in \`summary\` and leave it failing rather than editing it quietly.
- Add whatever OTHER tests the unit needs. New tests are welcome; the repro is the one that must stay as written.
- Re-run \`${reproCommand}\` when you are done, plus \`pnpm typecheck\` and \`pnpm lint\` in ${worktree}, and fix what you can.`
  : `THERE IS NO REPRO THIS ATTEMPT — ${phaseOneFailure[1]} This is a RETRY, so the report at the top of this prompt is your evidence in its place: it NAMES the failure, and not every failure a verifier names is test-shaped (a file touched outside the declared set, a lint error, a gate that failed for a reason no test can hold).

Fix exactly what that report names.

- Read it first and fix the thing it names, not the thing you would have fixed. If it names a failure you CAN reproduce, reproduce it before you change code, and say so in \`summary\`.
- Do not invent a failing test to justify the change, and do not weaken an existing one to make a gate pass. Add whatever tests the fix genuinely needs.
- Anything the repro agent committed is already on ${branch} — check \`git -C ${worktree} log --oneline ${base}..${branch}\` before you start, and do not leave a half-written test behind.
- Run \`pnpm typecheck\` and \`pnpm lint\` in ${worktree} when you are done, plus the tests covering the files you touched, and fix what you can.`;

const impl = await agent(
  `${retryBlock ? `${retryBlock}\n\n` : ""}You are a ${workstream.lane} engineer. ${conventions}

Work in the existing worktree ${worktree}, which is already on branch ${branch} with a test env. Just \`cd\` into it.

You own ONE workstream of a larger track. Implement exactly the unit(s) below and NOTHING else — other agents are working other workstreams of this same track in parallel, and every file outside your declared list may be theirs. Touching one is how two worktrees collide at integration.

${unitBlocksRendered}

Your declared files — stay inside them:
${declaredFileList}

${reproBriefing}

Commit to ${branch} (conventional commits). Do NOT push, do NOT open a PR, and do NOT merge anything — the loop integrates the workstreams and ships the track. Report every commit you made in \`commits\`, transcribed from \`git log --format=%H -n <count>\`. Return strictly the schema.`,
  {
    label: `impl:${workstream.id}#${attempt}`,
    phase: "Build",
    agentType: A.implAgentType,
    schema: isRetry ? RETRY_RESULT_SCHEMA : RESULT_SCHEMA,
  }
);

// A dead implementer leaves a KNOWN-FAILING test committed and nothing else.
// Reporting the repro's own commits as this attempt's work would send a diff to
// the verifier that the recipe already knows is red, and buy a confident FAIL
// for the price of a full gate run — so this refuses like the paths above.
if (!impl)
  return {
    summary: reproProven
      ? `${workstream.id}: repro-first reproduced the defect but the implementer died on attempt ${attempt} — the branch carries a failing repro and no fix`
      : `${workstream.id}: repro-first had no repro to hand over and the implementer died on attempt ${attempt} — nothing was fixed`,
    commits: [],
    warnings: [
      ...warnings,
      reproProven
        ? `the implementer agent died after the repro went red — \`${reproCommand}\` is committed on ${branch} and still failing, so the next attempt starts from a proven repro rather than from nothing.`
        : `the implementer agent died, and this attempt had no repro to hand it — the verifier's named finding is still unaddressed and still the whole evidence for the next attempt.`,
    ],
  };

if (impl.deviations) warnings.push(impl.deviations);

// `git log --format=%H` prints newest first, so the fix leads and commits[0]
// stays the branch tip — the shape the parent and the other recipes assume.
const implCommits = (impl.commits || []).filter(
  (sha) => sha && !reproCommits.includes(sha)
);
const commits = [...implCommits, ...reproCommits];

// A live implementer that reports no commits is WARNED about and the loop goes
// on to the confirmation, which is the opposite of the dead-implementer path
// above and deliberately so: an implementer that fixed the bug and
// mis-transcribed its shas is the common case of this shape, and refusing here
// would leave the next attempt's repro agent looking at a repro that now
// PASSES — which that agent must refuse in turn, dead-ending a track over a
// transcription slip. The confirmation run answers the question the shas
// cannot: if the repro is green, something fixed it; if it is red, the warning
// and the scoped verifier's own G2-subset both say so.
if (!implCommits.length)
  warnings.push(
    reproProven
      ? `the implementer reported no commits of its own on top of the repro — if \`${reproCommand}\` is green below, the shas were under-reported; if it is red, this attempt carries a failing repro and no fix.`
      : `the implementer reported no commits of its own — with no repro to re-run, nothing here can tell an under-reported sha from an attempt that changed nothing, so the scoped verifier's own gates are the only answer.`
  );

// ---------------------------------------------------------------------------
// Phase 3 — the confirmation. A different agent, because "the fix works" is
// exactly the claim a green-washed fix makes about itself. It runs one command
// and transcribes what it printed; it writes nothing.
//
// Skipped whenever no red was OBSERVED — gated on `reproProven`, NEVER on
// `reproCommand`. The retry carve-out's most likely shape has a non-empty
// command: REPRO_SCHEMA requires `reproCommand` and `redOutput`, and step 5 of
// the repro brief asks for `wentRed: false` "with what you saw", so a real
// not-test-shaped retry arrives with a command and a transcript attached to a
// red that never happened. Gating on the string sent a confirm agent in behind
// it, holding a prompt that ASSERTS the red — "the repro which failed BEFORE
// the fix", "what the same command printed BEFORE the fix" — and a `passed:
// false` came back as the warning "the repro is STILL RED after the fix": a
// fabricated red that rides the journal into the scoped verifier's prompt and
// into the next attempt's `fixInstructions`. The agent could not have earned
// its keep there either, because a green run is only ever HALF of red→green:
// with no red on record a passing command proves the command passes and
// nothing more, so `greenConfirmed` was forced back to false anyway and the
// run could produce warnings and nothing else. A skipped phase 3 is not a
// failed one — the carve-out warning above already says what could not be
// shown, and `greenConfirmed` is already false.
// ---------------------------------------------------------------------------
const confirm = !reproProven
  ? null
  : await agent(
      `You are confirming ONE thing about a bug fix on branch ${branch} in the worktree ${worktree}: that the repro which failed BEFORE the fix passes AFTER it, and that it is still the same repro.

Run exactly this command in ${worktree}, verbatim, and transcribe what it prints:

  ${reproCommand}

Then check whether the repro itself was edited after it was written. Derive the anchor from the log rather than from anybody's report:
  \`git -C ${worktree} log --oneline --reverse ${base}..${branch} -- ${reproPaths.join(" ") || "."}\` — the FIRST of those commits is the one that introduced the repro
  \`git -C ${worktree} diff <that sha> ${branch} -- ${reproPaths.join(" ") || "."}\` — anything the fix did to it afterwards
The repro agent reported ${reproCommits.length} commit(s) and the repro at ${reproPaths.join(", ") || "(no path named)"}; if the log disagrees, THE LOG WINS. An empty diff is the expected answer. A non-empty one is not automatically wrong — a rename or a second test case is legitimate — but a change that weakens what the repro ASSERTS is how a red test is made green without fixing anything, so report the diff and say which it is.

Here is what the same command printed BEFORE the fix, so you can tell "it passes" from "it no longer runs":
---
${redOutput}
---

You MUST NOT write code, edit any file, commit, push, merge, or touch labels or issues. If the command cannot run, report \`ran: false\` with the reason in \`notes\` — do not repair the harness, and do not report the implementer's result as your own. Return strictly the schema.`,
      {
        label: `green:${workstream.id}#${attempt}`,
        phase: "Verify",
        agentType: "code-reviewer",
        schema: CONFIRM_SCHEMA,
      }
    );

// Green is established in exactly ONE place: a confirmation that ran, ran the
// command it was given, and reported a pass with something to show for it.
// Nothing else may set it — not the implementer's word, and not the absence of
// a complaint.
let greenConfirmed = false;
let ranADifferentCommand = false;

if (!reproProven) {
  // Phase 3 was SKIPPED, not failed — no red was observed, so there is nothing
  // a re-run could confirm and nobody was sent to try. The carve-out warning
  // above already said so, and adding "nobody re-ran it" here would read as a
  // dead confirmer.
} else if (!confirm) {
  warnings.push(
    `the confirming agent died — \`${reproCommand}\` was never re-run by anybody but the implementer, so the fix goes to the gates unproven.`
  );
} else if (confirm.ran !== true) {
  warnings.push(
    `the confirming agent could not run \`${reproCommand}\`${confirm.notes ? `: ${confirm.notes}` : ""} — the fix goes to the gates unproven.`
  );
} else if (
  !normalizeCommand(confirm.command).includes(normalizeCommand(reproCommand))
) {
  ranADifferentCommand = true;
  warnings.push(
    `the confirming agent ran \`${normalizeCommand(confirm.command)}\` instead of the repro command \`${reproCommand}\` — a different command answers a different question, so this attempt has no green run of the repro.`
  );
} else if (confirm.passed !== true) {
  warnings.push(
    `the repro is STILL RED after the fix: \`${reproCommand}\` failed again${confirm.output ? ` — ${String(confirm.output).slice(0, 600)}` : ""}. The diff changes something, but not the thing the repro measures.`
  );
} else if (!String(confirm.output || "").trim()) {
  warnings.push(
    `the confirming agent reported \`${reproCommand}\` passing but transcribed no output, so the green state is a claim with no evidence behind it.`
  );
} else {
  greenConfirmed = true;
}

// Orthogonal to green, and reported whether or not it is: a repro that changed
// after it went red is no longer the test that failed.
if (confirm && confirm.reproChanged === true)
  warnings.push(
    `the repro was EDITED after the commit that made it red${confirm.reproChangeDiff ? ` — ${String(confirm.reproChangeDiff).slice(0, 800)}` : ""}. Read that diff before trusting the green run: weakening the assertion is how a red repro is made to pass without a fix.`
  );

const verdict = !reproProven
  ? "unconfirmed — no repro went red this attempt, so there is no red→green to show"
  : greenConfirmed
    ? confirm.reproChanged === true
      ? "red→green confirmed, but the repro was edited after it went red"
      : "red→green confirmed"
    : ranADifferentCommand
      ? "no green run — the confirmation ran a different command"
      : confirm && confirm.ran === true && confirm.passed !== true
        ? "STILL RED after the fix"
        : "unconfirmed — nobody re-ran the repro after the fix";

log(`🟢 ${workstream.id} attempt ${attempt}: repro-first — ${verdict}`);

return {
  summary:
    `${impl.summary || `${workstream.id} implemented`} — repro-first: ${verdict}` +
    (reproCommand ? ` (repro: \`${reproCommand}\`)` : ""),
  commits,
  warnings,
  ...(isRetry
    ? {
        rootCause: impl.rootCause || "",
        rootCauseAddressed: impl.rootCauseAddressed || "",
      }
    : {}),
};
