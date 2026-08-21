import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { ministryTeams, teamMemberships, teamRoles } from "@/db/schema";
import {
  createScratchPerson,
  createScratchPlant,
  databaseReachable,
  LIVE_DB,
  liveSkip as skip,
  sweepScratch,
  UNREACHABLE,
  type ScratchPlant,
} from "@/lib/testing/ministry-teams-scratch";

import { syncLeaderOnFill } from "./leader-sync";
import { assignMember, removeMember } from "./memberships";
import { createRole, deleteRole, updateRole } from "./roles";
import { assignTeamLeader, initializePredefinedTeams } from "./teams";

// ----------------------------------------------------------------------------
// MT-004b (#311 WS2) — A FILLED LEADERSHIP ROLE IS THE TEAM'S LEADER, until
// somebody says otherwise.
//
// WHY THIS IS NOT A UNIT TEST. Every rule here is a `WHERE` clause: "only while
// `leader_id IS NULL`", "only when `leader_id = $person`". Those are the whole
// implementation, and a stub would be asserting that the mock returns what the
// mock was told to return. What is under test is which value the column holds
// after each door is used, so the column is what is read.
//
// THE FIVE RULES, one test each below:
//   1. no leader + a filled role marked leadership  → that assignee leads
//   2. no leader + somebody assigned to a leadership role → they lead
//   3. a leader already set → the derived path changes NOTHING
//   4. the seat vacated (removed / unmarked / role deleted) → cleared IFF it
//      pointed at that assignee
//   5. explicit `assignTeamLeader` still works and wins
// ----------------------------------------------------------------------------

const SCRATCH_NAME = "__t311 leader sync scratch__";

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweepScratch(SCRATCH_NAME);
});

async function scratchTeam(plant: ScratchPlant) {
  const [team] = await initializePredefinedTeams(
    plant.churchId,
    plant.actorId,
    ["worship"]
  );
  return team;
}

async function leaderOf(teamId: string): Promise<string | null> {
  const [team] = await db
    .select({ leaderId: ministryTeams.leaderId })
    .from(ministryTeams)
    .where(eq(ministryTeams.id, teamId));
  return team.leaderId;
}

/**
 * A team with one role of the caller's choosing, and nothing else — so every
 * assertion below is about the ONE seat it names.
 */
async function teamWithRole(
  plant: ScratchPlant,
  isLeadershipRole: boolean,
  name = "Scratch Role"
) {
  const team = await scratchTeam(plant);
  const role = await createRole(plant.churchId, team.id, plant.actorId, {
    name,
    isLeadershipRole,
  });
  return { team, role };
}

test(
  "rule 1 — marking a FILLED role as a leadership role names its assignee leader",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const { team, role } = await teamWithRole(plant, false);
    const personId = await createScratchPerson(plant, "Ada");

    await assignMember(
      plant.churchId,
      team.id,
      role.id,
      personId,
      plant.actorId
    );
    assert.equal(
      await leaderOf(team.id),
      null,
      "an ordinary role fills without touching the leader"
    );

    await updateRole(plant.churchId, role.id, plant.actorId, {
      isLeadershipRole: true,
    });

    assert.equal(
      await leaderOf(team.id),
      personId,
      "flipping the flag on a filled role names its occupant"
    );
  }
);

test(
  "rule 2 — assigning somebody to an existing leadership role makes them leader",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const { team, role } = await teamWithRole(plant, true);
    const personId = await createScratchPerson(plant, "Grace");

    assert.equal(await leaderOf(team.id), null, "an open seat leads nobody");

    await assignMember(
      plant.churchId,
      team.id,
      role.id,
      personId,
      plant.actorId
    );

    assert.equal(await leaderOf(team.id), personId);
  }
);

test(
  "rule 3 — an existing leader is never overwritten by a second leadership fill",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const team = await scratchTeam(plant);
    const first = await createRole(plant.churchId, team.id, plant.actorId, {
      name: "Worship Leader",
      isLeadershipRole: true,
    });
    const second = await createRole(plant.churchId, team.id, plant.actorId, {
      name: "Assistant Worship Leader",
      isLeadershipRole: true,
    });

    const ada = await createScratchPerson(plant, "Ada");
    const grace = await createScratchPerson(plant, "Grace");

    await assignMember(plant.churchId, team.id, first.id, ada, plant.actorId);
    assert.equal(await leaderOf(team.id), ada);

    await assignMember(
      plant.churchId,
      team.id,
      second.id,
      grace,
      plant.actorId
    );
    assert.equal(
      await leaderOf(team.id),
      ada,
      "the second leadership seat did not take the team from the first"
    );

    // …and the same is true through the OTHER door.
    const third = await createRole(plant.churchId, team.id, plant.actorId, {
      name: "Sound Tech",
      isLeadershipRole: false,
    });
    const linus = await createScratchPerson(plant, "Linus");
    await assignMember(plant.churchId, team.id, third.id, linus, plant.actorId);
    await updateRole(plant.churchId, third.id, plant.actorId, {
      isLeadershipRole: true,
    });
    assert.equal(await leaderOf(team.id), ada, "nor did the flag flip");
  }
);

