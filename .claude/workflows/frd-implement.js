export const meta = {
  name: "frd-implement",
  description:
    "Build the board's frontier: read the unblocked, unclaimed issues, fan the file-disjoint ones into isolated git worktrees, implement and code-review each. You merge the resulting branches.",
  whenToUse:
    "After frd-plan has published the DAG, and whenever blockers have since closed. Pass nothing to build the whole frontier, or {issues:[...]} to restrict it to a candidate set.",
  phases: [
    { title: "Frontier", detail: "Read and claim what is takeable" },
    { title: "Implement", detail: "One agent per track, in its own worktree" },
    {
      title: "Review",
      detail: "The one review per branch; it settles the board",
    },
    { title: "Settle", detail: "Fallback only: a track that produced nothing" },
  ],
};

// ---------------------------------------------------------------------------
// Input — all optional. {issues:[12,13]} restricts the frontier to candidates;
// {base:"main"} sets the branch point. There is no units array: the order lives
// on the board, so a fresh session sees the same picture as this one.
// ---------------------------------------------------------------------------
const parsedArgs =
  typeof args === "string" && args.trim().startsWith("{")
    ? JSON.parse(args)
    : args;
const candidates = Array.isArray(parsedArgs)
  ? parsedArgs
  : parsedArgs?.issues || null;
const base = parsedArgs?.base || null;

// Schema builders — the schema IS the contract, so keep the field names exact.
const str = { type: "string" };
const num = { type: "number" };
const noted = (base, description) => ({ ...base, description });
const list = (items, d) => (d ? { type: "array", items, description: d } : { type: "array", items }); // prettier-ignore
const obj = (required, properties) => ({
  type: "object",
  required,
  properties,
});
const enm = (...values) => ({ type: "string", enum: values });

const LABELLED = list(
  obj(["issue", "label"], { issue: num, label: str }),
  "the label each issue ended on"
);

const FRONTIER_SCHEMA = obj(["frontier", "blocked", "notes"], {
  frontier: list(
    obj(
      ["issue", "id", "title", "lane", "files", "summary", "acceptanceCriteria", "risk"], // prettier-ignore
      {
        issue: num,
        id: noted(str, "short slug for the branch name"),
        title: str,
        lane: enm("frontend", "backend", "fullstack"),
        files: list(str),
        summary: str,
        acceptanceCriteria: list(str),
        risk: enm("low", "medium", "high"),
      }
    ),
    "takeable now: open, zero OPEN blockers, unassigned"
  ),
  blocked: list(
    obj(["issue", "title", "waitingOn"], {
      issue: num,
      title: str,
      waitingOn: list(num),
    }),
    "queued but NOT takeable, with what each still waits on"
  ),
  notes: str,
});

const IMPL_SCHEMA = obj(
  ["branch", "unitsCompleted", "filesChanged", "summary", "selfCheckPassed"],
  {
    branch: str,
    unitsCompleted: list(str),
    filesChanged: list(str),
    summary: str,
    selfCheckPassed: noted(
      { type: "boolean" },
      "tsc + lint passed in the tree"
    ),
  }
);

const REVIEW_SCHEMA = obj(["verdict", "critical", "warnings", "summary"], {
  verdict: enm("PASS", "PASS_WITH_WARNINGS", "FAIL"),
  critical: list(str, "actionable findings, each naming its remedy"),
  warnings: list(
    str,
    "non-blocking observations, and the rulings made on them"
  ),
  summary: str,
  updated: LABELLED,
});

const SETTLE_SCHEMA = obj(["updated", "notes"], {
  updated: LABELLED,
  notes: str,
});

const CONVENTIONS =
  "Read AGENTS.md, then memory/invariants.md and the domain invariant files covering the files you own.";

