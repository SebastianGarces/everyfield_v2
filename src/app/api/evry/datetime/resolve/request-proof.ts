import assert from "node:assert/strict";
import { mock } from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  EVRY_DATE_BEARING_SUBJECTS,
  type EvryDateBearingConfirmationEvidence,
} from "@/lib/evry/artifacts/types";
import type { EvryDateTimeResolution } from "@/lib/evry/resolvers/datetime";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const PLANT_ID = "10000000-0000-4000-8000-000000000001";
const CAPABILITY_IDENTITY =
  "action:src/app/(dashboard)/meetings/actions.ts → createMeetingAction";
const REFERENCE_INSTANT = "2026-08-28T04:30:00.000Z";

let sessionSequence: Array<SessionUser | null> = [];
let storedTimeZone: string | null = "America/New_York";
const queriedPlantIds: unknown[] = [];
const dialect = new PgDialect();

const fakeDatabase = {
  select() {
    return {
      from() {
        return {
          where(predicate: SQL) {
            const query = dialect.sqlToQuery(predicate);
            assert.equal(query.sql, '"churches"."id" = $1');
            queriedPlantIds.push(query.params[0]);
            return {
              async limit() {
                return storedTimeZone === null
                  ? []
                  : [{ timeZone: storedTimeZone }];
              },
            };
          },
        };
      },
    };
  },
};

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      const user = sessionSequence.shift() ?? null;
      if (!user) throw new Error("Unauthorized");
      return { user };
    },
  },
});
mock.module("@/db", { namedExports: { db: fakeDatabase } });

