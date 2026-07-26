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
      detail: "open-pr — gated on a PASS verdict, with the evidence bundle",
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
    failingGate: { type: "string" },
    fixInstructions: { type: "string" },
    summary: { type: "string" },
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
  required: ["labelled"],
  properties: { labelled: { type: "boolean" }, note: { type: "string" } },
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

async function blockTrack(track, reason, lastReport) {
  log(`⛔ ${track.id} blocked: ${reason}`);
  await agent(
    `A build loop for issue(s) ${track.issues.map((n) => `#${n}`).join(", ")} could not reach the Definition of Done.
Reason: ${reason}.
Failing gate / findings: ${lastReport ? JSON.stringify({ failingGate: lastReport.failingGate, fixInstructions: lastReport.fixInstructions, summary: lastReport.summary }) : "no verifier report"}.
For EACH issue: \`gh issue edit <n> --remove-label agent:in-progress --add-label agent:blocked\` and post a comment (\`gh issue comment <n>\`) with the failing gate + the concrete evidence + what a human needs to do. Do NOT open a PR. Return strictly the schema.`,
    {
      label: `block:${track.id}`,
      phase: "Verify",
      // Mechanical: label edits plus a comment transcribed from the report it
      // was handed. It reformats findings, it does not produce them.
      model: "sonnet",
      effort: "low",
      schema: BLOCK_SCHEMA,
    }
  );
  return { track, status: "blocked", reason, lastReport };
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
        ? `Create the worktree and branch:\n\`git worktree add -b ${branch} ${wt} <HEAD of ${BASE}>\` (skip add if ${wt} already exists; just \`cd\` into it).`
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
- G2 \`pnpm test\`
- G3 functional: use \`${track.lane === "backend" ? "validate-backend" : "validate-frontend"}\` and PROVE each acceptance criterion with an assertion + screenshot/transcript; console must be error-free; lighthouse a11y ≥ 90 for UI. Frontend validates against the branch's VERCEL PREVIEW (scripts/preview-url.sh --wait --bypass), never localhost:3000 — localhost serves main and would pass code this track never wrote. Backend prefers a tsx harness in the worktree.
- G4 conventions, G5 diff hygiene.
Acceptance criteria to prove:
${track.units.map((u) => (u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n")).join("\n")}
${track.risk === "high" ? "This is HIGH-RISK: also run HR1–HR3 (migration dry-run + schema diff + rollback proof)." : ""}
Default to FAIL when evidence is missing or unconvincing. Return strictly the DoD report schema.`,
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
Push the branch. If a PR for this branch already EXISTS (an earlier attempt opened one), do NOT open a second — the push updates it. Otherwise open a PR against main with --label agent:in-review${track.risk === "high" ? " and --label risk:high" : ""}. Build the PR body from the evidence bundle (the DoD table + AC checklist + screenshots/lighthouse/migration). Include "Closes ${track.issues.map((n) => `#${n}`).join(", Closes ")}". Then flip each issue label agent:in-progress → agent:in-review.

The body MUST include the skill's **## 👀 Manual QA** section: the preview URL and exact path(s), a numbered happy-path walkthrough, and — the part that matters — **what the automation could NOT check**. Do NOT restate the acceptance criteria there; G3 already proved those, and a reviewer re-reading them learns nothing. Name the judgement calls instead (does it look right, read right, feel fast) and any edge case no AC asserted. Human attention is the scarcest resource in this system: spend it on what a gate cannot decide. If this track genuinely has nothing to eyeball, say so in one line.

THEN WAIT FOR CI AND REPORT WHAT IT SAID, NOT WHAT YOU BELIEVE:
\`gh pr checks <number> --watch --fail-fast\`, then read the conclusion of the "Format, Lint, Typecheck, Build" check. Put it in checkConclusion verbatim (success | failure | timed_out | none). If it is not success, pull the failing step and its error with \`gh run view <run-id> --log-failed\` and put that in checkSummary. Do not summarise it as "probably unrelated" and do not claim success you did not observe. Return strictly the schema.`,
      // Deliberately NOT tiered down. This node looks mechanical, but it is the
      // one that transcribes the CI conclusion, and the whole anchoring story
      // rests on it reporting what GitHub said instead of summarising it into
      // "probably unrelated". Cheapening it is a false economy.
      { label: `pr:${track.id}#${attempt}`, phase: "Ship", schema: PR_SCHEMA }
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

    return {
      track,
      status:
        pr?.opened && pr.checkConclusion === "success"
          ? "shipped"
          : "pr-failed",
      pr,
      report: verify,
      attempts: attempt,
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
const shipped = done.filter((r) => r.status === "shipped");
const blocked = done.filter(
  (r) => r.status === "blocked" || r.status === "pr-failed"
);
log(
  `Done: ${shipped.length} shipped (PR opened), ${blocked.length} blocked${lost.length ? `, ${lost.length} LOST` : ""}.`
);
return {
  summary: `${shipped.length}/${tracks.length} tracks shipped to PR; ${blocked.length} blocked${lost.length ? `; ⚠️ ${lost.length} lost without a verdict` : ""}.`,
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
  })),
  blocked: blocked.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    reason: r.reason,
    failingGate: r.lastReport?.failingGate,
  })),
  nextStep:
    "Review the opened PRs (your queue). For blocked issues, read the issue comment for the failing gate + evidence and decide: tighten the spec, raise budget (+Nk), or take it manually." +
    (lost.length
      ? " ⚠️ FIRST: the lost tracks got no verdict and no issue comment — nothing told you about them except this field. Re-queue them (their issues are stuck on agent:in-progress)."
      : ""),
};
