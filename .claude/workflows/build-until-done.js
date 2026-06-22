export const meta = {
  name: "build-until-done",
  description:
    "The loop. Per file-disjoint track: implement → validate against the Definition of Done (independent verifier + MCP) → feed failures back and retry → on PASS open a PR with the evidence bundle. On exhaustion (max attempts / token reserve) label the issue agent:blocked and alert — never a silent stop, never a PR that isn't proven done.",
  whenToUse:
    "After spec-intake + token-preflight, to actually build a wave of tracks autonomously to PR. Pass args = the wave's units array (each: {id,title,lane,files,summary,acceptanceCriteria,issue,risk}), optionally {units, base, maxAttempts}.",
  phases: [
    { title: "Build", detail: "implementer codes the track in an isolated worktree" },
    { title: "Verify", detail: "independent code-reviewer runs the DoD gates incl. MCP G3" },
    { title: "Ship", detail: "open-pr — gated on a PASS verdict, with the evidence bundle" },
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
    committed: { type: "boolean", description: "code committed to the track branch" },
    filesChanged: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    selfCheckPassed: { type: "boolean", description: "tsc + lint passed in the worktree" },
    deviations: { type: "string", description: "any files touched outside the declared set, justified" },
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
  required: ["opened", "url"],
  properties: {
    opened: { type: "boolean" },
    url: { type: "string" },
    reason: { type: "string", description: "if not opened, why" },
  },
};
const BLOCK_SCHEMA = {
  type: "object",
  required: ["labelled"],
  properties: { labelled: { type: "boolean" }, note: { type: "string" } },
};

// ---------------------------------------------------------------------------
// Defensive regroup: merge any units that share a file into ONE track/branch
// so parallel worktrees can never collide. (Same DSU as frd-implement-wave.)
// ---------------------------------------------------------------------------
const normFile = (f) =>
  String(f).replace(/\s*\((new|modified|edit|edited)\)\s*$/i, "").trim();
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
    const ra = find(a), rb = find(b);
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
  lane: [...new Set(us.map((u) => u.lane))].length === 1 ? us[0].lane : "fullstack",
}));
log(`${units.length} unit(s) → ${tracks.length} track(s); max ${MAX_ATTEMPTS} attempt(s) each.`);

