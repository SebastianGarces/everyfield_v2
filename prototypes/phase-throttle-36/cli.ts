// ============================================================================
// THROWAWAY PROTOTYPE — #36 throughput ruling. Never merges.
//
// The question: with MAX_BATCH cut 25 -> 10, does a DAILY cron still close #36
// ("the real cost is staleness"), or does this track also need the frequency
// change?
//
// Prose can only tell you "roughly halved". This simulates the four directions
// against the real selection rule (it imports the production
// `filterDirtyOrStale`, not a copy) and reports the number #36 is actually
// about: how long a plant waits between a material event and the fresh
// assessment that reflects it.
//
// Run:  pnpm tsx prototypes/phase-throttle-36/cli.ts
// ============================================================================

import * as readline from "node:readline";

import {
  filterDirtyOrStale,
  MAX_STALENESS_MS,
  type PlantSelectionInput,
} from "../../src/lib/phase-engine/assessment/dirty";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

type Ordering = "table" | "oldest-first";

interface Direction {
  key: string;
  name: string;
  what: string;
  /** Hours of the day the route is driven. */
  tickHours: number[];
  maxBatch: number;
  ordering: Ordering;
  cost: string;
}

const DIRECTIONS: Direction[] = [
  {
    key: "A",
    name: "Ship as-is (daily tick, MAX_BATCH=10)",
    what: "vercel.json untouched: one tick at 07:00. Follow-up issue for frequency.",
    tickHours: [7],
    maxBatch: 10,
    ordering: "table",
    cost: "Nothing to build. The tail waits, and because the batch is an UNORDERED slice the same tail waits every day.",
  },
  {
    key: "B",
    name: "Twice-daily GitHub Actions tick",
    what: "New workflow job hitting the route at 07:00 and 19:00 with CRON_SECRET, mirroring notifications-dispatch.yml.",
    tickHours: [7, 19],
    maxBatch: 10,
    ordering: "table",
    cost: "Touches deploy config no workstream declared. Doubles OpenAI spend per day. Still unordered, so fairness is luck.",
  },
  {
    key: "C",
    name: "Daily tick + oldest-assessed-first ordering",
    what: "vercel.json untouched; sort the selection by latestAssessmentAt before slicing MAX_BATCH.",
    tickHours: [7],
    maxBatch: 10,
    ordering: "oldest-first",
    cost: "A few lines inside the track's own files, no deploy config. Throughput is still 10/day — it bounds the tail, it does not shrink it.",
  },
  {
    key: "D",
    name: "Twice-daily tick + oldest-first ordering",
    what: "B and C together: frequency for throughput, ordering for fairness.",
    tickHours: [7, 19],
    maxBatch: 10,
    ordering: "oldest-first",
    cost: "Largest diff of the four, and the only one that makes #36's impact statement plainly true for a 15-plant cohort.",
  },
];

// ---------------------------------------------------------------------------
// Scenario knobs
// ---------------------------------------------------------------------------

interface Scenario {
  plants: number;
  /** Probability a given plant sees a material event on a given day. */
  eventRate: number;
  days: number;
  seed: number;
}

let scenario: Scenario = {
  plants: 15, // top of the alpha cohort — the contentious case
  eventRate: 0.6,
  days: 21,
  seed: 36,
};

// Deterministic PRNG so a ruling can be reproduced.
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

interface Result {
  ticks: number;
  assessed: number;
  /** Hours from a material event to the assessment that first reflected it. */
  latencies: number[];
  /** Events still unreflected when the simulation ended. */
  unresolved: number;
  /** Worst per-plant gap between consecutive assessments, in hours. */
  worstGapHours: number;
  /** Plants never assessed at all in the window. */
  neverAssessed: number;
  /** Selected-but-skipped per tick, averaged. */
  avgBacklog: number;
}

