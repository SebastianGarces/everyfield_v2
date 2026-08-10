/**
 * Disposable TUI over `directions.ts`. Run:
 *   pnpm tsx prototypes/312-evaluation-comparison-window/cli.ts
 *
 * [a/b/c/d] flips the direction, [1-5] flips the church/meeting, and the card
 * a planter would read is printed for the current pair.
 */

import {
  DIRECTIONS,
  SCENARIOS,
  type Direction,
  type Scenario,
} from "./directions";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

let directionIndex = 0;
let scenarioIndex = 2;
let showAll = false;
const CTRL_C = "\u0003";

const cardFor = (direction: Direction, scenario: Scenario) => {
  const current = scenario.all.find((m) => m.meetingId === scenario.currentId)!;
  return { card: direction.render(scenario.all, current), current };
};

const printCard = (direction: Direction, scenario: Scenario, indent = "") => {
  const { card, current } = cardFor(direction, scenario);
  const box = (line: string) => console.log(`${indent}  │ ${line}`);

  console.log(
    `${indent}  ┌─ Compared with previous meetings ${DIM}(${card.testid})${RESET}`
  );
  if (card.headline) {
    box(`${BOLD}${card.headline}${RESET}`);
    for (const figure of card.figures) box(`${DIM}${figure}${RESET}`);
  }
  for (const line of wrap(card.prose, 76)) box(line);
  console.log(`${indent}  └─`);

  const earlier = scenario.all.filter(
    (m) => m.datetime.getTime() < current.datetime.getTime()
  ).length;
  const coverage =
    card.baselineCount === null
      ? "no baseline"
      : `baseline covers ${card.baselineCount} of them`;
  console.log(
    `${indent}  ${DIM}truth: ${earlier} evaluated meeting(s) exist before this one · ${coverage} · ${card.cost}${RESET}`
  );
  console.log(
    card.lies
      ? `${indent}  ${RED}✗ tells the planter something untrue about their own data${RESET}`
      : `${indent}  ${GREEN}✓ nothing on this card is false${RESET}`
  );
};

const wrap = (text: string, width: number): string[] => {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else {
      line += " " + word;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
};

const DUMP = process.argv.includes("--dump");

const render = (): void => {
  if (!DUMP) console.clear();
  const scenario = SCENARIOS[scenarioIndex]!;

  console.log(
    `${BOLD}#312 / VM-016c — what does a planter see when their earlier meetings are outside the comparison window?${RESET}\n`
  );
  console.log(
    `${BOLD}Scenario ${scenario.key}: ${scenario.name}${RESET}\n${DIM}${scenario.why}${RESET}\n`
  );

  if (showAll) {
    for (const direction of DIRECTIONS) {
      console.log(`${CYAN}${BOLD}[${direction.key}] ${direction.name}${RESET}`);
      printCard(direction, scenario);
      console.log("");
    }
  } else {
    const direction = DIRECTIONS[directionIndex]!;
    console.log(
      `${CYAN}${BOLD}Direction ${direction.key}: ${direction.name}${RESET}\n${DIM}${wrap(direction.blurb, 96).join("\n")}${RESET}\n`
    );
    printCard(direction, scenario);
  }

  const liars = DIRECTIONS.filter((d) => cardFor(d, scenario).card.lies).map(
    (d) => d.key.toUpperCase()
  );
  console.log(
    liars.length
      ? `\n${YELLOW}On this scenario, direction(s) ${liars.join(", ")} render a false statement.${RESET}`
      : `\n${GREEN}On this scenario, no direction renders a false statement.${RESET}`
  );

  console.log(
    `\n${DIM}[a/b/c/d] direction   [1-5] scenario   [s] ${showAll ? "one direction" : "all four side by side"}   [q] quit${RESET}`
  );
};

const keys: Record<string, () => void> = {
  a: () => ((directionIndex = 0), (showAll = false)),
  b: () => ((directionIndex = 1), (showAll = false)),
  c: () => ((directionIndex = 2), (showAll = false)),
  d: () => ((directionIndex = 3), (showAll = false)),
  s: () => (showAll = !showAll),
};

// Non-interactive: `--dump` prints every scenario against every direction and
// exits. Used to verify all four options before presenting them.
if (process.argv.includes("--dump")) {
  showAll = true;
  for (let i = 0; i < SCENARIOS.length; i += 1) {
    scenarioIndex = i;
    render();
  }
  process.exit(0);
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  for (const key of chunk.toLowerCase()) {
    if (key === "q" || key === CTRL_C) {
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
