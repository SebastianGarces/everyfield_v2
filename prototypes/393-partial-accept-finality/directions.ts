/**
 * Four directions for: what does unticking an offer MEAN?
 *
 * Throwaway. Nothing here imports the app — it re-implements only the answer
 * bookkeeping of `src/lib/tasks/phase-prompt.ts`, with the real phase-2 catalog
 * (`src/lib/tasks/templates.ts`) as data, so the awkward case can be operated
 * instead of imagined.
 */

export interface Offer {
  key: string;
  name: string;
  taskCount: number;
}

/** The real phase-2 offers, counts from `taskTemplateSize`. */
export const OFFERS: Offer[] = [
  { key: "ministry-team-setup", name: "Ministry Team Setup", taskCount: 9 },
  { key: "launch-date-planning", name: "Launch Date Planning", taskCount: 7 },
  {
    key: "project-timeline-creation",
    name: "Project Timeline Creation",
    taskCount: 6,
  },
];

export type Device = "laptop" | "phone";

export interface State {
  /** Which stage change we are answering. A move mints a new one. */
  transitionId: number;
  /** Tasks that exist, in creation order: one entry per imported checklist. */
  created: { transitionId: number; key: string; taskCount: number }[];
  /** Per-transition bookkeeping, whatever this direction stores. */
  answered: Set<number>;
  takenKeys: Map<number, Set<string>>;
  /** The fast-path cookie, per device: the transition this browser has finished with. */
  cookies: Partial<Record<Device, number>>;
}

export const initialState = (): State => ({
  transitionId: 1,
  created: [],
  answered: new Set(),
  takenKeys: new Map(),
  cookies: {},
});

export interface Render {
  /** null = no prompt on screen. */
  offers: Offer[] | null;
  /** Offers shown but not takeable again, if the direction has such a state. */
  locked?: Offer[];
  note: string;
}

