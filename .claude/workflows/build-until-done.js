export const meta = {
  name: "build-until-done",
  description:
    "The loop. Per track: stages of parallel workstreams in their own worktrees, merged back stage by stage, then ONE code review, at most one fix round, and one ship pass that proves the branch works, opens the PR and anchors on CI. Exhaustion labels the issue agent:blocked with its evidence — never a silent stop, never an unproven PR.",
  whenToUse:
    "To build a wave of tracks autonomously to PR. args = the wave's units array (each {id,title,lane,files,summary,acceptanceCriteria,issue,risk,dependsOn,hold?}), or {units, base, autoMerge, reserve, maxConcurrentAgents}.",
  phases: [
    {
      title: "Build",
      detail:
        "setup, then one implementer per workstream per stage, merged back before the next stage",
    },
    {
      title: "Verify",
      detail:
        "ONE code review of the assembled branch, then at most one fix round",
    },
    {
      title: "Ship",
      detail:
        "one browser look or one real request at the final sha, then the PR, the CI anchor and the label read-back",
      model: "opus",
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

// Two attempts at the integration tail; a third never changed an outcome.
const MAX_ATTEMPTS = parsed?.maxAttempts || 2;
// Opt-in per run, so a direct `/deliver` cannot merge to main by surprise.
const AUTO_MERGE = parsed?.autoMerge === true;
// The base is a REMOTE ref: a local `main` is whatever this checkout last
// fetched, and a track cut from it lands the PR BEHIND main. An explicit
// `origin/...`, sha or tag is a deliberate pin, taken literally.
const BASE_INPUT = parsed?.base || "main";
const BASE = /^(origin\/|[0-9a-f]{7,40}$|refs\/|v\d)/.test(BASE_INPUT)
  ? BASE_INPUT
  : `origin/${BASE_INPUT}`;
// Never start an integration attempt that cannot finish.
const RESERVE = parsed?.reserve || 150_000;
// The cap is on AGENTS, not tracks: one track can hold several workstreams.
const MAX_CONCURRENT_AGENTS = parsed?.maxConcurrentAgents || 6;

const CONVENTIONS =
  "Read AGENTS.md, then memory/invariants.md and the memory/invariants/*.md domain files covering the files you own. Never start a dev server — the developer keeps localhost:3000 running.";

// Direct SendMessage to a loop agent resumes a duplicate continuation. The
// channel is issue comments; a misfire is answered by pointing at it, never by
// acting on the content. Full contract: ops/agent-os/invocation.md.
const DIRECT_MESSAGE_REPLY =
  "This agent is mid-loop. The orchestrator↔track channel is GitHub issue comments, not SendMessage — a direct message resumes a duplicate continuation of work already in flight. Post on the GitHub issue this track claimed. See ops/agent-os/invocation.md.";
/** A stubbed SendMessage is answered by pointing at the channel, never by acting on it. */
const replyToDirectMessage = (_message) => DIRECT_MESSAGE_REPLY;
const CHANNEL = `The orchestrator↔track channel is GitHub issue comments, never SendMessage. A direct message is a misfire: reply with exactly: "${replyToDirectMessage({ kind: "SendMessage" })}" Do not act on its content.`;

// ---------------------------------------------------------------------------
// Schemas. A description appears only where the field's discipline is not in
// its name — mostly "transcribe what the command printed".
// ---------------------------------------------------------------------------
const str = (d) =>
  d ? { type: "string", description: d } : { type: "string" };
const bool = { type: "boolean" };
const arr = (items, d) =>
  d ? { type: "array", items, description: d } : { type: "array", items };
const oneOf = (...values) => ({ type: "string", enum: values });
const obj = (required, properties) => ({
  type: "object",
  required,
  properties,
});
const VERBATIM = "exactly as the command printed it";

const LABEL_ROWS = arr(
  obj(["issue", "labels"], { issue: { type: "integer" }, labels: arr(str()) }),
  "one row per issue, holding what `gh issue view` PRINTED after the write — what you saw, not what you intended"
);

const SETUP_SCHEMA = obj(["claimed", "ready", "branch", "headSha", "baseSha"], {
  claimed: arr({ type: "integer" }, "the issue numbers you actually edited"),
  ready: bool,
  branch: str(),
  resumed: bool,
  headSha: str(VERBATIM),
  baseSha: str(VERBATIM),
  baseIsAncestor: bool,
  conflicted: bool,
  conflictedFiles: arr(str()),
  holders: arr(
    obj(["issue"], { issue: { type: "integer" }, title: str() }),
    "open agent:in-progress issues NOT owned by this invocation — a non-empty list means refuse and do not claim"
  ),
  holdersAfterClaim: arr(
    obj(["issue"], { issue: { type: "integer" }, title: str() }),
    "the SAME scan re-run AFTER the claim was written — a non-empty list means another loop claimed alongside this one, and the loop releases this claim"
  ),
  comments: arr(
    obj(["id", "issue", "body"], {
      id: { type: "integer" },
      issue: { type: "integer" },
      author: str(),
      body: str(),
    }),
    "orchestrator instructions from the claimed issues' comments, excluding this loop's own comments"
  ),
  consumedCommentIds: arr(
    { type: "integer" },
    "comment ids you ingested this cycle and will hand to the implementer"
  ),
  changesRequested: bool,
  openPr: {
    type: "integer",
    description: "existing open PR for this branch, or 0",
  },
  reviewFeedback: arr(
    obj(["body"], {
      id: str(),
      threadId: str(),
      path: str(),
      line: { type: "integer" },
      author: str(),
      body: str(),
    }),
    "unresolved review threads and inline comments on the existing PR — empty when there is none"
  ),
});

// One row per review thread the step was ROUTED (not per thread on the PR):
// each thread is answered in exactly one place, and every place answers all of
// the threads it was given.
const THREAD_REPLIES = arr(
  obj(["threadId", "replied", "body"], {
    threadId: str(),
    replied: bool,
    actioned: bool,
    body: str(
      "what changed, or not actioned and why — never silently drop a thread"
    ),
  }),
  "one row per review thread you were given; silence is not a reply"
);

const IMPL_SCHEMA = obj(["committed", "filesChanged", "summary", "commits"], {
  committed: bool,
  filesChanged: arr(str()),
  summary: str(),
  commits: arr(str(), "`git log --format=%H -n <count>`, " + VERBATIM),
  deviations: str(
    "files touched outside the declared set. An undeclared src/db/migrations/ path is NEVER justifiable — the loop blocks it."
  ),
  consumedCommentIds: arr(
    { type: "integer" },
    "inbox comment ids you acted on (or explicitly declined) this pass"
  ),
  threadReplies: THREAD_REPLIES,
});

const INTEGRATE_SCHEMA = obj(["merged", "conflicts"], {
  merged: arr(str()),
  conflicts: arr(str(), "branches that would not merge cleanly, and why"),
});

// The one code review. `warnings` and `findings` are different questions, not
// severities: a warning asks what SHOULD have been built (the reviewer rules on
// it, and escalates only what it may not rule on); a finding is decidable from
// the codebase alone and is fixed in this pass.
const REVIEW_SCHEMA = obj(["verdict", "acceptanceCriteria", "summary"], {
  verdict: oneOf("PASS", "PASS_WITH_WARNINGS", "FAIL"),
  headSha: str(VERBATIM),
  remoteSha: str(VERBATIM),
  acceptanceCriteria: arr(
    obj(["ac", "status", "evidence"], {
      ac: str(),
      status: oneOf("PASS", "FAIL"),
      evidence: str(),
    })
  ),
  warnings: arr(
    obj(["kind", "summary"], {
      kind: oneOf("ruling", "spec-question"),
      summary: str(),
      detail: str(
        "a ruling: what you decided and which source decided it. A spec-question: the decision and its options."
      ),
      files: arr(str()),
    })
  ),
  findings: arr(
    obj(["severity", "summary", "remedy"], {
      severity: oneOf("critical", "structural", "suggestion"),
      summary: str(),
      detail: str("exact files, lines, defect"),
      files: arr(str()),
      remedy: str('what "fixed" looks like'),
    })
  ),
  failingGate: str(),
  summary: str(),
});

// A fix that cannot say what it did about each item is a change, not a fix — so
// it is refused, and an unanswered finding holds the PR as a decision.
const FIX_PROPS = {
  committed: bool,
  filesChanged: arr(str()),
  summary: str(),
  perFinding: arr(
    obj(["finding", "fixed", "addressed"], {
      finding: str("restated in your own words"),
      fixed: {
        type: "boolean",
        description:
          "true ONLY if the item is gone. Declining it is `false`, and false sends it to the PR as a decision — which is the point.",
      },
      addressed: str(
        "what you changed so it is gone and the output proving it — or a plain 'not addressed, here is why'"
      ),
    }),
    "one row per item you were given, in the order given"
  ),
};
const FIX_REQUIRED = ["committed", "filesChanged", "summary", "perFinding"];
const FIX_SCHEMA = obj(FIX_REQUIRED, FIX_PROPS);

// Fixing a NAMED gate failure carries the two fields the retry contract always
// had: restate the cause, and say what you did about it.
const GATE_FIX_SCHEMA = obj(
  [...FIX_REQUIRED, "rootCause", "rootCauseAddressed"],
  {
    ...FIX_PROPS,
    rootCause: str(
      "the cause the reviewer NAMED, in your own words — the defect, not the symptom or the gate id"
    ),
    rootCauseAddressed: str(
      "what you changed, and the output proving that cause is gone"
    ),
  }
);

const SHIP_SCHEMA = obj(
  ["works", "opened", "url", "checkConclusion", "labels"],
  {
    headSha: str(VERBATIM),
    remoteSha: str(VERBATIM),
    works: obj(["status", "evidence"], {
      status: oneOf("PASS", "FAIL"),
      evidence: str("per criterion: what you asserted, what you observed"),
      screenshots: arr(str()),
      judgement: str("what you thought of the layout, hierarchy and copy"),
    }),
    opened: bool,
    url: str(),
    reason: str("if no PR, why"),
    // The anchor: everything else here is an agent's account of its own work,
    // and this is the one field a model cannot talk its way past.
    checkConclusion: {
      ...oneOf("success", "failure", "timed_out", "none"),
      description: "from `gh pr checks` — GitHub's word, not your opinion",
    },
    checkSummary: str("if not success: the failing step and the error excerpt"),
    // The body is evidence too, so it is checked like evidence: a table still
    // reading "anchoring", or citing an ancestor sha, is a green PR describing
    // a commit nobody reviewed.
    bodySha: str(
      "the sha the body's CI row cites AFTER the back-fill, " + VERBATIM
    ),
    prHeadSha: str("`gh pr view <n> --json headRefOid`, " + VERBATIM),
    // Track-level review threads — the ones no workstream's declared files
    // own. Ship is the only step that holds the whole diff, so it is the one
    // place they can be answered.
    threadReplies: THREAD_REPLIES,
    // The migration rider, reported rather than remembered. `touched` comes
    // from the diff, never from the declared file list.
    migration: obj(["touched"], {
      touched: bool,
      ddl: str("the DDL delta you pasted into the body"),
      applyTranscript: str(
        "what the scratch DB printed applying it, " + VERBATIM
      ),
      rollbackTranscript: str(
        "what the scratch DB printed rolling it back, " + VERBATIM
      ),
    }),
    labels: LABEL_ROWS,
    mergeState: {
      ...oneOf(
        "merged",
        "queued-for-auto-merge",
        "refused",
        "failed",
        "not-attempted"
      ),
      description: "what GitHub reported, not what was attempted",
    },
  }
);

const EXIT_SCHEMA = obj(["commented", "observed"], {
  commented: bool,
  observed: LABEL_ROWS,
});

// ---------------------------------------------------------------------------
// Grouping, in two layers. A TRACK is a connected component over (shared file ∪
// dependsOn): one branch, one worktree, one PR. Inside it, STAGES are the
// topological levels of dependsOn, and the file-overlap DSU runs again within
// each stage — overlap inside a stage forces one agent, overlap across stages
// is free because a later stage starts from the earlier one's commit.
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

/** Group `us` into file-disjoint clusters. Shared file => same cluster. */
function clusterByFile(us) {
  const dsu = makeDSU(us.map((u) => u.id));
  const owners = new Map();
  for (const u of us)
    for (const raw of u.files || []) {
      const f = normFile(raw);
      if (!owners.has(f)) owners.set(f, []);
      owners.get(f).push(u.id);
    }
  for (const [, o] of owners)
    if (o.length > 1) for (let i = 1; i < o.length; i++) dsu.union(o[0], o[i]);
  const groups = new Map();
  for (const u of us) {
    const r = dsu.find(u.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(u);
  }
  return [...groups.values()];
}

// The machine that decides what merges keeps a human: a diff touching it never
// auto-merges, whether or not the caller remembered to declare it.
const FACTORY_PATH = /^(\.claude\/(workflows|skills)|\.cursor|ops\/agent-os)\//;

// G5: a migration outside a track that did not declare db/ is blocking. `db/`
// in a declared path (src/db/schema/..., src/db/migrations/..., db/...) is the
// declaration; a file named src/lib/db.ts is not.
const MIGRATION_PATH = /(^|\/)src\/db\/migrations\//;
const DB_DECLARED = /(^|\/)(src\/)?db(\/|$)/;

const declaresDb = (files) =>
  (files || []).some((f) => DB_DECLARED.test(normFile(f)));

const undeclaredMigrations = (changed, declared) =>
  declaresDb(declared)
    ? []
    : (changed || []).map(normFile).filter((f) => MIGRATION_PATH.test(f));

const schemaFenceReason = (migrations) =>
  `G5: undeclared migration(s) ${migrations.join(", ")} — db/ is not in this track's declared files. Halt and re-declare src/db/migrations/ (and the schema it applies) on the workstream; do NOT delete the migration.`;

/** Threads from reviewFeedback that have no threadReplies row with a non-empty body. */
const unansweredReviewThreads = (feedback, replies) => {
  const threads = [
    ...new Set(
      (feedback || [])
        .map((f) => String(f.threadId || f.id || "").trim())
        .filter(Boolean)
    ),
  ];
  const rows = replies || [];
  return threads.filter((id) => {
    const row = rows.find((r) => String(r.threadId || "").trim() === id);
    return !row || !String(row.body || "").trim();
  });
};

/** True when `p` is a declared file, or sits under a declared directory. */
const pathUnderDeclared = (p, files) => {
  const target = normFile(p);
  if (!target) return false;
  return (files || []).some((f) => {
    const declared = normFile(f).replace(/\/+$/, "");
    return (
      declared && (target === declared || target.startsWith(`${declared}/`))
    );
  });
};

/**
 * Route each review thread to exactly ONE place that answers it. A thread on a
 * path a workstream declared is that workstream's; a thread with no path, or a
 * path no workstream owns, is the track's and ship answers it once.
 *
 * The alternative — handing every thread to every workstream — is wrong in both
 * directions at once: each workstream either posts a duplicate reply on a thread
 * about someone else's files, or correctly declines it and is then false-blocked
 * by `unansweredReviewThreads` for not covering it. Routing keeps "silence is
 * not a reply" while making exactly one place accountable for each thread.
 */
const routeReviewThreads = (feedback, workstreams) => {
  const rows = feedback || [];
  const wss = workstreams || [];
  const byWorkstream = new Map(wss.map((ws) => [ws.id, []]));
  // One workstream IS the track: there is no second place a thread could go, so
  // routing would only invent a seam. It owns every thread, as it always did.
  if (wss.length < 2) {
    if (wss.length) byWorkstream.set(wss[0].id, [...rows]);
    return { byWorkstream, trackLevel: wss.length ? [] : [...rows] };
  }
  const trackLevel = [];
  for (const f of rows) {
    const owner = f?.path
      ? wss.find((ws) => pathUnderDeclared(f.path, ws.files))
      : null;
    (owner ? byWorkstream.get(owner.id) : trackLevel).push(f);
  }
  return { byWorkstream, trackLevel };
};

const summarise = (us, extra = {}) => {
  const files = [...new Set(us.flatMap((u) => (u.files || []).map(normFile)))];
  return {
    units: us,
    issues: [...new Set(us.map((u) => u.issue).filter((x) => x != null))],
    files,
    risk: us.some((u) => u.risk === "high") ? "high" : us[0].risk || "low",
    // One-way: a unit can only make its track MORE held — either the caller
    // declared it or the paths did.
    hold: us.some((u) => u.hold === true) || files.some((f) => FACTORY_PATH.test(f)), // prettier-ignore
    lane:
      [...new Set(us.map((u) => u.lane))].length === 1
        ? us[0].lane
        : "fullstack",
    ...extra,
  };
};

const trackDsu = makeDSU(units.map((u) => u.id));
const byUnitId = new Map(units.map((u) => [u.id, u]));
{
  const owners = new Map();
  for (const u of units)
    for (const raw of u.files || []) {
      const f = normFile(raw);
      if (!owners.has(f)) owners.set(f, []);
      owners.get(f).push(u.id);
    }
  for (const [, o] of owners)
    if (o.length > 1)
      for (let i = 1; i < o.length; i++) trackDsu.union(o[0], o[i]);
  for (const u of units)
    for (const d of u.dependsOn || [])
      if (byUnitId.has(d)) trackDsu.union(u.id, d);
}
const trackGroups = new Map();
for (const u of units) {
  const r = trackDsu.find(u.id);
  if (!trackGroups.has(r)) trackGroups.set(r, []);
  trackGroups.get(r).push(u);
}

/** Stages within a track. A cycle would deadlock it, so it throws at plan time. */
function planStages(trackUnits, trackId) {
  const ids = new Set(trackUnits.map((u) => u.id));
  const depsOf = (u) => (u.dependsOn || []).filter((d) => ids.has(d));
  const level = new Map();
  const visiting = new Set();
  const depth = (id) => {
    if (level.has(id)) return level.get(id);
    if (visiting.has(id))
      throw new Error(
        `dependsOn cycle inside track "${trackId}" at unit "${id}". ` +
          `A cycle can never reach a stage — fix the decomposition.`
      );
    visiting.add(id);
    let d = 0;
    for (const p of depsOf(byUnitId.get(id))) d = Math.max(d, 1 + depth(p));
    visiting.delete(id);
    level.set(id, d);
    return d;
  };
  for (const u of trackUnits) depth(u.id);

  const maxLevel = Math.max(...trackUnits.map((u) => level.get(u.id)));
  const stages = [];
  for (let l = 0; l <= maxLevel; l++) {
    const inLevel = trackUnits.filter((u) => level.get(u.id) === l);
    if (!inLevel.length) continue;
    stages.push(
      clusterByFile(inLevel).map((us, i) =>
        summarise(us, { id: `${trackId}-s${stages.length}w${i + 1}` })
      )
    );
  }
  return stages;
}

const tracks = [...trackGroups.values()].map((us) => {
  const id = us[0].id;
  return summarise(us, { id, stages: planStages(us, id) });
});

log(
  `${units.length} unit(s) → ${tracks.length} track(s), ` +
    `${tracks.reduce((n, t) => n + t.stages.reduce((m, s) => m + s.length, 0), 0)} workstream(s); ` +
    `max ${MAX_ATTEMPTS} integration attempt(s) per track; ≤${MAX_CONCURRENT_AGENTS} agents at once.`
);
for (const t of tracks)
  if (t.stages.length > 1 || t.stages[0].length > 1)
    log(
      `   ${t.id}: ${t.stages.map((s, i) => `stage ${i} × ${s.length}`).join(" → ")}`
    );

// Issues this invocation owns — a live agent:in-progress on any other number
// is a foreign loop and setup must refuse rather than claim.
const PASS_ISSUES = [
  ...new Set(units.map((u) => u.issue).filter((x) => x != null)),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const hashes = (issues) => issues.map((n) => `#${n}`).join(", ");

const unitBlocks = (holder) =>
  holder.units
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

const allCriteria = (holder) =>
  holder.units
    .map((u) => (u.acceptanceCriteria || []).map((a) => `  - ${a}`).join("\n"))
    .join("\n");

const actionableFindings = (findings) =>
  (findings || []).filter(
    (f) => f?.severity === "critical" || f?.severity === "structural"
  );

/** Which of `issues` do NOT demonstrably read `target`. A missing row counts. */
const labelViolations = (issues, observed, target) =>
  (issues || []).filter((n) => {
    const row = (observed || []).find((o) => Number(o?.issue) === Number(n));
    const labels = row?.labels || [];
    return (
      !row || !labels.includes(target) || labels.includes("agent:in-progress")
    );
  });

/** The failing evidence, VERBATIM — a paraphrase is where a named cause dies. */
function evidenceBlock(report) {
  if (!report) return "(nothing was returned at all)";
  const lines = report.failingGate ? [`FAILING: ${report.failingGate}`] : [];
  for (const a of (report.acceptanceCriteria || []).filter(
    (x) => x?.status === "FAIL"
  ))
    lines.push(`--- failed AC: ${a.ac} ---\n${a.evidence}`);
  if (report.summary) lines.push(`--- evidence ---\n${report.summary}`);
  return lines.length
    ? lines.join("\n\n")
    : "(a failure with no evidence attached — say so, and fix the missing evidence first)";
}

/** The reviewer's findings, VERBATIM, for the fixer and the PR comment. */
const findingsBlock = (findings) =>
  (findings || [])
    .map(
      (f, i) =>
        `--- finding ${i + 1} [${f.severity}] ---\n${f.summary}\n${f.detail || "(no further detail)"}\n` +
        `Files: ${(f.files || []).join(", ") || "(none named)"}\n` +
        `What "fixed" looks like: ${f.remedy || "(not stated)"}`
    )
    .join("\n\n") || "(no findings)";

/**
 * What a stopped track leaves behind. A merged track removes its own trees; a
 * held or blocked one hands the list over, because those trees are the only
 * place the work exists in a re-runnable form.
 */
function survivingTrees(track, branch, wt) {
  const trees = [
    {
      path: wt,
      branch,
      holds: `the track branch for issue(s) ${hashes(track.issues)}`,
    },
  ];
  for (const stage of track.stages || [])
    for (const ws of stage)
      if (ws.wt && ws.wt !== wt)
        trees.push({
          path: ws.wt,
          branch: ws.branch,
          holds: `workstream ${ws.id} — ${(ws.files || []).join(", ") || "no declared files"}`,
        });
  return trees;
}

const treeLines = (trees) =>
  (trees || [])
    .map((t) => `  - \`${t.path}\` on \`${t.branch}\` — ${t.holds}`)
    .join("\n") || "  (none)";

const inboxBlock = (comments) =>
  (comments || []).length
    ? `Orchestrator instructions from the issue's comments (the channel — not SendMessage). Consume each and report its id in \`consumedCommentIds\`:\n${(
        comments || []
      )
        .map(
          (c) =>
            `--- comment ${c.id} on #${c.issue} (${c.author || "unknown"}) ---\n${c.body}`
        )
        .join("\n\n")}`
    : "";

const reviewFeedbackBlock = (feedback) =>
  (feedback || []).length
    ? `This is a changes-requested re-entry. Review threads and inline comments on the existing PR — each must be replied to on GitHub (what changed, or not actioned and why). Report every row in \`threadReplies\`. Silence is not a reply:\n${(
        feedback || []
      )
        .map(
          (f) =>
            `--- ${f.threadId || f.id} ${f.path ? `${f.path}:${f.line || ""}` : ""} (${f.author || "reviewer"}) ---\n${f.body}`
        )
        .join("\n\n")}`
    : "";

/**
 * `parallel()` with a ceiling. Chunking is enough, because both callers are
 * barriers: a stage waits for its workstreams, a chunk of tracks for its tracks.
 */
async function boundedParallel(thunks, limit = MAX_CONCURRENT_AGENTS) {
  const out = [];
  for (let i = 0; i < thunks.length; i += limit)
    out.push(...(await parallel(thunks.slice(i, i + limit))));
  return out;
}

// ---------------------------------------------------------------------------
// exit — the only failure exit, and every non-shipped outcome takes it. One
// agent comments the verbatim evidence AND writes the label AND reads it back.
// The labels stay distinct: they send the human to a failing gate, to a retry
// of work that already passed, or to a board that disagrees with a green PR.
// ---------------------------------------------------------------------------
// kind → [label, result status, the sentence that tells the human what to do].
const EXIT = {
  blocked: ["agent:blocked", "blocked", "The work did not reach the Definition of Done. The human needs the failing gate and its evidence, then a decision: tighten the spec, raise the budget, or take it manually."], // prettier-ignore
  "delivery-failed": ["agent:delivery-failed", "pr-failed", "Every gate PASSED and only the delivery step failed: say plainly that the human should retry the delivery (push the branch, open the PR) and must NOT re-review or rebuild code that already passed."], // prettier-ignore
  errored: ["agent:in-review", "errored", "The PR is open and its check is green — only the board write did not stick. Name the PR, say that nothing needs rebuilding or re-reviewing, and set the label the ship pass could not confirm."], // prettier-ignore
  refused: ["agent:queued", "refused", "This invocation must not run: another loop already holds a claim. Revert ONLY issues this invocation actually claimed (the claimed list it wrote to agent:in-progress) to agent:queued — never agent:blocked, and never an issue it did not claim. If claimed is empty, do not retouch labels. Name the holder. Do not build."], // prettier-ignore
};

async function exitTrack(
  track,
  kind,
  { reason, report = null, trees = [], claimed = null }
) {
  const [label, status, brief] = EXIT[kind];
  log(`⛔ ${track.id} ${kind}: ${reason}`);
  const claimedIssues = (claimed || []).map(Number).filter(Boolean);
  // On refused, only rewrite labels this invocation actually wrote. An empty
  // claimed list means serialize refused before any edit — leave the board.
  const labelTargets = kind === "refused" ? claimedIssues : track.issues;
  const labelInstructions =
    kind === "refused" && labelTargets.length === 0
      ? `Do NOT run \`gh issue edit\`. This invocation claimed nothing, so it must not retouch labels — an issue still on \`agent:changes-requested\` or \`agent:queued\` stays there. Do not rewrite it to queued. Comment to name the holder. Report \`observed: []\`.`
      : `Then label ${kind === "refused" ? `ONLY the issue(s) this invocation actually claimed (${hashes(labelTargets)}) — never a number it did not write to agent:in-progress` : "it"} and prove it: \`gh issue edit n --add-label ${label} --remove-label agent:in-progress\`, dropping any other \`agent:*\` it carries. Read back with \`gh issue view n --json labels --jq '[.labels[].name]'\` and report EXACTLY what that printed — an issue still reading agent:in-progress is the board lying about this track.`;
  const done = await agent(
    `A build loop for issue(s) ${hashes(track.issues)} stopped. Reason: ${reason}.

${brief}

The evidence, verbatim — put it in the comment as-is:
\`\`\`
${evidenceBlock(report)}
\`\`\`

For EACH issue, \`gh issue comment <n>\` with that reason, that evidence, what to do next, and a **Surviving worktrees** section listing these — they hold the only copy of this work, they are the reader's now (\`git worktree remove <path>\` when done), and you remove none of them:
${treeLines(trees)}

${labelInstructions} Do NOT open a PR. Return strictly the schema.`,
    {
      label: `exit:${track.id}`,
      phase: "Ship",
      model: "haiku",
      effort: "low",
      schema: EXIT_SCHEMA,
    }
  );

  const missing = labelTargets.length
    ? labelViolations(labelTargets, done?.observed, label)
    : [];
  if (missing.length)
    log(
      `🚨 ${track.id}: issue(s) ${missing.join(", ")} do not read ${label} — fix by hand.`
    );
  return {
    track,
    status,
    reason,
    lastReport: report,
    labelSettled: missing.length === 0,
    survivingTrees: trees,
  };
}

// ---------------------------------------------------------------------------
// setup — serialize, claim, cut, provision env, read inbox. One cheap agent.
// ---------------------------------------------------------------------------
// The holder scan, in the ONE form `ops/agent-os/labels.md` declares
// load-bearing: `--paginate` and never a bare limit (`gh issue list` caps at 30
// and answers silently from a window over the newest issues, so a holder
// outside the window reads as an empty board and two loops run at once), plus
// `select(.pull_request == null)`, because that REST endpoint returns pull
// requests alongside issues.
const HOLDER_SCAN = `gh api --paginate "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/issues?labels=agent:in-progress&state=open&per_page=100" --jq '.[] | select(.pull_request == null) | {issue: .number, title: .title}'`;

async function setupTrack(track, branch, wt, passIssues) {
  const owned = (passIssues || track.issues).join(", ") || "(none)";
  const ready = await agent(
    `Claim this track's issues and prepare its build tree. ${CHANNEL} Run exactly this, in order, and write no code.

1. **SERIALIZE.** \`${HOLDER_SCAN}\`. Run it in exactly that form — \`--paginate\`, never a bare-limit issue listing, which caps at 30 and answers silently from a window over the newest issues, so a holder outside the window reads as an empty board (\`ops/agent-os/labels.md\`). Holders are rows whose \`issue\` is NOT one of this invocation's issues (${owned}). If any holders exist: do NOT edit any labels, return \`ready: false\`, \`claimed: []\`, and the holders. Launching a second loop while another holds a claim is forbidden.
2. Label EXACTLY these issues and no others: ${track.issues.join(", ") || "(none)"}
   For each number n: \`gh issue edit n --remove-label agent:queued --remove-label agent:changes-requested --add-label agent:in-progress\`. Drop whichever status label it currently carries. Do NOT run \`gh issue list\`, \`gh search\`, or anything else that enumerates issues by label to decide what to edit — the list above is the complete and only input. The number of issues you edit must be exactly ${track.issues.length}. Report them in \`claimed\`. If the issue carried \`agent:changes-requested\`, set \`changesRequested: true\`.
3. **RE-CHECK THE CLAIM.** Step 1 read the board BEFORE step 2 wrote your claim, so two loops launched together both saw it empty and both claimed. Run \`${HOLDER_SCAN}\` AGAIN, apply the same filter (rows whose \`issue\` is not one of ${owned}), and report the result in \`holdersAfterClaim\` — an empty list when you are the only claimant. If it is non-empty, STOP: run no further step, cut no worktree, and let the loop release the claim you just wrote. Do not release it yourself.
4. \`git fetch origin --prune\` — an unfetched \`${BASE}\` is whatever this checkout last saw.
5. \`git rev-parse --verify --quiet refs/heads/${branch}\` picks the path:
   - **no such branch → FRESH**: \`scripts/worktree-add.sh -b ${branch} ${wt} ${BASE}\`, never from a local branch of the same name. Report \`resumed: false\`.
   - **it exists → RESUME**: a held, blocked, or changes-requested track kept this branch on purpose — do not re-cut, reset or delete anything. Re-attach the tree if it is gone (\`scripts/worktree-add.sh ${wt} ${branch}\`, no \`-b\`), then \`git -C ${wt} merge --no-edit ${BASE}\`. If that conflicts, do NOT resolve it: capture \`git -C ${wt} diff --name-only --diff-filter=U\`, \`git -C ${wt} merge --abort\`, and return \`ready: false\`, \`conflicted: true\` and those paths. Report \`resumed: true\`. A changes-requested re-entry ALWAYS resumes; never open a second branch.
6. If \`.env.local\` is missing, \`scripts/worktree-env.sh ${wt}\` (idempotent). A tree with no env fails every DB suite.
7. **INBOX.** For each claimed issue, \`gh api repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/issues/<n>/comments --jq '.[] | {id, issue: <n>, author: .user.login, body}'\`. Return orchestrator instructions (not this loop's own comments) in \`comments\` and their ids in \`consumedCommentIds\`. This is the defined point the loop reads the channel.
8. **REVIEW THREADS.** \`gh pr list --head ${branch} --state open --json number --jq '.[0].number'\`. If a PR exists, set \`openPr\` to that number and fetch unresolved review threads plus inline comments (\`gh api\` pulls comments and GraphQL \`reviewThreads\`). Return them in \`reviewFeedback\`. A changes-requested re-entry has no input without this. If none, \`openPr: 0\` and \`reviewFeedback: []\`.

Then report VERBATIM what each printed: \`git -C ${wt} rev-parse --abbrev-ref HEAD\` → \`branch\`; \`git -C ${wt} rev-parse HEAD\` → \`headSha\`; \`git rev-parse ${BASE}\` → \`baseSha\`; \`git -C ${wt} merge-base --is-ancestor ${BASE} HEAD && echo yes || echo no\` → \`baseIsAncestor\`. The loop checks these rather than trusting you: a FRESH cut has headSha == baseSha, a RESUME has baseIsAncestor true, and nothing is built on a base behind ${BASE}. Return strictly the schema.`,
    {
      label: `setup:${track.id}`,
      phase: "Build",
      model: "haiku",
      effort: "low",
      schema: SETUP_SCHEMA,
    }
  );

  const claimed = (ready?.claimed || []).map(Number);
  const holders = ready?.holders || [];
  if (holders.length)
    return {
      ok: false,
      refused: true,
      claimed,
      reason: `refused: another loop holds ${holders.map((h) => `#${h.issue}${h.title ? ` (${h.title})` : ""}`).join(", ")}. Never launch a build-until-done while another holds a claim.`,
    };

  // Step 1 reads and step 2 writes, so the serialize gate is check-then-claim:
  // two loops launched together both read an empty board and both claim. Step 3
  // re-reads AFTER the write, which is the first moment a second claimant is
  // visible, and this loop then gives back exactly what it took — `claimed`
  // goes to the refused exit, which reverts only those issues to agent:queued.
  //
  // Residual, accepted: in a dead heat BOTH loops see each other and BOTH back
  // off, so the pass builds nothing. That is fail-safe rather than
  // fail-dangerous — a pass nobody ran is one re-dispatch, while two loops on
  // one branch and one claim is corrupted work — and it is recorded in
  // `ops/agent-os/workflow.md` § Serialized invocation.
  const raceHolders = ready?.holdersAfterClaim || [];
  if (raceHolders.length)
    return {
      ok: false,
      refused: true,
      claimed,
      reason: `refused: the claim raced — after this invocation wrote its claim, ${raceHolders.map((h) => `#${h.issue}${h.title ? ` (${h.title})` : ""}`).join(", ")} also held agent:in-progress. Releasing only the claim this invocation wrote (${claimed.join(", ") || "none"}); nothing was built. Both loops backing off is the accepted outcome — re-dispatch this track.`,
    };

  const strays = claimed.filter((n) => !track.issues.includes(n));
  // A throw here would vanish the track into the fan-in hole — and the claim it
  // just wrote would go unanswered. It stops as a blocked exit instead.
  if (strays.length || claimed.length !== track.issues.length)
    return {
      ok: false,
      reason:
        `setup claimed ${claimed.length} issue(s) (${claimed.join(", ") || "none"}) for a track that owns exactly ${track.issues.length} (${track.issues.join(", ") || "none"})` +
        `${strays.length ? `; ${strays.join(", ")} belong to no one here` : ""}. Nothing was built against a corrupted board — revert the strays to agent:queued and re-run.`,
    };

  if (ready?.conflicted === true)
    return {
      ok: false,
      reason: `${branch} carries preserved work and ${BASE} does not merge into it cleanly — conflicts in ${(ready.conflictedFiles || []).join(", ") || "(none reported)"}. The merge was ABORTED, so nothing was discarded. Resolve it by hand with \`.claude/skills/resolving-merge-conflicts/SKILL.md\` in ${wt}, then re-run.`,
    };
  if (ready?.ready !== true || ready.branch !== branch)
    return { ok: false, reason: `the worktree ${wt} is not on ${branch}` };

  const head = String(ready.headSha || "").trim();
  const base = String(ready.baseSha || "").trim();
  if (!head || !base)
    return {
      ok: false,
      reason: `setup did not report both shas — an unverifiable base is treated as a stale one`,
    };
  if (ready.resumed === true && ready.baseIsAncestor !== true)
    return {
      ok: false,
      reason: `${branch} was resumed at ${head} but ${BASE} (${base}) is NOT an ancestor — it is missing commits already on main. Merge ${BASE} into it in ${wt} and re-run; do not delete the branch or the worktree.`,
    };
  if (ready.resumed !== true && head !== base)
    return {
      ok: false,
      reason: `${branch} was cut from ${head} but ${BASE} is at ${base} — a stale base builds against files that already changed and lands the PR BEHIND main.`,
    };
  return {
    ok: true,
    comments: ready.comments || [],
    consumedCommentIds: ready.consumedCommentIds || [],
    reviewFeedback: ready.reviewFeedback || [],
    openPr: ready.openPr || 0,
    changesRequested: ready.changesRequested === true,
  };
}

// ---------------------------------------------------------------------------
// implement — one agent per workstream, one pass. The only build strategy.
// ---------------------------------------------------------------------------
async function implementWorkstream(ws, trackBranch, declaredFiles, inbox = {}) {
  const { branch, wt } = ws;
  const comments = inbox.comments || [];
  // Only THIS workstream's threads: the ones whose path its declared files own.
  // Everything else is another workstream's or the track's, and answering it
  // here is either a duplicate reply or a decline that false-blocks the ship.
  const feedback = inbox.routedFeedback?.get(ws.id) || [];
  const reentry =
    inbox.changesRequested === true || Number(inbox.openPr) > 0
      ? `This is a re-entry on existing PR #${inbox.openPr || "?"}. Push to ${branch} and update that PR; never open a second. The full DoD still runs — a human asking for a change does not lower the bar.`
      : "";
  const impl = await agent(
    `You are a ${ws.lane} engineer. ${CONVENTIONS} ${CHANNEL}

${
  ws.solo
    ? `Work in the existing worktree ${wt}, already on ${branch}. If \`.env.local\` is missing, run \`scripts/worktree-env.sh ${wt}\` (idempotent). A fresh worktree still has no \`node_modules\`: run \`pnpm install\` in ${wt} before typecheck or tests.`
    : `First cut your tree — one command, which adds the worktree AND links its env — then install deps. These are numbered steps, not optional:
1. \`scripts/worktree-add.sh -b ${branch} ${wt} ${trackBranch}\` — from the TRACK branch, never from ${BASE}, because it already carries every earlier stage's commits. If the branch survives an earlier run, re-attach instead (no \`-b\`) without resetting it.
2. If \`.env.local\` is missing, \`scripts/worktree-env.sh ${wt}\` (idempotent).
3. \`pnpm install\` in ${wt} — a fresh worktree has no \`node_modules\`; env alone does not make \`pnpm test\` run.
Then work there.`
}

${reentry}

You own ONE workstream of a larger track. Implement exactly the unit(s) below and nothing else — other agents are writing other workstreams in parallel, and every file outside your declared list may be theirs.

${unitBlocks(ws)}

Your declared files — stay inside them:
${(ws.files || []).map((f) => `  - ${f}`).join("\n") || "  (none declared)"}
A new file under \`src/db/migrations/\` when \`db/\` is not in that list is a blocking G5 halt: re-declare the migration (do not delete it).

${inboxBlock(comments)}
${reviewFeedbackBlock(feedback)}
Fill \`threadReplies\` for every review thread you were given — those below and no others. Threads on files you do not own were routed to the workstream that owns them, or to the ship pass; do not reply to a thread you were not given. Reply on the GitHub thread itself. Feedback you choose not to action still gets a reply naming the reason — never drop it silently.

Write code AND tests. Run \`pnpm typecheck\` and \`pnpm lint\` in ${wt}. Commit to ${branch} (conventional commits) and report every commit sha. Do NOT push, open a PR, edit labels or issues, or merge — the loop integrates, reviews and ships. Return strictly the schema.`,
    {
      label: `impl:${ws.id}`,
      phase: "Build",
      agentType: ws.lane === "backend" ? "backend" : "frontend",
      model: "opus",
      schema: IMPL_SCHEMA,
    }
  );

  if (!impl || !(impl.commits || []).length)
    return {
      ok: false,
      ws,
      branch,
      reason: `${ws.id}: the implementer ${!impl ? "returned nothing" : "committed nothing"}`,
    };
  const migrations = undeclaredMigrations(impl.filesChanged, declaredFiles);
  if (migrations.length)
    return {
      ok: false,
      ws,
      branch,
      reason: `${ws.id}: ${schemaFenceReason(migrations)}`,
    };
  const unanswered = unansweredReviewThreads(feedback, impl.threadReplies);
  if (unanswered.length)
    return {
      ok: false,
      ws,
      branch,
      reason: `${ws.id}: review thread(s) ${unanswered.join(", ")} have no threadReplies row with a non-empty body — silence is not a reply.`,
    };
  return {
    ok: true,
    ws,
    branch,
    wt,
    summary: impl.summary || "",
    consumedCommentIds:
      impl.consumedCommentIds || inbox.consumedCommentIds || [],
    threadReplies: impl.threadReplies || [],
  };
}

/** One stage: its workstreams in parallel, then merged back onto the track. */
async function runStage(track, stage, stageIndex, trackBranch, trackWt, inbox) {
  const solo = stage.length === 1;
  log(
    `🔨 ${track.id} stage ${stageIndex}: ${stage.length} workstream(s)${solo ? "" : " in parallel"}`
  );
  for (const ws of stage) {
    ws.solo = solo;
    // Named up front, not on success: a workstream that dies still leaves a
    // tree, and the exit comment has to hand it over.
    ws.branch = solo ? trackBranch : `feature/${ws.id}`;
    ws.wt = solo ? trackWt : `.claude/worktrees/bud-${ws.id}`;
  }

  const results = await boundedParallel(
    stage.map(
      (ws) => () => implementWorkstream(ws, trackBranch, track.files, inbox)
    )
  );
  // `parallel()` resolves a thunk that threw to null, so a dead agent comes
  // back as a hole — and a hole inside a passing stage would ship a track with
  // a piece of itself silently missing.
  const settled = stage.map(
    (ws, i) =>
      results[i] ?? {
        ok: false,
        ws,
        reason: `${ws.id} returned no result (its agent died) — nothing was built and nothing said so`,
      }
  );
  const failed = settled.filter((r) => !r.ok);
  if (failed.length)
    return {
      ok: false,
      reason: `stage ${stageIndex} failed: ${failed.map((f) => f.reason).join("; ")}`,
    };
  if (solo) return { ok: true, results: settled };

  const integrated = await agent(
    `Integrate a stage of parallel work. In ${trackWt} (on ${trackBranch}), merge each of these in order with \`git -C ${trackWt} merge --no-ff <branch>\`:
${settled.map((r) => `  - ${r.branch}`).join("\n")}

They were written against declared-disjoint file sets, so a clean merge is expected. If one conflicts the file sets were wrong: use \`.claude/skills/resolving-merge-conflicts/SKILL.md\` and resolve by intent, tracing each side to what its workstream was asked to do — never by taking one side wholesale.

Then run \`pnpm typecheck\` in ${trackWt}: two individually-correct workstreams can still contradict each other, and this is the first moment that is visible. A branch you could not merge cleanly belongs in \`conflicts\` with the reason. Return strictly the schema.`,
    {
      label: `integrate:${track.id}#s${stageIndex}`,
      phase: "Build",
      agentType: "backend",
      model: "opus",
      schema: INTEGRATE_SCHEMA,
    }
  );

  const merged = integrated?.merged || [];
  const missing = settled
    .map((r) => r.branch)
    .filter((b) => !merged.includes(b));
  if (missing.length)
    return {
      ok: false,
      reason: `stage ${stageIndex} did not integrate: ${missing.join(", ")} ${integrated?.conflicts?.length ? `(${integrated.conflicts.join("; ")})` : "were never reported merged"}`,
    };
  log(
    `🔗 ${track.id} stage ${stageIndex} integrated ${merged.length} branch(es)`
  );
  return { ok: true, results: settled };
}

// ---------------------------------------------------------------------------
// review — publish, then THE single code review of this PR. No browser work
// here: the one browser look happens last, in ship, at the final sha.
// ---------------------------------------------------------------------------
async function reviewPass(track, branch, wt, wsOutcomes, attempt) {
  return agent(
    `You are the code-reviewer, and this is the ONE review branch ${branch} (worktree ${wt}) gets before it merges — issue(s) ${hashes(track.issues)}. ${CHANNEL} The gate contract is \`ops/agent-os/dod.md\`; you are gate REVIEWED. It was built by ${wsOutcomes.length} workstream(s):
${wsOutcomes.map((r) => `- **${r.ws.id}** — ${r.summary || "no summary given"}`).join("\n")}

FIRST publish, so nothing downstream validates a sha the remote does not have: \`git -C ${wt} push -u origin ${branch}\`, \`git -C ${wt} fetch origin ${branch}\`, then report VERBATIM what \`git -C ${wt} rev-parse HEAD\` and \`git -C ${wt} rev-parse origin/${branch}\` printed, as \`headSha\` and \`remoteSha\`. If they differ, stop: verdict FAIL, failingGate \`publish\`, the two shas as evidence.

Then review the assembled diff (\`git -C ${wt} diff ${BASE}...HEAD\`), running \`pnpm typecheck\` and the tests covering the changed files yourself, on four axes:
- **correctness** against the criteria below, including the cases none of them names — empty state, the second call, concurrent writes, a null row. For a migration, the DDL itself: nullability, defaults, indexes, cascade, and whether existing data survives.
- **conventions**: AGENTS.md, then memory/invariants.md and the memory/invariants/*.md domain files covering the changed paths. Every rule there is hard.
- **diff hygiene**: files outside the declared set, debris, unrelated churn. Declared: ${track.files.join(", ") || "(none)"}. A new file under \`src/db/migrations/\` when \`db/\` is not in that set is G5: FAIL, re-declare, do not delete the migration.
- **spec mapping**: each criterion to the code that satisfies it, with evidence.
On a schema, auth or multi-tenancy diff, hold the security lens explicitly and say so: auth on every new entrypoint, whether org A can reach org B's rows through anything this adds, unsafe interpolation, secrets or internal data reaching a client bundle or a log, SELECTs that widen a response. You are the only reviewer on that axis.

Do NOT drive a browser and do NOT open a PR — ship takes the one look at the final sha.

Acceptance criteria to map:
${allCriteria(track)}

Two output channels, and the split decides who acts:
- **findings** — anything decidable from the codebase alone. Fixed in this pass, never filed as debt. Severity critical | structural | suggestion; the first two get one fix round, suggestions never gate. State each so an implementer can act on it directly, with a \`remedy\`.
- **warnings** — questions about WHAT should have been built. Rule on them yourself from product-docs/product-values.md, CONTEXT.md and memory/invariants.md; a ruling you make is a warning of kind \`ruling\` naming the decision and the source that made it, and ship copies it into the PR body. Convene a short consulate (two or three perspectives, one synthesis) for a hard call. Only an irreversible call or a matter of the owner's taste is a \`spec-question\`, and that holds the track for a human.

Do not invent either to seem thorough, and do not suppress one to get a clean merge — empty lists are a real answer. Default to FAIL when evidence is missing or unconvincing. Return strictly the schema.`,
    {
      label: `review:${track.id}#${attempt}`,
      phase: "Verify",
      agentType: "code-reviewer",
      model: "opus",
      schema: REVIEW_SCHEMA,
    }
  );
}

/**
 * fix — ONE round, no re-review agent: the reviewer stated a `remedy` for every
 * finding, the fixer must answer each one, and CI re-anchors the build and the
 * suite at the new sha. Returns the items it left unanswered.
 */
async function fixPass(
  track,
  branch,
  wt,
  { findings = [], report = null, attempt }
) {
  const gateFail = Boolean(report);
  const fix = await agent(
    `You are fixing branch ${branch} in worktree ${wt} (issue(s) ${hashes(track.issues)}). ${CONVENTIONS} ${CHANNEL}

${
  gateFail
    ? `The reviewer REJECTED this branch. THE CAUSE IS BELOW, IN ITS OWN WORDS — read it before you open a file, and reproduce it yourself before you change anything.

\`\`\`
${evidenceBlock(report)}
\`\`\`
${findings.length ? `\nIt also filed these, verbatim — answer every one:\n\n${findingsBlock(findings)}\n` : ""}
Fix THAT, and answer it: \`rootCause\` (the named cause in your own words) and \`rootCauseAddressed\` (what you changed, and the output proving it is gone). An honest "not addressed, here is why" is worth more than a fix report for something else.`
    : `The reviewer passed the gates and left findings fixed in this ONE round — there is no second round and no re-review, so answer them now or say plainly that you did not. Verbatim:

${findingsBlock(findings)}`
}

Work in ${wt} on ${branch}. Fix this and nothing else. Run \`pnpm typecheck\` and the tests covering the files you touch, and commit (conventional commits). Do NOT push, open a PR, edit labels or issues, or merge.

Fill \`perFinding\` for every item above, in order: restate it, set \`fixed\` (true only when it is gone — declining one is \`false\`, and the PR carries it as a decision), and say what you changed with the output proving it. Return strictly the schema.`,
    {
      label: `fix:${track.id}#${attempt}`,
      phase: "Build",
      agentType: track.lane === "backend" ? "backend" : "frontend",
      model: "opus",
      schema: gateFail ? GATE_FIX_SCHEMA : FIX_SCHEMA,
    }
  );

  // One row per finding, in the order given, and it fails closed: only an
  // explicit `fixed: true` clears an item. A missing row, an empty answer or a
  // declined finding all stand, and a standing finding holds the PR as a
  // decision — a fixer must not be able to make one disappear.
  const rows = fix?.perFinding || [];
  const unresolved = findings.filter(
    (_, i) =>
      rows[i]?.fixed !== true || !String(rows[i]?.addressed || "").trim()
  );
  if (findings.length && unresolved.length === findings.length)
    log(`↩️  ${track.id} fix round answered nothing — the findings stand`);
  return { fix, unresolved };
}

// ---------------------------------------------------------------------------
// ship — publish, prove it works at the final sha, PR, labels, CI, merge.
// ---------------------------------------------------------------------------
async function shipPass(
  track,
  branch,
  wt,
  { review, unresolved, holds, trees, attempt, trackThreads = [] }
) {
  const ruled = (review?.warnings || []).filter((w) => w.kind === "ruling");
  const specQuestions = (review?.warnings || []).filter(
    (w) => w.kind === "spec-question"
  );
  const menu = unresolved.length
    ? `\nUnresolved review findings — present EACH as a DECISION with this menu, never as a defect dump: (a) merge as-is, ruling the finding accepted; (b) direct a named fix, which is why the branch and worktree survive; (c) take it manually. Quote each verbatim:\n${findingsBlock(unresolved)}\n`
    : "";
  // Threads no workstream's declared files own. They were routed here because
  // ship is the only step that holds the whole track's diff — and because a
  // thread nobody was made accountable for is a thread that goes unanswered.
  const trackThreadBlock = trackThreads.length
    ? `\n**TRACK-LEVEL REVIEW THREADS.** These threads on the existing PR touch no single workstream's declared files, so they are yours and yours only — no implementer was given them. Reply to EACH on the GitHub thread itself (what changed, or not actioned and why) and report one \`threadReplies\` row per thread. Silence is not a reply, and the loop refuses the merge on a thread you left blank:\n${trackThreads
        .map(
          (f) =>
            `--- ${f.threadId || f.id} ${f.path ? `${f.path}:${f.line || ""}` : "(no file)"} (${f.author || "reviewer"}) ---\n${f.body}`
        )
        .join("\n\n")}\n`
    : "";

  return agent(
    `You are the release agent for branch ${branch} (worktree ${wt}), issue(s) ${hashes(track.issues)}. ${CHANNEL} It passed the one code review. The gate contract is \`ops/agent-os/dod.md\`. Do all of this, in order, in one pass.

1. **PUBLISH.** \`git -C ${wt} push -u origin ${branch}\`, then \`git -C ${wt} fetch origin ${branch}\`. Report VERBATIM what \`git -C ${wt} rev-parse HEAD\` and \`git -C ${wt} rev-parse origin/${branch}\` printed. If they differ, stop: nothing is validated or merged at a sha the remote lacks.

2. **WORKS — one look, at that sha, and only one.** Use \`.claude/skills/validate/SKILL.md\`.
${
  track.lane === "backend"
    ? `   Make ONE real request against the route or server action this track changed — the real handler, not a mock — and assert the status AND the response shape against the contract. A tsx harness in the worktree is fine.`
    : `   Drive the branch's VERCEL PREVIEW (\`scripts/preview-url.sh ${branch} --wait --bypass\` — name the branch, or it resolves whatever HEAD your shell is on), never localhost:3000 — localhost serves main and would pass code this track never wrote. Confirm the deployment was built from \`remoteSha\`; if it was built from anything else, report works FAIL and name that sha. Assert EACH criterion and screenshot it, require a clean console (the toolbar's 403 is the one allowed entry), and run a lighthouse a11y audit — below 90 is a FAIL. Judge what no gate can while you are there: layout, hierarchy, copy. Tear the browser down when you finish.`
}
   **MIGRATION RIDER — compute it, never recall it**, whatever this track's lane is: \`git -C ${wt} diff --name-only ${BASE}...HEAD -- src/db/migrations/\`. Nothing printed → report \`migration: { "touched": false }\` and move on. Anything printed → the rider is owed at any risk tier (\`ops/agent-os/dod.md\` § Migrations): apply it on a scratch DB **and roll it back**, then report what the scratch DB printed in each direction VERBATIM as \`migration.applyTranscript\` and \`migration.rollbackTranscript\`, with the DDL delta as \`migration.ddl\`. **The DDL delta alone is a FAIL** — a delta nobody applied is a claim, and the loop refuses the merge on a half-met rider. If either direction will not run, that is works FAIL carrying what the scratch DB printed, never a body written anyway.
   Criteria to prove:
${allCriteria(track)}

   **If WORKS is FAIL, STOP HERE.** Report \`works.status: "FAIL"\` with its evidence, \`opened: false\`, \`checkConclusion: "none"\`, \`mergeState: "not-attempted"\`, and do NOT open a PR, edit labels or merge. A branch that does not work must not reach main while someone decides; the loop reads that and decides the retry.

3. **PR.** Follow \`.claude/skills/open-pr/SKILL.md\` for the body template and the label discipline — every write there is idempotent, so retry one that did not stick. Update the existing PR for this branch if there is one — never open a second. Otherwise \`gh pr create\` against main with \`--label agent:in-review\`${track.risk === "high" ? " --label risk:high" : ""}. The body carries the evidence bundle (review verdict, the criteria checklist with evidence, the works evidence and screenshots), ${ruled.length ? `a **Rulings** section quoting each of these verbatim — ${ruled.map((w) => `${w.summary} (${w.detail || "no source named"})`).join(" | ")} — ` : ""}\`Closes ${track.issues.map((n) => `#${n}`).join(", Closes ")}\`, and a **## 👀 Manual QA** section naming WHAT THE AUTOMATION COULD NOT JUDGE: the judgement calls and any edge case no criterion asserted. Do NOT restate the acceptance criteria there — step 2 proved them, and human attention is the scarcest thing here. "Nothing to eyeball" in one line is a valid answer.${menu}
   **Every sha the body cites is \`remoteSha\`** — the head you just published and the one step 5 anchors. No evidence copied from an earlier attempt, no "CI ❌ at <older sha>", and no preview validated at anything but that sha. Where the CI row cannot be filled yet, write it as \`anchoring at <remoteSha>\` and back-fill it in step 5; a body still saying "anchoring" after the check reports is a green PR describing a commit nobody read. When \`migration.touched\` is true the **Schema diff** section carries the DDL delta AND both scratch-DB transcripts — apply and rollback, verbatim. The DDL alone does not satisfy it.
${trackThreadBlock}
4. **LABELS, once.** For each issue n: \`gh issue edit n --add-label agent:in-review --remove-label agent:in-progress\`, dropping any other \`agent:*\` it carries, and \`gh pr edit <number> --add-label agent:in-review\`. Then READ THEM BACK with \`gh issue view n --json labels --jq '[.labels[].name]'\` and report in \`labels\` EXACTLY what that printed, even when it is not what you expected — the loop compares it and errors this track if the board disagrees with you.

5. **CI is the merge contract.** \`gh pr checks <number> --watch --fail-fast\`, then read the conclusion of the "Format, Lint, Typecheck, Build" check into \`checkConclusion\` verbatim. If it is not success, pull the failing step with \`gh run view <run-id> --log-failed\` into \`checkSummary\`. Do not report success you did not observe, and do not call a red check probably unrelated.
   **Then BACK-FILL the body**, in the same pass: rewrite the CI row to the conclusion you just read and the sha it ran at (\`gh pr edit <number> --body-file <path>\`), and correct any other cell whose sha the fix round moved. Then read the PR back — \`gh pr view <number> --json headRefOid\` into \`prHeadSha\`, and the sha the body's CI row now cites into \`bodySha\` — and report both VERBATIM, even when they disagree. The loop compares them rather than trusting you.

6. ${
      AUTO_MERGE && !holds.length
        ? `**MERGE**, once the check is green AND the body describes this head. Three refusals come before the merge command, and each is a stop rather than a note: \`bodySha\` must equal \`prHeadSha\` — a body citing an ancestor sha merges evidence for another commit; a diff carrying a migration must show BOTH scratch-DB transcripts, not the DDL alone; and every track-level review thread above must carry a \`threadReplies\` row with a real body. Correct the body and re-anchor first; if you still cannot make it true, report \`mergeState: "refused"\` with the two shas or the missing transcript and merge nothing. Otherwise: \`gh pr merge <number> --squash --delete-branch --auto\`. \`--auto\` is deliberate — the main ruleset requires up-to-date branches, so GitHub re-runs the checks and merges only on green; if it refuses because the branch is behind, \`gh pr update-branch\` and retry. Re-read with \`gh pr view <number> --json state,mergedAt\` and report what GitHub did in \`mergeState\`. ONLY when that reads \`merged\`, clean up: for each path below, \`git worktree remove <path> --force\` and \`git branch -D <branch>\`, then \`git worktree prune\`. Touch nothing outside this list — other tracks are building in sibling worktrees.
${treeLines(trees)}`
        : `**HOLD** — this PR does not auto-merge. \`gh pr comment\` with why, report \`mergeState: "${holds.length ? "refused" : "not-attempted"}"\`, and do not touch labels again.
${holds.length ? `Reason(s):\n${holds.map((h) => `- ${h}`).join("\n")}` : "This run does not auto-merge; a human reviews the PR directly."}
${
  specQuestions.length
    ? `Present each spec-question as a decision with its options — the reviewer's job is to RULE, not to hunt. If one is a DIRECTION question, where trying beats reading, use \`.claude/skills/prototype/SKILL.md\` BEFORE commenting: build two or three candidates on this branch, verify each works, and write the comment so the reviewer can operate the options.\n`
    : ""
}End with a **Surviving worktrees** section listing these verbatim. A held track keeps its trees on purpose: they are the reviewer's to remove once the PR merges, and you remove none.
${treeLines(trees)}`
    }

Return strictly the schema.`,
    {
      // Opus, the executor tier: this node transcribes GitHub's answer and can
      // mutate main. It must not drop to the quick-command tier.
      label: `ship:${track.id}#${attempt}`,
      phase: "Ship",
      model: "opus",
      schema: SHIP_SCHEMA,
    }
  );
}

