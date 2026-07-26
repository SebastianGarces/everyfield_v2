export const meta = {
  name: "frd-implement",
  description:
    "Build everything currently on the board's frontier: read the unblocked, unclaimed issues, fan the file-disjoint ones into isolated git worktrees, implement and code-review each. You merge the resulting branches; the board holds the order.",
  whenToUse:
    "After frd-plan has published the DAG, and whenever blockers have since closed. Takes no wave array — pass nothing to build the whole frontier, or {issues:[...]} to restrict it to a candidate set.",
  phases: [
    {
      title: "Frontier",
      detail:
        "Read the board for issues whose blockers are all closed and nobody has claimed",
    },
    {
      title: "Implement",
      detail:
        "One coding agent per file-disjoint track, each in an isolated git worktree on its own branch",
    },
    {
      title: "Review",
      detail: "code-reviewer runs on each track branch as it lands",
    },
    {
      title: "Settle",
      detail:
        "Write each track's outcome back to its issue so the board stays true",
    },
  ],
};

// ---------------------------------------------------------------------------
// Input — all optional.
//   {issues:[12,13]}  restrict the frontier to these candidates
//   {base:"main"}     branch point (default: the current branch)
//
// There is deliberately NO units array. The old model passed one wave's units
// in as an argument, which meant the ordering lived in whatever transcript or
// file produced it. It now lives on the board, so a run started in a fresh
// session sees exactly the same picture as one started here.
// ---------------------------------------------------------------------------
const parsedArgs =
  typeof args === "string" && args.trim().startsWith("{")
    ? JSON.parse(args)
    : args;
const candidates = Array.isArray(parsedArgs)
  ? parsedArgs
  : parsedArgs?.issues || null;
const base = parsedArgs?.base || null;

