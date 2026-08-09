import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { formatDate, formatTime } from "@/lib/datetime";

// ----------------------------------------------------------------------------
// Meeting reminder email — the pinned wall clock (#169)
//
// This template ran `toLocaleDateString` / `toLocaleTimeString` with no
// `timeZone`, so the reminder stated whatever wall clock the *sending process*
// happened to be in. A worker in a different zone than the one the meeting
// pages render in tells the invitee the wrong hour, and nothing on the page it
// links to agrees with it. memory/invariants.md → Date & Time Rendering.
//
// A meeting late in the UTC evening is the fixture that separates the two: at
// 23:30 UTC an unpinned formatter east of UTC has already rolled over into the
// next calendar day.
// ----------------------------------------------------------------------------

const TEMPLATE = path.join(__dirname, "meeting-reminder.tsx");
const LATE_NIGHT = new Date("2026-07-30T23:30:00Z");

const PROPS = {
  personName: "Maria",
  teamName: "Worship",
  meetingTitle: "Weekly Team Meeting",
  datetime: LATE_NIGHT.toISOString(),
  location: "Room 201",
  agenda: null,
  churchName: "Grace Church",
};

/** Render the reminder in a fresh process running under `timeZone`. */
function renderUnder(timeZone: string): {
  ambientTimeZone: string;
  subject: string;
  html: string;
  text: string;
} {
  const tsx = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "node_modules",
    ".bin",
    "tsx"
  );

  const script = `
    import(${JSON.stringify(TEMPLATE)}).then(async (loaded) => {
      // tsx transforms to CJS, so the namespace may be behind interop default.
      const m =
        typeof loaded.meetingReminderEmail === "function"
          ? loaded
          : loaded.default;
      const props = ${JSON.stringify(PROPS)};
      const rendered = await m.meetingReminderEmail({
        ...props,
        datetime: new Date(props.datetime),
      });
      process.stdout.write(
        JSON.stringify({
          ambientTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...rendered,
        })
      );
    });
  `;

  const stdout = execFileSync(tsx, ["--eval", script], {
    encoding: "utf8",
    env: { ...process.env, TZ: timeZone },
  });

  return JSON.parse(stdout);
}

test("the reminder states the pinned wall clock, not the sender's", () => {
  const sender = renderUnder("Pacific/Kiritimati"); // UTC+14

  assert.equal(
    sender.ambientTimeZone,
    "Pacific/Kiritimati",
    "the child process did not pick up the hostile timezone, so this test proves nothing"
  );

  // What every other surface shows for this meeting.
  assert.equal(formatDate(LATE_NIGHT), "Thursday, July 30, 2026");
  assert.equal(formatTime(LATE_NIGHT), "11:30 PM");

  for (const body of [sender.html, sender.text]) {
    assert.ok(
      body.includes("Thursday, July 30, 2026"),
      "the reminder rolled the meeting onto the sending process's calendar day"
    );
    assert.ok(
      body.includes("11:30 PM"),
      "the reminder stated the sending process's hour"
    );
  }
});

test("a sender west of UTC renders exactly what a sender east of UTC renders", () => {
  const east = renderUnder("Pacific/Kiritimati"); // UTC+14
  const west = renderUnder("Pacific/Niue"); // UTC-11

  assert.equal(west.ambientTimeZone, "Pacific/Niue");

  const { ambientTimeZone: _e, ...eastBody } = east;
  const { ambientTimeZone: _w, ...westBody } = west;
  assert.deepEqual(
    westBody,
    eastBody,
    "the same reminder would reach two invitees stating two different times"
  );
});

test("the template holds no unpinned formatter", () => {
  const source = readFileSync(TEMPLATE, "utf8");

  assert.ok(
    !/\btoLocale(Date|Time)?String\s*\(/.test(source),
    "`toLocale*` follows the runtime's zone — format through @/lib/datetime"
  );
  assert.ok(
    !/from "date-fns"/.test(source),
    "date-fns follows the runtime's zone — format through @/lib/datetime"
  );
  assert.ok(source.includes('from "@/lib/datetime"'));
});
