import assert from "node:assert/strict";
import { mock } from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

type Seat = "owner" | "admin" | "member" | null;
type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: Seat;
}>;

type StoredPerson = Readonly<{
  id: string;
  churchId: string;
  firstName: string;
  lastName: string;
}>;

type QueryEvidence = Readonly<{
  sql: string;
  recordId: unknown;
  plantId: unknown;
}>;

const PLANT_ONE = "10000000-0000-4000-8000-000000000001";
const PLANT_TWO = "10000000-0000-4000-8000-000000000002";
const LOCAL_PERSON = "20000000-0000-4000-8000-000000000001";
const FOREIGN_PERSON = "20000000-0000-4000-8000-000000000002";
const ABSENT_PERSON = "20000000-0000-4000-8000-000000000003";

const people: readonly StoredPerson[] = [
  {
    id: LOCAL_PERSON,
    churchId: PLANT_ONE,
    firstName: "Local",
    lastName: "Person",
  },
  {
    id: FOREIGN_PERSON,
    churchId: PLANT_TWO,
    firstName: "Foreign",
    lastName: "Person",
  },
];

const queryEvidence: QueryEvidence[] = [];
const dialect = new PgDialect();

const fakeDatabase = {
  select() {
    return {
      from() {
        return {
          where(predicate: SQL) {
            const query = dialect.sqlToQuery(predicate);
            const [recordId, plantId] = query.params;
            queryEvidence.push({ sql: query.sql, recordId, plantId });

            return {
              async limit() {
                const person = people.find(
                  (candidate) =>
                    candidate.id === recordId && candidate.churchId === plantId
                );
                return person ? [person] : [];
              },
            };
          },
        };
      },
    };
  },
};

let sessionSequence: Array<SessionUser | null> = [];

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

function user(seat: Seat, overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    churchId: PLANT_ONE,
    sendingChurchId: null,
    sendingNetworkId: null,
    seat,
    ...overrides,
  };
}

function moduleExport(moduleValue: unknown, exportName: string): unknown {
  assert.ok(typeof moduleValue === "object" && moduleValue !== null);
  const exports = moduleValue as Record<string, unknown>;
  const direct = exports[exportName];
  const fallback =
    typeof exports.default === "object" && exports.default !== null
      ? (exports.default as Record<string, unknown>)[exportName]
      : undefined;
  return direct ?? fallback;
}

function moduleFunction(
  moduleValue: unknown,
  exportName: string
): (...args: unknown[]) => unknown {
  const value = moduleExport(moduleValue, exportName);
  assert.equal(typeof value, "function", `${exportName} is not exported`);
  return value as (...args: unknown[]) => unknown;
}

type Operation = "read" | "propose-write";

function request(
  operation: Operation,
  recordId: string,
  context: unknown = undefined
): Request {
  return new Request("http://localhost/api/evry/eligibility/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, recordId, context }),
  });
}

async function main(): Promise<void> {
  const routeModule =
    await import("../../../app/api/evry/eligibility/probe/route");
  const capabilityModule = await import("./capabilities");
  const post = moduleFunction(routeModule, "POST");
  const authorize = moduleFunction(capabilityModule, "authorizeEvryCapability");
  const writeIdentity = moduleExport(
    capabilityModule,
    "EVRY_PEOPLE_WRITE_PROBE_IDENTITY"
  );
  assert.equal(typeof writeIdentity, "string");

  async function invoke(
    sessions: Array<SessionUser | null>,
    operation: Operation,
    recordId: string = LOCAL_PERSON,
    context: unknown = undefined
  ): Promise<Readonly<{ status: number; body: unknown }>> {
    sessionSequence = [...sessions];
    const responseValue = await post(request(operation, recordId, context));
    assert.ok(responseValue instanceof Response);
    return { status: responseValue.status, body: await responseValue.json() };
  }

  for (const operation of ["read", "propose-write"] as const) {
    assert.deepEqual(await invoke([null], operation), {
      status: 401,
      body: { status: "unavailable" },
    });

    for (const refused of [
      user("owner", { churchId: null }),
      user(null, { churchId: null }),
      user(null),
      user("owner", { churchId: null, sendingNetworkId: PLANT_TWO }),
      user("owner", { sendingNetworkId: PLANT_TWO }),
    ]) {
      assert.deepEqual(await invoke([refused], operation), {
        status: 404,
        body: { status: "unavailable" },
      });
    }
  }

  for (const seat of ["owner", "admin", "member"] as const) {
    const current = user(seat);
    assert.deepEqual(await invoke([current, current], "read"), {
      status: 200,
      body: {
        status: "available",
        person: { id: LOCAL_PERSON, displayName: "Local Person" },
      },
    });

    const proposed = await invoke([current, current], "propose-write");
    const expectedProposalBySeat = {
      owner: {
        status: 200,
        body: {
          status: "available",
          proposal: {
            kind: "people.update",
            target: { id: LOCAL_PERSON, displayName: "Local Person" },
          },
        },
      },
      admin: {
        status: 200,
        body: {
          status: "available",
          proposal: {
            kind: "people.update",
            target: { id: LOCAL_PERSON, displayName: "Local Person" },
          },
        },
      },
      member: {
        status: 403,
        body: { status: "refused" },
      },
    } as const;
    assert.deepEqual(proposed, expectedProposalBySeat[seat]);
  }

  const admin = user("admin");
  const member = user("member");

  const representativeParity = [
    {
      identity:
        "action:src/app/(dashboard)/launch/actions.ts → scheduleLaunchAction",
      allowed: { owner: true, admin: false, member: false },
    },
    {
      identity:
        "action:src/app/(dashboard)/tasks/actions.ts → completeTaskAction",
      allowed: { owner: true, admin: true, member: true },
    },
  ] as const;

  for (const capability of representativeParity) {
    for (const seat of ["owner", "admin", "member"] as const) {
      sessionSequence = [user(seat)];
      assert.equal(
        (await authorize(capability.identity)) !== null,
        capability.allowed[seat],
        `${seat} parity drifted for ${capability.identity}`
      );
    }
  }

  sessionSequence = [admin];
  const oldAuthorization = await authorize(writeIdentity);
  assert.ok(oldAuthorization);

  sessionSequence = [member];
  assert.equal(await authorize(writeIdentity), null);

  assert.deepEqual(
    await invoke([admin, member], "propose-write", LOCAL_PERSON, {
      actor: oldAuthorization,
      plantId: PLANT_ONE,
      seat: "admin",
      capability: "people.write",
    }),
    { status: 403, body: { status: "refused" } }
  );

  for (const operation of ["read", "propose-write"] as const) {
    const absent = await invoke([admin, admin], operation, ABSENT_PERSON);
    const foreign = await invoke([admin, admin], operation, FOREIGN_PERSON, {
      plantId: PLANT_TWO,
    });

    assert.deepEqual(foreign, absent);
    assert.deepEqual(foreign, {
      status: 404,
      body: { status: "unavailable" },
    });
  }

  assert.equal(queryEvidence.length > 0, true);
  for (const evidence of queryEvidence) {
    assert.equal(
      evidence.sql,
      '("persons"."id" = $1 and "persons"."church_id" = $2)'
    );
    assert.equal(evidence.plantId, PLANT_ONE);
  }

  console.log(
    `Evry eligibility request proof passed (${queryEvidence.length} scoped repository queries)`
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