const FRONTIER_SCHEMA = {
  type: "object",
  required: ["frontier", "blocked", "notes"],
  properties: {
    frontier: {
      type: "array",
      description: "takeable now: open, zero OPEN blockers, unassigned",
      items: {
        type: "object",
        required: [
          "issue",
          "id",
          "title",
          "lane",
          "files",
          "summary",
          "acceptanceCriteria",
          "risk",
        ],
        properties: {
          issue: { type: "number" },
          id: { type: "string", description: "short slug for the branch name" },
          title: { type: "string" },
          lane: { type: "string", enum: ["frontend", "backend", "fullstack"] },
          files: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
          risk: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
    blocked: {
      type: "array",
      description: "queued but NOT takeable, with what each still waits on",
      items: {
        type: "object",
        required: ["issue", "title", "waitingOn"],
        properties: {
          issue: { type: "number" },
          title: { type: "string" },
          waitingOn: { type: "array", items: { type: "number" } },
        },
      },
    },
    notes: { type: "string" },
  },
};

const IMPL_SCHEMA = {
  type: "object",
  required: [
    "branch",
    "unitsCompleted",
    "filesChanged",
    "summary",
    "selfCheckPassed",
  ],
  properties: {
    branch: { type: "string" },
    unitsCompleted: { type: "array", items: { type: "string" } },
    filesChanged: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    selfCheckPassed: {
      type: "boolean",
      description: "tsc + lint passed in the worktree",
    },
  },
};
const REVIEW_SCHEMA = {
  type: "object",
  required: ["verdict", "critical", "warnings", "summary"],
  properties: {
    verdict: { type: "string", enum: ["PASS", "PASS_WITH_WARNINGS", "FAIL"] },
    critical: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};
const SETTLE_SCHEMA = {
  type: "object",
  required: ["updated", "notes"],
  properties: {
    updated: {
      type: "array",
      items: {
        type: "object",
        required: ["issue", "label"],
        properties: {
          issue: { type: "number" },
          label: { type: "string" },
        },
      },
    },
    notes: { type: "string" },
  },
};

const CONVENTIONS = `Read AGENTS.md and CLAUDE.md, then memory/entrypoints.md, memory/invariants.md, and relevant memory/contracts/*.md before opening source files. Hard rules: pnpm; Drizzle migrations via db:generate+db:migrate (NEVER db:push); shadcn via pnpm dlx shadcn@latest add; cursor-pointer on clickables; never start a dev server.`;

// ---------------------------------------------------------------------------
// 1. Frontier — ask the board what is takeable
// ---------------------------------------------------------------------------
phase("Frontier");
const board = await agent(
  `You are reading the delivery board to find takeable work. Read ops/agent-os/labels.md FIRST — it defines the frontier and the label vocabulary. Use the \`gh\` CLI.

**The frontier** is every issue that is: open, labelled \`agent:queued\`, has **zero OPEN blockers**, and has **no assignee**.

\`\`\`bash
R=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh issue list --state open --label agent:queued --json number --jq '.[].number' | while read n; do
  b=$(gh api repos/$R/issues/$n --jq '.issue_dependencies_summary.blocked_by')
  a=$(gh api repos/$R/issues/$n --jq '.assignees | length')
  echo "$n blocked_by=$b assignees=$a"
done
\`\`\`

\`blocked_by\` counts only OPEN blockers, so it is a live gate rather than a history.
${candidates ? `\n**Restrict to these candidates only:** ${candidates.join(", ")}. Ignore everything else on the board.\n` : ""}
**For each frontier issue**, read its body (\`gh issue view <n>\`) and extract the fields the schema asks for. \`files\` must come from the issue's **Likely files** section — it is what keeps parallel tracks from colliding, so copy it faithfully rather than guessing. \`lane\` comes from the Validation plan; \`risk\` from the Risk section. Give each a short kebab-case \`id\` for its branch name.

**Exclude and report as blocked**, never as frontier:
- anything with an open blocker (say which, in \`waitingOn\`)
- anything already assigned — someone else has it
- anything labelled \`needs-spec\`, \`decision\`, \`deferred\` or \`feature\`; those are not buildable units

**Claim what you return:** for each frontier issue, \`gh issue edit <n> --add-assignee @me --add-label agent:in-progress --remove-label agent:queued\`. Claiming is the first write, so two runs cannot pick up the same issue.

If the frontier is empty, return an empty array and say in \`notes\` what the board is waiting on.
Return strictly the schema.`,
  { phase: "Frontier", agentType: "backend", schema: FRONTIER_SCHEMA }
);

if (!board) throw new Error("Could not read the board's frontier");

if (board.blocked?.length)
  log(
    `Blocked, not started: ${board.blocked.map((b) => `#${b.issue}→${b.waitingOn.join("/")}`).join(", ")}`
  );

const units = board.frontier || [];
if (units.length === 0) {
  log("Frontier is empty — nothing is takeable right now.");
  return {
    summary: "Frontier empty; nothing built.",
    blocked: board.blocked || [],
    notes: board.notes,
    nextStep:
      "Every queued issue is waiting on an open blocker or is already claimed. Close the blockers (merge their PRs) and run again.",
  };
}

// ---------------------------------------------------------------------------
// 2. Regroup by shared file
//
// The frontier is a SEMANTIC guarantee — nothing here waits on anything else
// here. It is not a guarantee about files. Two unblocked issues can still both
// own src/db/schema/index.ts, and parallel worktrees would collide. So the
// file-overlap grouping still runs, exactly as it did per-wave.
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
let collisions = 0;
for (const [, o] of owners)
  if (o.length > 1) {
    collisions++;
    for (let i = 1; i < o.length; i++) dsu.union(o[0], o[i]);
  }
if (collisions)
  log(
    `${collisions} shared-file collision(s) on the frontier — merged into combined tracks (one branch, built in order).`
  );

const groups = new Map();
for (const u of units) {
  const r = dsu.find(u.id);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(u);
}
const tracks = [...groups.values()].map((us) => ({
  id: us[0].id,
  units: us,
  issues: us.map((u) => u.issue),
  lane:
    [...new Set(us.map((u) => u.lane))].length === 1 ? us[0].lane : "fullstack",
}));
log(
  `Frontier: ${units.length} issue(s) → ${tracks.length} parallel track(s)${base ? ` off ${base}` : ""}`
);

// ---------------------------------------------------------------------------
// 3. Implement (isolated worktree) → review, pipelined
// ---------------------------------------------------------------------------
phase("Implement");
const results = await pipeline(
  tracks,
  (track) => {
    const branch = `feature/${track.id}`;
    const blocks = track.units
      .map(
        (u, i) => `### Unit ${i + 1}: ${u.title} (${u.lane}) — issue #${u.issue}
Summary: ${u.summary}
Files: ${(u.files || []).join(", ")}
Acceptance criteria:
${(u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n")}`
      )
      .join("\n\n");
    return agent(
      `You are a ${track.lane} engineer. ${CONVENTIONS}

Create a NEW branch "${branch}"${base ? ` from ${base}` : ""} and implement the following ${track.units.length} unit(s)${track.units.length > 1 ? " IN ORDER (they share files, so build sequentially in one tree)" : ""}.

These issues are on the board's frontier, which means every issue they were blocked by is already closed and merged. Build on what exists; do not re-create it. If something you depend on is genuinely missing from the base branch, stop and say so rather than rebuilding it — that means the board is wrong, and guessing would hide it.

${blocks}

Write code and tests, run the project's type-check and lint and fix what you can, then commit to the branch (conventional commits). Reference the issue number in your commit body, but do NOT write "Closes #n" — this workflow does not open PRs and must not close anything. Stay within the listed files unless strictly necessary; note any deviation.
Return strictly the schema.`,
      {
        label: `impl:${track.id}`,
        phase: "Implement",
        agentType: track.lane === "backend" ? "backend" : "frontend",
        schema: IMPL_SCHEMA,
        isolation: "worktree",
      }
    ).then((impl) => ({ track, impl }));
  },
  (res) => {
    if (!res || !res.impl) return null;
    const { track, impl } = res;
    const criteria = track.units
      .map(
        (u) =>
          `- ${u.title} (#${u.issue}):\n${(u.acceptanceCriteria || []).map((a) => `    · ${a}`).join("\n")}`
      )
      .join("\n");
    return agent(
      `You are the code-reviewer. Review the diff on branch "${impl.branch}" (git diff against the base). Apply the code-reviewer checklist (correctness, security, simplicity, performance, project conventions). Verify these acceptance criteria are met:
${criteria}
Return strictly the schema.`,
      {
        label: `review:${track.id}`,
        phase: "Review",
        agentType: "code-reviewer",
        schema: REVIEW_SCHEMA,
      }
    ).then((review) => ({ track, impl, review }));
  }
);

const landed = results.filter(Boolean);

// ---------------------------------------------------------------------------
// 4. Settle — write the outcome back to the board
//
// Every issue was claimed as agent:in-progress in the frontier step. Leaving
// one there after the run is exactly the stale state this whole board exists
// to prevent, so the outcome is written back before the workflow returns.
//
// Note what this deliberately does NOT do: promote to `agent:in-review`. That
// label means "DoD passed, PR opened", and this workflow runs neither the DoD
// gates nor open-pr. Claiming review-readiness it has not earned would be the
// same class of error as trusting a board card over a run log.
// ---------------------------------------------------------------------------
phase("Settle");
const outcomes = landed.map((r) => ({
  issues: r.track.issues,
  branch: r.impl?.branch,
  verdict: r.review?.verdict || "UNKNOWN",
  critical: r.review?.critical || [],
  selfCheckPassed: r.impl?.selfCheckPassed,
}));
const failedTracks = tracks.filter(
  (t) => !landed.some((r) => r.track.id === t.id)
);

const settled = await agent(
  `You are writing build outcomes back to the GitHub board so it does not lie. Read ops/agent-os/labels.md first. Use \`gh\`. Every issue below is currently \`agent:in-progress\` and assigned, because this run claimed it.

**Passing tracks** — a branch exists and the code review passed. Leave the issue \`agent:in-progress\` (the work is real but has NOT been through the DoD and has no PR, so it must not be promoted to \`agent:in-review\`). Comment on each issue with the branch name, the review verdict, and any warnings.

**Failing or incomplete tracks** — swap \`agent:in-progress\` for \`agent:blocked\`, unassign, and comment with the specific critical findings so the next attempt starts informed. An issue nobody can act on is worse than one that says why.

${outcomes
  .map(
    (o) =>
      `- issues ${o.issues.map((i) => `#${i}`).join(", ")} — branch \`${o.branch}\`, review ${o.verdict}, selfCheck ${o.selfCheckPassed}${o.critical.length ? `\n    critical: ${o.critical.join("; ")}` : ""}`
  )
  .join("\n")}
${failedTracks.length ? `\n**These tracks produced nothing at all** (the agent died or returned null) — mark every one of their issues \`agent:blocked\` and say so:\n${failedTracks.map((t) => `- issues ${t.issues.map((i) => `#${i}`).join(", ")} (track ${t.id})`).join("\n")}` : ""}

Report the label each issue ended on.
Return strictly the schema.`,
  { phase: "Settle", agentType: "backend", schema: SETTLE_SCHEMA }
);

return {
  summary: `${landed.length}/${tracks.length} tracks implemented & reviewed from a frontier of ${units.length} issue(s)`,
  branches: landed.map((r) => ({
    track: r.track.id,
    issues: r.track.issues,
    branch: r.impl?.branch,
    units: r.track.units.map((u) => u.id),
    selfCheckPassed: r.impl?.selfCheckPassed,
    verdict: r.review?.verdict,
    critical: r.review?.critical,
    filesChanged: r.impl?.filesChanged,
  })),
  stillBlocked: board.blocked || [],
  boardUpdates: settled?.updated || [],
  nextStep:
    "Review each branch, address critical findings, and merge the passing ones. Closing their issues (via `Closes #n` on a PR, or by hand) clears the blocking edges — then run frd-implement again and the next set of issues will have become takeable. Repeat until the frontier is empty.",
};