export interface Direction {
  id: "A" | "B" | "C" | "D";
  name: string;
  blurb: string;
  schema: string;
  /** The one sentence of prompt copy this direction owes the planter. */
  copy: string;
  render(state: State, device: Device): Render;
  accept(state: State, keys: string[], device: Device): string;
  dismiss(state: State, device: Device): string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const taken = (state: State): Set<string> =>
  state.takenKeys.get(state.transitionId) ?? new Set<string>();

const isAnswered = (state: State): boolean =>
  state.answered.has(state.transitionId);

const importKeys = (state: State, keys: string[]): number => {
  const set = state.takenKeys.get(state.transitionId) ?? new Set<string>();
  let rows = 0;
  for (const key of keys) {
    const offer = OFFERS.find((candidate) => candidate.key === key);
    if (!offer) continue;
    state.created.push({
      transitionId: state.transitionId,
      key: offer.key,
      taskCount: offer.taskCount,
    });
    set.add(offer.key);
    rows += offer.taskCount;
  }
  state.takenKeys.set(state.transitionId, set);
  return rows;
};

const remaining = (state: State): Offer[] => {
  const already = taken(state);
  return OFFERS.filter((offer) => !already.has(offer.key));
};

const rowsOf = (keys: string[]): number =>
  keys.reduce(
    (total, key) =>
      total + (OFFERS.find((offer) => offer.key === key)?.taskCount ?? 0),
    0
  );

// ---------------------------------------------------------------------------
// A — as built: one answer per transition, any answer closes it. Copy only.
// ---------------------------------------------------------------------------

const A: Direction = {
  id: "A",
  name: "As built + one sentence of copy",
  blurb:
    "Any answer — full, partial, or Not now — closes the stage change for good. The only change is copy that names the consequence.",
  schema: "none (migration 0035 unchanged)",
  copy: "Checklists you untick will not be offered here again. You can still import them any time from Checklist templates.",
  render(state, device) {
    if (isAnswered(state))
      return { offers: null, note: "no prompt (answered)" };
    if (state.cookies[device] === state.transitionId)
      return { offers: null, note: "no prompt (cookie fast path)" };
    return { offers: OFFERS, note: "all three offered" };
  },
  accept(state, keys, device) {
    if (isAnswered(state))
      return "already answered -> created nothing (idempotent)";
    state.answered.add(state.transitionId);
    state.cookies[device] = state.transitionId;
    const rows = importKeys(state, keys);
    const dropped = remaining(state).map((offer) => offer.name);
    return `imported ${keys.length} checklist(s), ${rows} tasks. Prompt closed. Retired unasked: ${dropped.length > 0 ? dropped.join(", ") : "none"}`;
  },
  dismiss(state, device) {
    if (isAnswered(state)) return "already answered -> nothing changes";
    state.answered.add(state.transitionId);
    state.cookies[device] = state.transitionId;
    return "declined. Prompt closed for this stage change, all three retired.";
  },
};

// ---------------------------------------------------------------------------
// B — the answer records WHICH keys were taken; the remainder keeps being offered.
// ---------------------------------------------------------------------------

const B: Direction = {
  id: "B",
  name: "Answer records the taken keys; re-offer the remainder",
  blurb:
    "A partial accept records what was taken. The prompt comes back with only what is left, until the planter takes it all or presses Not now.",
  schema:
    "0035 gains `taken_keys text[]` (or one row per offer); the unique index moves to (transition_id, template_key) or stays with the array",
  copy: "Import what you want now. Anything you leave stays on offer here until this stage change is done with.",
  render(state, device) {
    if (isAnswered(state))
      return { offers: null, note: "no prompt (answered)" };
    const left = remaining(state);
    if (left.length === 0)
      return { offers: null, note: "no prompt (all offers taken)" };
    if (state.cookies[device] === state.transitionId)
      return { offers: null, note: "no prompt (cookie fast path)" };
    const already = [...taken(state)];
    return {
      offers: left,
      note:
        already.length > 0
          ? `${left.length} left; ${already.length} already imported`
          : "all three offered",
    };
  },
  accept(state, keys) {
    const already = taken(state);
    const fresh = keys.filter((key) => !already.has(key));
    if (isAnswered(state))
      return "already answered -> created nothing (idempotent)";
    const rows = importKeys(state, fresh);
    const left = remaining(state);
    if (left.length === 0) state.answered.add(state.transitionId);
    const skipped = keys.length - fresh.length;
    return `imported ${fresh.length} checklist(s), ${rows} tasks${skipped > 0 ? ` (${skipped} already taken, skipped)` : ""}. ${left.length > 0 ? `Prompt stays, offering: ${left.map((offer) => offer.name).join(", ")}` : "Prompt closed (nothing left)."}`;
  },
  dismiss(state, device) {
    if (isAnswered(state)) return "already answered -> nothing changes";
    state.answered.add(state.transitionId);
    state.cookies[device] = state.transitionId;
    return "declined the rest. Prompt closed for this stage change.";
  },
};

// ---------------------------------------------------------------------------
// C — a partial accept does not close the transition at all.
// ---------------------------------------------------------------------------

const C: Direction = {
  id: "C",
  name: "Only a FULL accept (or Not now) closes the stage change",
  blurb:
    "The claim is on 'this planter is done', not 'this planter pressed'. A partial accept leaves the prompt exactly as it was — including the parts already imported.",
  schema: "none, but the one-answer-per-transition guarantee is given up",
  copy: "Import as much or as little as you like. This stays here until you take everything or press Not now.",
  render(state, device) {
    if (isAnswered(state))
      return { offers: null, note: "no prompt (answered)" };
    if (state.cookies[device] === state.transitionId)
      return { offers: null, note: "no prompt (cookie fast path)" };
    const already = taken(state);
    return {
      offers: OFFERS,
      note:
        already.size > 0
          ? `all three still offered (${already.size} already imported once)`
          : "all three offered",
    };
  },
  accept(state, keys, device) {
    if (isAnswered(state))
      return "already answered -> created nothing (idempotent)";
    const already = taken(state);
    const dupes = keys.filter((key) => already.has(key));
    const rows = importKeys(state, keys);
    const full = keys.length === OFFERS.length;
    if (full) {
      state.answered.add(state.transitionId);
      state.cookies[device] = state.transitionId;
    }
    return `imported ${keys.length} checklist(s), ${rows} tasks${dupes.length > 0 ? ` — ${dupes.length} DUPLICATE checklist(s): ${dupes.map((key) => OFFERS.find((offer) => offer.key === key)?.name).join(", ")}` : ""}. ${full ? "Prompt closed (took everything)." : "Prompt stays, unchanged."}`;
  },
  dismiss(state, device) {
    if (isAnswered(state)) return "already answered -> nothing changes";
    state.answered.add(state.transitionId);
    state.cookies[device] = state.transitionId;
    return "declined. Prompt closed for this stage change.";
  },
};

// ---------------------------------------------------------------------------
// D — the claim is per offer, and the prompt becomes a durable stage panel.
// ---------------------------------------------------------------------------

const D: Direction = {
  id: "D",
  name: "Per-offer claim; the prompt becomes a stage panel",
  blurb:
    "One claim per (stage change, checklist). Taken checklists stay on screen marked Imported and cannot be taken twice; the panel stays until Not now — or until the next stage change replaces it.",
  schema:
    "0035's unique index becomes (transition_id, template_key), one row per offer answered",
  copy: "Each checklist can be imported once for this stage change. Imported ones are marked; the rest stay here.",
  render(state, device) {
    if (isAnswered(state))
      return { offers: null, note: "no panel (dismissed)" };
    if (state.cookies[device] === state.transitionId)
      return { offers: null, note: "no panel (cookie fast path)" };
    const already = taken(state);
    if (already.size === OFFERS.length)
      return { offers: null, note: "no panel (every checklist imported)" };
    return {
      offers: OFFERS.filter((offer) => !already.has(offer.key)),
      locked: OFFERS.filter((offer) => already.has(offer.key)),
      note:
        already.size > 0
          ? `${already.size} marked Imported (locked), ${OFFERS.length - already.size} takeable`
          : "all three offered",
    };
  },
  accept(state, keys) {
    if (isAnswered(state)) return "panel dismissed -> created nothing";
    const already = taken(state);
    const fresh = keys.filter((key) => !already.has(key));
    const blocked = keys.length - fresh.length;
    const rows = importKeys(state, fresh);
    return `imported ${fresh.length} checklist(s), ${rows} tasks${blocked > 0 ? ` (${blocked} blocked by its claim row — no duplicate)` : ""}. Panel stays: ${remaining(state).length} still takeable.`;
  },
  dismiss(state, device) {
    if (isAnswered(state)) return "already dismissed -> nothing changes";
    state.answered.add(state.transitionId);
    state.cookies[device] = state.transitionId;
    return "panel dismissed for this stage change. Untaken checklists retired.";
  },
};

export const DIRECTIONS: Direction[] = [A, B, C, D];

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

export type Event =
  | { kind: "move" }
  | { kind: "open"; device: Device }
  | { kind: "import"; device: Device; keys: string[] }
  | { kind: "notnow"; device: Device };

export interface Scenario {
  title: string;
  question: string;
  events: Event[];
}

const MINISTRY = "ministry-team-setup";
const LAUNCH = "launch-date-planning";
const TIMELINE = "project-timeline-creation";

export const SCENARIOS: Scenario[] = [
  {
    title: "The partial accept (the case that raised this)",
    question:
      "The planter unticks Project Timeline Creation. Is it gone, or does it come back?",
    events: [
      { kind: "move" },
      { kind: "open", device: "laptop" },
      { kind: "import", device: "laptop", keys: [MINISTRY, LAUNCH] },
      { kind: "open", device: "laptop" },
      { kind: "open", device: "phone" },
    ],
  },
  {
    title: "Changed my mind a week later",
    question:
      "The planter now wants the checklist they unticked. Where do they get it?",
    events: [
      { kind: "move" },
      { kind: "import", device: "laptop", keys: [MINISTRY, LAUNCH] },
      { kind: "open", device: "laptop" },
      { kind: "import", device: "laptop", keys: [TIMELINE] },
      { kind: "open", device: "laptop" },
    ],
  },
  {
    title: "Double press / second device (what the claim exists for)",
    question:
      "Two presses of the same thing. Does anything import twice in any direction?",
    events: [
      { kind: "move" },
      { kind: "import", device: "laptop", keys: [MINISTRY, LAUNCH, TIMELINE] },
      { kind: "open", device: "phone" },
      { kind: "import", device: "phone", keys: [MINISTRY, LAUNCH, TIMELINE] },
    ],
  },
  {
    title: "The dangerous press (partial, then everything)",
    question:
      "A partial accept, then the planter presses Import with all three ticked.",
    events: [
      { kind: "move" },
      { kind: "import", device: "laptop", keys: [MINISTRY] },
      { kind: "open", device: "phone" },
      { kind: "import", device: "phone", keys: [MINISTRY, LAUNCH, TIMELINE] },
      { kind: "open", device: "laptop" },
    ],
  },
  {
    title: "Not now, then the next stage change",
    question:
      "Does declining stay declined, and does the next move re-arm everything?",
    events: [
      { kind: "move" },
      { kind: "notnow", device: "laptop" },
      { kind: "open", device: "phone" },
      { kind: "move" },
      { kind: "open", device: "phone" },
    ],
  },
];

// ---------------------------------------------------------------------------
// the runner
// ---------------------------------------------------------------------------

export const describeEvent = (event: Event): string => {
  switch (event.kind) {
    case "move":
      return "plant moves a stage (new transition)";
    case "open":
      return `open /tasks on ${event.device}`;
    case "import":
      return `press Import on ${event.device} with [${event.keys
        .map((key) => OFFERS.find((offer) => offer.key === key)?.name)
        .join(", ")}] ticked`;
    case "notnow":
      return `press Not now on ${event.device}`;
  }
};

export const applyEvent = (
  direction: Direction,
  state: State,
  event: Event
): string => {
  switch (event.kind) {
    case "move": {
      state.transitionId += 1;
      return `stage change #${state.transitionId} recorded`;
    }
    case "open": {
      const render = direction.render(state, event.device);
      if (render.offers === null) return render.note;
      const shown = render.offers.map(
        (offer) => `${offer.name} (${offer.taskCount})`
      );
      const locked = (render.locked ?? []).map(
        (offer) => `${offer.name} [Imported]`
      );
      return `prompt: ${[...shown, ...locked].join(" | ")}  -- ${render.note}`;
    }
    case "import":
      return direction.accept(state, event.keys, event.device);
    case "notnow":
      return direction.dismiss(state, event.device);
  }
};

export const totals = (state: State): string => {
  const rows = state.created.reduce(
    (total, entry) => total + entry.taskCount,
    0
  );
  const names = state.created.map(
    (entry) => OFFERS.find((offer) => offer.key === entry.key)?.name
  );
  return `${state.created.length} checklist import(s), ${rows} task rows: ${names.length > 0 ? names.join(", ") : "none"}`;
};

export { rowsOf };
