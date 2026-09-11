// Focused in-process PostgreSQL proof. See the adjacent report for installation/run.
// Uses production services and schema, an isolated PGlite engine, and a batch adapter.
// It does not prove Neon transport, migrations, concurrent writers or browser behavior.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { mock } from "node:test";
import { sql, eq } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import schema from "../../src/db/schema/index.ts";

assert.ok(
  process.env.PGLITE_MODULE,
  "Set PGLITE_MODULE to the installed PGlite entry file"
);
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const pg = new PGlite();
const dialect = new PgDialect();
const quoted = (name) => `"${name.replaceAll('"', '""')}"`;
const render = (value) => dialect.sqlToQuery(sql`${value}`.inlineParams()).sql;
const database = drizzle(
  async (query, params) => {
    const result = await pg.query(query, params, {
      rowMode: "array",
      parsers: {
        1082: (value) => value,
        1114: (value) => value,
        1184: (value) => value,
      },
    });
    return { rows: result.rows };
  },
  { schema }
);
const db = new Proxy(database, {
  get(target, key) {
    if (key !== "batch") return Reflect.get(target, key);
    return async (queries) => {
      await pg.exec("BEGIN");
      try {
        const result = [];
        for (const query of queries) result.push(await query);
        await pg.exec("COMMIT");
        return result;
      } catch (error) {
        await pg.exec("ROLLBACK");
        throw error;
      }
    };
  },
});
mock.module("@/db", { namedExports: { db } });
mock.module("@/lib/ministry-teams/events", {
  namedExports: {
    emitTeamLeaderAssigned: async () => {},
    emitTeamMemberAssigned: async () => {},
    emitTeamStaffingChanged: async () => {},
  },
});

