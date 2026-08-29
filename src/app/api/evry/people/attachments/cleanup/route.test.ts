import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createEvryPeopleAttachmentCleanupGet } from "./route";

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
    sweep: async () => {
      sweeps += 1;
      return { removed: 0, failed: 0 };
    },
  })(request("Bearer anything"));
  assert.equal(response.status, 401);
  assert.equal(sweeps, 0);
});

test("cleanup reports complete and retryable incomplete sweeps", async () => {
  process.env.CRON_SECRET = "cleanup-secret";
  const completed = await createEvryPeopleAttachmentCleanupGet({
    sweep: async () => ({ removed: 4, failed: 0 }),
  })(request("Bearer cleanup-secret"));
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), {
    status: "completed",
    removed: 4,
    failed: 0,
  });

  const incomplete = await createEvryPeopleAttachmentCleanupGet({
    sweep: async () => ({ removed: 3, failed: 1 }),
  })(request("Bearer cleanup-secret"));
  assert.equal(incomplete.status, 503);
  assert.deepEqual(await incomplete.json(), {
    status: "incomplete",
    removed: 3,
    failed: 1,
  });
});