test(
  "rule 4a — removing the assignment that made somebody leader clears the leader",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const { team, role } = await teamWithRole(plant, true);
    const personId = await createScratchPerson(plant, "Ada");

    const membership = await assignMember(
      plant.churchId,
      team.id,
      role.id,
      personId,
      plant.actorId
    );
    assert.equal(await leaderOf(team.id), personId);

    await removeMember(plant.churchId, membership.id, plant.actorId);
    assert.equal(
      await leaderOf(team.id),
      null,
      "the header goes back to 'No leader assigned'"
    );
  }
);

test(
  "rule 4b — unmarking the leadership flag clears the leader it named",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const { team, role } = await teamWithRole(plant, true);
    const personId = await createScratchPerson(plant, "Ada");

    await assignMember(
      plant.churchId,
      team.id,
      role.id,
      personId,
      plant.actorId
    );
    assert.equal(await leaderOf(team.id), personId);

    await updateRole(plant.churchId, role.id, plant.actorId, {
      isLeadershipRole: false,
    });
    assert.equal(await leaderOf(team.id), null);
  }
);

test(
  "rule 4c — vacating a leadership seat leaves a leader pointing ELSEWHERE untouched",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    // The `iff` half. `leader_id = $person` is the whole condition, so a team
    // led by somebody else survives every vacate below.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const team = await scratchTeam(plant);
    const ada = await createScratchPerson(plant, "Ada");
    const grace = await createScratchPerson(plant, "Grace");

    await assignTeamLeader(plant.churchId, team.id, ada, plant.actorId);

    const role = await createRole(plant.churchId, team.id, plant.actorId, {
      name: "Worship Leader",
      isLeadershipRole: true,
    });
    const membership = await assignMember(
      plant.churchId,
      team.id,
      role.id,
      grace,
      plant.actorId
    );
    assert.equal(await leaderOf(team.id), ada, "rule 5: explicit wins");

    await removeMember(plant.churchId, membership.id, plant.actorId);
    assert.equal(await leaderOf(team.id), ada, "removing Grace left Ada alone");

    await assignMember(plant.churchId, team.id, role.id, grace, plant.actorId);
    await updateRole(plant.churchId, role.id, plant.actorId, {
      isLeadershipRole: false,
    });
    assert.equal(await leaderOf(team.id), ada, "unmarking left Ada alone");

    await deleteRole(plant.churchId, role.id, plant.actorId);
    assert.equal(await leaderOf(team.id), ada, "deleting left Ada alone");
  }
);

test(
  "rule 5 — an explicit assignment lands after a derived one and wins",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const { team, role } = await teamWithRole(plant, true);
    const ada = await createScratchPerson(plant, "Ada");
    const grace = await createScratchPerson(plant, "Grace");

    await assignMember(plant.churchId, team.id, role.id, ada, plant.actorId);
    assert.equal(await leaderOf(team.id), ada);

    await assignTeamLeader(plant.churchId, team.id, grace, plant.actorId);
    assert.equal(
      await leaderOf(team.id),
      grace,
      "the explicit door overwrites what the derived one set"
    );
  }
);

test(
  "an ordinary role's seat never touches the leader, in either direction",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    // The gate is `isLeadershipRole`, not "this person happens to be leader":
    // an explicitly named leader who also holds an ORDINARY role keeps the team
    // when that role is vacated.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const { team, role } = await teamWithRole(plant, false);
    const ada = await createScratchPerson(plant, "Ada");

    await assignTeamLeader(plant.churchId, team.id, ada, plant.actorId);
    const membership = await assignMember(
      plant.churchId,
      team.id,
      role.id,
      ada,
      plant.actorId
    );
    await removeMember(plant.churchId, membership.id, plant.actorId);

    assert.equal(await leaderOf(team.id), ada);
  }
);

test(
  "deleting a filled role takes its memberships with it — no orphans",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    // THROUGH THE SERVICE, not through the UI's ordering: `deleteRole` is
    // called directly with a filled role and the memberships have to be gone
    // afterwards (#311 WS2 amendment).
    const plant = await createScratchPlant(SCRATCH_NAME);
    const { team, role } = await teamWithRole(plant, true);
    const ada = await createScratchPerson(plant, "Ada");

    await assignMember(plant.churchId, team.id, role.id, ada, plant.actorId);
    assert.equal(await leaderOf(team.id), ada);

    await deleteRole(plant.churchId, role.id, plant.actorId);

    const roles = await db
      .select({ id: teamRoles.id })
      .from(teamRoles)
      .where(eq(teamRoles.id, role.id));
    assert.deepEqual(roles, [], "the role is gone");

    const memberships = await db
      .select({ id: teamMemberships.id })
      .from(teamMemberships)
      .where(eq(teamMemberships.roleId, role.id));
    assert.deepEqual(memberships, [], "and so are its memberships");

    assert.equal(
      await leaderOf(team.id),
      null,
      "and the leader it named is cleared"
    );
  }
);

