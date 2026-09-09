import assert from "node:assert/strict";
import { mock } from "node:test";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { User } from "@/db/schema";

const CHURCH = "10000000-0000-4000-8000-000000000001";
const MEETING = "20000000-0000-4000-8000-000000000001";
const TEAM = "30000000-0000-4000-8000-000000000001";
const PERSON = "40000000-0000-4000-8000-000000000001";
const FOREIGN = "40000000-0000-4000-8000-000000000002";
const USER = "50000000-0000-4000-8000-000000000001";
let actor: Pick<
  User,
  "id" | "seat" | "churchId" | "sendingChurchId" | "sendingNetworkId"
> | null;
let meetingExists = true;
let meetingType = "team_meeting";
let teamId: string | null = TEAM;
let leaderUserId: string | null = USER;
let peopleExist = true;
let attendanceExists = true;
let writes = 0;
let attendance = {
  status: "attended",
  attendanceType: "returning" as string | null,
  responseStatus: "confirmed",
  invitedById: FOREIGN,
};
let responseCardExists = true;
let fullRemovals = 0;
const dialect = new PgDialect();
const database = {
  select() {
    let table = "";
    let predicate: { sql: string; params: unknown[] };
    const rows = () => {
      assert.ok(predicate.sql.includes(`"${table}"."church_id"`));
      assert.ok(predicate.params.includes(CHURCH));
      if (table === "church_meetings")
        return meetingExists
          ? [
              {
                churchId: CHURCH,
                type: meetingType,
                teamId,
                datetime: new Date(),
              },
            ]
          : [];
      if (table === "ministry_teams") return [{ id: TEAM, leaderUserId }];
      if (table === "meeting_attendance") {
        assert.match(predicate.sql, /"meeting_attendance"\."meeting_id" =/);
        assert.match(predicate.sql, /"meeting_attendance"\."person_id" =/);
        assert.deepEqual(predicate.params.slice(0, 2), [CHURCH, MEETING]);
        return attendanceExists && predicate.params[2] === PERSON
          ? [{ id: PERSON }]
          : [];
      }
      assert.equal(table, "persons");
      assert.match(predicate.sql, /"persons"\."deleted_at" is null/);
      return peopleExist && predicate.params.includes(PERSON)
        ? [{ id: PERSON }]
        : [];
    };
    const query = {
      from(value: Parameters<typeof getTableName>[0]) {
        table = getTableName(value);
        return query;
      },
      leftJoin(_value: unknown, condition: SQL) {
        const sql = dialect.sqlToQuery(condition).sql;
        assert.match(sql, /"persons"\."id" = "ministry_teams"\."leader_id"/);
        assert.match(
          sql,
          /"persons"\."church_id" = "ministry_teams"\."church_id"/
        );
        assert.match(sql, /"persons"\."deleted_at" is null/);
        return query;
      },
      where(condition: SQL) {
        predicate = dialect.sqlToQuery(condition);
        return query;
      },
      async limit() {
        return rows();
      },
      then(resolve: (value: ReturnType<typeof rows>) => unknown) {
        return Promise.resolve(rows()).then(resolve);
      },
    };
    return query;
  },
  update() {
    return {
      set(values: Partial<typeof attendance>) {
        return {
          async where(condition: SQL) {
            const predicate = dialect.sqlToQuery(condition);
            assert.ok(predicate.params.includes(PERSON));
            attendance = { ...attendance, ...values };
            writes++;
          },
        };
      },
    };
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
mock.module("next/cache", {
  namedExports: { refresh() {}, revalidatePath() {} },
});
mock.module("next/navigation", {
  namedExports: {
    redirect() {
      throw new Error("redirect");
    },
  },
});
const effect = async () => {
  writes++;
  return { id: PERSON };
};
mock.module("@/lib/meetings/service", {
  namedExports: {
    ...Object.fromEntries(
      [
        "addAttendee",
        "createEvaluation",
        "createMeeting",
        "deleteMeeting",
        "finalizeAttendance",
        "recordAttendanceBatch",
        "removeAttendee",
        "updateChecklistItem",
        "updateMeeting",
        "updateMeetingStatus",
        "setMeetingAgenda",
      ].map((name) => [name, effect])
    ),
    removeAttendee: async (
      churchId: string,
      meetingId: string,
      personId: string
    ) => {
      assert.deepEqual(
        [churchId, meetingId, personId],
        [CHURCH, MEETING, PERSON]
      );
      attendanceExists = false;
      writes++;
      fullRemovals++;
      responseCardExists = false;
    },
    FinalizeAttendanceError: class extends Error {},
  },
});
mock.module("@/lib/meetings/guest-list", {
  namedExports: {
    addToGuestList: effect,
    removeFromGuestList: effect,
    updateRsvpStatus: effect,
  },
});
mock.module("@/lib/meetings/attendance-type", {
  namedExports: { deriveAttendanceType: async () => "returning" },
});
mock.module("@/lib/people/service", { namedExports: { createPerson: effect } });
mock.module("@/lib/meetings/locations", {
  namedExports: { createLocation: effect, updateLocation: effect },
});
mock.module("@/lib/meetings/response-queries", {
  namedExports: {
    clearMeetingResponse: effect,
    recordMeetingResponse: effect,
    MeetingResponseError: class extends Error {},
  },
});
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
function reset(seat: User["seat"] = "member") {
  actor = {
    id: USER,
    seat,
    churchId: CHURCH,
    sendingChurchId: null,
    sendingNetworkId: null,
  };
  meetingExists = true;
  meetingType = "team_meeting";
  teamId = TEAM;
  leaderUserId = USER;
  peopleExist = true;
  attendanceExists = true;
  writes = 0;
  fullRemovals = 0;
  attendance = {
    status: "attended",
    attendanceType: "returning",
    responseStatus: "confirmed",
    invitedById: FOREIGN,
  };
  responseCardExists = true;
}
async function main() {
  const a = await import("./actions");
  const cases = [
    [
      "add",
      () =>
        a.addAttendeeAction(
          MEETING,
          form({ personId: PERSON, status: "attended" })
        ),
    ],
    ["remove", () => a.removeAttendeeAction(MEETING, PERSON)],
    ["finalize", () => a.finalizeAttendanceAction(MEETING)],
    [
      "batch",
      () =>
        a.recordAttendanceBatchAction(MEETING, [
          { personId: PERSON, status: "attended" },
        ]),
    ],
    ["toggle", () => a.toggleAttendanceStatusAction(MEETING, PERSON, true)],
    ["walk-in", () => a.addWalkInAttendeeAction(MEETING, PERSON)],
  ] as const;
  async function check(
    call: () => Promise<{ success: boolean }>,
    allowed: boolean,
    label: string
  ) {
    writes = 0;
    let success = false;
    try {
      success = (await call()).success;
    } catch (error) {
      if (allowed) throw error;
    }
    assert.equal(success, allowed, label);
    assert.equal(writes > 0, allowed, `${label}: persistence boundary`);
  }
  const scenarios: [string, () => void, boolean][] = [
    ["leader", () => reset(), true],
    [
      "owner",
      () => {
        reset("owner");
        meetingType = "service";
        teamId = null;
      },
      true,
    ],
    [
      "admin",
      () => {
        reset("admin");
        leaderUserId = null;
      },
      true,
    ],
    [
      "unrelated member",
      () => {
        reset();
        leaderUserId = FOREIGN;
      },
      false,
    ],
    [
      "deleted or unlinked leader",
      () => {
        reset();
        leaderUserId = null;
      },
      false,
    ],
    ["coach", () => reset(null), false],
    [
      "oversight",
      () => {
        reset("owner");
        actor = { ...actor!, churchId: null, sendingChurchId: CHURCH };
      },
      false,
    ],
    [
      "anonymous",
      () => {
        reset();
        actor = null;
      },
      false,
    ],
    [
      "missing or foreign meeting",
      () => {
        reset();
        meetingExists = false;
      },
      false,
    ],
    [
      "other meeting type with led team",
      () => {
        reset();
        meetingType = "service";
      },
      false,
    ],
    [
      "no linked team",
      () => {
        reset();
        teamId = null;
      },
      false,
    ],
  ];
  let count = 0;
  for (const [name, call] of cases)
    for (const [scenario, setup, allowed] of scenarios) {
      setup();
      await check(call, allowed, `${name}: ${scenario}`);
      count++;
    }
  for (const [name, call] of cases.filter(
    ([name]) => name !== "finalize" && name !== "remove"
  )) {
    reset();
    peopleExist = false;
    await check(call, false, `${name}: deleted or foreign person`);
    count++;
  }
  reset();
  await check(
    () =>
      a.recordAttendanceBatchAction(MEETING, [
        { personId: PERSON, status: "attended" },
        { personId: FOREIGN, status: "attended" },
      ]),
    false,
    "mixed foreign batch has no partial write"
  );
  count++;
  reset();
  await check(
    () =>
      Reflect.apply(a.toggleAttendanceStatusAction, null, [
        MEETING,
        PERSON,
        "false",
      ]),
    false,
    "serialized boolean rejected"
  );
  count++;
  const protectedFields: Record<string, string>[] = [
    { responseStatus: "confirmed" },
    { invitedById: PERSON },
  ];
  for (const extra of protectedFields) {
    reset();
    await check(
      () => a.addAttendeeAction(MEETING, form({ personId: PERSON, ...extra })),
      false,
      "Member cannot inject RSVP or inviter"
    );
    count++;
  }
  reset();
  await check(
    () =>
      a.quickAddWalkInAction(
        MEETING,
        form({ firstName: "Test", lastName: "Person" })
      ),
    false,
    "Member cannot create Person"
  );
  count++;
  reset();
  await check(
    () => a.finalizeAttendanceAction("invalid"),
    false,
    "malformed meeting id"
  );
  count++;
  reset();
  await check(
    () => a.removeAttendeeAction(MEETING, PERSON),
    true,
    "Member clears attendance without protected deletion"
  );
  assert.deepEqual(attendance, {
    ...attendance,
    status: "absent",
    attendanceType: null,
    responseStatus: "confirmed",
    invitedById: FOREIGN,
  });
  assert.equal(responseCardExists, true);
  assert.equal(fullRemovals, 0);
  count++;
  reset("admin");
  await check(
    () => a.removeAttendeeAction(MEETING, PERSON),
    true,
    "Admin retains full removal"
  );
  assert.equal(fullRemovals, 1);
  assert.equal(responseCardExists, false);
  count++;
  for (const [seat, fullRemoval] of [
    ["admin", true],
    ["member", false],
  ] as const) {
    reset(seat);
    peopleExist = false;
    await check(
      () => a.removeAttendeeAction(MEETING, PERSON),
      true,
      `${seat}: existing soft-deleted attendee`
    );
    assert.equal(attendanceExists, !fullRemoval);
    assert.equal(responseCardExists, !fullRemoval);
    assert.equal(fullRemovals, fullRemoval ? 1 : 0);
    if (!fullRemoval) {
      assert.equal(attendance.status, "absent");
      assert.equal(attendance.attendanceType, null);
      assert.equal(attendance.responseStatus, "confirmed");
      assert.equal(attendance.invitedById, FOREIGN);
    }
    count++;
    reset(seat);
    attendanceExists = false;
    await check(
      () => a.removeAttendeeAction(MEETING, PERSON),
      false,
      `${seat}: missing or foreign attendance`
    );
    assert.equal(responseCardExists, true);
    assert.equal(fullRemovals, 0);
    count++;
    reset(seat);
    await check(
      () => a.removeAttendeeAction(MEETING, FOREIGN),
      false,
      `${seat}: another person's foreign attendance`
    );
    assert.equal(responseCardExists, true);
    assert.equal(attendanceExists, true);
    count++;
  }
  console.log(
    `Attendance authorization proof passed: ${count} cases; mocked persistence boundaries, not database proof`
  );
}
const originalError = console.error;
console.error = () => {};
main()
  .catch((error) => {
    originalError(error);
    process.exitCode = 1;
  })
  .finally(() => {
    console.error = originalError;
  });