// ---------------------------------------------------------------------------
// One track, start to finish.
// ---------------------------------------------------------------------------
async function buildTrack(track) {
  const branch = `feature/${track.id}`;
  const wt = `.claude/worktrees/bud-${track.id}`;
  const trees = () => survivingTrees(track, branch, wt);

  const setup = await setupTrack(track, branch, wt, PASS_ISSUES);
  if (!setup.ok)
    return exitTrack(track, setup.refused ? "refused" : "blocked", {
      reason: setup.refused
        ? setup.reason
        : `could not prepare ${wt} on ${branch}: ${setup.reason}`,
      trees: trees(),
      claimed: setup.claimed,
    });

  // Each review thread gets exactly one answering place, decided here once:
  // the workstream whose declared files the thread touches, or — when no
  // workstream owns the path — the ship pass, the only step holding the whole
  // track's diff.
  const routed = routeReviewThreads(
    setup.reviewFeedback || [],
    track.stages.flat()
  );
  const inbox = {
    comments: setup.comments || [],
    consumedCommentIds: setup.consumedCommentIds || [],
    reviewFeedback: setup.reviewFeedback || [],
    routedFeedback: routed.byWorkstream,
    openPr: setup.openPr || 0,
    changesRequested: setup.changesRequested === true,
  };

  const starved = (what) =>
    budget.total && budget.remaining() < RESERVE
      ? `token reserve hit before ${what} (${Math.round(budget.remaining() / 1000)}k left < ${Math.round(RESERVE / 1000)}k)`
      : null;

  const wsOutcomes = [];
  for (const [i, stage] of track.stages.entries()) {
    // Building work the budget can never review or ship is the expensive way to
    // fail, so the same flat check guards every stage, not just the tail.
    const broke = starved(`stage ${i}`);
    if (broke) return exitTrack(track, "blocked", { reason: broke, trees: trees() }); // prettier-ignore
    const result = await runStage(track, stage, i, branch, wt, inbox);
    if (!result.ok)
      return exitTrack(track, "blocked", {
        reason: result.reason,
        trees: trees(),
      });
    wsOutcomes.push(...result.results);
  }

  // The integration tail. A failed attempt re-runs from the step that failed,
  // not from the top: a red check needs a fix and another ship, not another
  // review, because a PR gets exactly one review.
  let step = "review";
  let review = null;
  let unresolved = [];
  let lastReport = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const broke = starved(`integration attempt ${attempt}`);
    if (broke)
      return exitTrack(track, "blocked", {
        reason: broke,
        report: lastReport,
        trees: trees(),
      });

    if (step === "review") {
      review = await reviewPass(track, branch, wt, wsOutcomes, attempt);
      if (!review) {
        lastReport = {
          failingGate: "REVIEWED",
          summary: `${track.id}: the reviewer returned nothing`,
        };
        continue;
      }
      lastReport = review;
      const head = String(review.headSha || "").trim();
      const remote = String(review.remoteSha || "").trim();
      if (head && remote && head !== remote) {
        log(
          `🔁 ${track.id}: ${branch} is at ${head} but origin has ${remote} — republishing`
        );
        continue;
      }
      if (review.verdict === "FAIL") {
        log(
          `❌ ${track.id} attempt ${attempt}: ${review.failingGate || "review FAIL"}`
        );
        if (attempt < MAX_ATTEMPTS)
          await fixPass(track, branch, wt, {
            report: review,
            findings: actionableFindings(review.findings),
            attempt,
          });
        continue;
      }
      const actionable = actionableFindings(review.findings);
      if (actionable.length) {
        log(`🔧 ${track.id}: ${actionable.length} finding(s) — one fix round`);
        unresolved = (
          await fixPass(track, branch, wt, { findings: actionable, attempt })
        ).unresolved;
      }
      step = "ship";
    }

    // The auto-merge gate: five conditions, each a different guarantee. CI
    // green the ship agent proves itself; the other four are known here.
    const specQuestions = (review.warnings || []).filter(
      (w) => w.kind === "spec-question"
    );
    const holds = [];
    if (track.risk === "high") holds.push("risk:high — never auto-merges");
    if (track.hold)
      holds.push("hold — a factory change, or an issue that declared it");
    if (specQuestions.length)
      holds.push(
        `${specQuestions.length} spec-question(s): ${specQuestions.map((w) => w.summary).join(" | ")}`
      );
    if (unresolved.length)
      holds.push(`${unresolved.length} unresolved review finding(s)`);

    const ship = await shipPass(track, branch, wt, {
      review,
      unresolved,
      holds,
      trees: trees(),
      attempt,
      trackThreads: routed.trackLevel,
    });
    if (!ship) {
      log(`💥 ${track.id} attempt ${attempt}: the ship agent died`);
      continue;
    }

    // Order matters: a WORKS failure aborts the ship pass BEFORE the PR, so
    // "no PR" only means a delivery failure once WORKS has passed.
    const gateFailure =
      ship.works?.status === "FAIL"
        ? { failingGate: "WORKS", summary: ship.works.evidence }
        : ship.opened && ship.checkConclusion !== "success"
          ? {
              failingGate: "CI",
              summary: `CI reported "${ship.checkConclusion}" on ${ship.url || "the PR"}. ${ship.checkSummary || "no summary returned"}`,
            }
          : null;
    if (gateFailure) {
      lastReport = { ...review, verdict: "FAIL", ...gateFailure };
      log(
        `🔴 ${track.id} attempt ${attempt}: ${lastReport.failingGate} failed`
      );
      if (attempt < MAX_ATTEMPTS)
        await fixPass(track, branch, wt, { report: lastReport, attempt });
      continue;
    }

    // The refusals the ship agent must not be able to mark its own homework on.
    // Every one is about the EVIDENCE, not the code — a body citing a sha the
    // head moved past, a migration whose rollback nobody ran, a review thread
    // nobody replied to — so the remedy is another ship pass that corrects and
    // re-anchors the body, never a fix round that rewrites code which already
    // passed. A rider that is half-met because the rollback genuinely fails
    // comes back as works FAIL, and that path does route to a fixer.
    const bodySha = String(ship.bodySha || "").trim();
    const prHead = String(ship.prHeadSha || ship.remoteSha || "").trim();
    const mig = ship.migration || {};
    const proved = (k) => Boolean(String(mig[k] || "").trim());
    const refusals = [];
    if (bodySha && prHead && bodySha !== prHead)
      refusals.push(
        `the PR body's evidence cites ${bodySha} but the head is ${prHead} — the body describes a commit nobody reviewed`
      );
    const riderMissing =
      mig.touched === true &&
      !(proved("applyTranscript") && proved("rollbackTranscript"));
    // The third refusal, same class as the other two: it is about the evidence
    // on the PR, not the code, so the remedy is another ship pass that posts
    // the replies — never a fix round. A track-level thread is answered here or
    // nowhere, because no implementer was given it.
    const unansweredTrackThreads = unansweredReviewThreads(
      routed.trackLevel,
      ship.threadReplies
    );
    if (unansweredTrackThreads.length)
      refusals.push(
        `review thread(s) ${unansweredTrackThreads.join(", ")} were routed to the ship pass and have no threadReplies row with a non-empty body — silence is not a reply`
      );
    if (riderMissing)
      refusals.push(
        `the diff touches src/db/migrations/ and the body carries ${
          proved("applyTranscript")
            ? "no rollback transcript"
            : proved("rollbackTranscript")
              ? "no apply transcript"
              : "neither scratch-DB transcript"
        } — the DDL delta alone is a claim, not a proof`
      );
    if (refusals.length) {
      if (ship.mergeState === "merged")
        log(
          `🚨 ${track.id}: ${ship.url || "the PR"} merged anyway — ${refusals.join("; ")}. The evidence on main is stale; fix the body by hand.`
        );
      else {
        lastReport = {
          ...review,
          verdict: "FAIL",
          failingGate: riderMissing ? "WORKS" : "publish",
          summary: refusals.join("; "),
        };
        log(`🔁 ${track.id} attempt ${attempt}: merge refused — ${refusals.join("; ")}`); // prettier-ignore
        continue;
      }
    }

    if (!ship.opened)
      return exitTrack(track, "delivery-failed", {
        reason: `every gate passed and the PR step still produced no PR (${ship.reason || "no reason given"}). The work is committed on ${branch}.`,
        report: review,
        trees: trees(),
      });

    const missing = labelViolations(
      track.issues,
      ship.labels,
      "agent:in-review"
    );
    // A PR whose issue still reads agent:in-progress is indistinguishable from
    // a failure, and it halts the next unattended pass — so it takes the exit
    // too, and the label the ship pass could not confirm gets one more writer.
    const errored = missing.length
      ? await exitTrack(track, "errored", {
          reason: `${ship.url || "the PR"} is open and green, but issue(s) ${missing.join(", ")} do not read agent:in-review`,
          report: review,
          trees: trees(),
        })
      : null;

    return {
      ...(errored || {}),
      track,
      status: missing.length ? "errored" : "shipped",
      reason: missing.length
        ? `issue(s) ${missing.join(", ")} were never confirmed on agent:in-review`
        : undefined,
      pr: ship,
      mergeState: ship.mergeState,
      warnings: review.warnings || [],
      unresolvedFindings: unresolved,
      attempts: attempt,
      unlabelledIssues: missing,
      observedLabels: ship.labels || [],
      // A merged track cleaned up after itself; every other outcome hands its
      // trees to the reviewer named in the PR comment.
      survivingTrees: ship.mergeState === "merged" ? [] : trees(),
      consumedCommentIds: [
        ...new Set(
          (inbox.consumedCommentIds || []).concat(
            wsOutcomes.flatMap((r) => r.consumedCommentIds || [])
          )
        ),
      ],
    };
  }

  return exitTrack(track, "blocked", {
    reason: `the assembled branch did not ship in ${MAX_ATTEMPTS} attempt(s)`,
    report: lastReport,
    trees: trees(),
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
phase("Build");
// A track puts its widest stage in flight at once, so the TRACK limit is the
// agent ceiling divided by that width — otherwise the real ceiling is the
// product of the two, not the number the caller set.
const peakStageLoad = Math.max(
  1,
  ...tracks.map((t) => Math.max(...t.stages.map((s) => s.length)))
);
const results = await boundedParallel(
  tracks.map((t) => () => buildTrack(t)),
  Math.max(1, Math.floor(MAX_CONCURRENT_AGENTS / peakStageLoad))
);

// Fan-in guard: `parallel()` resolves a thunk that threw to null, so a track
// whose buildTrack died comes back as a hole — and a filtered-out hole is a
// unit nobody built and nobody was told about. The count in must equal the
// count out, and each hole still gets its comment and its label.
const lost = tracks.filter((_, i) => !results[i]);
if (lost.length) {
  log(
    `🚨 FAN-IN GAP: launched ${tracks.length} track(s), ${results.length - lost.length} returned. ` +
      `${lost.map((t) => `${t.id} (issues ${hashes(t.issues) || "none"})`).join("; ")} vanished without a verdict — ` +
      `NOT blocked and NOT shipped, and their issues still read agent:in-progress.`
  );
  for (const t of lost)
    await exitTrack(t, "blocked", {
      reason: `the track's loop died mid-flight and returned no verdict at all — nothing was reviewed and nothing shipped`,
      trees: survivingTrees(
        t,
        `feature/${t.id}`,
        `.claude/worktrees/bud-${t.id}`
      ),
    });
}

const done = results.filter(Boolean);
const shipped = done.filter((r) => r.status === "shipped");
const blocked = done.filter((r) => r.status === "blocked");
const refused = done.filter((r) => r.status === "refused");
// Separate from blocked because the human action differs: these passed every
// gate and only the delivery call failed, so they want a retried push.
const deliveryFailed = done.filter((r) => r.status === "pr-failed");
// The work exists but the board cannot be trusted about it: it needs a hand.
const errored = done.filter((r) => r.status === "errored");

log(
  `Done: ${shipped.length} shipped, ${blocked.length} blocked${refused.length ? `, ${refused.length} refused (serialize)` : ""}${deliveryFailed.length ? `, ${deliveryFailed.length} delivery-failed` : ""}${errored.length ? `, ${errored.length} ERRORED (label unconfirmed)` : ""}${lost.length ? `, ${lost.length} LOST` : ""}.`
);

const kinds = (r, kind) =>
  (r.warnings || []).filter((w) => w.kind === kind).map((w) => w.summary);
const base = (r) => ({
  track: r.track.id,
  issues: r.track.issues,
  reason: r.reason,
  survivingWorktrees: (r.survivingTrees || []).map((t) => t.path),
});

return {
  summary: `${shipped.length}/${tracks.length} tracks shipped to PR; ${blocked.length} blocked${refused.length ? `; ${refused.length} refused (another loop holds a claim)` : ""}${deliveryFailed.length ? `; 📦 ${deliveryFailed.length} passed the gates but failed to deliver` : ""}${errored.length ? `; 🚨 ${errored.length} errored with an unconfirmed label` : ""}${lost.length ? `; ⚠️ ${lost.length} lost without a verdict` : ""}.`,
  lost: lost.map((t) => ({
    track: t.id,
    issues: t.issues,
    reason:
      "no result — the loop died mid-flight; an exit pass commented and labelled it agent:blocked",
  })),
  shipped: shipped.map((r) => ({
    ...base(r),
    stages: r.track.stages.length,
    workstreams: r.track.stages.reduce((n, s) => n + s.length, 0),
    pr: r.pr?.url,
    attempts: r.attempts,
    merge: r.mergeState || (AUTO_MERGE ? "held-for-review" : "not-attempted"),
    rulings: kinds(r, "ruling"),
    heldBy: kinds(r, "spec-question"),
    unresolvedFindings: (r.unresolvedFindings || []).map((f) => f.summary),
    consumedCommentIds: r.consumedCommentIds || [],
  })),
  blocked: blocked.map((r) => ({
    ...base(r),
    failingGate: r.lastReport?.failingGate,
    labelSettled: r.labelSettled !== false,
  })),
  refused: refused.map((r) => ({
    ...base(r),
    labelSettled: r.labelSettled !== false,
  })),
  deliveryFailed: deliveryFailed.map((r) => ({
    ...base(r),
    branch: `feature/${r.track.id}`,
    // Not a gate name: every gate passed. Naming the step is what stops this
    // being read as a code failure.
    failingGate: "delivery",
    labelSettled: r.labelSettled !== false,
  })),
  errored: errored.map((r) => ({
    ...base(r),
    pr: r.pr?.url,
    unlabelledIssues: r.unlabelledIssues || r.track.issues,
    observedLabels: r.observedLabels || [],
  })),
  nextStep:
    (errored.length
      ? `🚨 FIRST: ${errored.length} track(s) errored on an unconfirmed label — set those labels by hand before trusting the board. `
      : "") +
    (AUTO_MERGE
      ? "Your queue is ONLY the held PRs: each carries a decision menu for the ruling that held it."
      : "Review the opened PRs (your queue).") +
    " Blocked issues carry the failing gate and its evidence in a comment: tighten the spec, raise the budget (+Nk), or take it manually. Blocked and held tracks KEEP their worktrees; merged tracks removed their own." +
    (refused.length
      ? ` Refused tracks were reverted to agent:queued because another loop holds a claim — see ops/agent-os/invocation.md.`
      : "") +
    (deliveryFailed.length
      ? ` 📦 ${deliveryFailed.length} delivery-failed: push the named branch and open the PR — the code already passed.`
      : "") +
    (lost.length
      ? " ⚠️ The lost tracks died without a verdict; they were commented and blocked, so re-queue them."
      : ""),
};
