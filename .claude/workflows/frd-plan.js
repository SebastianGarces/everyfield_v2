export const meta = {
  name: "frd-plan",
  description:
    "Plan an FRD into a parallel build: decompose, group into file-disjoint tracks, and schedule dependency waves. Pulls human-gated work (schema, high-risk) out as prerequisites. No code is written.",
  whenToUse:
    "Before implementing an FRD. Produces the wave plan you execute one wave at a time with frd-implement-wave. Pass the FRD path (or {frd, scope}) as args.",
  phases: [
    {
      title: "Decompose",
      detail:
        "Architect splits the FRD into work units with declared file ownership and dependencies",
    },
  ],
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const frdPath = typeof args === "string" ? args : args?.frd;
const scope = (typeof args === "object" && args?.scope) || "MVP";
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
        "HUMAN-GATED units: DB schema/migrations, auth, tenancy, payments. Agent-authorable, but they need approval and run first/alone — kept OUT of the parallel waves.",
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
- "dependsOn": logical ordering only (it does NOT force same-branch grouping).
- risk "high" = DB schema/migrations, auth/permissions, multi-tenant boundaries, payments → put in "deferred" (human-gated: agent can author, but it needs approval and runs first/alone). Consolidate ALL schema into one deferred unit (only one db:generate is allowed).
Return strictly the schema.`,
  { phase: "Decompose", agentType: "architect", schema: DECOMPOSE_SCHEMA }
);
if (!plan) throw new Error("Decomposition failed");

// ---------------------------------------------------------------------------
// Deterministic grouping: tracks (shared-file ONLY) + dependency waves
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

// Group into tracks by SHARED FILE ONLY (deps do NOT merge tracks — they schedule waves).
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
  })),
  files: [...new Set(units.flatMap((u) => (u.files || []).map(normFile)))],
  lane:
    [...new Set(units.map((u) => u.lane))].length === 1
      ? units[0].lane
      : "fullstack",
}));

// Track-level dependency graph (ignore gated deps — those are prerequisites, "wave 0/human").
const byId = new Map(implementable.map((u) => [u.id, u]));
const trackDeps = new Map(tracks.map((t) => [t.root, new Set()]));
for (const u of implementable) {
  for (const d of u.dependsOn || []) {
    if (gatedIds.has(d) || !byId.has(d)) continue;
    const from = trackOf.get(u.id),
      to = trackOf.get(d);
    if (from !== to) trackDeps.get(from).add(to);
  }
}
// Topological wave = longest dependency chain length.
const depthMemo = new Map();
function depth(root) {
  if (depthMemo.has(root)) return depthMemo.get(root);
  depthMemo.set(root, 0);
  let d = 0;
  for (const dep of trackDeps.get(root)) d = Math.max(d, 1 + depth(dep));
  depthMemo.set(root, d);
  return d;
}
const waveOf = new Map(tracks.map((t) => [t.root, depth(t.root)]));
const maxWave = Math.max(0, ...[...waveOf.values()]);
const waves = [];
for (let w = 0; w <= maxWave; w++)
  waves.push(tracks.filter((t) => waveOf.get(t.root) === w).map((t) => t.id));

log(
  `${implementable.length} units → ${tracks.length} file-disjoint tracks across ${waves.length} wave(s); ${gated.length} human-gated prerequisite(s)`
);
if (sharedFiles.length)
  log(
    `Shared-file tracks: ${sharedFiles.map((s) => s.file.split("/").pop()).join(", ")}`
  );

// ---------------------------------------------------------------------------
// Return the plan (no code written). Run each wave with frd-implement-wave.
// ---------------------------------------------------------------------------
return {
  frd: frdPath,
  scope,
  prerequisites: gated.map((g) => ({
    ...g,
    note: "Agent-authorable, but needs human approval and must land on the base branch BEFORE running wave 1.",
  })),
  tracks: tracks.map((t) => ({
    id: t.id,
    lane: t.lane,
    units: t.units,
    files: t.files,
  })),
  waves: waves.map((trackIds, i) => ({
    wave: i + 1,
    tracks: trackIds,
    units: tracks
      .filter((t) => trackIds.includes(t.id))
      .flatMap((t) => t.units),
  })),
  sharedFileClusters: sharedFiles,
  howToRun:
    "Land the prerequisites (approved) on a base branch. Then for each wave in order: run frd-implement-wave with args = that wave's `units` array; review and merge its branches into the base; proceed to the next wave.",
  decompositionNotes: plan.notes,
};
