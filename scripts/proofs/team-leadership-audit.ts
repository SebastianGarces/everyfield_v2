/** Real action/query proof, plus private browser fixtures. Owned preview databases only. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ministryTeams, persons, users, type User } from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";
import { getOrgChart } from "@/lib/ministry-teams/org-chart";
import { searchLeaderCandidates } from "@/lib/ministry-teams/leader-candidates";
import { assignMember, removeMember } from "@/lib/ministry-teams/memberships";
import { createRole, updateRole } from "@/lib/ministry-teams/roles";
import { getTeam, listTeams } from "@/lib/ministry-teams/teams";

async function main() {
  const connection = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  assert.equal(connection.hostname, "localhost");
  assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const [input, output] = process.argv.slice(2);
  for (const path of [input, output])
    assert.ok(path?.startsWith("/private/tmp/"));
  const fixture = JSON.parse(readFileSync(input, "utf8"));
  assert.equal(connection.pathname, `/${fixture.database}`);
  const identity = await db.execute<{ name: string }>(
    sql`select current_database() as name`
  );
  assert.equal(identity.rows[0].name, fixture.database);
  const account = async (email: string) => {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, `${email}@preview.example.test`));
    assert.ok(user);
    return user;
  };
  const owner = await account("owner"),
    member = await account("member"),
    admin = await account("admin"),
    coach = await account("coach");
  const churchId = fixture.primaryChurchId;
  const key = crypto.randomUUID().slice(0, 8);
  let actor: User | null = owner;
  mock.module("@/lib/auth/session", {
    namedExports: {
      verifySession: async () => {
        if (!actor) throw new UnauthorizedError();
        return { user: actor };
      },
    },
  });
  mock.module("next/cache", {
    namedExports: { revalidatePath() {}, refresh() {} },
  });
  mock.module("next/navigation", { namedExports: { unstable_rethrow() {} } });
  const { assignTeamLeaderAction, searchLeaderCandidatesAction } =
    await import("@/app/(dashboard)/teams/actions");
  const [removedAccount] = await db
    .insert(users)
    .values({
      name: "Removed leader account",
      email: `removed-${key}@example.test`,
      passwordHash: "not-a-login",
      seat: null,
    })
    .returning();
  const [unlinked, another, removed, foreign] = await db
    .insert(persons)
    .values([
      {
        churchId,
        firstName: `Ada-${key}`,
        lastName: "Eligible contact",
        createdBy: owner.id,
      },
      {
        churchId,
        firstName: `Pat-${key}`,
        lastName: "Multiple roles",
        createdBy: owner.id,
      },
      {
        churchId,
        firstName: `Removed-${key}`,
        lastName: "Ineligible contact",
        userId: removedAccount.id,
        createdBy: owner.id,
      },
      {
        churchId: fixture.foreignChurchId,
        firstName: `Foreign-${key}`,
        lastName: "Forbidden contact",
        createdBy: owner.id,
      },
    ])
    .returning();
  const [team, otherTeam] = await db
    .insert(ministryTeams)
    .values([
      {
        churchId,
        name: "Neighborhood care",
        type: "custom",
        createdBy: owner.id,
      },
      {
        churchId: fixture.foreignChurchId,
        name: "Foreign chart canary",
        type: "custom",
        createdBy: owner.id,
      },
    ])
    .returning();
  // Root identity comes from the template key, regardless of its display name.
  const [root] = await db
    .insert(ministryTeams)
    .values({
      churchId,
      name: "Renamed leadership",
      type: "predefined",
      templateKey: "senior_pastor",
      createdBy: owner.id,
    })
    .returning();
  const pastorRole = await createRole(churchId, root.id, owner.id, {
    name: "Senior Pastor",
    isLeadershipRole: true,
  });
  await assignMember(churchId, root.id, pastorRole.id, unlinked.id, owner.id);
  const role = await createRole(churchId, team.id, owner.id, {
    name: "Coordinator",
    isLeadershipRole: true,
  });
  const membership = await assignMember(
    churchId,
    team.id,
    role.id,
    another.id,
    owner.id
  );
  let stored = await getTeam(churchId, team.id);
  assert.equal(stored?.leaderId, another.id);
  assert.equal(stored?.leaderSource, "role");
  assert.equal(stored?.leaderRoleId, role.id);
  assert.equal(stored?.roles[0].status, "filled");
  assert.equal(
    (await assignTeamLeaderAction(team.id, another.id)).success,
    true
  );
  await updateRole(churchId, role.id, owner.id, { isLeadershipRole: false });
  await removeMember(churchId, membership.id, owner.id);
  stored = await getTeam(churchId, team.id);
  assert.equal(stored?.leaderId, another.id);
  assert.equal(stored?.leaderSource, "explicit");
  assert.equal(stored?.leaderRoleId, null);
  // Both ordinary fill and edit-to-leadership derive a leader in fresh supported operations.
  const editRole = await createRole(churchId, root.id, owner.id, {
    name: "Assistant",
    isLeadershipRole: false,
  });
  await assignMember(churchId, root.id, editRole.id, another.id, owner.id);
  const [derived] = await db
    .insert(ministryTeams)
    .values({
      churchId,
      name: "Fresh derived team",
      type: "custom",
      createdBy: owner.id,
    })
    .returning();
  const derivedRole = await createRole(churchId, derived.id, owner.id, {
    name: "Organizer",
  });
  await assignMember(
    churchId,
    derived.id,
    derivedRole.id,
    unlinked.id,
    owner.id
  );
  assert.equal((await getTeam(churchId, derived.id))?.leaderId, null);
  await updateRole(churchId, derivedRole.id, owner.id, {
    isLeadershipRole: true,
  });
  assert.equal((await getTeam(churchId, derived.id))?.leaderId, unlinked.id);

  const candidates = await searchLeaderCandidates(churchId, key);
  assert.ok(candidates.some((person) => person.id === unlinked.id));
  assert.ok(
    !candidates.some(
      (person) => person.id === removed.id || person.id === foreign.id
    )
  );
  assert.deepEqual(Object.keys(candidates[0]).sort(), [
    "firstName",
    "id",
    "lastName",
  ]);
  const before = await getTeam(churchId, team.id);
  for (const [targetTeam, person] of [
    [team.id, removed.id],
    [team.id, foreign.id],
    [otherTeam.id, unlinked.id],
    ["invalid", unlinked.id],
  ]) {
    assert.equal(
      (await assignTeamLeaderAction(targetTeam, person)).success,
      false
    );
  }
  for (const viewer of [member, coach]) {
    actor = viewer;
    assert.equal(
      (await assignTeamLeaderAction(team.id, unlinked.id)).success,
      false
    );
    assert.equal((await searchLeaderCandidatesAction(key)).success, false);
  }
  assert.deepEqual(await getTeam(churchId, team.id), before);
  actor = null;
  await assert.rejects(
    () => assignTeamLeaderAction(team.id, unlinked.id),
    /Unauthorized/
  );
  actor = admin;
  assert.equal(
    (await assignTeamLeaderAction(team.id, unlinked.id)).success,
    true
  );
  assert.equal((await getTeam(churchId, team.id))?.leaderId, unlinked.id);
  assert.equal(
    (await listTeams(churchId)).find((row) => row.id === team.id)?.leaderName,
    `${unlinked.firstName} ${unlinked.lastName}`
  );
  actor = owner;
  await assignMember(churchId, team.id, role.id, another.id, owner.id);
  const secondRole = await createRole(churchId, team.id, owner.id, {
    name: "Visitor",
  });
  await assignMember(churchId, team.id, secondRole.id, another.id, owner.id);
  await createRole(churchId, team.id, owner.id, { name: "Driver vacancy" });
  const chart = await getOrgChart(churchId);
  const selectedTeam = chart.find((row) => row.id === team.id)!;
  assert.equal(selectedTeam.leader?.id, unlinked.id);
  assert.equal(
    selectedTeam.roles.filter((row) => row.person?.id === another.id).length,
    2
  );
  assert.ok(
    selectedTeam.roles.some(
      (row) => row.name === "Driver vacancy" && row.person === null
    )
  );
  assert.ok(
    chart.some(
      (row) =>
        row.templateKey === "senior_pastor" && row.name === "Renamed leadership"
    )
  );
  assert.ok(!JSON.stringify(chart).includes("Foreign chart canary"));
  for (const field of [
    "userId",
    "passwordHash",
    "photoStorageKey",
    "email",
    "churchId",
  ])
    assert.ok(!JSON.stringify(chart).includes(`"${field}"`));
  assert.deepEqual(Object.keys(selectedTeam).sort(), [
    "id",
    "leader",
    "name",
    "roles",
    "templateKey",
  ]);
  assert.ok(
    (await getOrgChart(fixture.foreignChurchId)).every(
      (row) => row.id !== team.id && row.id !== root.id
    )
  );
  writeFileSync(
    output,
    JSON.stringify(
      {
        ...fixture,
        teamId: team.id,
        rootTeamId: root.id,
        unlinked,
        another,
        removedId: removed.id,
        foreignTeamId: otherTeam.id,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  console.log(
    "PASS: real leader assignment, canonical eligibility and refusals; explicit provenance survives role removal/unmarking; fresh fill/edit derive leader; scoped chart preserves renamed root, repeated roles, vacancy and safe DTO."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
