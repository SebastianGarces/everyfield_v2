export const meta = {
  name: "frd-implement-wave",
  description:
    "Execute ONE wave of a planned FRD build: fan out file-disjoint units into isolated git worktrees, each implemented and code-reviewed. You merge the resulting branches before running the next wave.",
  whenToUse:
    "After frd-plan, once the prerequisites (schema) and any prior waves are merged onto the current branch. Pass args = the wave's `units` array (file-disjoint; their dependencies already merged on the base branch).",
  phases: [
    {
      title: "Implement",
      detail:
        "One coding agent per file-disjoint track, each in an isolated git worktree on its own branch",
    },
    {
      title: "Review",
      detail: "code-reviewer runs on each track branch as it lands",
    },
  ],
};

// ---------------------------------------------------------------------------
// Input: args = [ unit, ... ]  OR  { units: [ unit, ... ] }
// unit = { id, title, lane, files, summary, acceptanceCriteria }
// ASSUMPTION: these units' dependencies are already merged on the current branch.
// ---------------------------------------------------------------------------
const units = Array.isArray(args) ? args : args?.units;
if (!Array.isArray(units) || units.length === 0) {
  throw new Error(
    "Pass the wave's units array as args (from frd-plan output), e.g. args: [{id,title,lane,files,summary,acceptanceCriteria}, ...]"
  );
}

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
const CONVENTIONS = `Read AGENTS.md and CLAUDE.md, then memory/entrypoints.md, memory/invariants.md, and relevant memory/contracts/*.md before opening source files. Hard rules: pnpm; Drizzle migrations via db:generate+db:migrate (NEVER db:push); shadcn via pnpm dlx shadcn@latest add; cursor-pointer on clickables; never start a dev server.`;

// ---------------------------------------------------------------------------
// Defensive regroup: even within a handed wave, merge any units that share a
// file into one track (one branch) so parallel worktrees can't collide.
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
    `Note: ${collisions} shared-file collision(s) within this wave — merged into combined tracks.`
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
  lane:
    [...new Set(us.map((u) => u.lane))].length === 1 ? us[0].lane : "fullstack",
}));
log(`Wave: ${units.length} unit(s) → ${tracks.length} parallel track(s)`);

// ---------------------------------------------------------------------------
// Implement (isolated worktree) → review, pipelined
// ---------------------------------------------------------------------------
phase("Implement");
const results = await pipeline(
  tracks,
  (track) => {
    const branch = `feature/${track.id}`;
    const blocks = track.units
      .map(
        (u, i) => `### Unit ${i + 1}: ${u.title} (${u.lane})
Summary: ${u.summary}
Files: ${(u.files || []).join(", ")}
Acceptance criteria:
${(u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n")}`
      )
      .join("\n\n");
    return agent(
      `You are a ${track.lane} engineer. ${CONVENTIONS}

Create a NEW branch "${branch}" and implement the following ${track.units.length} unit(s)${track.units.length > 1 ? " IN ORDER (they share files, so build sequentially in one tree)" : ""}.
Their dependencies are already present on the base branch — build on what exists; do not re-create it.

${blocks}

Write code and tests, run the project's type-check and lint and fix what you can, then commit to the branch (conventional commits). Do not open a PR. Stay within the listed files unless strictly necessary; note any deviation.
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
          `- ${u.title}:\n${(u.acceptanceCriteria || []).map((a) => `    · ${a}`).join("\n")}`
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
return {
  summary: `${landed.length}/${tracks.length} tracks implemented & reviewed`,
  branches: landed.map((r) => ({
    track: r.track.id,
    branch: r.impl?.branch,
    units: r.track.units.map((u) => u.id),
    selfCheckPassed: r.impl?.selfCheckPassed,
    verdict: r.review?.verdict,
    critical: r.review?.critical,
    filesChanged: r.impl?.filesChanged,
  })),
  nextStep:
    "Review each branch, address any critical findings, merge the passing branches into the base, then run the next wave.",
};
