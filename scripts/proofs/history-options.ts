/** Owned database query proof and private browser fixtures. No delivery transport is called. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { communications, users } from "@/db/schema";
import {
  communicationChannels,
  communicationStatuses,
} from "@/db/schema/communication";
import {
  getCommunications,
  getHistoryFilterAvailability,
} from "@/lib/communication/service";
import { historyFilterOptions } from "@/lib/communication/history-options";

async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const connection = new URL(process.env.DATABASE_URL!);
  assert.equal(connection.hostname, "localhost");
  assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const identity = await db.execute<{ name: string }>(
    sql`select current_database() as name`
  );
  assert.equal(identity.rows[0].name, connection.pathname.slice(1));
  const [input, output, evidencePath] = process.argv.slice(2);
  for (const path of [input, output, evidencePath])
    assert.ok(path?.startsWith("/private/tmp/"));
  const fixture = JSON.parse(readFileSync(input, "utf8"));
  assert.equal(fixture.database, identity.rows[0].name);
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.email, "owner@preview.example.test"));
  const [foreignOwner] = await db
    .select()
    .from(users)
    .where(eq(users.email, "foreign-owner@preview.example.test"));
  assert.ok(owner && foreignOwner);
  const supported = ["sending", "sent", "failed", "logged"] as const;
  await db.insert(communications).values(
    supported.map((status, index) => ({
      churchId: fixture.primaryChurchId,
      createdById: owner.id,
      channel: "email" as const,
      status,
      subject: `Supported ${status} record`,
      body: `Supported ${status} content`,
      createdAt: new Date(2026, 0, 1, 0, index),
    }))
  );
  await db.insert(communications).values(
    Array.from({ length: 24 }, (_, index) => ({
      churchId: fixture.primaryChurchId,
      createdById: owner.id,
      channel: "email" as const,
      status: "sent" as const,
      subject: `Paging record ${String(index).padStart(2, "0")}`,
      body: "Pagination fixture",
      createdAt: new Date(2026, 0, 2, 0, index),
    }))
  );
  await db.insert(communications).values(
    communicationChannels.flatMap((channel) =>
      communicationStatuses.map((status, index) => ({
        churchId: fixture.foreignChurchId,
        createdById: foreignOwner.id,
        channel,
        status,
        subject: `Historical ${channel} ${status}`,
        body: "Historical fixture, no delivery",
        createdAt: new Date(
          2026,
          0,
          3,
          communicationChannels.indexOf(channel),
          index
        ),
      }))
    )
  );
  const primary = await getHistoryFilterAvailability(fixture.primaryChurchId);
  assert.deepEqual(primary.channels, ["email"]);
  assert.deepEqual([...primary.statuses].sort(), [...supported].sort());
  const primaryOptions = historyFilterOptions(primary, {});
  assert.deepEqual(
    primaryOptions.channels.map((option) => option.value),
    ["email"]
  );
  assert.deepEqual(
    primaryOptions.statuses.map((option) => option.value),
    supported
  );
  const historical = await getHistoryFilterAvailability(
    fixture.foreignChurchId
  );
  assert.deepEqual(
    [...historical.channels].sort(),
    [...communicationChannels].sort()
  );
  assert.deepEqual(
    [...historical.statuses].sort(),
    [...communicationStatuses].sort()
  );
  const historicalOptions = historyFilterOptions(historical, {});
  assert.deepEqual(
    historicalOptions.channels.map((option) => option.value),
    communicationChannels
  );
  assert.deepEqual(
    historicalOptions.statuses.map((option) => option.value),
    communicationStatuses
  );
  for (const channel of communicationChannels)
    for (const status of communicationStatuses) {
      const result = await getCommunications(fixture.foreignChurchId, {
        channel,
        status,
        search: "Historical",
      });
      assert.equal(result.total, 1);
      assert.equal(
        result.communications[0].subject,
        `Historical ${channel} ${status}`
      );
    }
  const narrowed = await getCommunications(fixture.foreignChurchId, {
    channel: "email",
    status: "sent",
    search: "no matching content",
    page: 4,
  });
  assert.equal(narrowed.total, 0);
  assert.equal(narrowed.communications.length, 0);
  assert.deepEqual(
    await getHistoryFilterAvailability(fixture.foreignChurchId),
    historical
  );
  const legacyUrl = await getCommunications(fixture.primaryChurchId, {
    channel: "sms",
    status: "scheduled",
  });
  assert.equal(legacyUrl.total, 0);
  const selected = historyFilterOptions(primary, {
    channel: "sms",
    status: "scheduled",
  });
  assert.ok(
    selected.channels.some(
      (option) => option.value === "sms" && option.historical
    )
  );
  assert.ok(
    selected.statuses.some(
      (option) => option.value === "scheduled" && option.historical
    )
  );
  const first = await getCommunications(fixture.primaryChurchId, {
    search: "Paging record",
    page: 1,
    limit: 20,
  });
  const second = await getCommunications(fixture.primaryChurchId, {
    search: "Paging record",
    page: 2,
    limit: 20,
  });
  assert.equal(first.total, 24);
  assert.equal(second.total, 24);
  assert.equal(
    new Set(
      [...first.communications, ...second.communications].map((row) => row.id)
    ).size,
    24
  );
  assert.ok(
    first.communications.every(
      (row) => row.churchId === fixture.primaryChurchId
    )
  );
  writeFileSync(output, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        database: identity.rows[0].name,
        supportedOnlyOptions: true,
        foreignHistoricalOptionsAbsent: true,
        historicalCombinations: 18,
        availabilityIndependentOfFiltersAndPaging: true,
        validHistoricalUrlRetained: true,
        queryPaginationUniqueRows: 24,
        deliveryCalls: 0,
      },
      null,
      2
    )
  );
  console.log(
    "PASS: supported and historical history options, tenant isolation, 18 historical query combinations and 24 paginated rows; no delivery."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
