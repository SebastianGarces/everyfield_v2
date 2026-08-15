export const meta = {
  name: "frd-plan",
  description:
    "Decompose an FRD into file-disjoint tracks and publish them to the board as issues with native blocking edges. No code is written.",
  whenToUse:
    "Before implementing an FRD. Execute the published DAG with frd-implement, which reads the frontier. Pass the FRD path, or {frd, scope, publish:false}.",
  phases: [
    { title: "Decompose", detail: "Split the FRD into work units" },
    { title: "Publish", detail: "Tracks become issues, prerequisites first" },
  ],
};

// ---------------------------------------------------------------------------
// Input. publish:false plans without touching the board — a dry run.
// ---------------------------------------------------------------------------
const frdPath = typeof args === "string" ? args : args?.frd;
const scope = (typeof args === "object" && args?.scope) || "MVP";
const publish =
  typeof args === "object" && args?.publish === false ? false : true;
if (!frdPath)
  throw new Error(
    'Pass the FRD path as args, e.g. "product-docs/features/phase-engine/frd.md"'
  );

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

const UNIT = obj(
  ["id", "title", "lane", "risk", "files", "summary", "acceptanceCriteria", "dependsOn"], // prettier-ignore
  {
    id: str,
    title: str,
    lane: enm("frontend", "backend", "fullstack"),
    risk: enm("low", "medium", "high"),
    files: list(str, "EVERY file/dir this unit creates or edits"),
    summary: str,
    acceptanceCriteria: list(str),
    dependsOn: list(str, "ids that must land first — ordering, not overlap"),
  }
);

const DECOMPOSE_SCHEMA = obj(["units", "deferred", "notes"], {
  units: list(UNIT),
  deferred: list(
    obj(["id", "title", "reason"], { id: str, title: str, reason: str }),
    "prerequisite units — all schema/migration work in ONE, plus anything else that must land first and alone; everything depending on one publishes blocked_by it"
  ),
  notes: str,
});

const PUBLISH_SCHEMA = obj(["parentIssue", "published", "edges", "notes"], {
  parentIssue: noted(num, "the `feature` issue these were filed under, 0 if none"), // prettier-ignore
  published: list(
    obj(["trackId", "issue", "created"], {
      trackId: str,
      issue: num,
      created: noted({ type: "boolean" }, "false if an issue was reused"),
    })
  ),
  edges: list(str, "the blocked_by edges written, as 'blocked<-blocker'"),
  notes: str,
});

const CONVENTIONS =
  "Read AGENTS.md, then memory/invariants.md and the domain invariant files covering the files you own.";

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

