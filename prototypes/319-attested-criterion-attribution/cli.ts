/**
 * DISPOSABLE TUI over `directions.ts`. Run:
 *   pnpm tsx prototypes/319-attested-criterion-attribution/cli.ts
 *
 * [A-D] flips the attribution rule. [1-4] swaps the citation scenario. The
 * three attested rows re-render as the planter would see them, and the grade
 * line reports what each rule missed and what it over-claimed.
 */

import {
  CRITERIA,
  DIRECTIONS,
  SCENARIOS,
  citableManualPaths,
  citationsUnder,
  grade,
  runDirection,
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
let scenarioIndex = 1;
let showLedger = false;

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length);

const standingCell = (standing: string): string =>
  standing === "met"
    ? `${GREEN}met${RESET}    `
    : standing === "not_met"
      ? `${RED}not met${RESET}`
      : `${DIM}unknown${RESET}`;

const render = (): void => {
  console.clear();
  const direction = DIRECTIONS[directionIndex] as Direction;
  const scenario = SCENARIOS[scenarioIndex] as Scenario;

  console.log(
    `${BOLD}#319 — when the judge cites an attested gate by a different legal path, does the row say "Not addressed"?${RESET}\n`
  );
  console.log(
    `${BOLD}Direction ${direction.key}: ${direction.name}${RESET}\n${DIM}${direction.blurb}\nchange: ${direction.diff}${RESET}\n`
  );
  console.log(
    `${BOLD}Scenario ${scenarioIndex + 1}: ${scenario.name}${RESET}\n${DIM}${scenario.note}${RESET}\n`
  );

  console.log(`${DIM}What the judge emitted:${RESET}`);
  for (const insight of scenario.insights) {
    const cited = citationsUnder(direction, insight);
    const rewritten =
      cited.join("|") !== insight.citedPaths.join("|")
        ? ` ${YELLOW}(rewritten by this direction's ledger)${RESET}`
        : "";
    console.log(
      `  ${CYAN}${insight.id}${RESET} ${insight.text}\n      ${DIM}cites ${cited.join(", ")}${RESET}${rewritten}`
    );
  }

  console.log(
    `\n${BOLD}The exit-criteria card, as the planter reads it:${RESET}`
  );
  console.log(
    `  ${DIM}${pad("CRITERION", 34)}${pad("STANDING", 9)}WHAT THE ENGINE SAID${RESET}`
  );
  for (const row of runDirection(direction, scenario)) {
    const said = row.addressed
      ? `${GREEN}addressed by ${row.addressedBy.join(", ")}${RESET}`
      : `${YELLOW}Not addressed${RESET}`;
    console.log(
      `  ${pad(row.criterion.label, 34)}${standingCell(row.standing)}  ${said}`
    );
  }

  const { missed, overclaimed } = grade(direction, scenario);
  console.log(
    `\n${BOLD}Grade vs. what the judge actually wrote about:${RESET}\n` +
      `  missed     ${missed.length === 0 ? `${GREEN}none${RESET}` : `${RED}${missed.join(", ")}${RESET}`}\n` +
      `  over-claimed ${overclaimed.length === 0 ? `${GREEN}none${RESET}` : `${RED}${overclaimed.join(", ")}${RESET}`}`
  );

  if (showLedger) {
    const allowed = direction.ledger(citableManualPaths());
    console.log(`\n${BOLD}Citable manual paths under this direction:${RESET}`);
    for (const path of citableManualPaths()) {
      const ok = allowed.includes(path);
      console.log(`  ${ok ? GREEN + "+" : RED + "-"} ${path}${RESET}`);
    }
    console.log(
      `\n${DIM}Criteria declare: ${CRITERIA.map((c) => c.factPaths.join(",") || "(none)").join(" · ")}${RESET}`
    );
  }

  console.log(
    `\n${DIM}[A-D] direction   [1-4] scenario   [l] toggle citable ledger   [q] quit${RESET}`
  );
};

const keyMap: Record<string, () => void> = {
  a: () => (directionIndex = 0),
  b: () => (directionIndex = 1),
  c: () => (directionIndex = 2),
  d: () => (directionIndex = 3),
  "1": () => (scenarioIndex = 0),
  "2": () => (scenarioIndex = 1),
  "3": () => (scenarioIndex = 2),
  "4": () => (scenarioIndex = 3),
  l: () => (showLedger = !showLedger),
};

const isTTY = process.stdin.isTTY === true;
render();

if (!isTTY) {
  console.log(
    `${DIM}(not a TTY — printing every direction against every scenario instead)${RESET}`
  );
  for (const [i, scenario] of SCENARIOS.entries()) {
    console.log(`\nScenario ${i + 1}: ${scenario.name}`);
    for (const direction of DIRECTIONS) {
      const { missed, overclaimed } = grade(direction, scenario);
      const rows = runDirection(direction, scenario)
        .map(
          (row) =>
            `${row.criterion.key}=${row.addressed ? "addressed" : "NOT-ADDRESSED"}`
        )
        .join(" ");
      console.log(
        `  ${direction.key}: ${rows}  | missed=${missed.join(",") || "none"} overclaimed=${overclaimed.join(",") || "none"}`
      );
    }
  }
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  const key = chunk.toLowerCase();
  if (key === "q" || key === "") {
    console.clear();
    process.exit(0);
  }
  const action = keyMap[key];
  if (action) {
    action();
    render();
  }
});