try {
  // Derive columns/defaults/checks from production schema, not a parallel model.
  // Unrelated indexes/FKs are omitted. The role-deletion cascade below is relevant.
  for (const table of [
    schema.churches,
    schema.users,
    schema.persons,
    schema.ministryTeams,
    schema.teamRoles,
    schema.teamMemberships,
    schema.sessions,
    schema.tasks,
  ]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(
      (column) =>
        `${quoted(column.name)} ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}` +
        `${column.notNull ? " NOT NULL" : ""}` +
        (column.default === undefined
          ? ""
          : ` DEFAULT ${render(column.default)}`)
    );
    const checks = config.checks.map(
      (check) =>
        `CONSTRAINT ${quoted(check.name)} CHECK (${render(check.value)})`
    );
    await pg.exec(
      `CREATE TABLE ${quoted(config.name)} (${[...columns, ...checks].join(",")})`
    );
  }
  const cascade = getTableConfig(schema.teamMemberships).foreignKeys.find(
    (fk) => fk.reference().foreignTable === schema.teamRoles
  );
  assert.equal(cascade.onDelete, "cascade");
  await pg.exec(`ALTER TABLE team_memberships ADD FOREIGN KEY (role_id) REFERENCES team_roles(id) ON DELETE CASCADE;
    CREATE UNIQUE INDEX team_memberships_role_active_unique_idx ON team_memberships(role_id) WHERE status='active'`);

  const { createRole, updateRole, deleteRole } =
    await import("@/lib/ministry-teams/roles");
  const { assignMember, removeMember } =
    await import("@/lib/ministry-teams/memberships");
  const { assignTeamLeader } = await import("@/lib/ministry-teams/teams");
  const { syncLeaderOnFill, syncLeaderOnVacate } =
    await import("@/lib/ministry-teams/leader-sync");
  const { mayManageTeam } = await import("@/lib/ministry-teams/authorization");
  const { seatActorFromSession, removeSeat } =
    await import("@/lib/seats/roster");
  const churchId = randomUUID(),
    actorId = randomUUID(),
    userId = randomUUID(),
    personId = randomUUID();
  const member = {
    id: userId,
    seat: "member",
    churchId,
    sendingChurchId: null,
    sendingNetworkId: null,
  };
  await db.insert(schema.users).values([
    {
      id: actorId,
      passwordHash: "unusable-proof-hash",
      email: "owner@proof.invalid",
      name: "Owner",
      seat: "owner",
      churchId,
    },
    {
      id: userId,
      passwordHash: "unusable-proof-hash",
      email: "member@proof.invalid",
      name: "Member",
      seat: "member",
      churchId,
    },
  ]);
  await db.insert(schema.persons).values({
    id: personId,
    churchId,
    userId,
    firstName: "Ada",
    lastName: "Proof",
    createdBy: actorId,
  });
  const state = async (teamId) => {
    const [row] = await db
      .select({
        person: schema.ministryTeams.leaderId,
        source: schema.ministryTeams.leaderSource,
        role: schema.ministryTeams.leaderRoleId,
      })
      .from(schema.ministryTeams)
      .where(eq(schema.ministryTeams.id, teamId));
    return row;
  };
  const make = async () => {
    const [team] = await db
      .insert(schema.ministryTeams)
      .values({ churchId, name: "Proof", type: "custom", createdBy: actorId })
      .returning();
    const role = await createRole(churchId, team.id, actorId, {
      name: "Leadership",
      isLeadershipRole: true,
    });
    const membership = await assignMember(
      churchId,
      team.id,
      role.id,
      personId,
      actorId
    );
    assert.deepEqual(await state(team.id), {
      person: personId,
      source: "role",
      role: role.id,
    });
    return { team, role, membership };
  };
  const vacancy = {
    remove: ({ membership }) => removeMember(churchId, membership.id, actorId),
    unmark: ({ role }) =>
      updateRole(churchId, role.id, actorId, { isLeadershipRole: false }),
    delete: ({ role }) => deleteRole(churchId, role.id, actorId),
  };
  for (const [door, vacate] of Object.entries(vacancy)) {
    for (const explicit of [false, true]) {
      const fixture = await make();
      if (explicit)
        await assignTeamLeader(churchId, fixture.team.id, personId, actorId);
      await vacate(fixture);
      if (door === "delete") {
        await assert.rejects(vacate(fixture), /Role not found/);
        assert.equal(
          (
            await db
              .select()
              .from(schema.teamMemberships)
              .where(eq(schema.teamMemberships.roleId, fixture.role.id))
          ).length,
          0
        );
      } else {
        await vacate(fixture);
      }
      assert.deepEqual(
        await state(fixture.team.id),
        explicit
          ? { person: personId, source: "explicit", role: null }
          : { person: null, source: null, role: null }
      );
      assert.equal(await mayManageTeam(member, fixture.team.id), explicit);
      console.log(
        `PASS: ${door}, ${explicit ? "explicit leader and Member access retained" : "derived leader and Member access cleared"}`
      );
    }
  }
  const fixture = await make();
  const otherRole = await createRole(churchId, fixture.team.id, actorId, {
    name: "Other leadership",
    isLeadershipRole: true,
  });
  const otherMembership = await assignMember(
    churchId,
    fixture.team.id,
    otherRole.id,
    personId,
    actorId
  );
  await removeMember(churchId, otherMembership.id, actorId);
  assert.deepEqual(await state(fixture.team.id), {
    person: personId,
    source: "role",
    role: fixture.role.id,
  });
  assert.equal(
    await syncLeaderOnVacate(
      randomUUID(),
      fixture.team.id,
      personId,
      fixture.role.id
    ),
    false
  );
  assert.equal(
    await syncLeaderOnVacate(
      churchId,
      fixture.team.id,
      randomUUID(),
      fixture.role.id
    ),
    false
  );
  console.log(
    "PASS: unrelated same-person role and foreign/person vacancy cannot clear source leadership"
  );

  await removeMember(churchId, fixture.membership.id, actorId);
  assert.equal(
    await syncLeaderOnFill(
      churchId,
      fixture.team.id,
      personId,
      fixture.role.id
    ),
    false
  );
  await assignMember(
    churchId,
    fixture.team.id,
    fixture.role.id,
    personId,
    actorId
  );
  await assignTeamLeader(churchId, fixture.team.id, personId, actorId);
  assert.equal(
    await syncLeaderOnFill(
      churchId,
      fixture.team.id,
      personId,
      fixture.role.id
    ),
    false
  );
  await assert.rejects(
    assignTeamLeader(randomUUID(), fixture.team.id, personId, actorId),
    /Person not found/
  );
  console.log(
    "PASS: inactive-seat fill refused, explicit appointment resists fill, foreign explicit assignment refused"
  );

  const [empty] = await db
    .insert(schema.ministryTeams)
    .values({
      churchId,
      name: "Fill negatives",
      type: "custom",
      createdBy: actorId,
    })
    .returning();
  const ordinary = await createRole(churchId, empty.id, actorId, {
    name: "Ordinary",
    isLeadershipRole: false,
  });
  await assignMember(churchId, empty.id, ordinary.id, personId, actorId);
  const unheld = await createRole(churchId, empty.id, actorId, {
    name: "Unheld",
    isLeadershipRole: true,
  });
  for (const role of [ordinary.id, unheld.id, fixture.role.id]) {
    assert.equal(
      await syncLeaderOnFill(churchId, empty.id, personId, role),
      false
    );
  }
  assert.equal(
    await syncLeaderOnFill(randomUUID(), empty.id, personId, ordinary.id),
    false
  );
  assert.deepEqual(await state(empty.id), {
    person: null,
    source: null,
    role: null,
  });
  console.log(
    "PASS: ordinary, unheld, wrong-team and foreign-tenant fill refused"
  );

  for (const [source, roleId, leaderId] of [
    [null, null, personId],
    ["role", null, personId],
    ["explicit", fixture.role.id, personId],
    ["unknown", null, personId],
    ["explicit", null, null],
    [null, fixture.role.id, null],
  ]) {
    await assert.rejects(
      db
        .update(schema.ministryTeams)
        .set({ leaderId, leaderSource: source, leaderRoleId: roleId })
        .where(eq(schema.ministryTeams.id, fixture.team.id)),
      (error) => error.cause?.code === "23514"
    );
  }
  console.log("PASS: production CHECK rejects six malformed provenance states");

  // Include explicit, role-derived and legacy appointments in real seat-removal cleanup.
  const derived = await make();
  const legacy = await make();
  await db
    .update(schema.ministryTeams)
    .set({ leaderSource: "legacy", leaderRoleId: null })
    .where(eq(schema.ministryTeams.id, legacy.team.id));
  assert.equal(
    await syncLeaderOnFill(churchId, legacy.team.id, personId, legacy.role.id),
    false
  );
  assert.equal(
    await syncLeaderOnVacate(
      churchId,
      legacy.team.id,
      personId,
      legacy.role.id
    ),
    false
  );
  const foreignChurch = randomUUID(),
    foreignPerson = randomUUID();
  await db.insert(schema.persons).values({
    id: foreignPerson,
    churchId: foreignChurch,
    userId,
    firstName: "Foreign",
    lastName: "Proof",
    createdBy: actorId,
  });
  const [foreignTeam] = await db
    .insert(schema.ministryTeams)
    .values({
      churchId: foreignChurch,
      name: "Foreign",
      createdBy: actorId,
      leaderId: foreignPerson,
      leaderSource: "explicit",
    })
    .returning();
  const owner = seatActorFromSession({
    user: { ...member, id: actorId, seat: "owner" },
  });
  await removeSeat(owner, userId);
  for (const team of [fixture.team, derived.team, legacy.team]) {
    assert.deepEqual(await state(team.id), {
      person: null,
      source: null,
      role: null,
    });
    assert.equal(await mayManageTeam(member, team.id), false);
    assert.equal(
      await mayManageTeam({ ...member, seat: null, churchId: null }, team.id),
      false
    );
  }
  assert.deepEqual(await state(foreignTeam.id), {
    person: foreignPerson,
    source: "explicit",
    role: null,
  });
  assert.equal(
    (
      await db
        .select()
        .from(schema.persons)
        .where(eq(schema.persons.id, personId))
    ).length,
    1
  );
  assert.ok(
    (
      await db
        .select()
        .from(schema.teamMemberships)
        .where(eq(schema.teamMemberships.personId, personId))
    ).length > 0
  );
  console.log(
    "PASS: native seat removal clears all provenance, retains person and roster"
  );
  console.log(
    "Native provenance proof passed. LIMIT: no migration, Neon transport, concurrency or browser pass."
  );
} finally {
  mock.restoreAll();
  await pg.close();
}
