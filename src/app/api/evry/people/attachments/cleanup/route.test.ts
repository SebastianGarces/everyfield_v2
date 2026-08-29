import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";

import { createEvryPeopleAttachmentCleanupGet, maxDuration } from "./route";

const priorSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (priorSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = priorSecret;
});

function request(token?: string) {
  return new Request(
    "https://everyfield.test/api/evry/people/attachments/cleanup",
    {
      headers: token ? { authorization: token } : undefined,
    }
  );
}

test("cleanup fails closed before touching storage", async () => {
  delete process.env.CRON_SECRET;
  let sweeps = 0;
  const response = await createEvryPeopleAttachmentCleanupGet({
    sweepStaged: async () => {
      sweeps += 1;
      return { removed: 0, failed: 0 };
    },
    sweepPhotos: async () => {
      sweeps += 1;
      return { removed: 0, failed: 0 };
    },
    sweepCommitments: async () => {
      sweeps += 1;
      return { removed: 0, failed: 0 };
    },
  })(request("Bearer anything"));
  assert.equal(response.status, 401);
  assert.equal(sweeps, 0);
});

test("cleanup rejects every non-exact bearer before touching storage", async () => {
  process.env.CRON_SECRET = "cleanup-secret";
  let sweeps = 0;
  const handler = createEvryPeopleAttachmentCleanupGet({
    sweepStaged: async () => {
      sweeps += 1;
      return { removed: 0, failed: 0 };
    },
    sweepPhotos: async () => {
      sweeps += 1;
      return { removed: 0, failed: 0 };
    },
    sweepCommitments: async () => {
      sweeps += 1;
      return { removed: 0, failed: 0 };
    },
  });

  for (const token of [
    undefined,
    "cleanup-secret",
    "Bearer wrong-secret",
    "Basic cleanup-secret",
  ]) {
    const response = await handler(request(token));
    assert.equal(response.status, 401, token);
  }
  assert.equal(sweeps, 0);
});

test("cleanup reports complete and retryable incomplete sweeps", async () => {
  process.env.CRON_SECRET = "cleanup-secret";
  const completed = await createEvryPeopleAttachmentCleanupGet({
    sweepStaged: async () => ({ removed: 1, failed: 0 }),
    sweepPhotos: async () => ({ removed: 2, failed: 0 }),
    sweepCommitments: async () => ({ removed: 1, failed: 0 }),
  })(request("Bearer cleanup-secret"));
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), {
    status: "completed",
    removed: 4,
    failed: 0,
  });

  const incomplete = await createEvryPeopleAttachmentCleanupGet({
    sweepStaged: async () => ({ removed: 1, failed: 0 }),
    sweepPhotos: async () => ({ removed: 1, failed: 1 }),
    sweepCommitments: async () => ({ removed: 1, failed: 0 }),
  })(request("Bearer cleanup-secret"));
  assert.equal(incomplete.status, 503);
  assert.deepEqual(await incomplete.json(), {
    status: "incomplete",
    removed: 3,
    failed: 1,
  });
});

test("a repeated cleanup tick converges after the first successful removal", async () => {
  process.env.CRON_SECRET = "cleanup-secret";
  const remaining = [1, 2, 1];
  const sweep = (index: number) => async () => {
    const removed = remaining[index] ?? 0;
    remaining[index] = 0;
    return { removed, failed: 0 };
  };
  const handler = createEvryPeopleAttachmentCleanupGet({
    sweepStaged: sweep(0),
    sweepPhotos: sweep(1),
    sweepCommitments: sweep(2),
  });

  const first = await handler(request("Bearer cleanup-secret"));
  const replay = await handler(request("Bearer cleanup-secret"));

  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    status: "completed",
    removed: 4,
    failed: 0,
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), {
    status: "completed",
    removed: 0,
    failed: 0,
  });
});

test("GitHub Actions owns one authenticated, bounded hourly cleanup tick", () => {
  const workflow = readFileSync(
    path.join(process.cwd(), ".github/workflows/evry-people-file-cleanup.yml"),
    "utf8"
  );
  const vercel = JSON.parse(
    readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")
  ) as { crons?: readonly Readonly<{ path: string; schedule: string }>[] };

  assert.match(workflow, /- cron: "17 \* \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: evry-people-file-cleanup/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(
    workflow,
    /CLEANUP_URL: https:\/\/everyfield-v2\.vercel\.app\/api\/evry\/people\/attachments\/cleanup/
  );
  assert.match(workflow, /Authorization: Bearer \$CRON_SECRET/);
  assert.match(workflow, /if \[ -z "\$\{CRON_SECRET:-\}" \]/);

  const requestSeconds = Number(/--max-time (\d+)/.exec(workflow)?.[1]);
  const jobMinutes = Number(/timeout-minutes: (\d+)/.exec(workflow)?.[1]);
  assert.equal(requestSeconds, 90);
  assert.equal(jobMinutes, 5);
  assert.ok(requestSeconds > maxDuration);
  assert.ok(jobMinutes * 60 > requestSeconds);
  assert.deepEqual(vercel.crons ?? [], []);
});
