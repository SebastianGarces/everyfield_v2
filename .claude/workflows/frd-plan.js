export const meta = {
  name: "frd-plan",
  description:
    "Plan an FRD into a parallel build: decompose, group into file-disjoint tracks, and publish them to the board as issues with native blocking edges. Human-gated work (schema, high-risk) is published as blockers. No code is written.",
  whenToUse:
    "Before implementing an FRD. Publishes the dependency DAG onto the board; execute it with frd-implement, which reads the frontier. Pass the FRD path (or {frd, scope, publish:false}) as args.",
  phases: [
    {
      title: "Decompose",
      detail:
        "Architect splits the FRD into work units with declared file ownership and dependencies",
    },
    {
      title: "Publish",
      detail:
        "Tracks become issues on the board, blockers first, with native blocked_by edges",
    },
  ],
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const frdPath = typeof args === "string" ? args : args?.frd;
const scope = (typeof args === "object" && args?.scope) || "MVP";
// publish:false plans without writing to the board — useful for a dry run.
const publish =
  typeof args === "object" && args?.publish === false ? false : true;
if (!frdPath)
  throw new Error(
    'Pass the FRD path as args, e.g. "product-docs/features/phase-engine/frd.md"'
  );

const DECOMPOSE_SCHEMA = {
  type: "object",
  required: ["units", "deferred", "notes"],
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "title",
          "lane",
          "risk",
          "files",
          "summary",
          "acceptanceCriteria",
          "dependsOn",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          lane: { type: "string", enum: ["frontend", "backend", "fullstack"] },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          files: {
            type: "array",
            items: { type: "string" },
            description:
              "EVERY file/dir this unit creates or edits — the planner groups units that share a file into one track.",
          },
          summary: { type: "string" },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
          dependsOn: {
            type: "array",
            items: { type: "string" },
            description:
              "ids of units that must land first (ordering, not file-conflict)",
          },
        },
      },
    },
    deferred: {
      type: "array",
      description:
        "HUMAN-GATED units: DB schema/migrations, auth, tenancy, payments. Agent-authorable, but they need approval and run first/alone — everything depending on them is published blocked_by them.",
      items: {
        type: "object",
        required: ["id", "title", "reason"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    notes: { type: "string" },
  },
};

const PUBLISH_SCHEMA = {
  type: "object",
  required: ["parentIssue", "published", "edges", "notes"],
  properties: {
    parentIssue: {
      type: "number",
      description:
        "the `feature` issue these were filed under, 0 if none existed",
    },
    published: {
      type: "array",
      items: {
        type: "object",
        required: ["trackId", "issue", "created"],
        properties: {
          trackId: { type: "string" },
          issue: { type: "number" },
          created: {
            type: "boolean",
            description:
              "false if an existing issue with this title was reused",
          },
        },
      },
    },
    edges: {
      type: "array",
      description:
        "the blocked_by edges actually written, as 'blocked<-blocker'",
      items: { type: "string" },
    },
    notes: { type: "string" },
  },
};

const CONVENTIONS = `Read AGENTS.md and CLAUDE.md, then memory/entrypoints.md, memory/invariants.md, and relevant memory/contracts/*.md before opening source files. Hard rules: pnpm; Drizzle migrations via db:generate+db:migrate (NEVER db:push); shadcn via pnpm dlx shadcn@latest add; cursor-pointer on clickables; never start a dev server.`;

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Decompose
// ---------------------------------------------------------------------------
phase("Decompose");
log(`Decomposing ${frdPath} (scope: ${scope})`);
const plan = await agent(
  `You are the architect. ${CONVENTIONS}

Read the FRD at "${frdPath}" and product-docs/system-architecture.md (and any companion files the FRD references, e.g. a rubric). Decompose the ${scope} scope into work units.
Rules:
- "files": list EVERY file/dir the unit creates or edits. The planner serializes any units that share a file, so accuracy keeps merges clean. Confine cross-cutting chokepoints (shared barrels, event-bus registries, constants) to a SINGLE owner unit.
- "dependsOn": logical ordering only — one unit needing another's code to exist. It does NOT mean "touches the same file"; file overlap is handled separately and must not be expressed here.
- risk "high" = DB schema/migrations, auth/permissions, multi-tenant boundaries, payments → put in "deferred" (human-gated: agent can author, but it needs approval and lands first). Consolidate ALL schema into one deferred unit (only one db:generate is allowed). Anything needing that schema should list it in dependsOn — it becomes a real blocking edge on the board.
Return strictly the schema.`,
  { phase: "Decompose", agentType: "architect", schema: DECOMPOSE_SCHEMA }
);
if (!plan) throw new Error("Decomposition failed");

// ---------------------------------------------------------------------------
// Deterministic grouping: tracks (shared-file ONLY) + a dependency DAG
//
// Two different constraints, deliberately kept apart (ops/agent-os/labels.md):
//   shared file  -> a SCHEDULING constraint. Same track, same branch, built in order.
//   dependsOn    -> a SEMANTIC blocking edge. Separate track, published as blocked_by.
// Collapsing them is what made the old wave model coarser than it needed to be.
// ---------------------------------------------------------------------------
const gated = [...plan.deferred];
const gatedIds = new Set(gated.map((d) => d.id));
const implementable = [];
for (const u of plan.units) {
  if (u.risk === "high") {
    gated.push({ id: u.id, title: u.title, reason: "risk=high (auto-gated)" });
    gatedIds.add(u.id);
  } else implementable.push(u);
}

const ids = implementable.map((u) => u.id);
const dsu = makeDSU(ids);
const fileOwners = new Map();
for (const u of implementable)
  for (const raw of u.files || []) {
    const f = normFile(raw);
    if (!fileOwners.has(f)) fileOwners.set(f, []);
    fileOwners.get(f).push(u.id);
  }
const sharedFiles = [];
for (const [f, owners] of fileOwners)
  if (owners.length > 1) {
    sharedFiles.push({ file: f, units: owners });
    for (let i = 1; i < owners.length; i++) dsu.union(owners[0], owners[i]);
  }

const trackOf = new Map();
const trackMembers = new Map();
for (const u of implementable) {
  const root = dsu.find(u.id);
  trackOf.set(u.id, root);
  if (!trackMembers.has(root)) trackMembers.set(root, []);
  trackMembers.get(root).push(u);
}
const tracks = [...trackMembers.entries()].map(([root, units]) => ({
  id: units[0].id,
  root,
  unitIds: units.map((u) => u.id),
  units: units.map((u) => ({
    id: u.id,
    title: u.title,
    lane: u.lane,
    files: u.files,
    summary: u.summary,
    acceptanceCriteria: u.acceptanceCriteria,
    // Intra-track ordering, kept rather than dropped.
    //
    // The track-level graph below deliberately ignores an edge whose endpoints
    // landed in the same track (`if (from !== to)`), because as a BOARD edge it
    // would be a self-block. But it is still real: it says which of these units
    // has to exist before the others compile. That is exactly what
    // build-until-done now needs to split a track into a prerequisite stage and
    // a parallel fan-out, so it travels with the unit instead of dying here.
    dependsOn: (u.dependsOn || []).filter((d) =>
      units.some((sibling) => sibling.id === d)
    ),
  })),
  files: [...new Set(units.flatMap((u) => (u.files || []).map(normFile)))],
  lane:
    [...new Set(units.map((u) => u.lane))].length === 1
      ? units[0].lane
      : "fullstack",
}));

// Track-level dependency graph. Unlike the old model, a dependency on a gated
// unit is NOT dropped — it becomes an edge onto that prerequisite's issue, so
// "the schema must land first" is durable state rather than a sentence in a plan.
const byId = new Map(implementable.map((u) => [u.id, u]));
const trackDeps = new Map(tracks.map((t) => [t.root, new Set()]));
const gatedDeps = new Map(tracks.map((t) => [t.root, new Set()]));
for (const u of implementable) {
  for (const d of u.dependsOn || []) {
    const from = trackOf.get(u.id);
    if (gatedIds.has(d)) {
      gatedDeps.get(from).add(d);
      continue;
    }
    if (!byId.has(d)) continue;
    const to = trackOf.get(d);
    if (from !== to) trackDeps.get(from).add(to);
  }
}

// Depth is now used ONLY to order the writes — publish a blocker before the
// thing it blocks, so `--blocked-by` can reference a real issue number. It is
// no longer an execution barrier; the frontier decides what runs.
const depthMemo = new Map();
const visiting = new Set();
function depth(root) {
  if (depthMemo.has(root)) return depthMemo.get(root);
  if (visiting.has(root)) {
    // A cycle would deadlock the frontier permanently — every member stays
    // blocked forever. Surface it here rather than on the board.
    throw new Error(
      `Dependency cycle detected at track "${root}". A cycle can never reach the frontier — fix dependsOn in the decomposition.`
    );
  }
  visiting.add(root);
  let d = 0;
  for (const dep of trackDeps.get(root)) d = Math.max(d, 1 + depth(dep));
  visiting.delete(root);
  depthMemo.set(root, d);
  return d;
}
const publishOrder = [...tracks].sort(
  (a, b) => depth(a.root) - depth(b.root) || a.id.localeCompare(b.id)
);

const rootCount = tracks.filter(
  (t) => trackDeps.get(t.root).size === 0 && gatedDeps.get(t.root).size === 0
).length;
log(
  `${implementable.length} units → ${tracks.length} file-disjoint tracks; ${rootCount} start unblocked; ${gated.length} human-gated prerequisite(s)`
);
if (sharedFiles.length)
  log(
    `Shared-file tracks: ${sharedFiles.map((s) => s.file.split("/").pop()).join(", ")}`
  );

const dag = publishOrder.map((t) => ({
  trackId: t.id,
  lane: t.lane,
  units: t.units,
  files: t.files,
  blockedBy: [...trackDeps.get(t.root)].map(
    (r) => tracks.find((x) => x.root === r).id
  ),
  blockedByPrerequisite: [...gatedDeps.get(t.root)],
}));

// ---------------------------------------------------------------------------
// Publish to the board
// ---------------------------------------------------------------------------
if (!publish) {
  log("publish:false — returning the DAG without touching the board");
  return {
    frd: frdPath,
    scope,
    published: false,
    prerequisites: gated,
    dag,
    sharedFileClusters: sharedFiles,
    decompositionNotes: plan.notes,
    howToRun:
      "Dry run only. Re-run without publish:false to write the DAG onto the board.",
  };
}

phase("Publish");
const published = await agent(
  `You are publishing a planned build onto the GitHub board. Read ops/agent-os/labels.md and .claude/skills/spec-intake/SKILL.md FIRST — they define the issue shape, the label vocabulary and the parent rule. Use the \`gh\` CLI (>= 2.96, so --parent and --blocked-by are available).

FRD: ${frdPath}

**1. Find the parent.** \`gh issue list --label feature\` and pick the feature issue for this FRD. If none exists, create it first: a thin body linking the FRD plus the settled scope decisions — an index, not a store. Report its number as parentIssue.

**2. Publish the prerequisites**, each as its own issue with \`--label needs-spec --label risk:high --parent <parent>\`. These are human-gated: they are agent-authorable but need approval before they run, which is why they are NOT \`agent:queued\`.
${gated.map((g) => `  - [${g.id}] ${g.title}\n    reason: ${g.reason}`).join("\n") || "  (none)"}

**3. Publish the tracks IN THE ORDER GIVEN BELOW.** The order is topological, so every blocker already exists by the time something references it. For each: \`gh issue create --label agent:queued --parent <parent> [--blocked-by <numbers>]\`, using the issue numbers you got from earlier steps for the edges.

Each body must follow the spec-intake template: Goal, Context (link the FRD), Acceptance criteria (each with how it is verified), Validation plan, Risk, **Likely files** (list them exactly — that is what keeps parallel tracks from colliding), Out of scope.

**Where a track holds more than one unit, write them as a \`## Workstreams\` section** — one \`### <name>\` block per unit, each carrying its own AC subset, its own **Likely files** line, and a \`depends on:\` line naming the workstreams that must land first (empty for the prerequisite). \`build-until-done\` reads that structure to run the prerequisite alone and then fan the rest out in parallel; without it the whole track collapses back to a single agent working sequentially. The top-level \`## Likely files\` stays as the union.

${publishOrder
  .map((t, i) => {
    const deps = [...trackDeps.get(t.root)].map(
      (r) => tracks.find((x) => x.root === r).id
    );
    const pre = [...gatedDeps.get(t.root)];
    const blockers = [...deps, ...pre];
    return `${i + 1}. trackId "${t.id}" (${t.lane})
   blocked by: ${blockers.length ? blockers.join(", ") : "nothing — starts on the frontier"}
   files: ${t.files.join(", ")}
   units:
${t.units.map((u) => `     - ${u.title}: ${u.summary}\n       ACs: ${(u.acceptanceCriteria || []).join(" | ")}`).join("\n")}`;
  })
  .join("\n\n")}

**Idempotency:** before creating anything, \`gh issue list --state all --search "<title> in:title"\`. If an issue with that exact title already exists, REUSE it (report created:false) and only add missing edges with \`gh issue edit <n> --add-blocked-by <m>\`. Re-running a plan must not duplicate the board.

**Do not** open PRs, write code, or close anything. Report exactly what you created and every edge you wrote.
Return strictly the schema.`,
  { phase: "Publish", agentType: "backend", schema: PUBLISH_SCHEMA }
);

if (!published) throw new Error("Publishing to the board failed");
log(
  `Published ${published.published.length} track issue(s) under #${published.parentIssue}; ${published.edges.length} blocking edge(s)`
);

const issueOf = new Map(published.published.map((p) => [p.trackId, p.issue]));

return {
  frd: frdPath,
  scope,
  published: true,
  parentIssue: published.parentIssue,
  prerequisites: gated,
  dag: dag.map((t) => ({ ...t, issue: issueOf.get(t.trackId) ?? null })),
  edges: published.edges,
  sharedFileClusters: sharedFiles,
  decompositionNotes: plan.notes,
  publishNotes: published.notes,
  howToRun:
    "Approve and land the prerequisites on the base branch, then close their issues so the edges clear. Run frd-implement to build everything currently on the frontier; merge its branches, close those issues, and run it again. There is no wave array to carry between runs — the board holds the order.",
};
