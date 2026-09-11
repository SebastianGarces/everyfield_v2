import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import { resolveTeamsEvryEffect } from "./resolver";

const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const TEAM = "30000000-0000-4000-8000-000000000001";
const ROLE = "40000000-0000-4000-8000-000000000001";
const PERSON = "50000000-0000-4000-8000-000000000001";

test("closed Teams scalars refuse values the interface cannot author", async () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  assert.equal(
    await resolveTeamsEvryEffect({
      actor,
      now,
      selection: {
        kind: "effect",
        operation: "createRoleAction",
        values: { teamId: TEAM, name: "Leader", isLeadershipRole: "yes" },
      },
    }),
    null
  );
  assert.equal(
    await resolveTeamsEvryEffect({
      actor,
      now,
      selection: {
        kind: "effect",
        operation: "createTrainingProgramAction",
        values: { teamId: TEAM, name: "Safety", isRequired: "yes" },
      },
    }),
    null
  );
  assert.equal(
    await resolveTeamsEvryEffect({
      actor,
      now,
      selection: {
        kind: "effect",
        operation: "assignMemberAction",
        values: {
          teamId: TEAM,
          roleId: ROLE,
          personId: PERSON,
          startDate: "2030-02-31",
        },
      },
    }),
    null
  );
});