// ---------------------------------------------------------------------------
// Per-track verify-until-done loop
// ---------------------------------------------------------------------------
function unitBlocks(track) {
  return track.units
    .map(
      (u, i) => `### Unit ${i + 1}: ${u.title} (${u.lane}) — issue #${u.issue ?? "?"}
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
    { label: `block:${track.id}`, phase: "Verify", schema: BLOCK_SCHEMA }
  );
  return { track, status: "blocked", reason, lastReport };
}

async function buildTrack(track) {
  const branch = `feature/${track.id}`;
  const wt = `.claude/worktrees/bud-${track.id}`;
  const implAgent = track.lane === "backend" ? "backend" : "frontend";
  let lastReport = null;

  // mark issues in-progress (best-effort, inside an agent since the script has no shell)
  await agent(
    `For each issue in [${track.issues.join(", ")}], run: \`gh issue edit <n> --remove-label agent:queued --add-label agent:in-progress\`. Return strictly {"labelled": true}.`,
    { label: `start:${track.id}`, phase: "Build", schema: BLOCK_SCHEMA }
  );

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (budget.total && budget.remaining() < RESERVE)
      return blockTrack(track, `token reserve hit before attempt ${attempt} (remaining ${Math.round(budget.remaining() / 1000)}k < reserve ${Math.round(RESERVE / 1000)}k)`, lastReport);

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
      { label: `impl:${track.id}#${attempt}`, phase: "Build", agentType: implAgent, schema: IMPL_SCHEMA }
    );
    if (!impl) return blockTrack(track, `implementer died on attempt ${attempt}`, lastReport);

    // Independent verifier (G6): a DIFFERENT agent runs the full DoD.
    const verify = await agent(
      `You are the code-reviewer and the INDEPENDENT verifier. Use the \`definition-of-done\` skill and \`ops/agent-os/dod.md\`. Validate branch ${branch} in worktree ${wt} for issue(s) ${track.issues.map((n) => `#${n}`).join(", ")}.
Run every gate yourself — do not trust the implementer's claims:
- G1 \`pnpm typecheck && pnpm lint && pnpm build\` in ${wt}
- G2 \`pnpm test\`
- G3 functional: use \`${track.lane === "backend" ? "validate-backend" : "validate-frontend"}\` (drive localhost:3000 via Playwright MCP / run the route) and PROVE each acceptance criterion with an assertion + screenshot/transcript; console must be error-free; lighthouse a11y ≥ 90 for UI.
- G4 conventions, G5 diff hygiene.
Acceptance criteria to prove:
${track.units.map((u) => (u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n")).join("\n")}
${track.risk === "high" ? "This is HIGH-RISK: also run HR1–HR3 (migration dry-run + schema diff + rollback proof)." : ""}
Default to FAIL when evidence is missing or unconvincing. Return strictly the DoD report schema.`,
      { label: `verify:${track.id}#${attempt}`, phase: "Verify", agentType: "code-reviewer", schema: DOD_SCHEMA }
    );
    lastReport = verify;
    if (!verify) continue;

    const passed = verify.verdict === "PASS" || verify.verdict === "PASS_WITH_WARNINGS";
    if (!passed) {
      log(`❌ ${track.id} attempt ${attempt}: ${verify.failingGate || "FAIL"} — retrying`);
      continue;
    }

    // High-risk → second independent verifier must also pass (HR4).
    if (track.risk === "high") {
      const verify2 = await agent(
        `You are a SECOND independent code-reviewer for HIGH-RISK branch ${branch} (worktree ${wt}), issue(s) ${track.issues.map((n) => `#${n}`).join(", ")}. Re-run the DoD gates focusing on the migration dry-run, schema diff, rollback, and the auth/tenancy ACs. Do not assume the first reviewer was right. Return strictly the DoD report schema.`,
        { label: `verify2:${track.id}#${attempt}`, phase: "Verify", agentType: "code-reviewer", schema: DOD_SCHEMA }
      );
      if (!verify2 || (verify2.verdict !== "PASS" && verify2.verdict !== "PASS_WITH_WARNINGS")) {
        lastReport = verify2 || lastReport;
        log(`❌ ${track.id} attempt ${attempt}: second verifier rejected — retrying`);
        continue;
      }
    }

    // PASS → ship.
    log(`✅ ${track.id} passed DoD on attempt ${attempt} — opening PR`);
    const pr = await agent(
      `You are the release agent. Use the \`open-pr\` skill. Branch ${branch} (worktree ${wt}) PASSED the Definition of Done. The verifier's evidence report:
${JSON.stringify(verify)}
Push the branch and open a PR against main with --label agent:in-review${track.risk === "high" ? " and --label risk:high" : ""}. Build the PR body from the evidence bundle (the DoD table + AC checklist + screenshots/lighthouse/migration). Include "Closes ${track.issues.map((n) => `#${n}`).join(", Closes ")}". Then flip each issue label agent:in-progress → agent:in-review. Return strictly the schema.`,
      { label: `pr:${track.id}`, phase: "Ship", schema: PR_SCHEMA }
    );
    return { track, status: pr?.opened ? "shipped" : "pr-failed", pr, report: verify, attempts: attempt };
  }

  return blockTrack(track, `did not reach DoD in ${MAX_ATTEMPTS} attempts`, lastReport);
}

phase("Build");
const results = await parallel(tracks.map((t) => () => buildTrack(t)));

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const done = results.filter(Boolean);
const shipped = done.filter((r) => r.status === "shipped");
const blocked = done.filter((r) => r.status === "blocked" || r.status === "pr-failed");
log(`Done: ${shipped.length} shipped (PR opened), ${blocked.length} blocked.`);
return {
  summary: `${shipped.length}/${tracks.length} tracks shipped to PR; ${blocked.length} blocked.`,
  shipped: shipped.map((r) => ({ track: r.track.id, issues: r.track.issues, pr: r.pr?.url, attempts: r.attempts })),
  blocked: blocked.map((r) => ({ track: r.track.id, issues: r.track.issues, reason: r.reason, failingGate: r.lastReport?.failingGate })),
  nextStep:
    "Review the opened PRs (your queue). For blocked issues, read the issue comment for the failing gate + evidence and decide: tighten the spec, raise budget (+Nk), or take it manually.",
};