test(
  "a rename does not disturb the leader, because it says nothing about the flag",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const plant = await createScratchPlant(SCRATCH_NAME);
    const { team, role } = await teamWithRole(plant, true);
    const ada = await createScratchPerson(plant, "Ada");

    await assignMember(plant.churchId, team.id, role.id, ada, plant.actorId);

    const renamed = await updateRole(plant.churchId, role.id, plant.actorId, {
      name: "Lead Musician",
    });
    assert.equal(renamed.name, "Lead Musician");
    assert.equal(renamed.isLeadershipRole, true, "the flag is untouched");
    assert.equal(await leaderOf(team.id), ada, "and so is the leader");
  }
);

test(
  "editing an ordinary FILLED role does not clear the leader — even posting the flag",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    // THE BUG REVIEW CAUGHT, pinned. The edit dialog posts `isLeadershipRole`
    // on EVERY submit — an unticked checkbox is absent from FormData, so a
    // hidden input carries the boolean to make unticking expressible. Gating
    // the vacate on "the caller mentioned it and it is now false" therefore
    // fired on every save of an ordinary role, and a change of time commitment
    // erased an explicitly named leader. The gate is the TRANSITION.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const { team, role } = await teamWithRole(plant, false);
    const ada = await createScratchPerson(plant, "Ada");

    await assignMember(plant.churchId, team.id, role.id, ada, plant.actorId);
    await assignTeamLeader(plant.churchId, team.id, ada, plant.actorId);

    // Exactly what the dialog posts for an untouched checkbox on an ordinary
    // role: the flag, spelled false, alongside a real edit.
    await updateRole(plant.churchId, role.id, plant.actorId, {
      timeCommitment: "high",
      isLeadershipRole: false,
    });

    assert.equal(
      await leaderOf(team.id),
      ada,
      "a save that did not flip the flag must not vacate the leader"
    );
  }
);

test(
  "a second, ordinary role held by the derived leader does not clear them",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    // The seat index is per ROLE, so one person may hold two roles in a team.
    // Editing the ordinary one must not disturb the leadership seat they
    // actually lead from — and no explicit assignment is involved here, so
    // this is the derived rule breaking itself.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const team = await scratchTeam(plant);
    const leadRole = await createRole(plant.churchId, team.id, plant.actorId, {
      name: "Worship Leader",
      isLeadershipRole: true,
    });
    const ordinaryRole = await createRole(
      plant.churchId,
      team.id,
      plant.actorId,
      { name: "Vocalist", isLeadershipRole: false }
    );
    const ada = await createScratchPerson(plant, "Ada");

    await assignMember(
      plant.churchId,
      team.id,
      leadRole.id,
      ada,
      plant.actorId
    );
    await assignMember(
      plant.churchId,
      team.id,
      ordinaryRole.id,
      ada,
      plant.actorId
    );
    assert.equal(await leaderOf(team.id), ada);

    await updateRole(plant.churchId, ordinaryRole.id, plant.actorId, {
      name: "Backing Vocalist",
      isLeadershipRole: false,
    });

    assert.equal(
      await leaderOf(team.id),
      ada,
      "the leadership seat is still filled, so the leader stands"
    );
  }
);

test(
  "a person who is not on the team cannot be made its leader",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    // `syncLeaderOnFill` re-asserts the SEAT inside its own write, so a stale
    // holder read cannot install a leader who has left. Asserted directly,
    // because the race that produces a stale read is not reproducible here —
    // what is testable is that the statement refuses the value.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const team = await scratchTeam(plant);
    const stranger = await createScratchPerson(plant, "Stranger");

    const filled = await syncLeaderOnFill(plant.churchId, team.id, stranger);

    assert.equal(filled, false, "the write matched nothing");
    assert.equal(await leaderOf(team.id), null);
  }
);

test(
  "a role of another church cannot be edited or deleted",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweepScratch(SCRATCH_NAME);

    const ours = await createScratchPlant(SCRATCH_NAME);
    const theirs = await createScratchPlant(SCRATCH_NAME);
    const { role } = await teamWithRole(theirs, true);

    await assert.rejects(
      () => updateRole(ours.churchId, role.id, ours.actorId, { name: "taken" }),
      /not found/i
    );
    await assert.rejects(
      () => deleteRole(ours.churchId, role.id, ours.actorId),
      /not found/i
    );

    const [survivor] = await db
      .select({ name: teamRoles.name })
      .from(teamRoles)
      .where(eq(teamRoles.id, role.id));
    assert.equal(survivor.name, "Scratch Role");
  }
);