// ---------------------------------------------------------------------------
// 1. Frontier — ask the board what is takeable, and claim it
// ---------------------------------------------------------------------------
phase("Frontier");
const board = await agent(
  `Find the takeable work on the delivery board with \`gh\`. The frontier rules and the label vocabulary live in ops/agent-os/labels.md — read it first.

**The frontier** is every issue that is open, labelled \`agent:queued\`, has **zero OPEN blockers**, and has **no assignee**.

**Read the whole board in ONE call** — the REST list endpoint carries \`issue_dependencies_summary\`, \`assignees\`, \`labels\` AND the full \`body\`:

\`\`\`bash
R=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh api --paginate "repos/$R/issues?labels=agent:queued&state=open&per_page=100" \\
  --jq '.[] | select(.pull_request == null) | {number, title, body, assignees: (.assignees | length), blocked_by: .issue_dependencies_summary.blocked_by, labels: [.labels[].name]}'
\`\`\`

- **Keep \`--paginate\`** — an unpaginated list truncates at 30 rows and hides most of the board, silently.
- **Keep \`select(.pull_request == null)\`** — that endpoint returns pull requests alongside issues.
- **Do NOT run \`gh issue view <n>\` per issue** — the body is already in the payload.

\`blocked_by\` counts only OPEN blockers, so it is a live gate, not a history.
${candidates ? `\n**Restrict to these candidates only:** ${candidates.join(", ")}. Ignore everything else on the board.\n` : ""}
Fill the schema **from the payload you already fetched**: \`files\` from the body's **Likely files** section (copy it faithfully — it is what keeps parallel tracks from colliding), \`lane\` from the Validation plan, \`risk\` from the Risk section, plus a short kebab-case \`id\` for the branch name.

**Report as blocked, never as frontier:** anything with an open blocker (name it in \`waitingOn\`), anything already assigned, anything labelled \`needs-spec\`, \`decision\`, \`deferred\` or \`feature\`.

**Claim what you return:** \`gh issue edit <n> --add-assignee @me --add-label agent:in-progress --remove-label agent:queued\`. Claiming is the first write, so two runs cannot pick up the same issue.

If the frontier is empty, return an empty array and say in \`notes\` what the board waits on.
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
      "Every queued issue waits on an open blocker or is already claimed. Close the blockers and run again.",
  };
}

// ---------------------------------------------------------------------------
// 2. Regroup by shared file. The frontier guarantees nothing here waits on
// anything else here; it guarantees nothing about files, and parallel worktrees
// owning the same file collide.
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
// 3. Implement (isolated worktree) → review, pipelined. That review is the
// review of record for the branch: nothing downstream reviews it again.
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

These issues are on the frontier, so everything they were blocked by is closed and merged. Build on what exists. If something you depend on is genuinely missing from the base branch, stop and say so — that means the board is wrong, and guessing would hide it.

${blocks}

Write code and tests, run type-check and lint and fix what you can, then commit (conventional commits). Reference the issue number in the commit body, but do NOT write "Closes #n" — this workflow opens no PRs and closes nothing. Stay within the listed files unless strictly necessary; note any deviation.
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
      `You are the code-reviewer, and this is the ONE review this branch gets. Review the diff on branch "${impl.branch}" (against the base) for correctness, project conventions (AGENTS.md, plus the memory/invariants files matching the diff), diff hygiene, and whether it meets its acceptance criteria. On a schema, auth or tenancy diff, hold the security lens explicitly and read the matching memory/invariants/*.md.

Acceptance criteria:
${criteria}

Split what you find: \`critical\` = actionable findings, each naming its remedy; \`warnings\` = everything else, including spec-questions — rule on those yourself from product-docs/product-values.md, CONTEXT.md and memory/invariants.md, and record the ruling in the warning text.

**Then settle this track's issues** (${track.issues.map((i) => `#${i}`).join(", ")}) with \`gh\`; each is \`agent:in-progress\` and assigned, because this run claimed it.
- PASS or PASS_WITH_WARNINGS → comment the branch, the verdict and any warnings, and leave the label alone. Passing tracks stay \`agent:in-progress\` — no DoD, no PR, so no \`agent:in-review\`.
- FAIL → swap \`agent:in-progress\` for \`agent:blocked\`, unassign, and comment the critical findings so the next attempt starts informed.
Report the label each issue ended on in \`updated\`.
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

// A reviewer that died settled nothing, so its track is NOT landed — counting
// it as reviewed would leave its issues claimed forever, which is a silent stop.
const returned = results.filter(Boolean);
const landed = returned.filter((r) => r.review);
const branchOf = new Map(
  returned.filter((r) => !r.review).map((r) => [r.track.id, r.impl?.branch])
);

// ---------------------------------------------------------------------------
// 4. Settle — fallback only. Each reviewer settled its own issues; a track whose
// build OR review produced nothing had none, so its issues stay claimed forever.
// ---------------------------------------------------------------------------
const failedTracks = tracks.filter(
  (t) => !landed.some((r) => r.track.id === t.id)
);
let settled = null;
if (failedTracks.length) {
  phase("Settle");
  settled = await agent(
    `These claimed issues were never settled — their build or their review agent died. Label vocabulary: ops/agent-os/labels.md. With \`gh\`, for each issue below: swap \`agent:in-progress\` for \`agent:blocked\`, unassign, and comment what happened. Where a branch is named, the code EXISTS and is unreviewed — name that branch in the comment so the work is not lost and the next attempt does not rebuild it.

${failedTracks.map((t) => `- issues ${t.issues.map((i) => `#${i}`).join(", ")} (track ${t.id}) — ${branchOf.has(t.id) ? `branch \`${branchOf.get(t.id) || "unnamed"}\` exists, but no review landed` : "no branch was produced"}`).join("\n")}

Report the label each issue ended on.
Return strictly the schema.`,
    { phase: "Settle", agentType: "backend", schema: SETTLE_SCHEMA }
  );
}

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
  boardUpdates: [
    ...landed.flatMap((r) => r.review?.updated || []),
    ...(settled?.updated || []),
  ],
  nextStep:
    "Merge the passing branches. Closing their issues clears the blocking edges — then run frd-implement again and the next set becomes takeable. Repeat until the frontier is empty.",
};
