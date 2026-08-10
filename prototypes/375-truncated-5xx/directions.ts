/**
 * Four directions for #375's open spec question, as pure modules over the same
 * interface. No imports from `src/` on purpose: the question is what the run
 * SUMMARY and the Actions LOG say, not how the pacer computes a backoff.
 *
 * Every direction agrees on every non-contended plant event. They differ on
 * exactly one input: `server_error_deadline` — a 5xx retry ladder stopped by the
 * run's wall-clock deadline rather than by exhausting its attempts.
 */

export type PlantReason = "new" | "dirty" | "stale";

/** How one selected plant ended, as the batch loop observes it. */
export type PlantEvent =
  /** The judge answered. */
  | { kind: "assessed" }
  /** 429 ladder ran out of attempts. `deferred`/`rate_limit` on every direction. */
  | { kind: "throttled_exhausted"; attempts: number }
  /** 429 ladder stopped on the deadline. `deferred`/`time_budget` on every direction. */
  | { kind: "throttled_deadline"; attempts: number }
  /** 5xx ladder ran out of attempts against a broken provider. `failed` on every direction. */
  | { kind: "server_error_exhausted"; attempts: number }
  /** THE CONTENDED CASE: 5xx ladder stopped by the run deadline. */
  | { kind: "server_error_deadline"; attempts: number }
  /** The loop stood the plant down before starting it. `deferred`/`time_budget`, cost 0. */
  | { kind: "never_started" };

export interface PlantRun {
  churchId: string;
  reason: PlantReason;
  event: PlantEvent;
}

export interface Outcome {
  churchId: string;
  reason: PlantReason;
  /** Direction D widens this vocabulary; A/B/C keep the shipped three. */
  status: "assessed" | "failed" | "deferred" | "incomplete";
  attempted: boolean;
  deferralReason?: "rate_limit" | "time_budget";
  /** Direction C only. */
  truncatedByDeadline?: boolean;
  error?: string;
}

export interface LogLine {
  level: "warn" | "error";
  text: string;
}

export interface RunResult {
  outcomes: Outcome[];
  logs: LogLine[];
  /** Ordered so the frame is stable across directions. */
  summary: [string, number][];
}

export interface Direction {
  key: "A" | "B" | "C" | "D";
  name: string;
  blurb: string;
  wins: string;
  costs: string;
  run(plants: PlantRun[]): RunResult;
}

const BAD_GATEWAY = "bad gateway";

/** `route.ts`'s log prefix, reproduced so the frames read like a real Actions log. */
const P = "[phase-engine/assess]";

/**
 * Everything all four directions agree on. Returns `null` for the contended
 * event so each direction can own it and nothing else.
 */
const shared = (
  plant: PlantRun
): { outcome: Outcome; logs: LogLine[] } | null => {
  const { churchId, reason, event } = plant;

  switch (event.kind) {
    case "assessed":
      return {
        outcome: { churchId, reason, status: "assessed", attempted: true },
        logs: [],
      };

    case "throttled_exhausted":
      return {
        outcome: {
          churchId,
          reason,
          status: "deferred",
          attempted: true,
          deferralReason: "rate_limit",
          error: "rate limit deferral",
        },
        logs: [
          {
            level: "warn",
            text: `${P} rate-limit deferral for church ${churchId} (${reason}, rate_limit) after ${event.attempts} provider call(s): the plant stays dirty and is retried on the next run.`,
          },
        ],
      };

    case "throttled_deadline":
      return {
        outcome: {
          churchId,
          reason,
          status: "deferred",
          attempted: true,
          deferralReason: "time_budget",
          error: "rate limit deferral",
        },
        logs: [
          {
            level: "warn",
            text: `${P} rate-limit deferral for church ${churchId} (${reason}, time_budget) after ${event.attempts} provider call(s): the plant stays dirty and is retried on the next run.`,
          },
        ],
      };

    case "server_error_exhausted":
      return {
        outcome: {
          churchId,
          reason,
          status: "failed",
          attempted: true,
          error: BAD_GATEWAY,
        },
        logs: [
          {
            level: "error",
            text: `${P} assessment failed for church ${churchId} (${reason}): ${BAD_GATEWAY}`,
          },
        ],
      };

    case "never_started":
      return {
        outcome: {
          churchId,
          reason,
          status: "deferred",
          attempted: false,
          deferralReason: "time_budget",
        },
        logs: [],
      };

    case "server_error_deadline":
      return null;
  }
};

/** The counters the shipped `AssessRunSummary` already has, plus per-direction extras. */
const summarize = (
  outcomes: Outcome[],
  extra: [string, number][] = []
): [string, number][] => {
  const count = (fn: (o: Outcome) => boolean) => outcomes.filter(fn).length;
  return [
    ["selected", outcomes.length],
    ["attempted", count((o) => o.attempted)],
    ["assessed", count((o) => o.status === "assessed")],
    ["failed", count((o) => o.status === "failed")],
    ...extra,
    ["skipped", 0],
    ["deferred", count((o) => o.status === "deferred")],
    [
      "deferredUnattempted",
      count((o) => o.status === "deferred" && !o.attempted),
    ],
    ["rateLimited", count((o) => o.deferralReason === "rate_limit")],
  ];
};

