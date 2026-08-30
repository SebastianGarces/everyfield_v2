import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlatformEvryInventory,
  classifyPlatformRscCall,
  discoverPlatformRscCalls,
  generatePlatformEvryInventory,
} from "../../../../../ops/evry/platform-inventory";

const repoRoot = process.cwd();

test("platform inventory is generated, closed, and has zero unclassified entries", async () => {
  await generatePlatformEvryInventory({ repoRoot, check: true });
  const inventory = buildPlatformEvryInventory(repoRoot);
  assert.equal(inventory.summary.unclassified, 0);
  assert.deepEqual(
    inventory.capabilities.map(({ identity }) => identity).toSorted(),
    [
      "dashboard.summary.get",
      "notifications.badge.unread-count",
      "notifications.feed.list",
      "notifications.feed.mark-all-read",
      "notifications.feed.mark-one-read",
      "platform.feedback.submit",
    ]
  );
  assert.equal(inventory.summary.actions, 9);
  assert.equal(inventory.summary.routes, 3);
  assert.equal(inventory.summary.rscReads, 4);
  assert.equal(inventory.summary.excluded, 6);
});

test("platform inventory discovers owning RSC calls through their symbols", () => {
  assert.deepEqual(
    discoverPlatformRscCalls(repoRoot).map(({ exportName }) => exportName),
    [
      "getDashboardMetrics",
      "getRecentActivity",
      "loadUnreadBadgeCountSafely",
      "loadNotificationFeedScreen",
    ]
  );
  assert.throws(
    () =>
      classifyPlatformRscCall({
        source: "src/app/(dashboard)/notifications/page.tsx",
        owner: "src/lib/notifications/feed.ts",
        exportName: "newOwningOperation",
      }),
    /Unclassified platform RSC operation/
  );
});