function simulate(dir: Direction, sc: Scenario): Result {
  const rng = makeRng(sc.seed);
  const t0 = 0;

  // Plant state. `order` is the stable table order the production slice uses.
  const plants = Array.from({ length: sc.plants }, (_, i) => ({
    id: `plant-${String(i + 1).padStart(2, "0")}`,
    latestAssessmentAt: null as number | null,
    /** Every material event this plant has ever seen, in order. */
    events: [] as number[],
    /** Timestamps of events not yet reflected by an assessment. */
    pendingEvents: [] as number[],
    lastAssessedAt: null as number | null,
    worstGap: 0,
  }));

  const latencies: number[] = [];
  let assessed = 0;
  let ticks = 0;
  let backlogSum = 0;

  for (let day = 0; day < sc.days; day++) {
    // Events land through the day at a random hour.
    for (const p of plants) {
      if (rng() < sc.eventRate) {
        const at = t0 + day * DAY + Math.floor(rng() * 24) * HOUR;
        p.events.push(at);
        p.pendingEvents.push(at);
      }
    }

    for (const hour of dir.tickHours) {
      const now = t0 + day * DAY + hour * HOUR;
      ticks++;

      const inputs: PlantSelectionInput[] = plants.map((p) => {
        // The column holds the latest event that has ALREADY landed at `now` —
        // an event later today has not been written yet.
        const landed = p.events.filter((e) => e <= now);
        return {
          churchId: p.id,
          lastMaterialEventAt:
            landed.length > 0 ? new Date(Math.max(...landed)) : null,
          latestAssessmentAt:
            p.latestAssessmentAt !== null
              ? new Date(p.latestAssessmentAt)
              : null,
        };
      });

      let selected = filterDirtyOrStale(
        inputs,
        new Date(now),
        MAX_STALENESS_MS
      ).map((s) => plants.find((p) => p.id === s.churchId)!);

      if (dir.ordering === "oldest-first") {
        selected = [...selected].sort(
          (a, b) => (a.latestAssessmentAt ?? -1) - (b.latestAssessmentAt ?? -1)
        );
      }

      const batch = selected.slice(0, dir.maxBatch);
      backlogSum += selected.length - batch.length;

      for (const p of batch) {
        assessed++;
        if (p.lastAssessedAt !== null) {
          p.worstGap = Math.max(p.worstGap, (now - p.lastAssessedAt) / HOUR);
        }
        for (const e of p.pendingEvents) {
          if (e <= now) latencies.push((now - e) / HOUR);
        }
        p.pendingEvents = p.pendingEvents.filter((e) => e > now);
        p.latestAssessmentAt = now;
        p.lastAssessedAt = now;
      }
    }
  }

  return {
    ticks,
    assessed,
    latencies,
    unresolved: plants.reduce((n, p) => n + p.pendingEvents.length, 0),
    worstGapHours: Math.max(0, ...plants.map((p) => p.worstGap)),
    neverAssessed: plants.filter((p) => p.lastAssessedAt === null).length,
    avgBacklog: ticks === 0 ? 0 : backlogSum / ticks,
  };
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function hours(n: number): string {
  if (n >= 48) return `${(n / 24).toFixed(1)}d`;
  return `${n.toFixed(1)}h`;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function header(): void {
  console.log("");
  console.log("  #36 — how stale may alpha guidance be?");
  console.log(
    `  cohort=${scenario.plants} plants · eventRate=${scenario.eventRate} /plant/day · ${scenario.days} days · seed=${scenario.seed}`
  );
  console.log(
    "  MAX_BATCH=10 in every direction (the arithmetic rules out raising it)."
  );
  console.log("");
}

function runOne(dir: Direction): void {
  const r = simulate(dir, scenario);
  console.log(`  ${dir.key}. ${dir.name}`);
  console.log(`     ${dir.what}`);
  console.log("");
  console.log(
    `     assessments/day        ${(r.assessed / scenario.days).toFixed(1)}   (${r.ticks} ticks over ${scenario.days} days)`
  );
  console.log(
    `     event -> fresh advice  median ${hours(pct(r.latencies, 50))} · p95 ${hours(pct(r.latencies, 95))} · worst ${hours(Math.max(0, ...r.latencies))}`
  );
  console.log(`     worst re-assessment gap  ${hours(r.worstGapHours)}`);
  console.log(
    `     rolled-over per tick   ${r.avgBacklog.toFixed(1)}   · events still unreflected at the end: ${r.unresolved}`
  );
  console.log(`     cost: ${dir.cost}`);
  console.log("");
}

function compare(): void {
  header();
  const rows = DIRECTIONS.map((d) => ({ d, r: simulate(d, scenario) }));
  console.log(
    "   | direction                    | /day | median | p95    | worst  | backlog"
  );
  console.log(
    "   |------------------------------|------|--------|--------|--------|--------"
  );
  for (const { d, r } of rows) {
    const name = d.name.slice(0, 28).padEnd(28);
    console.log(
      `   ${d.key} | ${name} | ${(r.assessed / scenario.days).toFixed(1).padStart(4)} | ${hours(pct(r.latencies, 50)).padStart(6)} | ${hours(pct(r.latencies, 95)).padStart(6)} | ${hours(Math.max(0, ...r.latencies)).padStart(6)} | ${r.avgBacklog.toFixed(1).padStart(4)}`
    );
  }
  console.log("");
  console.log(
    "   median/p95/worst = hours from a material event to the assessment that reflects it."
  );
  console.log("   backlog = plants selected but not assessed, per tick.");
  console.log("");
}

function menu(): void {
  console.log("  [1] A  ship as-is        [2] B  twice-daily tick");
  console.log("  [3] C  daily + ordering  [4] D  twice-daily + ordering");
  console.log(
    "  [x] compare all   [p] cohort size   [e] event rate   [d] days   [s] seed   [q] quit"
  );
  console.log("");
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string, then: (answer: string) => void): void {
  rl.question(`  ${question} `, (a) => {
    then(a.trim());
    loop();
  });
}

function loop(): void {
  menu();
  rl.question("  > ", (raw) => {
    const cmd = raw.trim().toLowerCase();
    switch (cmd) {
      case "1":
        header();
        runOne(DIRECTIONS[0]);
        return loop();
      case "2":
        header();
        runOne(DIRECTIONS[1]);
        return loop();
      case "3":
        header();
        runOne(DIRECTIONS[2]);
        return loop();
      case "4":
        header();
        runOne(DIRECTIONS[3]);
        return loop();
      case "x":
        compare();
        return loop();
      case "p":
        return ask("cohort size (plants):", (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0)
            scenario = { ...scenario, plants: n };
        });
      case "e":
        return ask("event rate per plant per day (0-1):", (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0 && n <= 1)
            scenario = { ...scenario, eventRate: n };
        });
      case "d":
        return ask("days to simulate:", (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) scenario = { ...scenario, days: n };
        });
      case "s":
        return ask("seed:", (v) => {
          const n = Number(v);
          if (Number.isFinite(n)) scenario = { ...scenario, seed: n };
        });
      case "q":
        rl.close();
        return;
      default:
        console.log("  ?");
        return loop();
    }
  });
}

if (process.argv.includes("--compare")) {
  compare();
  rl.close();
} else {
  compare();
  loop();
}