/** Builds a direction from the one thing that varies. */
const direction = (
  spec: Omit<Direction, "run"> & {
    contended(
      plant: PlantRun,
      attempts: number
    ): { outcome: Outcome; logs: LogLine[] };
    extraCounters?(outcomes: Outcome[]): [string, number][];
  }
): Direction => ({
  key: spec.key,
  name: spec.name,
  blurb: spec.blurb,
  wins: spec.wins,
  costs: spec.costs,
  run(plants) {
    const outcomes: Outcome[] = [];
    const logs: LogLine[] = [];
    for (const plant of plants) {
      const agreed = shared(plant);
      const resolved =
        agreed ??
        spec.contended(
          plant,
          plant.event.kind === "server_error_deadline"
            ? plant.event.attempts
            : 1
        );
      outcomes.push(resolved.outcome);
      logs.push(...resolved.logs);
    }
    return {
      outcomes,
      logs,
      summary: summarize(outcomes, spec.extraCounters?.(outcomes) ?? []),
    };
  },
});

/** A — the code as it stands in this PR. The reference answer. */
const A = direction({
  key: "A",
  name: "Keep it — a broken answer is a failure whatever stopped the ladder",
  blurb:
    "runPacedCall rethrows the 5xx as itself. route.ts records {failed, attempted:true} and console.errors. The deadline only changed WHEN we stop asking, not WHAT the provider said.",
  wins: "Truthful about the provider: it answered, and the answer was broken. Zero new vocabulary, zero new counters, nothing for a consumer to learn. A real outage is never softened into a deferral.",
  costs:
    "A run truncated by its own budget prints `failed: N` and N ERROR lines that are indistinguishable from a genuinely broken judge — after as little as one attempt. The 7am reader pages someone for a clock problem.",
  contended: ({ churchId, reason }) => ({
    outcome: {
      churchId,
      reason,
      status: "failed",
      attempted: true,
      error: BAD_GATEWAY,
    },
    logs: [
      {
        level: "error",
        text: `${P} assessment failed for church ${churchId} (${reason}): ${BAD_GATEWAY}`,
      },
    ],
  }),
});

/** B — route it like the 429 side of the same deadline test. */
const B = direction({
  key: "B",
  name: "Make it a time_budget deferral, exactly like the 429 path",
  blurb:
    "The deadline is the deadline. Whatever the provider was doing, the run stood down on its own clock, so it reports the same {deferred, time_budget} the throttled branch reports.",
  wins: "One rule for 'we ran out of clock', no matter which branch was mid-ladder. `failed` goes back to meaning exactly what it meant on main. A truncated run is quiet, which is correct — nothing is broken.",
  costs:
    "A genuinely broken judge can hide behind a spent budget: 502 on every plant late in a run reports `deferred`, WARN-level, and the outage is invisible until it starts early enough to exhaust attempts. It also overloads `time_budget` with two very different causes.",
  contended: ({ churchId, reason }, attempts) => ({
    outcome: {
      churchId,
      reason,
      status: "deferred",
      attempted: true,
      deferralReason: "time_budget",
      error: BAD_GATEWAY,
    },
    logs: [
      {
        level: "warn",
        text: `${P} time-budget deferral for church ${churchId} (${reason}, time_budget) after ${attempts} provider call(s): last error ${BAD_GATEWAY}. The plant stays dirty and is retried on the next run.`,
      },
    ],
  }),
});

/** C — keep `failed`, mark the truncation. */
const C = direction({
  key: "C",
  name: "Keep failed, but mark the truncation",
  blurb:
    "Status and counters stay as in A, plus `truncatedByDeadline: true` on the outcome, a `failedTruncated` counter, and a distinct WARN line instead of the bare ERROR.",
  wins: "The log separates 'the judge is broken' from 'we ran out of clock' without softening either. `failed: 3, failedTruncated: 3` is self-explaining at 7am; `failed: 3, failedTruncated: 0` still pages you. Nothing hides.",
  costs:
    "A fourth counter and a per-outcome flag on a summary #374 already widened — more to read, and `failed` still needs a second field to interpret. The workflow's field-list comment goes staler.",
  contended: ({ churchId, reason }, attempts) => ({
    outcome: {
      churchId,
      reason,
      status: "failed",
      attempted: true,
      truncatedByDeadline: true,
      error: BAD_GATEWAY,
    },
    logs: [
      {
        level: "warn",
        text: `${P} run budget spent mid-retry for church ${churchId} (${reason}) after ${attempts} provider call(s): last error ${BAD_GATEWAY}. Counted as failed, but the ladder was cut short by the run deadline — not proof the judge is down.`,
      },
    ],
  }),
  extraCounters: (outcomes) => [
    [
      "failedTruncated",
      outcomes.filter((o) => o.truncatedByDeadline === true).length,
    ],
  ],
});

