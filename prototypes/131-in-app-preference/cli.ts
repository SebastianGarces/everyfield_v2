/**
 * Throwaway TUI for PR #223's spec-question: what does turning OFF the in_app
 * channel mean? Four directions, one action log, replayed on every keypress.
 *
 *   pnpm tsx prototypes/131-in-app-preference/cli.ts
 */

import {
  DIRECTIONS,
  statusFor,
  type Direction,
  type NotificationRow,
  type StatusRule,
  type World,
} from "./directions";

// ---------------------------------------------------------------------------
// actions + replay
// ---------------------------------------------------------------------------

type Action =
  | { type: "enqueue"; title: string; dueInMinutes: number }
  | { type: "pref"; channel: "in_app" | "email"; enabled: boolean }
  | { type: "dispatch" }
  | { type: "advance"; minutes: number }
  | { type: "readAll" };

const initialWorld = (): World => ({
  now: 0,
  prefs: { inApp: true, email: true },
  notifications: [],
  deliveries: [],
  emailsSent: 0,
  seq: 1,
});

function apply(
  world: World,
  action: Action,
  direction: Direction,
  rule: StatusRule
): World {
  const next: World = {
    ...world,
    prefs: { ...world.prefs },
    notifications: world.notifications.map((n) => ({ ...n })),
    deliveries: world.deliveries.map((d) => ({ ...d })),
  };

  switch (action.type) {
    case "pref":
      if (action.channel === "in_app") next.prefs.inApp = action.enabled;
      else next.prefs.email = action.enabled;
      return next;

    case "advance":
      next.now += action.minutes;
      return next;

    case "readAll": {
      const visible = new Set(
        direction.feed(effective(next, direction)).map((n) => n.id)
      );
      for (const n of next.notifications) {
        if (visible.has(n.id) && n.readAt === null) n.readAt = next.now;
      }
      return next;
    }

    case "enqueue": {
      const row = direction.enqueue(
        effective(next, direction),
        action.title,
        action.dueInMinutes
      );
      next.notifications.push(row);
      next.seq += 1;
      return next;
    }

    case "dispatch": {
      for (const row of next.notifications) {
        const alreadySettled = next.deliveries.some(
          (d) => d.notificationId === row.id
        );
        if (row.status !== "pending") continue;
        if (alreadySettled) continue;
        if (row.scheduledFor > next.now) continue;

        const written = direction.deliveriesFor(
          effective(next, direction),
          row
        );
        for (const w of written) {
          next.deliveries.push({ notificationId: row.id, ...w });
          if (w.channel === "email" && w.status === "sent")
            next.emailsSent += 1;
        }
        row.status = statusFor(written, rule);
      }
      return next;
    }
  }
}

/** A view of the world with the direction's own reading of the preferences. */
const effective = (world: World, direction: Direction): World => ({
  ...world,
  prefs: direction.effectivePrefs(world.prefs),
});

function replay(log: Action[], direction: Direction, rule: StatusRule): World {
  return log.reduce(
    (world, action) => apply(world, action, direction, rule),
    initialWorld()
  );
}

// ---------------------------------------------------------------------------
// preloaded scenarios — the contentious cases, one keypress away
// ---------------------------------------------------------------------------

const off = (channel: "in_app" | "email"): Action => ({
  type: "pref",
  channel,
  enabled: false,
});
const on = (channel: "in_app" | "email"): Action => ({
  type: "pref",
  channel,
  enabled: true,
});
const task = (title: string, dueInMinutes = 0): Action => ({
  type: "enqueue",
  title,
  dueInMinutes,
});

