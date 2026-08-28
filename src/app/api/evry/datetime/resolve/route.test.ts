import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

function runProof(viewerTimeZone: string): unknown {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/app/api/evry/datetime/resolve/request-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://ci:ci@localhost:5432/ci",
        TZ: viewerTimeZone,
      },
      timeout: 30_000,
    }
  );

  assert.equal(
    proof.status,
    0,
    `datetime request proof failed under ${viewerTimeZone}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  assert.match(proof.stdout, /Evry datetime request proof passed/);

  const resultLine = proof.stdout
    .split("\n")
    .find((line) => line.startsWith("EVRY_DATETIME_RESULT "));
  assert.ok(resultLine);
  return JSON.parse(resultLine.slice("EVRY_DATETIME_RESULT ".length));
}

test("the Request/Response resolver is invariant across viewer timezones", () => {
  const easternViewer = runProof("America/New_York");
  const islandViewer = runProof("Pacific/Kiritimati");

  assert.deepEqual(easternViewer, islandViewer);
  assert.deepEqual(easternViewer, {
    status: "resolved",
    dateTime: {
      calendarDate: "2026-08-28",
      localTime: "12:30 AM",
      timeZone: "America/Chicago",
      utcOffset: "-05:00",
      instantUtc: "2026-08-28T05:30:00.000Z",
      interpretation: {
        basis: "plant-relative-day",
        sourceText: "tomorrow at 12:30 AM",
        relativeDay: "tomorrow",
        referenceInstantUtc: "2026-08-28T04:30:00.000Z",
        referenceCalendarDate: "2026-08-27",
      },
    },
  });
});
