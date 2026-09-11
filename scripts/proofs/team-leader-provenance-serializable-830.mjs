// Test-only Serializable candidate. Real Neon driver + native SQL builders;
// miniature receipt/staleness CTE, not the production Evry executor.
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
const attempts = new Map();
const failures = new Map();
const loseResponse = new Set();
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
    if (batch) {
      const isolation = new Headers(init.headers).get(
        "Neon-Batch-Isolation-Level"
      );
      assert.ok(isolation === null || isolation === "Serializable");
      if (isolation === "Serializable")
        attempts.set(name, (attempts.get(name) ?? 0) + 1);
      await client.query(
        isolation === "Serializable"
          ? "begin isolation level serializable"
          : "begin isolation level read committed"
      );
    }
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
    if (loseResponse.delete(name))
      throw new Error("injected committed response loss");
    return new Response(JSON.stringify(batch ? { results } : results[0]), {
      status: 200,
    });
  } catch (error) {
    failures.set(name, [
      ...(failures.get(name) ?? []),
      error.code ?? "transport",
    ]);
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

  await pool.query(
    `create table proof_effect_claims(effect_key uuid primary key, identity jsonb not null, affected_count integer not null)`
  );
  const { lockPlantLeadership } =
    await import("../../src/lib/ministry-teams/leadership-lock.ts");
  const { lockTeamLeadership } =
    await import("../../src/lib/ministry-teams/leader-sync.ts");
  const { canLeadTeam } =
    await import("../../src/lib/ministry-teams/leader-eligibility.ts");
  const { removeSeat, seatActorFromSession } =
    await import("../../src/lib/seats/roster.ts");
  const { assignTeamLeader } =
    await import("../../src/lib/ministry-teams/teams.ts");
  async function fixture(linked = true) {
    const church = randomUUID(),
      actor = randomUUID(),
      person = randomUUID(),
      user = randomUUID(),
      team = randomUUID(),
      role = randomUUID();
    await pool.query(
      "insert into churches(id,name,leadership_status) values($1,'Candidate proof','planter_confirmed')",
      [church]
    );
    await pool.query(
      "insert into users(id,name,email,password_hash,seat,church_id) values($1,'Owner',$2,'unusable','owner',$3)",
      [actor, `${actor}@proof.invalid`, church]
    );
    if (linked)
      await pool.query(
        "insert into users(id,name,email,password_hash,seat,church_id) values($1,'Candidate',$2,'unusable','member',$3)",
        [user, `${user}@proof.invalid`, church]
      );
    await pool.query(
      "insert into persons(id,church_id,first_name,last_name,user_id,created_by) values($1,$2,'Candidate','Person',$3,$4)",
      [person, church, linked ? user : null, actor]
    );
    await pool.query(
      "insert into ministry_teams(id,church_id,name,created_by) values($1,$2,'Empty team',$3)",
      [team, church, actor]
    );
    await pool.query(
      "insert into team_roles(id,church_id,team_id,name,is_leadership_role,created_by) values($1,$2,$3,'Leadership role',true,$4)",
      [role, church, team, actor]
    );
    const owner = seatActorFromSession({
      user: {
        id: actor,
        seat: "owner",
        churchId: church,
        sendingChurchId: null,
        sendingNetworkId: null,
      },
    });
    return { church, actor, person, user, team, role, owner };
  }
  const row = async (table, id) =>
    (
      await pool.query(
        `select to_jsonb(t) as state from ${table} t where id=$1`,
        [id]
      )
    ).rows[0]?.state ?? null;
  const roles = async (f) =>
    (
      await pool.query(
        "select id from team_roles where church_id=$1 and team_id=$2 order by id",
        [f.church, f.team]
      )
    ).rows.map((r) => r.id);
  const owners = async (f) =>
    (
      await pool.query(
        "select p.id from persons p join users u on u.id=p.user_id and u.church_id=p.church_id join churches c on c.id=p.church_id where p.church_id=$1 and p.deleted_at is null and u.seat='owner' and c.leadership_status='planter_confirmed' order by p.id",
        [f.church]
      )
    ).rows.map((r) => r.id);
  async function plan(f, kind = "appointment") {
    return {
      ...f,
      kind,
      key: randomUUID(),
      identity: {
        attempt: randomUUID(),
        plan: randomUUID(),
        church: f.church,
        actor: f.actor,
        fingerprint: randomUUID(),
        correlation: randomUUID(),
        step: "appointment",
        capability: kind,
      },
      teamBefore: await row("ministry_teams", f.team),
      roleBefore: await row("team_roles", f.role),
      roleIds: await roles(f),
      ownerIds: await owners(f),
    };
  }
  async function receipt(p) {
    const result = await pool.query(
      "select affected_count from proof_effect_claims where effect_key=$1 and identity=$2::jsonb",
      [p.key, JSON.stringify(p.identity)]
    );
    return result.rows.length ? "completed" : null;
  }
  function statements(p) {
    const statements = [
      lockPlantLeadership(p.church).getQuery(),
      lockTeamLeadership(p.church, p.team).toSQL(),
    ];
    // Exact role and candidate locks form concrete row-version conflict fences.
    for (const query of [
      sql`select id from team_roles where id=${p.role}::uuid and church_id=${p.church}::uuid for update`,
      sql`select id from persons where id=${p.person}::uuid and church_id=${p.church}::uuid for update`,
      sql`select id from users where id in (select user_id from persons where id=${p.person}::uuid and church_id=${p.church}::uuid) for update`,
      sql`select id from churches where id=${p.church}::uuid for update`,
    ])
      statements.push(db.execute(query).getQuery());
    const final = sql`with valid as materialized (
      select t.id from ministry_teams t
      where t.id=${p.team}::uuid and t.church_id=${p.church}::uuid
        and to_jsonb(t)=${JSON.stringify(p.teamBefore)}::jsonb
        and ${canLeadTeam(p.church, p.person)}
        and exists(select 1 from team_roles r where r.id=${p.role}::uuid and to_jsonb(r)=${JSON.stringify(p.roleBefore)}::jsonb)
        and (select coalesce(jsonb_agg(id::text order by id::text),'[]'::jsonb) from team_roles where church_id=${p.church}::uuid and team_id=${p.team}::uuid)=${JSON.stringify(p.roleIds)}::jsonb
        and (select coalesce(jsonb_agg(p.id::text order by p.id::text),'[]'::jsonb) from persons p join users u on u.id=p.user_id and u.church_id=p.church_id join churches c on c.id=p.church_id where p.church_id=${p.church}::uuid and p.deleted_at is null and u.seat='owner' and c.leadership_status='planter_confirmed')=${JSON.stringify(p.ownerIds)}::jsonb
    ), claimed as (
      insert into proof_effect_claims(effect_key,identity,affected_count)
      select ${p.key}::uuid,${JSON.stringify(p.identity)}::jsonb,1 from valid
      on conflict do nothing returning effect_key
    ), written as (
      update ministry_teams set leader_id=${p.person}::uuid,leader_source='explicit',leader_role_id=null
      where id=${p.team}::uuid and exists(select 1 from claimed) returning id
    ) select 'completed' as status from written`;
    statements.push(db.execute(final).getQuery());
    return statements;
  }
  async function transact(p) {
    const built = statements(p);
    const result = await db.$client.transaction(
      (tx) => built.map((q) => tx.query(q.sql, q.params)),
      { isolationLevel: "Serializable" }
    );
    return result.at(-1)[0]?.status ?? "refused";
  }
  // Mirrors the bounded transaction retry/receipt recovery order, not executor
  // recipe semantics. Confirmation and all plan arguments remain unchanged.
  async function candidate(p) {
    const previous = await receipt(p);
    if (previous) return previous;
    try {
      return await transact(p);
    } catch (error) {
      const completed = await receipt(p);
      if (completed) return completed;
      if (!["40001", "40P01"].includes(error.code)) return "retryable";
      try {
        return await transact(p);
      } catch {
        return (await receipt(p)) ?? "retryable";
      }
    }
  }
  const leader = async (f) => {
    const r = await row("ministry_teams", f.team);
    return [r.leader_id, r.leader_source, r.leader_role_id];
  };
  const empty = [null, null, null];
  const requireRefused = async (p, result) => {
    assert.equal(result, "refused");
    assert.equal(await receipt(p), null);
    assert.deepEqual(await leader(p), empty);
  };

  // Snapshot starts while native AS-016 owns the shared lock but its final
  // account update has not committed. The team starts empty: no team conflict.
  {
    const f = await fixture(),
      p = await plan(f);
    const gate = pause("remove-first", "before", (q) =>
      q.startsWith('update "users"')
    );
    const removal = run("remove-first", () => removeSeat(f.owner, f.user));
    await gate.reached;
    const effect = run("effect-after-removal", () => candidate(p));
    try {
      await waitForLock("effect-after-removal");
    } finally {
      gate.release();
    }
    await removal;
    await requireRefused(p, await effect);
    assert.equal(attempts.get("effect-after-removal"), 2);
    assert.ok(failures.get("effect-after-removal").includes("40001"));
    console.log(
      "PASS: empty-team removal-first forces40001 at candidate account fence; full retry refuses without claim"
    );
  }
  {
    const f = await fixture(),
      p = await plan(f);
    const gate = pause("effect-first", "after", (q) =>
      q.includes("with valid as materialized")
    );
    const effect = run("effect-first", () => candidate(p));
    await gate.reached;
    const removal = run("remove-after-effect", () =>
      removeSeat(f.owner, f.user)
    );
    try {
      await waitForLock("remove-after-effect");
    } finally {
      gate.release();
    }
    assert.equal(await effect, "completed");
    await removal;
    assert.deepEqual(await leader(f), empty);
    assert.equal(await run("receipt-replay", () => candidate(p)), "completed");
    assert.equal(attempts.has("receipt-replay"), false);
    assert.deepEqual(await leader(f), empty);
    console.log(
      "PASS: effect-first has one receipt; removal clears provenance; exact replay never reappoints"
    );
  }
  // Use a separate connection to hold the production advisory lock, then alter
  // source rows after the Serializable statement has begun waiting.
  async function racedChange(label, p, change) {
    const blocker = await pool.connect();
    await blocker.query("begin");
    const lock = lockPlantLeadership(p.church).getQuery();
    await blocker.query(lock.sql, lock.params);
    const result = run(label, () => candidate(p));
    try {
      await waitForLock(label);
      await change(blocker);
      await blocker.query("commit");
    } catch (error) {
      await blocker.query("rollback");
      throw error;
    } finally {
      blocker.release();
    }
    return result;
  }
  for (const kind of [
    "person-delete",
    "seat-clear",
    "plant-change",
    "role-flag",
  ]) {
    const f = await fixture(),
      p = await plan(f);
    const result = await racedChange(kind, p, async (client) => {
      if (kind === "person-delete")
        await client.query("update persons set deleted_at=now() where id=$1", [
          f.person,
        ]);
      if (kind === "seat-clear")
        await client.query("update users set seat=null where id=$1", [f.user]);
      if (kind === "plant-change")
        await client.query("update users set church_id=null where id=$1", [
          f.user,
        ]);
      if (kind === "role-flag")
        await client.query(
          "update team_roles set is_leadership_role=false where id=$1",
          [f.role]
        );
    });
    await requireRefused(p, result);
    assert.equal(attempts.get(kind), 2);
    assert.ok(failures.get(kind).includes("40001"));
    console.log(`PASS: ${kind} causes40001 then stale/eligibility refusal`);
  }
  {
    const f = await fixture();
    await pool.query(
      "update ministry_teams set leader_id=$1,leader_source='role',leader_role_id=$2 where id=$3",
      [f.person, f.role, f.team]
    );
    const p = await plan(f);
    const result = await racedChange("provenance-drift", p, (c) =>
      c.query(
        "update ministry_teams set leader_source='explicit',leader_role_id=null where id=$1",
        [f.team]
      )
    );
    assert.equal(result, "refused");
    assert.equal(await receipt(p), null);
    assert.deepEqual(await leader(f), [f.person, "explicit", null]);
    assert.equal(attempts.get("provenance-drift"), 2);
    console.log(
      "PASS: same-person provenance-only drift conflicts and refuses unchanged plan"
    );
  }
  {
    const f = await fixture(false),
      p = await plan(f);
    loseResponse.add("lost-response");
    assert.equal(await run("lost-response", () => candidate(p)), "completed");
    assert.equal(attempts.get("lost-response"), 1);
    assert.equal(await receipt(p), "completed");
    assert.deepEqual(await leader(f), [f.person, "explicit", null]);
    console.log(
      "PASS: unlinked CRM appointment and receipt recovery after committed response loss"
    );
  }
  // A real SQL error after claim insertion must roll back both claim and leader.
  {
    const f = await fixture(),
      p = await plan(f);
    await pool.query(
      `create function fail_candidate() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`
    );
    await pool.query(
      "create trigger fail_candidate before update on ministry_teams for each row execute function fail_candidate()"
    );
    assert.equal(await run("failure", () => candidate(p)), "retryable");
    assert.equal(await receipt(p), null);
    assert.deepEqual(await leader(f), empty);
    await pool.query("drop trigger fail_candidate on ministry_teams");
    console.log(
      "PASS: failure inside final effect rolls back receipt and appointment"
    );
  }
  for (const kind of ["import-child", "initialization-person"]) {
    for (const fence of [false, true]) {
      const f = await fixture(),
        p = await plan(f, kind),
        label = `${kind}-${fence ? "version-fence" : "lock-only"}`;
      const result = await racedChange(label, p, async (client) => {
        if (fence)
          await client.query(
            kind === "import-child"
              ? "update ministry_teams set updated_at=clock_timestamp() where id=$1"
              : "update churches set updated_at=clock_timestamp() where id=$1",
            [kind === "import-child" ? f.team : f.church]
          );
        if (kind === "import-child")
          await client.query(
            "insert into team_roles(church_id,team_id,name,created_by) values($1,$2,'New child',$3)",
            [f.church, f.team, f.actor]
          );
        else
          await client.query(
            "insert into persons(church_id,first_name,last_name,user_id,created_by) values($1,'New qualifying','Owner',$2,$2)",
            [f.church, f.actor]
          );
      });
      if (!fence) {
        assert.equal(result, "completed");
        assert.equal(attempts.get(label), 1);
        assert.equal(await receipt(p), "completed");
        console.log(
          `REPRODUCED GAP: ${kind} phantom invisible under lock-only Serializable; stale set claimed`
        );
      } else {
        await requireRefused(p, result);
        assert.equal(attempts.get(label), 2);
        assert.ok(failures.get(label).includes("40001"));
        console.log(
          `PASS: test-only ${kind} parent UPDATE fence forces40001; unchanged-plan retry refuses`
        );
      }
    }
  }
  console.log(
    "RESULT: retain Serializable for fenced existing-row cases; import/initialization require shared parent-version guards. This is a test-only mechanism proof, not production Evry acceptance."
  );
} finally {
  hooks.clear();
  await pool.end();
  await admin.query(`drop schema ${namespace} cascade`);
  await admin.end();
}