function user(
  seat: SessionUser["seat"] = "owner",
  overrides: Partial<SessionUser> = {}
): SessionUser {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    churchId: PLANT_ID,
    sendingChurchId: null,
    sendingNetworkId: null,
    seat,
    ...overrides,
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/evry/datetime/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function body(
  sourceText: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    capabilityIdentity: CAPABILITY_IDENTITY,
    sourceText,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const routeModule = await import("./route");
  const resolverModule = await import("@/lib/evry/resolvers/datetime");
  const artifactModule = await import("@/lib/evry/artifacts/core");
  const post = routeModule.createEvryDateTimeResolvePost({
    now: () => new Date(REFERENCE_INSTANT),
  });
  const resolve = resolverModule.createEvryPlantDateTimeRequestResolver({
    now: () => new Date(REFERENCE_INSTANT),
  });

  async function invoke(
    sessions: Array<SessionUser | null>,
    requestBody: unknown
  ): Promise<Readonly<{ status: number; body: unknown }>> {
    sessionSequence = [...sessions];
    const response = await post(request(requestBody));
    return { status: response.status, body: await response.json() };
  }

  assert.deepEqual(await invoke([null], body("August 5, 2026 at 10 AM")), {
    status: 401,
    body: { status: "unavailable" },
  });

  const owner = user();
  const explicit = await invoke(
    [owner, owner],
    body("August 5, 2026 at 10 AM")
  );
  assert.deepEqual(explicit, {
    status: 200,
    body: {
      status: "resolved",
      dateTime: {
        calendarDate: "2026-08-05",
        localTime: "10:00 AM",
        timeZone: "America/New_York",
        utcOffset: "-04:00",
        instantUtc: "2026-08-05T14:00:00.000Z",
        interpretation: {
          basis: "explicit-calendar-date",
          sourceText: "August 5, 2026 at 10 AM",
          statedCalendarDate: "2026-08-05",
        },
      },
    },
  });

  for (const [sourceText, reason] of [
    ["August 5 at 10 AM", "missing-year"],
    ["Friday at 3 PM", "ambiguous-weekday"],
    ["next Friday at 3 PM", "ambiguous-weekday"],
    ["January 1, 0099 at 10 AM", "invalid-calendar-date"],
  ] as const) {
    const response = await invoke([owner, owner], body(sourceText));
    assert.equal(response.status, 200, sourceText);
    assert.equal(
      (response.body as { status: string }).status,
      "clarification",
      sourceText
    );
    assert.equal(
      (response.body as { reason: string }).reason,
      reason,
      sourceText
    );
  }

  for (const [sourceText, reason] of [
    ["March 8, 2026 at 2:30 AM", "nonexistent-local-time"],
    ["November 1, 2026 at 1:30 AM", "repeated-local-time"],
  ] as const) {
    const response = await invoke([owner, owner], body(sourceText));
    assert.equal(response.status, 200, sourceText);
    assert.deepEqual(
      {
        status: (response.body as { status: string }).status,
        reason: (response.body as { reason: string }).reason,
      },
      { status: "clarification", reason }
    );
    if (reason === "repeated-local-time") {
      assert.match(
        (response.body as { prompt: string }).prompt,
        /different local time that occurs only once/
      );
      assert.doesNotMatch(
        (response.body as { prompt: string }).prompt,
        /which occurrence/i
      );
    }
  }

  for (const untrusted of [
    { plantTimeZone: "Pacific/Kiritimati" },
    { viewerTimeZone: "Pacific/Kiritimati" },
    { address: "123 Central Time Lane" },
    { referenceInstantUtc: "1999-01-01T00:00:00.000Z" },
  ]) {
    assert.deepEqual(
      await invoke([owner, owner], body("August 5, 2026 at 10 AM", untrusted)),
      { status: 400, body: { status: "invalid" } }
    );
  }

  assert.deepEqual(
    await invoke(
      [owner, owner],
      body("August 5, 2026 at 10 AM", { capabilityIdentity: "forged" })
    ),
    { status: 403, body: { status: "refused" } }
  );

  storedTimeZone = "Not/AZone";
  assert.deepEqual(
    await invoke([owner, owner], body("August 5, 2026 at 10 AM")),
    { status: 503, body: { status: "unavailable" } }
  );
  storedTimeZone = "America/Chicago";

  const beforeMidnight = await invoke(
    [owner, owner],
    body("today at 11:30 PM")
  );
  assert.equal(beforeMidnight.status, 200);
  assert.equal(
    (
      beforeMidnight.body as {
        dateTime: { calendarDate: string; localTime: string };
      }
    ).dateTime.calendarDate,
    "2026-08-27"
  );
  assert.equal(
    (
      beforeMidnight.body as {
        dateTime: { calendarDate: string; localTime: string };
      }
    ).dateTime.localTime,
    "11:30 PM"
  );

  const midnight = await invoke([owner, owner], body("tomorrow at 12:30 AM"));
  assert.equal(midnight.status, 200);

  storedTimeZone = "America/New_York";
  const historical = await invoke(
    [owner, owner],
    body("January 1, 1880 at 12 PM")
  );
  assert.equal(historical.status, 200);
  const historicalDateTime = (
    historical.body as {
      dateTime: { instantUtc: string; utcOffset: string };
    }
  ).dateTime;
  assert.equal(historicalDateTime.instantUtc, "1880-01-01T16:56:02.000Z");
  assert.equal(historicalDateTime.utcOffset, "-04:56:02");
  storedTimeZone = "America/Chicago";

  sessionSequence = [owner];
  const resolution: EvryDateTimeResolution = await resolve(
    body("August 5, 2026 at 10 AM")
  );
  assert.equal(resolution.status, "resolved");
  if (resolution.status !== "resolved") return;

  assert.deepEqual(EVRY_DATE_BEARING_SUBJECTS, [
    "meeting",
    "task",
    "communication",
    "launch",
  ]);
  for (const subject of EVRY_DATE_BEARING_SUBJECTS) {
    const evidence: EvryDateBearingConfirmationEvidence =
      artifactModule.buildEvryDateBearingConfirmationEvidence({
        subject,
        dateTime: resolution.dateTime,
      });
    assert.equal(evidence.dateTime.calendarDate, "2026-08-05");
    assert.equal(evidence.dateTime.localTime, "10:00 AM");
    assert.equal(evidence.dateTime.timeZone, "America/Chicago");
  }

  const durable = artifactModule.buildEvryDateBearingConfirmationEvidence({
    subject: "meeting",
    dateTime: resolution.dateTime,
  });
  const serialized = JSON.parse(JSON.stringify(durable));
  const restored =
    artifactModule.parsePersistedEvryDateBearingConfirmationEvidence(
      serialized
    );
  assert.deepEqual(restored, durable);
  assert.equal(
    resolverModule.isResolvedEvryPlantDateTime(restored.dateTime),
    false,
    "durable confirmation timing must not impersonate resolver authority"
  );
  assert.ok(Object.isFrozen(restored));
  assert.ok(Object.isFrozen(restored.dateTime));
  assert.throws(
    () =>
      artifactModule.parsePersistedEvryDateBearingConfirmationEvidence({
        ...serialized,
        unexpected: true,
      }),
    /unrecognized key/i
  );
  assert.throws(
    () =>
      artifactModule.parsePersistedEvryDateBearingConfirmationEvidence({
        ...serialized,
        dateTime: { ...serialized.dateTime, utcOffset: "+00:00" },
      }),
    /timing is invalid/
  );

  assert.ok(
    typeof explicit.body === "object" &&
      explicit.body !== null &&
      "dateTime" in explicit.body
  );
  assert.equal(
    resolverModule.isResolvedEvryPlantDateTime(explicit.body.dateTime),
    false,
    "serialization must strip resolver authority"
  );
  assert.throws(
    () =>
      Reflect.apply(
        artifactModule.buildEvryDateBearingConfirmationEvidence,
        null,
        [{ subject: "meeting", dateTime: explicit.body.dateTime }]
      ),
    /must come from the plant-local resolver/
  );

  assert.equal(queriedPlantIds.length > 0, true);
  assert.deepEqual(new Set(queriedPlantIds), new Set([PLANT_ID]));

  console.log(`EVRY_DATETIME_RESULT ${JSON.stringify(midnight.body)}`);
  console.log(
    `Evry datetime request proof passed (${queriedPlantIds.length} authoritative plant timezone reads)`
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
