/**
 * Disposable CLI over `directions.ts`. Run:
 *   pnpm tsx prototypes/393-partial-accept-finality/cli.ts
 *
 * One scenario is replayed through all four directions at once, so the same
 * presses produce four answers side by side. `1`-`5` swaps the scenario;
 * free play (`f`) lets you press Import/Not now yourself.
 */

import { createInterface } from "node:readline/promises";

import {
  DIRECTIONS,
  OFFERS,
  SCENARIOS,
  applyEvent,
  describeEvent,
  initialState,
  totals,
  type Device,
  type Event,
  type State,
} from "./directions";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

const colour = (line: string): string => {
  if (line.includes("DUPLICATE")) return `${RED}${line}${RESET}`;
  if (line.includes("Retired unasked") && !line.includes("none"))
    return `${YELLOW}${line}${RESET}`;
  if (line.startsWith("prompt:")) return `${CYAN}${line}${RESET}`;
  if (line.startsWith("imported")) return `${GREEN}${line}${RESET}`;
  return line;
};

const header = (): void => {
  console.log(`\n${BOLD}PR #393 — what does unticking an offer mean?${RESET}`);
  console.log(
    `${DIM}Phase 2 offers: ${OFFERS.map((offer) => `${offer.name} (${offer.taskCount})`).join(" | ")}${RESET}`
  );
  for (const direction of DIRECTIONS) {
    console.log(`  ${BOLD}${direction.id}${RESET}  ${direction.name}`);
    console.log(`     ${DIM}${direction.blurb}${RESET}`);
    console.log(`     ${DIM}schema: ${direction.schema}${RESET}`);
    console.log(`     ${DIM}copy:   "${direction.copy}"${RESET}`);
  }
};

const runScenario = (index: number): void => {
  const scenario = SCENARIOS[index];
  console.log(
    `\n${BOLD}Scenario ${index + 1}: ${scenario.title}${RESET}\n${DIM}${scenario.question}${RESET}`
  );

  const states = new Map<string, State>(
    DIRECTIONS.map((direction) => [direction.id, initialState()])
  );

  for (const event of scenario.events) {
    console.log(`\n  ${BOLD}> ${describeEvent(event)}${RESET}`);
    for (const direction of DIRECTIONS) {
      const state = states.get(direction.id)!;
      const line = applyEvent(direction, state, event);
      console.log(`    ${BOLD}${direction.id}${RESET}  ${colour(line)}`);
    }
  }

  console.log(`\n  ${BOLD}Ends with${RESET}`);
  for (const direction of DIRECTIONS) {
    console.log(
      `    ${BOLD}${direction.id}${RESET}  ${totals(states.get(direction.id)!)}`
    );
  }
};

const FREE_HELP = `${DIM}free play commands:
  open [laptop|phone]        render /tasks on that device
  import a[,b,c] | import all   press Import with those offers ticked (a=1st, b=2nd, c=3rd)
  notnow [laptop|phone]      press Not now
  move                       move the plant a stage (new transition)
  totals                     what exists in the tasks table
  back                       leave free play${RESET}`;

const parseKeys = (argument: string): string[] => {
  if (argument === "all" || argument === "") return OFFERS.map((o) => o.key);
  const map: Record<string, string> = {
    a: OFFERS[0].key,
    b: OFFERS[1].key,
    c: OFFERS[2].key,
    "1": OFFERS[0].key,
    "2": OFFERS[1].key,
    "3": OFFERS[2].key,
  };
  return argument
    .split(",")
    .map((token) => map[token.trim()])
    .filter(Boolean);
};

const main = async (): Promise<void> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  header();

  let free = false;
  const states = new Map<string, State>(
    DIRECTIONS.map((direction) => [direction.id, initialState()])
  );

  const broadcast = (event: Event): void => {
    console.log(`  ${BOLD}> ${describeEvent(event)}${RESET}`);
    for (const direction of DIRECTIONS) {
      const line = applyEvent(direction, states.get(direction.id)!, event);
      console.log(`    ${BOLD}${direction.id}${RESET}  ${colour(line)}`);
    }
  };

  for (;;) {
    const prompt = free
      ? `\n${BOLD}free>${RESET} `
      : `\n${BOLD}[1-5]${RESET} scenario  ${BOLD}[f]${RESET} free play  ${BOLD}[h]${RESET} directions  ${BOLD}[q]${RESET} quit > `;
    const answer = (await rl.question(prompt)).trim();

    if (answer === "q" || answer === "quit") break;

    if (!free) {
      if (answer === "h") {
        header();
        continue;
      }
      if (answer === "f") {
        free = true;
        console.log(FREE_HELP);
        continue;
      }
      const index = Number(answer) - 1;
      if (Number.isInteger(index) && index >= 0 && index < SCENARIOS.length) {
        runScenario(index);
      } else {
        console.log(`${DIM}pick 1-${SCENARIOS.length}, f, h or q${RESET}`);
      }
      continue;
    }

    const [verb, ...rest] = answer.split(/\s+/);
    const argument = rest.join(" ");
    if (verb === "back") {
      free = false;
      continue;
    }
    if (verb === "help") {
      console.log(FREE_HELP);
      continue;
    }
    if (verb === "move") {
      broadcast({ kind: "move" });
      continue;
    }
    if (verb === "open") {
      broadcast({ kind: "open", device: (argument || "laptop") as Device });
      continue;
    }
    if (verb === "notnow") {
      broadcast({ kind: "notnow", device: (argument || "laptop") as Device });
      continue;
    }
    if (verb === "import") {
      const parts = argument.split(/\s+/);
      const device: Device =
        parts.includes("phone") || parts.includes("laptop")
          ? ((parts.find((p) => p === "phone" || p === "laptop") ??
              "laptop") as Device)
          : "laptop";
      const keys = parseKeys(
        parts.filter((p) => p !== "phone" && p !== "laptop").join(" ")
      );
      if (keys.length === 0) {
        console.log(`${DIM}nothing ticked — try: import a,b${RESET}`);
        continue;
      }
      broadcast({ kind: "import", device, keys });
      continue;
    }
    if (verb === "totals") {
      for (const direction of DIRECTIONS) {
        console.log(
          `    ${BOLD}${direction.id}${RESET}  ${totals(states.get(direction.id)!)}`
        );
      }
      continue;
    }
    console.log(FREE_HELP);
  }

  rl.close();
};

void main();
