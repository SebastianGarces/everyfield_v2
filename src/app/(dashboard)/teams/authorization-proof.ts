import assert from "node:assert/strict";
import { mock } from "node:test";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import type { User } from "@/db/schema";

const CHURCH = "10000000-0000-4000-8000-000000000001";
const X = "20000000-0000-4000-8000-000000000001";
const Y = "20000000-0000-4000-8000-000000000002";
const PERSON = "30000000-0000-4000-8000-000000000001";
const ROW = "40000000-0000-4000-8000-000000000001";
const USER = "50000000-0000-4000-8000-000000000001";
let actor: Pick<
  User,
  "id" | "seat" | "churchId" | "sendingChurchId" | "sendingNetworkId"
> | null;
let storedTeam: string | null = X;
let leaderUserId: string | null = USER;
let activeTrainee = true;
let writes = 0;
const dialect = new PgDialect();
const database = {
  select() {
    let table = "";
    let where: { sql: string; params: unknown[] };
    const query = {
      from(value: Parameters<typeof getTableName>[0]) {
        table = getTableName(value);
        return query;
      },
      leftJoin(_value: unknown, predicate: SQL) {
        const join = dialect.sqlToQuery(predicate).sql;
        assert.match(join, /"persons"\."id" = "ministry_teams"\."leader_id"/);
        assert.match(
          join,
          /"persons"\."church_id" = "ministry_teams"\."church_id"/
        );
        assert.match(join, /"persons"\."deleted_at" is null/);
        return query;
      },
      innerJoin(_value: unknown, predicate: SQL) {
        const join = dialect.sqlToQuery(predicate);
        assert.match(
          join.sql,
          /"team_memberships"\."church_id" = "training_programs"\."church_id"/
        );
        assert.match(
          join.sql,
          /"team_memberships"\."team_id" = "training_programs"\."team_id"/
        );
        assert.deepEqual(join.params, [PERSON, "active"]);
        return query;
      },
      where(predicate: SQL) {
        where = dialect.sqlToQuery(predicate);
        return query;
      },
      async limit() {
        assert.ok(where.sql.includes(`"${table}"."church_id" = $1`));
        assert.equal(where.params[0], CHURCH);
        if (table === "ministry_teams") {
          if (where.params[1] !== X || storedTeam === null) return [];
          return [{ id: X, leaderUserId }];
        }
        assert.equal(where.params[1], ROW);
        if (table === "training_programs" && !activeTrainee) return [];
        return storedTeam ? [{ teamId: storedTeam }] : [];
      },
    };
    return query;
  },
};
mock.module("@/db", { namedExports: { db: database } });
mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      if (!actor) throw new Error("Unauthorized");
      return { user: actor };
    },
  },
});
mock.module("next/cache", { namedExports: { revalidatePath() {} } });
const serviceNames = [
  "createTeam",
  "updateTeam",
  "assignTeamLeader",
  "initializePredefinedTeams",
  "createRole",
  "updateRole",
  "deleteRole",
  "importRoleTemplates",
  "assignMember",
  "removeMember",
  "createResponsibility",
  "updateResponsibility",
  "deleteResponsibility",
  "createTrainingProgram",
  "markTrainingComplete",
];
mock.module("@/lib/ministry-teams/service", {
  namedExports: {
    ...Object.fromEntries(
      serviceNames.map((name) => [
        name,
        async () => {
          writes++;
          return name === "initializePredefinedTeams" ? [] : { id: ROW };
        },
      ])
    ),
    listTeams: async () => [],
    getTeamCountsForPeople: async () => ({}),
  },
});
mock.module("@/lib/meetings/service", {
  namedExports: {
    createMeeting: async () => {
      writes++;
      return { id: ROW };
    },
  },
});
mock.module("@/lib/people/service", {
  namedExports: { listPeople: async () => ({ people: [] }) },
});

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
async function main() {
  const a = await import("./actions");
  const cases = [
    [
      "createTeamAction",
      false,
      () => a.createTeamAction(form({ name: "Test" })),
    ],
    [
      "updateTeamAction",
      false,
      () => a.updateTeamAction(X, form({ name: "Test" })),
    ],
    [
      "assignTeamLeaderAction",
      false,
      () => a.assignTeamLeaderAction(X, PERSON),
    ],
    ["initializeTeamsAction", false, () => a.initializeTeamsAction([])],
    [
      "initializeTeamsWithRolesAction",
      false,
      () => a.initializeTeamsWithRolesAction(),
    ],
    [
      "importRoleTemplatesAction",
      false,
      () => a.importRoleTemplatesAction(X, "worship"),
    ],
    [
      "createRoleAction",
      true,
      () => a.createRoleAction(X, form({ name: "Test" })),
    ],
    [
      "updateRoleAction",
      true,
      () => a.updateRoleAction(ROW, form({ name: "Test" })),
    ],
    ["deleteRoleAction", true, () => a.deleteRoleAction(ROW)],
    [
      "createResponsibilityAction",
      true,
      () => a.createResponsibilityAction(X, form({ title: "Test" })),
    ],
    [
      "updateResponsibilityAction",
      true,
      () => a.updateResponsibilityAction(ROW, form({ title: "Test" })),
    ],
    [
      "setResponsibilityCompleteAction",
      true,
      () => a.setResponsibilityCompleteAction(ROW, true),
    ],
    [
      "deleteResponsibilityAction",
      true,
      () => a.deleteResponsibilityAction(ROW),
    ],
    [
      "assignMemberAction",
      true,
      () => a.assignMemberAction(X, ROW, { personId: PERSON }),
    ],
    ["removeMemberAction", true, () => a.removeMemberAction(ROW)],
    [
      "createMeetingAction",
      true,
      () =>
        a.createMeetingAction(X, form({ datetime: "2026-10-01T12:00:00Z" })),
    ],
    [
      "createTrainingProgramAction",
      true,
      () => a.createTrainingProgramAction(form({ name: "Test", teamId: X })),
    ],
    [
      "markTrainingCompleteAction",
      true,
      () => a.markTrainingCompleteAction({ personId: PERSON, programId: ROW }),
    ],
  ] as const;
  const exports = [
    ...readFileSync(new URL("./actions.ts", import.meta.url), "utf8").matchAll(
      /export async function (\w+)/g
    ),
  ].map((m) => m[1]);
  assert.deepEqual(
    cases.map(([name]) => name).sort(),
    exports
      .filter(
        (name) =>
          !["listTeamsAction", "searchTeamCandidatesAction"].includes(name)
      )
      .sort()
  );
  let assertions = 0;
  for (const [name, own, call] of cases) {
    for (const viewer of [
      "owner",
      "admin",
      "leader",
      "other-leader",
      "serving-member",
      "unrelated-member",
      "unlinked",
      "deleted-person",
      "coach",
      "oversight",
      "anonymous",
    ] as const) {
      actor =
        viewer === "anonymous"
          ? null
          : {
              id: USER,
              seat:
                viewer === "owner" || viewer === "admin"
                  ? viewer
                  : viewer === "coach"
                    ? null
                    : "member",
              churchId: viewer === "oversight" ? null : CHURCH,
              sendingChurchId: viewer === "oversight" ? CHURCH : null,
              sendingNetworkId: null,
            };
      leaderUserId =
        viewer === "leader" || viewer === "owner" || viewer === "admin"
          ? USER
          : null;
      storedTeam = X;
      activeTrainee = true;
      writes = 0;
      const allowed =
        viewer === "owner" ||
        viewer === "admin" ||
        (viewer === "leader" && own);
      if (
        viewer === "anonymous" ||
        (!allowed && name === "initializeTeamsWithRolesAction")
      )
        await assert.rejects(call);
      else {
        const result = await call();
        assert.equal(
          result.success,
          allowed,
          `${name}: ${viewer}: ${JSON.stringify(result)}`
        );
      }
      assert.equal(
        writes > 0,
        allowed,
        `${name}: ${viewer} persistence boundary`
      );
      assertions++;
    }
  }
  actor = {
    id: USER,
    seat: "member",
    churchId: CHURCH,
    sendingChurchId: null,
    sendingNetworkId: null,
  };
  leaderUserId = USER;
  // Stored child references on Y and missing/foreign rows never borrow X's grant.
  for (const team of [Y, null]) {
    storedTeam = team;
    for (const [name, own, call] of cases) {
      if (
        !own ||
        ![
          "updateRoleAction",
          "deleteRoleAction",
          "removeMemberAction",
          "updateResponsibilityAction",
          "deleteResponsibilityAction",
          "setResponsibilityCompleteAction",
          "markTrainingCompleteAction",
        ].includes(name)
      )
        continue;
      writes = 0;
      assert.equal(
        (await call()).success,
        false,
        `${name}: foreign or unled child`
      );
      assert.equal(writes, 0);
      assertions++;
    }
  }
  storedTeam = X;
  for (const data of [
    form({ name: "Test" }),
    form({ name: "Test", teamId: Y }),
    form({ name: "Test", teamId: "invalid" }),
  ]) {
    writes = 0;
    assert.equal((await a.createTrainingProgramAction(data)).success, false);
    assert.equal(writes, 0);
  }
  const duplicate = form({ name: "Test", teamId: X });
  duplicate.append("teamId", Y);
  writes = 0;
  assert.equal(
    (await a.createTrainingProgramAction(duplicate)).success,
    false,
    "duplicate form fields cannot authorize X and write Y"
  );
  assert.equal(writes, 0);
  activeTrainee = false;
  assert.equal(
    (await a.markTrainingCompleteAction({ personId: PERSON, programId: ROW }))
      .success,
    false
  );
  assert.equal(writes, 0, "training requires active membership");
  activeTrainee = true;
  assert.equal(
    (await a.createResponsibilityAction(X, form({ title: "" }))).success,
    false
  );
  assert.equal(writes, 0, "invalid input never reaches service");
  leaderUserId = null;
  assert.equal(
    (await a.createRoleAction(X, form({ name: "After leadership removal" })))
      .success,
    false
  );
  assert.equal(writes, 0, "a withdrawn leader grant cannot be reused");
  console.log(
    `Team authorization proof passed: ${assertions} action/actor cases, negative input and SQL tenant/leader/membership assertions`
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
