/**
 * Disposable TUI over `directions.ts`. Run:
 *   pnpm tsx prototypes/375-truncated-5xx/cli.ts
 *
 * Same plants, four rule sets. [1-4] flips the direction and replays the
 * identical plant events; [s] swaps which plants. Direction A is the code as it
 * stands in this PR, so it is the reference every other direction is read against.
 */

import {
  DIRECTIONS,
  SCENARIOS,
  type Direction,
  type Outcome,
} from "./directions";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

let directionIndex = 0;
let scenarioIndex = 0;
let showOutcomes = false;

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length);

/** Pads first, colours after — ANSI codes would otherwise count toward the width. */
const statusCell = (outcome: Outcome): string => {
  const text = pad(outcome.status, 11);
  if (outcome.status === "assessed") return `${GREEN}${text}${RESET}`;
  if (outcome.status === "failed") return `${RED}${text}${RESET}`;
  if (outcome.status === "incomplete") return `${YELLOW}${text}${RESET}`;
  return `${CYAN}${text}${RESET}`;
};

const render = (): void => {
  console.clear();
  const direction = DIRECTIONS[directionIndex] as Direction;
  const scenario = SCENARIOS[scenarioIndex];
  const result = direction.run(scenario.plants);

  console.log(
    `${BOLD}#375 — how should a 5xx retry ladder cut short by the run deadline surface?${RESET}\n`
  );
  console.log(
    `${BOLD}Direction ${direction.key}: ${direction.name}${RESET}` +
      `${direction.key === "A" ? `${DIM}  (= this PR today)${RESET}` : ""}`
  );
  console.log(`${DIM}${direction.blurb}${RESET}\n`);
  console.log(
    `${BOLD}Scenario ${scenarioIndex + 1}/${SCENARIOS.length}: ${scenario.name}${RESET}`
  );
  console.log(`${DIM}${scenario.note}${RESET}\n`);

  // The run summary, as the workflow step `cat`s it.
  console.log(
    `${BOLD}Run summary${RESET} ${DIM}(what the Actions step prints)${RESET}`
  );
  const line = result.summary
    .map(([key, value]) => {
      const cell = `${key}: ${value}`;
      if (key === "failed" && value > 0) return `${RED}${cell}${RESET}`;
      if ((key === "failedTruncated" || key === "incomplete") && value > 0)
        return `${YELLOW}${cell}${RESET}`;
      return cell;
    })
    .join("  ");
  console.log(`  ${line}`);

  const get = (key: string): number =>
    result.summary.find(([k]) => k === key)?.[1] ?? 0;
  const arithmeticHolds =
    get("selected") ===
    get("skipped") + get("attempted") + get("deferredUnattempted");
  console.log(
    `  ${DIM}#374 arithmetic — selected = skipped + attempted + deferredUnattempted: ${
      arithmeticHolds ? "holds" : "BROKEN"
    }${RESET}\n`
  );

  // The log, which is the part a human actually reads at 7am.
  console.log(`${BOLD}Actions log${RESET}`);
  if (result.logs.length === 0) {
    console.log(`  ${DIM}(no warnings, no errors)${RESET}`);
  }
  for (const log of result.logs) {
    const tag =
      log.level === "error" ? `${RED}ERROR${RESET}` : `${YELLOW}WARN ${RESET}`;
    console.log(`  ${tag} ${log.text}`);
  }
  const errors = result.logs.filter((l) => l.level === "error").length;
  console.log(
    `\n  ${DIM}${errors} ERROR line(s) — ${
      errors > 0 ? "this run wakes somebody up" : "this run is quiet"
    }${RESET}\n`
  );

  if (showOutcomes) {
    console.log(`${BOLD}Per-plant outcomes${RESET}`);
    for (const outcome of result.outcomes) {
      const extras = [
        `attempted: ${outcome.attempted}`,
        outcome.deferralReason ? `reason: ${outcome.deferralReason}` : null,
        outcome.truncatedByDeadline ? `truncatedByDeadline: true` : null,
      ].filter((value): value is string => value !== null);
      console.log(
        `  ${pad(outcome.churchId, 10)} ${pad(statusCell(outcome), 20)} ${DIM}${extras.join(", ")}${RESET}`
      );
    }
    console.log("");
  }

  console.log(`${BOLD}Wins${RESET}  ${direction.wins}`);
  console.log(`${BOLD}Costs${RESET} ${direction.costs}\n`);

  console.log(
    `${DIM}[1-4] direction  [s] next scenario  [o] per-plant outcomes  [q] quit${RESET}`
  );
};

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  // A TTY delivers one keypress per chunk; a pipe delivers them all at once, so
  // apply every character and then render a single frame.
  for (const key of chunk.toString()) {
    if (key === "q" || key === "") {
      process.stdin.setRawMode?.(false);
      console.log("");
      process.exit(0);
    }
    if (key >= "1" && key <= String(DIRECTIONS.length)) {
      directionIndex = Number(key) - 1;
    }
    if (key === "s") scenarioIndex = (scenarioIndex + 1) % SCENARIOS.length;
    if (key === "o") showOutcomes = !showOutcomes;
  }
  render();
});

render();
