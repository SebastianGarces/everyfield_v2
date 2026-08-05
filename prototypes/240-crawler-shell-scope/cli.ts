/**
 * Disposable TUI over `directions.ts`. Run:
 *   pnpm tsx prototypes/240-crawler-shell-scope/cli.ts
 *
 * Same request matrix, four rule sets. [1-4] flips the direction and re-runs
 * the identical inputs; [1-5] on the scenario row swaps which inputs.
 */

import {
  DIRECTIONS,
  SCENARIOS,
  UAS,
  type Direction,
  type Outcome,
  type Request,
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
let showTrace = false;

const uaLabel = (ua: string): string => {
  const entry = Object.entries(UAS).find(([, value]) => value === ua);
  if (entry) return entry[0];
  return ua.slice(0, 14);
};

const statusCell = (outcome: Outcome): string => {
  if (outcome.status === 500) return `${RED}500${RESET}`;
  if (outcome.status === 307)
    return `${GREEN}307 -> ${outcome.location}${RESET}`;
  return `${CYAN}200${RESET}`;
};

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length);

/** The reference answer: what `main` did, so every direction is graded against it. */
const mainDirection = DIRECTIONS[0];

const render = (): void => {
  console.clear();
  const direction = DIRECTIONS[directionIndex] as Direction;
  const scenario = SCENARIOS[scenarioIndex];

  console.log(
    `${BOLD}#240 — how wide should the layout's crawler shell be?${RESET}\n`
  );
  console.log(
    `${BOLD}Direction ${direction.key}: ${direction.name}${RESET}\n${DIM}${direction.blurb}${RESET}\n`
  );
  console.log(
    `${BOLD}Scenario ${scenario.key}: ${scenario.name}${RESET}\n${DIM}${scenario.why}${RESET}\n`
  );

  console.log(
    `${DIM}${pad("route", 22)}${pad("user-agent", 16)}${pad("this direction", 22)}main (== A)${RESET}`
  );

  let regressions = 0;
  for (const request of scenario.requests as Request[]) {
    const outcome = direction.run(request);
    const reference = mainDirection.run(request);
    const differs =
      outcome.status !== reference.status ||
      outcome.location !== reference.location;
    if (differs) regressions += 1;

    const session = request.hasSession ? " +session" : "";
    console.log(
      pad(request.path + session, 22) +
        pad(uaLabel(request.ua), 16) +
        pad(statusCell(outcome), 22 + 9) +
        `${DIM}${reference.status}${reference.location ? ` -> ${reference.location}` : ""}${RESET}` +
        (differs ? `  ${YELLOW}<- differs${RESET}` : "")
    );

    if (showTrace) {
      for (const step of outcome.steps) {
        console.log(`${DIM}    ${pad(step.actor, 8)}${step.detail}${RESET}`);
      }
    }
  }

  console.log(
    regressions === 0
      ? `\n${GREEN}Same as main on every request in this scenario.${RESET}`
      : `\n${YELLOW}${regressions} request(s) differ from main's behaviour.${RESET}`
  );

  console.log(
    `\n${DIM}[a/b/c/d] direction   [1-5] scenario   [t] ${showTrace ? "hide" : "show"} per-request trace   [q] quit${RESET}`
  );
};

const keys: Record<string, () => void> = {
  a: () => (directionIndex = 0),
  b: () => (directionIndex = 1),
  c: () => (directionIndex = 2),
  d: () => (directionIndex = 3),
  t: () => (showTrace = !showTrace),
};

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  // Character by character, so a pasted or piped "b3" acts like two keypresses.
  for (const key of chunk.toLowerCase()) {
    if (key === "q" || key === "\u0003") {
      console.clear();
      process.exit(0);
    }
    const scenario = SCENARIOS.findIndex((entry) => entry.key === key);
    if (scenario >= 0) scenarioIndex = scenario;
    keys[key]?.();
  }
  render();
});

render();