/** D — a third terminal status. */
const D = direction({
  key: "D",
  name: "A third status: `incomplete`",
  blurb:
    "Neither assessed nor failed nor deferred. `incomplete` means: we were mid-ladder against a broken provider and the run ended. It is its own status, its own counter, its own WARN.",
  wins: "No overloading anywhere — `failed` means broken judge, `deferred` means we stood down before/instead of finishing, `incomplete` means we were cut off mid-answer. Reads without needing a second field, and grep/alerting can key on the status alone.",
  costs:
    "The widest blast radius: a new value in a union that route.ts, the response body, and any future consumer must handle, for a state that only exists at the tail of a budgeted run. Easy to argue it is one status too many for how rare it is.",
  contended: ({ churchId, reason }, attempts) => ({
    outcome: {
      churchId,
      reason,
      status: "incomplete",
      attempted: true,
      error: BAD_GATEWAY,
    },
    logs: [
      {
        level: "warn",
        text: `${P} incomplete assessment for church ${churchId} (${reason}) after ${attempts} provider call(s): run deadline reached while retrying ${BAD_GATEWAY}. The plant stays dirty and is retried on the next run.`,
      },
    ],
  }),
  extraCounters: (outcomes) => [
    ["incomplete", outcomes.filter((o) => o.status === "incomplete").length],
  ],
});

export const DIRECTIONS: Direction[] = [A, B, C, D];

const plant = (
  churchId: string,
  reason: PlantReason,
  event: PlantEvent
): PlantRun => ({ churchId, reason, event });

export interface Scenario {
  name: string;
  note: string;
  plants: PlantRun[];
}

export const SCENARIOS: Scenario[] = [
  {
    name: "The flagged case — one 5xx ladder cut by the deadline",
    note: "Exactly what the G3 transcript produced: two good plants, then the clock runs out while the provider is 502-ing. One attempt, then stop.",
    plants: [
      plant("church-0", "dirty", { kind: "assessed" }),
      plant("church-1", "stale", { kind: "assessed" }),
      plant("church-2", "dirty", {
        kind: "server_error_deadline",
        attempts: 1,
      }),
    ],
  },
  {
    name: "07:00 UTC — a run truncated by its own budget",
    note: "Nothing is broken. The provider was flaky at the tail and the deadline arrived. Does this page someone?",
    plants: [
      plant("church-0", "dirty", { kind: "assessed" }),
      plant("church-1", "dirty", { kind: "assessed" }),
      plant("church-2", "stale", {
        kind: "server_error_deadline",
        attempts: 1,
      }),
      plant("church-3", "stale", {
        kind: "server_error_deadline",
        attempts: 2,
      }),
      plant("church-4", "new", { kind: "server_error_deadline", attempts: 1 }),
      plant("church-5", "new", { kind: "never_started" }),
    ],
  },
  {
    name: "The judge really is down — ladders exhausted",
    note: "What `failed` meant on main. Every direction must keep this loud; a direction that quiets THIS is wrong.",
    plants: [
      plant("church-0", "dirty", {
        kind: "server_error_exhausted",
        attempts: 4,
      }),
      plant("church-1", "stale", {
        kind: "server_error_exhausted",
        attempts: 4,
      }),
      plant("church-2", "new", { kind: "server_error_exhausted", attempts: 4 }),
    ],
  },
  {
    name: "B's cost — a broken judge late in a spent run",
    note: "The provider is genuinely down, but the outage starts near the deadline so no ladder gets to exhaust. Watch whether any ERROR line survives.",
    plants: [
      plant("church-0", "dirty", { kind: "assessed" }),
      plant("church-1", "dirty", {
        kind: "server_error_deadline",
        attempts: 1,
      }),
      plant("church-2", "stale", {
        kind: "server_error_deadline",
        attempts: 1,
      }),
      plant("church-3", "stale", {
        kind: "server_error_deadline",
        attempts: 1,
      }),
      plant("church-4", "new", { kind: "server_error_deadline", attempts: 1 }),
    ],
  },
  {
    name: "Mixed — every ending at once",
    note: "Throttled-to-exhaustion, throttled-on-deadline, 5xx-exhausted, 5xx-on-deadline, never started. The full vocabulary in one summary.",
    plants: [
      plant("church-0", "dirty", { kind: "assessed" }),
      plant("church-1", "dirty", { kind: "throttled_exhausted", attempts: 4 }),
      plant("church-2", "stale", { kind: "throttled_deadline", attempts: 2 }),
      plant("church-3", "stale", {
        kind: "server_error_exhausted",
        attempts: 4,
      }),
      plant("church-4", "new", { kind: "server_error_deadline", attempts: 1 }),
      plant("church-5", "new", { kind: "never_started" }),
      plant("church-6", "new", { kind: "never_started" }),
    ],
  },
];