const SCENARIOS: { name: string; note: string; log: Action[] }[] = [
  {
    name: "0 · empty (drive it yourself)",
    note: "Both channels on, nothing enqueued.",
    log: [],
  },
  {
    name: "1 · N-005 as written: tasks in-app OFF, email ON",
    note: "The case the FRD names explicitly. Preference set first, then three task notifications arrive and a tick runs.",
    log: [
      off("in_app"),
      task("Task assigned: call the landlord"),
      task("Task assigned: order chairs"),
      task("Task due today: launch team invite"),
      { type: "dispatch" },
    ],
  },
  {
    name: "2 · the user turns it off AFTER the items arrive",
    note: "Three tasks are already queued when the toggle is flipped. Retroactive or not?",
    log: [
      task("Task assigned: call the landlord"),
      task("Task assigned: order chairs"),
      task("Task due today: launch team invite"),
      off("in_app"),
      { type: "dispatch" },
    ],
  },
  {
    name: "3 · a reminder scheduled 2h out, in-app OFF",
    note: "The leak window: enqueue writes the feed row now, dispatch only records the suppression when the row comes due. Press [t] to advance 15m at a time and watch it.",
    log: [off("in_app"), task("Reminder: leaders meeting", 120)],
  },
  {
    name: "4 · fully opted out of tasks (both channels off)",
    note: "Nothing is sent anywhere. What should notifications.status say? Toggle [x].",
    log: [
      off("in_app"),
      off("email"),
      task("Task assigned: call the landlord"),
      task("Task assigned: order chairs"),
      { type: "dispatch" },
    ],
  },
  {
    name: "5 · turned off, then turned back on a week later",
    note: "Does the history come back, or is it gone for good?",
    log: [
      off("in_app"),
      task("Task assigned: call the landlord"),
      task("Task assigned: order chairs"),
      { type: "dispatch" },
      { type: "advance", minutes: 60 },
      on("in_app"),
      { type: "dispatch" },
    ],
  },
];

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else line += " " + word;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l) => indent + l).join("\n");
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `t+${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function renderRow(world: World, n: NotificationRow, inFeed: boolean): string {
  const del = world.deliveries.filter((d) => d.notificationId === n.id);
  const log =
    del.length === 0
      ? D("(no delivery rows yet)")
      : del
          .map((d) => {
            const label = `${d.channel}:${d.status === "sent" ? "sent" : "suppressed"}`;
            return d.status === "sent" ? G(label) : Y(label);
          })
          .join(" ");
  const seen = inFeed ? G("IN FEED") : R("hidden ");
  const read = n.readAt === null ? "unread" : "read  ";
  const due =
    n.scheduledFor > world.now ? D(` due ${clock(n.scheduledFor)}`) : "";
  return `  ${seen}  ${n.title.padEnd(38).slice(0, 38)} ${D(read)} ${D(n.status.padEnd(9))} ${log}${due}`;
}

function render(state: {
  direction: Direction;
  rule: StatusRule;
  scenario: number;
  log: Action[];
}): void {
  const { direction, rule } = state;
  const world = replay(state.log, direction, rule);
  const feedIds = new Set(
    direction.feed(effective(world, direction)).map((n) => n.id)
  );
  const badge = direction.unreadCount(effective(world, direction));
  const prefs = direction.effectivePrefs(world.prefs);
  const width = Math.min(process.stdout.columns ?? 100, 108);

  console.clear();
  console.log(B("  PR #223 — what does turning OFF the in_app channel mean?"));
  console.log(D("  " + "─".repeat(width - 4)));
  console.log("  " + B(direction.name));
  console.log(wrap(direction.blurb, width - 6, "    ") + "\n");
  console.log(
    "    " +
      G("wins  ") +
      wrap(direction.wins, width - 12, "")
        .replace(/\n/g, "\n          ")
        .trimStart()
  );
  console.log(
    "    " +
      Y("costs ") +
      wrap(direction.costs, width - 12, "")
        .replace(/\n/g, "\n          ")
        .trimStart()
  );
  console.log(D("  " + "─".repeat(width - 4)));

  const prefLine = [
    `in_app ${prefs.inApp ? G("on ") : R("off")}`,
    `email ${prefs.email ? G("on ") : R("off")}`,
  ].join("   ");
  const forced =
    prefs.inApp !== world.prefs.inApp
      ? Y("  (this direction ignores the in_app toggle)")
      : "";
  console.log(
    `  ${B("clock")} ${clock(world.now)}    ${B("tasks prefs")} ${prefLine}${forced}`
  );
  console.log(
    `  ${B("unread badge")} ${badge === 0 ? G("0") : Y(String(badge))}    ${B("emails sent")} ${world.emailsSent}    ${B("status rule")} ${rule === "delivered" ? "all-suppressed → delivered (today)" : "all-suppressed → opted_out (new status)"}`
  );
  console.log("");
  console.log(B("  scenario ") + SCENARIOS[state.scenario].name);
  console.log(wrap(SCENARIOS[state.scenario].note, width - 6, "    "));
  console.log("");

  if (world.notifications.length === 0) {
    console.log(D("    (no notifications — press [e] to enqueue one)"));
  } else {
    for (const n of world.notifications) {
      console.log(renderRow(world, n, feedIds.has(n.id)));
    }
  }

  console.log("");
  console.log(D("  " + "─".repeat(width - 4)));
  console.log(
    "  " +
      [
        `${B("[1-4]")} direction`,
        `${B("[s]")} next scenario`,
        `${B("[x]")} status rule`,
        `${B("[q]")} quit`,
      ].join("   ")
  );
  console.log(
    "  " +
      [
        `${B("[e]")} enqueue due now`,
        `${B("[f]")} enqueue +2h`,
        `${B("[i]")} toggle in_app pref`,
        `${B("[m]")} toggle email pref`,
      ].join("   ")
  );
  console.log(
    "  " +
      [
        `${B("[d]")} run dispatch tick`,
        `${B("[t]")} advance 15m`,
        `${B("[r]")} mark feed read`,
        `${B("[u]")} undo`,
        `${B("[0]")} reset scenario`,
      ].join("   ")
  );
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

const state = {
  direction: DIRECTIONS[0],
  rule: "delivered" as StatusRule,
  scenario: 1,
  log: [...SCENARIOS[1].log],
};

let enqueued = 0;
const nextTitle = () => {
  enqueued += 1;
  return `Task assigned: item ${enqueued}`;
};

function currentPrefs() {
  return replay(state.log, state.direction, state.rule).prefs;
}

function key(input: string): void {
  switch (input) {
    case "1":
    case "2":
    case "3":
    case "4":
      state.direction = DIRECTIONS[Number(input) - 1];
      break;
    case "s":
      state.scenario = (state.scenario + 1) % SCENARIOS.length;
      state.log = [...SCENARIOS[state.scenario].log];
      break;
    case "0":
      state.log = [...SCENARIOS[state.scenario].log];
      break;
    case "x":
      state.rule = state.rule === "delivered" ? "distinct" : "delivered";
      break;
    case "e":
      state.log.push(task(nextTitle()));
      break;
    case "f":
      state.log.push(task(nextTitle(), 120));
      break;
    case "i":
      state.log.push({
        type: "pref",
        channel: "in_app",
        enabled: !currentPrefs().inApp,
      });
      break;
    case "m":
      state.log.push({
        type: "pref",
        channel: "email",
        enabled: !currentPrefs().email,
      });
      break;
    case "d":
      state.log.push({ type: "dispatch" });
      break;
    case "t":
      state.log.push({ type: "advance", minutes: 15 });
      break;
    case "r":
      state.log.push({ type: "readAll" });
      break;
    case "u":
      state.log.pop();
      break;
    case "q":
    case "\u0003":
      console.clear();
      process.exit(0);
  }
  render(state);
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  // one frame per character, so a pasted/piped sequence replays like typing
  for (const char of chunk.toString()) key(char);
});

render(state);
