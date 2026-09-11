// Isolated PostgreSQL proof of actual native service interleavings.
// Requires PG_MODULE and PROVENANCE_PG_URL pointing to a disposable loopback DB.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { mock } from "node:test";
import { sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-http";
import { neon, neonConfig } from "@neondatabase/serverless";
import schema from "../../src/db/schema/index.ts";
import membershipCopy from "../../src/lib/ministry-teams/membership-copy.ts";
const { PERSON_ALREADY_ASSIGNED_MESSAGE } = membershipCopy;

const url = new URL(process.env.PROVENANCE_PG_URL);
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
assert.equal(url.pathname, "/proof830", "Use the disposable proof830 database");
const { default: postgres } = await import(
  pathToFileURL(process.env.PG_MODULE).href
);
const namespace = `provenance_${randomUUID().replaceAll("-", "")}`;
const admin = new postgres.Pool({ connectionString: url.href });
await admin.query(`create schema ${namespace}`);
const pool = new postgres.Pool({
  connectionString: url.href,
  options: `-c search_path=${namespace} -c statement_timeout=10000 -c lock_timeout=8000`,
  max: 8,
  types: {
    getTypeParser: (oid, format) =>
      [1082, 1114, 1184].includes(oid)
        ? (value) => value
        : postgres.types.getTypeParser(oid, format),
  },
});
const context = new AsyncLocalStorage();
const hooks = new Map();
const clients = new Map();
const run = (name, fn) => context.run({ name }, fn);
// Exercise the actual neon-http driver and Neon batch encoding. Only fetch
// transport is replaced: its request runs on the disposable PostgreSQL pool.
neonConfig.fetchFunction = async (_url, init) => {
  const body = JSON.parse(init.body);
  const batch = Array.isArray(body.queries);
  const client = await pool.connect();
  const name = context.getStore()?.name;
  clients.set(name, client.processID);
  try {
    if (batch) await client.query("begin isolation level read committed");
    const results = [];
    for (const { query, params } of batch ? body.queries : [body]) {
      await hooks.get(name)?.before?.(query);
      const result = await client.query({
        text: query,
        values: params,
        rowMode: "array",
        types: { getTypeParser: () => (value) => value },
      });
      await hooks.get(name)?.after?.(query);
      results.push({
        fields: result.fields,
        rows: result.rows,
        rowCount: result.rowCount,
        command: result.command,
        rowAsArray: true,
      });
    }
    if (batch) await client.query("commit");
    return new Response(JSON.stringify(batch ? { results } : results[0]), {
      status: 200,
    });
  } catch (error) {
    if (batch) await client.query("rollback");
    return new Response(
      JSON.stringify({
        message: error.message,
        code: error.code,
        severity: error.severity,
        constraint: error.constraint,
      }),
      { status: 400 }
    );
  } finally {
    client.release();
  }
};
const db = drizzle(neon(url.href), { schema });
const leaderEvents = [];
mock.module("@/db", { namedExports: { db } });
mock.module("@/lib/ministry-teams/events", {
  namedExports: {
    emitTeamLeaderAssigned: async (...args) => {
      leaderEvents.push(args);
    },
    emitTeamMemberAssigned: async () => {},
    emitTeamStaffingChanged: async () => {},
  },
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function pause(name, phase, matches) {
  const reached = deferred();
  const released = deferred();
  hooks.set(name, {
    [phase]: async (query) => {
      if (!matches(query)) return;
      hooks.delete(name);
      reached.resolve();
      await released.promise;
    },
  });
  return { reached: reached.promise, release: released.resolve };
}
async function waitForLock(name) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const pid = clients.get(name);
    if (pid) {
      const { rows } = await admin.query(
        "select wait_event_type from pg_stat_activity where pid=$1",
        [pid]
      );
      if (rows[0]?.wait_event_type === "Lock") return;
    }
    await new Promise((done) => setTimeout(done, 15));
  }
  throw new Error(`${name} did not block on the team row`);
}
const lockQuery = (q) =>
  q.includes('from "ministry_teams"') && q.endsWith("for update");
const orderingLock = (q) => lockQuery(q) || q.includes("pg_advisory_xact_lock");
const dialect = new PgDialect();
const render = (value) => dialect.sqlToQuery(sql`${value}`.inlineParams()).sql;
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
try {
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
        `${quote(column.name)} ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}` +
        `${column.notNull ? " NOT NULL" : ""}` +
        (column.default === undefined
          ? ""
          : ` DEFAULT ${render(column.default)}`)
    );
    const checks = config.checks.map(
      (check) =>
        `CONSTRAINT ${quote(check.name)} CHECK (${render(check.value)})`
    );
    await pool.query(
      `create table ${quote(config.name)} (${[...columns, ...checks].join(",")})`
    );
  }
  await pool.query(`alter table team_memberships add constraint role_cascade
    foreign key (role_id) references team_roles(id) on delete cascade`);
  await pool.query(`create unique index team_memberships_role_active_unique_idx
    on team_memberships(role_id) where status='active'`);
  const { assignMember, removeMember } =
    await import("../../src/lib/ministry-teams/memberships.ts");
  const { updateRole, deleteRole } =
    await import("../../src/lib/ministry-teams/roles.ts");
  const { syncLeaderOnVacate } =
    await import("../../src/lib/ministry-teams/leader-sync.ts");
  const church = randomUUID(),
    actor = randomUUID(),
    personA = randomUUID(),
    personB = randomUUID();
  await pool.query(`insert into churches(id,name) values($1,'Race proof')`, [
    church,
  ]);
  for (const id of [personA, personB]) {
    await pool.query(
      `insert into persons(id,church_id,first_name,last_name,created_by) values($1,$2,'Proof','Person',$3)`,
      [id, church, actor]
    );
  }
  async function fixture(active = true) {
    const team = randomUUID(),
      role = randomUUID(),
      membership = randomUUID();
    await pool.query(
      `insert into ministry_teams(id,church_id,name,type,leader_id,leader_source,leader_role_id,created_by)
      values($1,$2,'Race team','custom',$3,$4,$5,$6)`,
      [
        team,
        church,
        active ? personA : null,
        active ? "role" : null,
        active ? role : null,
        actor,
      ]
    );
    await pool.query(
      `insert into team_roles(id,church_id,team_id,name,is_leadership_role,status,created_by)
      values($1,$2,$3,'Leader',true,$4,$5)`,
      [role, church, team, active ? "filled" : "open", actor]
    );
    await pool.query(
      `insert into team_memberships(id,church_id,team_id,role_id,person_id,status,created_by)
      values($1,$2,$3,$4,$5,$6,$7)`,
      [
        membership,
        church,
        team,
        role,
        personA,
        active ? "active" : "inactive",
        actor,
      ]
    );
    return { team, role, membership };
  }
  async function leader(team) {
    const { rows } = await pool.query(
      "select leader_id,leader_source,leader_role_id from ministry_teams where id=$1",
      [team]
    );
    return rows[0];
  }
  const empty = { leader_id: null, leader_source: null, leader_role_id: null };
  const derived = (f) => ({
    leader_id: personA,
    leader_source: "role",
    leader_role_id: f.role,
  });
  const baseline = process.env.EXPECT_OLD_RACES === "1";

  // Pause deletion after its pre-reads but before its first write/lock. Another
  // request removes A and seats B. Deletion must clear B by the stored role.
  {
    const f = await fixture();
    const gate = pause(
      "delete-replaced",
      "before",
      (q) => orderingLock(q) || q.startsWith('delete from "team_roles"')
    );
    const deletion = run("delete-replaced", () =>
      deleteRole(church, f.role, actor)
    );
    await gate.reached;
    try {
      await run("remove-A", () => removeMember(church, f.membership, actor));
      await run("assign-B", () =>
        assignMember(church, f.team, f.role, personB, actor)
      );
    } finally {
      gate.release();
    }
    await deletion;
    const state = await leader(f.team);
    assert.deepEqual(
      state,
      baseline
        ? { leader_id: personB, leader_source: "role", leader_role_id: f.role }
        : empty
    );
    assert.equal(
      (
        await pool.query(
          "select count(*)::int as n from team_memberships where role_id=$1",
          [f.role]
        )
      ).rows[0].n,
      0
    );
    console.log(
      baseline
        ? "REPRODUCED: stale holder deletion leaves B leader without a role"
        : "PASS: deletion after holder replacement clears B and cascades memberships"
    );
  }

  // A stale notification for an earlier vacancy reaches the helper after the
  // same membership has been reactivated. A role token alone cannot date it.
  {
    const f = await fixture();
    await run("remove-renew", () => removeMember(church, f.membership, actor));
    await run("renew", () =>
      assignMember(church, f.team, f.role, personA, actor)
    );
    const cleared = await run("delayed-vacancy", () =>
      syncLeaderOnVacate(church, f.team, personA, f.role)
    );
    assert.equal(cleared, baseline);
    assert.deepEqual(await leader(f.team), baseline ? empty : derived(f));
    console.log(
      baseline
        ? "REPRODUCED: delayed vacancy erases renewed same-person derivation"
        : "PASS: delayed vacancy preserves renewed same-person derivation"
    );
  }
  if (!baseline) {
    // Renew but hold its transaction before COMMIT. Vacancy starts with an old
    // membership snapshot, blocks on the team, then must read the committed
    // active membership in its NEXT statement.
    {
      const f = await fixture(false);
      const gate = pause("renew-blocking", "after", (q) =>
        q.includes('with "assigned_membership"')
      );
      const renewal = run("renew-blocking", () =>
        assignMember(church, f.team, f.role, personA, actor)
      );
      await gate.reached;
      const vacancy = run("vacancy-waiter", () =>
        syncLeaderOnVacate(church, f.team, personA, f.role)
      );
      try {
        await waitForLock("vacancy-waiter");
      } finally {
        gate.release();
      }
      await renewal;
      assert.equal(await vacancy, false);
      assert.deepEqual(await leader(f.team), derived(f));
      console.log(
        "PASS: vacancy blocks on renewal and uses a fresh post-wait membership snapshot"
      );
    }
    // Deletion owns the team first. A competing fill has already read the role
    // but must wait; once the role is gone its FK refusal rolls the batch back.
    {
      const f = await fixture(false);
      const gate = pause("delete-first", "after", lockQuery);
      const deletion = run("delete-first", () =>
        deleteRole(church, f.role, actor)
      );
      await gate.reached;
      const assignment = run("assign-waiter", () =>
        assignMember(church, f.team, f.role, personB, actor)
      );
      const outcome = assignment.then(
        () => null,
        (error) => error
      );
      try {
        await waitForLock("assign-waiter");
      } finally {
        gate.release();
      }
      await deletion;
      assert.ok(await outcome, "assignment to deleted role must refuse");
      assert.deepEqual(await leader(f.team), empty);
      console.log(
        "PASS: assignment waits for deletion and cannot leave orphaned leadership"
      );
    }
    // Unmark and enable contend on the same lock. Enable must see the new false
    // flag after waiting and refill the existing active holder.
    {
      const f = await fixture();
      const gate = pause("unmark-first", "after", lockQuery);
      const unmark = run("unmark-first", () =>
        updateRole(church, f.role, actor, { isLeadershipRole: false })
      );
      await gate.reached;
      const enable = run("enable-waiter", () =>
        updateRole(church, f.role, actor, { isLeadershipRole: true })
      );
      try {
        await waitForLock("enable-waiter");
      } finally {
        gate.release();
      }
      await unmark;
      await enable;
      assert.deepEqual(await leader(f.team), derived(f));
      await pool.query(
        "update ministry_teams set leader_id=null,leader_source=null,leader_role_id=null where id=$1",
        [f.team]
      );
      await run("rename", () =>
        updateRole(church, f.role, actor, { name: "Renamed" })
      );
      await run("repeat-enable", () =>
        updateRole(church, f.role, actor, { isLeadershipRole: true })
      );
      assert.deepEqual(await leader(f.team), empty);
      console.log(
        "PASS: flag transition uses post-lock state; rename/repeated enable cannot reappoint"
      );
    }
    // Both reactivation requests read the inactive row. The loser RETURNING is
    // empty; it must not create leadership after an intervening explicit clear.
    for (const candidate of [personA, personB]) {
      const f = await fixture(false);
      const gate = pause("late-assignment", "before", orderingLock);
      const late = run("late-assignment", () =>
        assignMember(church, f.team, f.role, candidate, actor)
      );
      const outcome = late.then(
        () => null,
        (error) => error
      );
      await gate.reached;
      try {
        await run("winning-assignment", () =>
          assignMember(church, f.team, f.role, candidate, actor)
        );
        await pool.query(
          "update ministry_teams set leader_id=null,leader_source=null,leader_role_id=null where id=$1",
          [f.team]
        );
      } finally {
        gate.release();
      }
      assert.equal((await outcome)?.message, PERSON_ALREADY_ASSIGNED_MESSAGE);
      assert.deepEqual(await leader(f.team), empty);
      console.log(
        `PASS: unsuccessful ${candidate === personA ? "reactivation" : "insert"} cannot create an appointment`
      );
    }
  }
  if (!baseline) {
    for (const enable of [true, false]) {
      const f = await fixture(false);
      await pool.query(
        "update team_roles set is_leadership_role=$1 where id=$2",
        [!enable, f.role]
      );
      const gate = pause("flagged-assignment", "before", orderingLock);
      const assignment = run("flagged-assignment", () =>
        assignMember(church, f.team, f.role, personA, actor)
      );
      await gate.reached;
      try {
        await run("change-flag", () =>
          updateRole(church, f.role, actor, { isLeadershipRole: enable })
        );
      } finally {
        gate.release();
      }
      const eventCount = leaderEvents.length;
      await assignment;
      assert.equal(leaderEvents.length - eventCount, enable ? 1 : 0);
      assert.deepEqual(await leader(f.team), enable ? derived(f) : empty);
    }
    console.log(
      "PASS: assignment event follows the post-lock role flag in both toggle directions"
    );
    const f = await fixture(false);
    await pool.query(`create function refuse_role_write() returns trigger language plpgsql as $$
      begin raise exception 'injected role failure'; end $$`);
    await pool.query(
      `create trigger fail_role_write before update on team_roles for each row execute function refuse_role_write()`
    );
    try {
      await assert.rejects(
        run("rollback", () =>
          assignMember(church, f.team, f.role, personA, actor)
        ),
        /injected role failure|Failed query/
      );
      assert.deepEqual(await leader(f.team), empty);
      assert.equal(
        (
          await pool.query("select status from team_memberships where id=$1", [
            f.membership,
          ])
        ).rows[0].status,
        "inactive"
      );
      assert.equal(
        (
          await pool.query("select status from team_roles where id=$1", [
            f.role,
          ])
        ).rows[0].status,
        "open"
      );
    } finally {
      await pool.query("drop trigger fail_role_write on team_roles");
    }
    console.log(
      "PASS: later statement failure rolls back membership and leadership together"
    );
  }
  if (!baseline) {
    const { removeSeat, seatActorFromSession } =
      await import("../../src/lib/seats/roster.ts");
    const { assignTeamLeader } =
      await import("../../src/lib/ministry-teams/teams.ts");
    const { syncLeaderOnFill } =
      await import("../../src/lib/ministry-teams/leader-sync.ts");
    const owner = seatActorFromSession({
      user: {
        id: actor,
        seat: "owner",
        churchId: church,
        sendingChurchId: null,
        sendingNetworkId: null,
      },
    });
    const seatBaseline = process.env.EXPECT_SEAT_RACE === "1";
    for (const kind of seatBaseline
      ? ["membership"]
      : ["membership", "explicit", "enable", "sync"]) {
      for (const removalFirst of seatBaseline ? [true] : [true, false]) {
        const f = await fixture(kind === "enable" || kind === "sync");
        await pool.query(
          "update ministry_teams set leader_id=null,leader_source=null,leader_role_id=null where id=$1",
          [f.team]
        );
        if (kind === "enable")
          await pool.query(
            "update team_roles set is_leadership_role=false where id=$1",
            [f.role]
          );
        const account = randomUUID();
        await pool.query(
          `insert into users(id,name,email,password_hash,seat,church_id)
          values($1,'Race account',$2,'proof-unusable','member',$3)`,
          [account, `${account}@proof.invalid`, church]
        );
        await pool.query("update persons set user_id=$1 where id=$2", [
          account,
          personA,
        ]);
        const appointment = () =>
          kind === "membership"
            ? assignMember(church, f.team, f.role, personA, actor)
            : kind === "explicit"
              ? assignTeamLeader(church, f.team, personA, actor)
              : kind === "enable"
                ? updateRole(church, f.role, actor, { isLeadershipRole: true })
                : syncLeaderOnFill(church, f.team, personA, f.role);
        const previousEvents = leaderEvents.length;
        if (removalFirst) {
          const gate = pause("seat-removal", "before", (q) =>
            q.startsWith('update "users"')
          );
          const removal = run("seat-removal", () => removeSeat(owner, account));
          await gate.reached;
          const attempt = run("seat-appointment", appointment).then(
            (value) => ({ value }),
            (error) => ({ error })
          );
          try {
            if (seatBaseline) await attempt;
            else await waitForLock("seat-appointment");
          } finally {
            gate.release();
          }
          await removal;
          const result = await attempt;
          if (!seatBaseline && kind === "explicit") assert.ok(result.error);
          else assert.equal(result.error, undefined);
          if (!seatBaseline)
            assert.equal(
              leaderEvents.length,
              previousEvents,
              "removed account must not emit a leader assignment"
            );
        } else {
          const gate = pause("seat-appointment", "after", (q) =>
            q.includes('update "ministry_teams"')
          );
          const attempt = run("seat-appointment", appointment);
          await gate.reached;
          const removal = run("seat-removal", () => removeSeat(owner, account));
          try {
            await waitForLock("seat-removal");
          } finally {
            gate.release();
          }
          await attempt;
          await removal;
        }
        assert.deepEqual(
          await leader(f.team),
          seatBaseline ? derived(f) : empty
        );
        const accountState = (
          await pool.query("select seat,church_id from users where id=$1", [
            account,
          ])
        ).rows[0];
        assert.deepEqual(accountState, { seat: null, church_id: null });
        assert.equal(
          (
            await pool.query(
              "select count(*)::int as n from persons where id=$1",
              [personA]
            )
          ).rows[0].n,
          1
        );
        assert.equal(
          (
            await pool.query(
              "select count(*)::int as n from team_memberships where id=$1",
              [f.membership]
            )
          ).rows[0].n,
          1
        );
        console.log(
          seatBaseline
            ? "REPRODUCED: seat removal misses concurrent appointment into an empty team"
            : `PASS: seat removal versus ${kind}, ${removalFirst ? "removal" : "appointment"} wins first; no leader survives and roster remains`
        );
      }
    }
    if (!seatBaseline) {
      const f = await fixture(false);
      const linked = (
        await pool.query("select user_id from persons where id=$1", [personA])
      ).rows[0].user_id;
      const foreignPlant = randomUUID();
      await pool.query(
        "insert into churches(id,name) values($1,'Foreign plant')",
        [foreignPlant]
      );
      await pool.query(
        "update users set church_id=$1,seat='member' where id=$2",
        [foreignPlant, linked]
      );
      const beforeEvents = leaderEvents.length;
      await assert.rejects(assignTeamLeader(church, f.team, personA, actor));
      await assignMember(church, f.team, f.role, personA, actor);
      assert.deepEqual(await leader(f.team), empty);
      assert.equal(leaderEvents.length, beforeEvents);
      assert.equal(
        await syncLeaderOnFill(church, f.team, personA, f.role),
        false
      );
      await pool.query(
        "update users set church_id=$1,seat='member' where id=$2",
        [church, linked]
      );
      assert.equal(
        await syncLeaderOnFill(church, f.team, personA, f.role),
        true
      );
      assert.deepEqual(await leader(f.team), derived(f));
      console.log(
        "PASS: foreign linked seat cannot lead; regaining a seat in this plant restores eligibility"
      );
    }
    await pool.query("update persons set user_id=null where id=$1", [personA]);
  }
  console.log(
    baseline
      ? "Both original races reproduced."
      : process.env.EXPECT_SEAT_RACE === "1"
        ? "Seat-removal race reproduced."
        : "Native PostgreSQL concurrency proof passed, including seat removal. Hosted Neon and Evry remain outside this proof."
  );
} finally {
  hooks.clear();
  await pool.end();
  await admin.query(`drop schema ${namespace} cascade`);
  await admin.end();
}