Read the FRD at "${frdPath}", product-docs/system-architecture.md, and any companion file the FRD references. Decompose the ${scope} scope into work units.
- "files": every file the unit touches. Units sharing a file are serialized into one track, so accuracy keeps merges clean; give each cross-cutting chokepoint (barrel, registry, constants) a single owner unit.
- "dependsOn": ordering only — one unit needs another's code to exist. File overlap is handled separately and must not appear here.
- risk "high" = auth and permissions, multi-tenant isolation, payments — those units stay in "units" with risk high. Schema and migrations are NOT high (there is no separate production database yet), but ALL schema work still goes in ONE "deferred" unit because only one db:generate may run; anything needing it names it in dependsOn, which becomes a real blocking edge.
Return strictly the schema.`,
  { phase: "Decompose", agentType: "architect", schema: DECOMPOSE_SCHEMA }
);
if (!plan) throw new Error("Decomposition failed");

// ---------------------------------------------------------------------------
// Deterministic grouping. Two constraints, deliberately kept apart:
//   shared file -> SCHEDULING. Same track, same branch, built in order.
//   dependsOn   -> SEMANTIC. Separate track, published as a blocked_by edge.
// ---------------------------------------------------------------------------
// Two reasons to be a prerequisite, and only one of them is risk. A schema unit
// lands alone because one db:generate may run, not because it is dangerous.
const gated = [...plan.deferred];
const gatedIds = new Set(gated.map((d) => d.id));
const implementable = [];
for (const u of plan.units) {
  if (u.risk === "high") {
    gated.push({
      id: u.id,
      title: u.title,
      reason: "risk=high — auth, tenancy or payments",
      high: true,
    });
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
    // Intra-track ordering. The track graph below skips an edge inside a track
    // (as a board edge it would self-block), but build-until-done reads this one
    // to run the prerequisite workstream before the parallel fan-out.
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

// A dependency on a prerequisite is kept, not dropped: it becomes an edge onto
// that prerequisite's issue, so "the schema lands first" is durable state.
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

// Depth orders the WRITES only, so `--blocked-by` can name a real issue number.
const depthMemo = new Map();
const visiting = new Set();
function depth(root) {
  if (depthMemo.has(root)) return depthMemo.get(root);
  if (visiting.has(root))
    throw new Error(
      `Dependency cycle detected at track "${root}". A cycle can never reach the frontier — fix dependsOn in the decomposition.`
    );
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
  `${implementable.length} units → ${tracks.length} file-disjoint tracks; ${rootCount} start unblocked; ${gated.length} prerequisite(s)`
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
    howToRun: "Dry run. Re-run without publish:false to write to the board.",
  };
}

phase("Publish");
const published = await agent(
  `Publish this planned build onto the GitHub board with \`gh\` (>= 2.96, for --parent and --blocked-by). Read ops/agent-os/labels.md and .claude/skills/spec-intake/SKILL.md first — they hold the issue shape, the label vocabulary and the parent rule.

FRD: ${frdPath}

**1. Parent.** \`gh issue list --label feature\`, pick this FRD's feature issue or create one with a thin body linking the FRD. Report it as parentIssue.

**2. Prerequisites**, each its own issue, \`--label agent:queued --parent <parent>\`. They are buildable, and they land alone before anything blocked_by them. Add \`--label risk:high\` ONLY to the lines marked high below — risk:high means auth, tenancy or payments; schema and migrations are ordered, not dangerous.
${gated.map((g) => `  - [${g.id}] ${g.title}${g.high ? "  ← also --label risk:high" : ""}\n    reason: ${g.reason}`).join("\n") || "  (none)"}

**3. Tracks, IN THE ORDER BELOW** (topological, so every blocker exists before it is referenced): \`gh issue create --label agent:queued --parent <parent> [--blocked-by <numbers>]\`.

Bodies follow the spec-intake template. \`## Likely files\` is the union of the track's files, listed exactly — it is what keeps parallel tracks from colliding. **A track holding more than one unit also gets a \`## Workstreams\` section**: one \`### <name>\` block per unit with its own AC subset, its own **Likely files** line, and a \`depends on:\` line naming the workstreams that must land first. build-until-done reads that to run the prerequisite alone, then fan the rest out in parallel.

${publishOrder
  .map((t, i) => {
    const deps = [...trackDeps.get(t.root)].map(
      (r) => tracks.find((x) => x.root === r).id
    );
    const blockers = [...deps, ...gatedDeps.get(t.root)];
    return `${i + 1}. trackId "${t.id}" (${t.lane})
   blocked by: ${blockers.length ? blockers.join(", ") : "nothing — starts on the frontier"}
   files: ${t.files.join(", ")}
   units — each becomes one \`### <name>\` workstream block, with these lines:
${t.units
  .map(
    (u) => `     - ${u.title} (${u.lane}): ${u.summary}
       files: ${(u.files || []).map(normFile).join(", ") || "(none)"}
       depends on: ${(u.dependsOn || []).join(", ") || "nothing"}
       ACs: ${(u.acceptanceCriteria || []).join(" | ")}`
  )
  .join("\n")}`;
  })
  .join("\n\n")}

**Idempotency:** re-running must not duplicate the board — \`gh issue list --state all --search "<title> in:title"\` first, reuse an exact-title hit (created:false), and add only the missing edges with \`gh issue edit <n> --add-blocked-by <m>\`.

Open no PRs, write no code, close nothing. Report what you created and every edge.
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
    "Land and close the prerequisites so their edges clear, then run frd-implement. Merge its branches, close those issues, run it again — the board holds the order.",
};
