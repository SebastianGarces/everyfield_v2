// Real migrated PostgreSQL + production Neon driver, proposal, confirmation,
// route, executor, claims and receipts. Only HTTP transport and request-session
// context are supplied by the harness; no miniature effect/executor is used.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { mock } from "node:test";
import { neonConfig } from "@neondatabase/serverless";

const url = new URL(process.env.DATABASE_URL);
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
assert.equal(
  url.pathname,
  "/proof825830",
  "Use the disposable proof825830 database"
);
const { default: postgres } = await import(
  pathToFileURL(process.env.PG_MODULE).href
);
const pool = new postgres.Pool({
  connectionString: url.href,
  max: 10,
  options: "-c statement_timeout=15000 -c lock_timeout=12000",
});
const context = new AsyncLocalStorage();
const hooks = new Map();
const attempts = new Map();
const failures = new Map();
const loseResponse = new Set();
const effectSql = (query) =>
  query.includes("insert into evry_execution_effect_claims");
const plantLockSql = (query) => query.includes("pg_advisory_xact_lock");
const run = (name, fn) => context.run(name, fn);

neonConfig.fetchFunction = async (_url, init) => {
  const body = JSON.parse(init.body);
  const batch = Array.isArray(body.queries);
  const client = await pool.connect();
  const name = context.getStore();
  const serializable =
    new Headers(init.headers).get("Neon-Batch-Isolation-Level") ===
    "Serializable";
  const isEffect = batch && body.queries.some(({ query }) => effectSql(query));
  try {
    if (batch) {
      if (isEffect) {
        assert.ok(serializable, "Production effects must retain Serializable");
        assert.match(
          body.queries[0].query,
          /pg_advisory_xact_lock/,
          "Plant lock must be first"
        );
        attempts.set(name, (attempts.get(name) ?? 0) + 1);
      }
      await client.query(
        serializable ? "begin isolation level serializable" : "begin"
      );
    }
    const results = [];
    for (const { query, params } of batch ? body.queries : [body]) {
      await hooks.get(name)?.before?.(query, client, isEffect);
      const result = await client.query({
        text: query,
        values: params,
        rowMode: "array",
        types: { getTypeParser: () => (value) => value },
      });
      await hooks.get(name)?.after?.(query, client, isEffect);
      results.push({
        fields: result.fields,
        rows: result.rows,
        rowCount: result.rowCount,
        command: result.command,
        rowAsArray: true,
      });
    }
    if (batch) await client.query("commit");
    if (isEffect && loseResponse.delete(name))
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
      }),
      { status: 400 }
    );
  } finally {
    client.release();
  }
};
// tsx loads application .ts modules through the package's CJS export. Configure
// that driver's transport too; do not replace @/db or the production executor.
createRequire(import.meta.url)(
  "@neondatabase/serverless"
).neonConfig.fetchFunction = neonConfig.fetchFunction;

let sessionId;
async function session() {
  const { rows } = await pool.query(
    `select u.id, u.seat, u.church_id "churchId",
    u.sending_church_id "sendingChurchId", u.sending_network_id "sendingNetworkId"
    from sessions s join users u on u.id=s.user_id where s.id=$1 and s.expires_at>now()`,
    [sessionId]
  );
  assert.ok(rows[0], "The request must have a real unexpired session");
  return { user: rows[0] };
}
mock.module("@/lib/auth/session", {
  namedExports: { verifySession: session, verifyFreshSession: session },
});
const { requireEvryPlantViewer } =
  await import("../../src/lib/evry/eligibility/viewer.ts");
const { resolveTeamsEvryEffect } =
  await import("../../src/lib/evry/capabilities/teams/resolver.ts");
const { proposeTeamsEvryEffect } =
  await import("../../src/lib/evry/capabilities/teams/runtime.ts");
const { mintEvryPlanRequestKey } =
  await import("../../src/lib/evry/plans/index.ts");
const { POST: confirmPost } =
  await import("../../src/app/api/evry/plans/[planId]/confirm/route.ts");
const { POST: executePost } =
  await import("../../src/app/api/evry/plans/[planId]/execute/route.ts");
const { removeSeat, seatActorFromSession } =
  await import("../../src/lib/seats/roster.ts");
const { assignTeamLeader } =
  await import("../../src/lib/ministry-teams/teams.ts");
const { createRole } = await import("../../src/lib/ministry-teams/roles.ts");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function pause(name, phase, matches, establishSnapshot = false) {
  const reached = deferred(),
    release = deferred();
  hooks.set(name, {
    [phase]: async (query, client, isEffect) => {
      if (!matches(query, isEffect)) return;
      hooks.delete(name);
      if (establishSnapshot)
        await client.query("select txid_current_snapshot()");
      reached.resolve();
      await release.promise;
    },
  });
  return { reached: reached.promise, release: release.resolve };
}
async function within(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Proof barrier timed out")),
          20000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function fixture({ linked = true, template = null } = {}) {
  const f = Object.fromEntries(
    ["church", "actor", "person", "user", "team", "role"].map((key) => [
      key,
      randomUUID(),
    ])
  );
  await pool.query(
    "insert into churches(id,name,leadership_status,onboarding_completed_at) values($1,'Production leadership proof','planter_confirmed',now())",
    [f.church]
  );
  await pool.query(
    "insert into users(id,name,email,password_hash,seat,church_id) values($1,'Owner',$2,'unusable','owner',$3)",
    [f.actor, `${f.actor}@proof.invalid`, f.church]
  );
  if (linked)
    await pool.query(
      "insert into users(id,name,email,password_hash,seat,church_id) values($1,'Candidate',$2,'unusable','member',$3)",
      [f.user, `${f.user}@proof.invalid`, f.church]
    );
  await pool.query(
    "insert into persons(id,church_id,first_name,last_name,user_id,created_by) values($1,$2,'Candidate','Person',$3,$4)",
    [f.person, f.church, linked ? f.user : null, f.actor]
  );
  await pool.query(
    "insert into ministry_teams(id,church_id,name,template_key,created_by) values($1,$2,'Team',$3,$4)",
    [f.team, f.church, template, f.actor]
  );
  if (!template)
    await pool.query(
      "insert into team_roles(id,church_id,team_id,name,is_leadership_role,created_by) values($1,$2,$3,'Leadership role',true,$4)",
      [f.role, f.church, f.team, f.actor]
    );
  sessionId = randomUUID().replaceAll("-", "").repeat(2);
  await pool.query(
    "insert into sessions(id,user_id,expires_at) values($1,$2,now()+interval '1 hour')",
    [sessionId, f.actor]
  );
  f.owner = seatActorFromSession(await session());
  return f;
}
async function post(handler, suffix, plan) {
  const response = await handler(
    new Request(`http://localhost/api/evry/plans/${plan.planId}/${suffix}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint: plan.fingerprint }),
    }),
    { params: Promise.resolve({ planId: plan.planId }) }
  );
  return { status: response.status, body: await response.json() };
}
async function approve(
  f,
  operation = "assignTeamLeaderAction",
  values = { teamId: f.team, personId: f.person }
) {
  const actor = await requireEvryPlantViewer();
  const resolved = await resolveTeamsEvryEffect({
    actor,
    selection: { kind: "effect", operation, values },
    now: new Date(),
  });
  assert.ok(resolved, `resolve ${operation}`);
  const proposal = await proposeTeamsEvryEffect({
    actor,
    resolved,
    requestKey: mintEvryPlanRequestKey(),
  });
  assert.ok(proposal, `propose ${operation}`);
  const confirmed = await post(confirmPost, "confirm", proposal.plan);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
  return proposal.plan;
}
const execute = (name, plan) =>
  run(name, () => post(executePost, "execute", plan));
async function leader(f) {
  return (
    await pool.query(
      "select leader_id,leader_source,leader_role_id from ministry_teams where id=$1",
      [f.team]
    )
  ).rows[0];
}
async function claims(plan) {
  return (
    await pool.query(
      "select * from evry_execution_effect_claims where plan_id=$1",
      [plan.planId]
    )
  ).rows;
}
async function assertRefused(plan, result) {
  assert.equal(result.status, 409, JSON.stringify(result));
  assert.equal(
    (await claims(plan)).length,
    0,
    "Refusal must not claim an effect"
  );
}
async function assertReceipt(f, plan) {
  const rows = await claims(plan);
  assert.equal(rows.length, 1);
  const claim = rows[0];
  assert.equal(claim.actor_user_id, f.actor);
  assert.equal(claim.church_id, f.church);
  assert.equal(claim.plan_fingerprint, plan.fingerprint);
  const attempt = (
    await pool.query("select * from evry_execution_attempts where id=$1", [
      claim.attempt_id,
    ])
  ).rows[0];
  assert.equal(claim.correlation_id, attempt.correlation_id);
  assert.equal(attempt.plan_id, plan.planId);
  const stored = (
    await pool.query("select document from evry_action_plans where id=$1", [
      plan.planId,
    ])
  ).rows[0];
  const step = stored.document.steps[0];
  assert.equal(claim.step_id, step.id);
  assert.equal(claim.capability_identity, step.capabilityIdentity);
  const outcomes = (
    await pool.query(
      "select * from evry_execution_outcomes where attempt_id=$1",
      [attempt.id]
    )
  ).rows;
  const completed = outcomes.find((row) => row.status === "completed");
  assert.ok(completed, "Production executor must persist a completed outcome");
  assert.equal(completed.effect_key, claim.effect_key);
  assert.equal(completed.step_id, claim.step_id);
  assert.equal(completed.capability_identity, claim.capability_identity);
  assert.equal(completed.affected_count, claim.affected_count);
}
const passed = [];
async function prove(name, fn) {
  await fn();
  passed.push(name);
  console.log(`PASS ${name}`);
}

try {
  await prove(
    "production lifecycle, exact receipt and unlinked CRM eligibility",
    async () => {
      const f = await fixture({ linked: false }),
        plan = await approve(f);
      assert.equal((await execute("crm", plan)).status, 200);
      assert.deepEqual(await leader(f), {
        leader_id: f.person,
        leader_source: "explicit",
        leader_role_id: null,
      });
      await assertReceipt(f, plan);
    }
  );
  await prove(
    "native seat removal wins against an older production snapshot",
    async () => {
      const f = await fixture(),
        plan = await approve(f);
      const nativeGate = pause("remove-first", "after", plantLockSql);
      const removal = run("remove-first", () => removeSeat(f.owner, f.user));
      await within(nativeGate.reached);
      const effectGate = pause(
        "remove-loser",
        "before",
        (q, effect) => effect && plantLockSql(q),
        true
      );
      const effect = execute("remove-loser", plan);
      try {
        await within(effectGate.reached);
      } finally {
        nativeGate.release();
        effectGate.release();
      }
      await removal;
      await assertRefused(plan, await effect);
      assert.equal((await leader(f)).leader_id, null);
      assert.ok(failures.get("remove-loser")?.includes("40001"));
      assert.equal(attempts.get("remove-loser"), 2);
    }
  );
  for (const kind of [
    "role insert",
    "owner-person insert",
    "person deleted",
    "candidate seat",
    "candidate tenancy",
    "actor seat",
    "plan lifecycle",
    "role flag",
  ]) {
    await prove(`${kind} invalidates the production snapshot`, async () => {
      const isSet = kind.endsWith("insert");
      const f = await fixture({ template: isSet ? "senior_pastor" : null });
      const plan = isSet
        ? await approve(f, "importRoleTemplatesAction", {
            teamId: f.team,
            teamKey: "senior_pastor",
          })
        : kind === "role flag"
          ? await approve(f, "assignMemberAction", {
              teamId: f.team,
              roleId: f.role,
              personId: f.person,
            })
          : await approve(f);
      const name = `snapshot-${kind}`;
      const gate = pause(
        name,
        "after",
        (q, effect) => effect && plantLockSql(q)
      );
      const effect = execute(name, plan);
      try {
        await within(gate.reached);
        if (kind === "role insert")
          await createRole(f.church, f.team, f.actor, {
            name: "Concurrent native role",
          });
        if (kind === "owner-person insert")
          await pool.query(
            "insert into persons(church_id,first_name,last_name,user_id,created_by) values($1,'New','Owner',$2,$2)",
            [f.church, f.actor]
          );
        if (kind === "person deleted")
          await pool.query("update persons set deleted_at=now() where id=$1", [
            f.person,
          ]);
        if (kind === "candidate seat")
          await pool.query("update users set seat=null where id=$1", [f.user]);
        if (kind === "candidate tenancy")
          await pool.query("update users set church_id=null where id=$1", [
            f.user,
          ]);
        if (kind === "actor seat")
          await pool.query("update users set seat='member' where id=$1", [
            f.actor,
          ]);
        if (kind === "plan lifecycle")
          await pool.query(
            "update evry_action_plan_states set status='cancelled' where plan_id=$1",
            [plan.planId]
          );
        if (kind === "role flag")
          await pool.query(
            "update team_roles set is_leadership_role=false where id=$1",
            [f.role]
          );
      } finally {
        gate.release();
      }
      await assertRefused(plan, await effect);
      assert.equal((await leader(f)).leader_id, null);
      assert.ok(
        failures.get(name)?.includes("40001"),
        `${kind} must conflict, not silently read an old set`
      );
      assert.equal(attempts.get(name), 2);
    });
  }
  await prove(
    "same-person native explicit provenance defeats stale role vacancy",
    async () => {
      const f = await fixture();
      await pool.query(
        "insert into team_memberships(church_id,team_id,role_id,person_id,status,created_by) values($1,$2,$3,$4,'active',$5)",
        [f.church, f.team, f.role, f.person, f.actor]
      );
      await pool.query(
        "update ministry_teams set leader_id=$1,leader_source='role',leader_role_id=$2 where id=$3",
        [f.person, f.role, f.team]
      );
      const plan = await approve(f, "deleteRoleAction", { roleId: f.role });
      await assignTeamLeader(f.church, f.team, f.person, f.actor);
      await assertRefused(plan, await execute("provenance-drift", plan));
      assert.equal((await leader(f)).leader_source, "explicit");
      const fresh = await approve(f, "deleteRoleAction", { roleId: f.role });
      assert.equal((await execute("explicit-survives", fresh)).status, 200);
      assert.equal((await leader(f)).leader_id, f.person);
    }
  );
  await prove(
    "effect first, native cleanup second, receipt-only replay",
    async () => {
      const f = await fixture(),
        plan = await approve(f);
      const gate = pause("effect-first", "after", effectSql);
      const effect = execute("effect-first", plan);
      await within(gate.reached);
      const removal = run("remove-second", () => removeSeat(f.owner, f.user));
      gate.release();
      assert.equal((await effect).status, 200);
      await removal;
      assert.equal((await leader(f)).leader_id, null);
      await assertReceipt(f, plan);
      assert.equal((await execute("receipt-replay", plan)).status, 200);
      assert.equal(
        attempts.get("receipt-replay") ?? 0,
        0,
        "Replay must not re-enter the domain effect transaction"
      );
      assert.equal((await leader(f)).leader_id, null);
      await assertReceipt(f, plan);
    }
  );
  await prove(
    "claim and writes roll back together; retry succeeds",
    async () => {
      const f = await fixture(),
        plan = await approve(f);
      hooks.set("rollback", {
        after: async (query, client) => {
          if (!effectSql(query)) return;
          hooks.delete("rollback");
          await client.query("select 1/0");
        },
      });
      assert.equal((await execute("rollback", plan)).status, 503);
      assert.equal((await claims(plan)).length, 0);
      assert.equal((await leader(f)).leader_id, null);
      assert.equal((await execute("rollback-retry", plan)).status, 200);
      await assertReceipt(f, plan);
    }
  );
  await prove(
    "committed response loss recovers the exact receipt",
    async () => {
      const f = await fixture(),
        plan = await approve(f);
      loseResponse.add("response-loss");
      assert.equal((await execute("response-loss", plan)).status, 200);
      await assertReceipt(f, plan);
      assert.equal((await execute("loss-replay", plan)).status, 200);
      await assertReceipt(f, plan);
    }
  );
  await prove(
    "real cross-writer deadlock uses the bounded fresh retry",
    async () => {
      const f = await fixture(),
        plan = await approve(f);
      const reached = deferred(),
        release = deferred();
      hooks.set("deadlock", {
        after: async (query, client, effect) => {
          if (!effect || !query.includes("from leadership_versions")) return;
          hooks.delete("deadlock");
          await client.query("set local deadlock_timeout='50ms'");
          reached.resolve();
          await release.promise;
        },
      });
      const effect = execute("deadlock", plan);
      await within(reached.promise);
      const native = await pool.connect();
      try {
        await native.query("begin");
        await native.query("set local deadlock_timeout='10s'");
        // Arbitrary person writes hold the candidate before their DB trigger
        // asks for the version. Evry holds the version before the candidate.
        const update = native.query(
          "update persons set first_name='Concurrent' where id=$1",
          [f.person]
        );
        const deadline = Date.now() + 10000;
        let waiting = false;
        while (Date.now() < deadline) {
          const state = (
            await pool.query(
              "select wait_event_type from pg_stat_activity where pid=$1",
              [native.processID]
            )
          ).rows[0];
          if (state?.wait_event_type === "Lock") {
            waiting = true;
            break;
          }
          await new Promise((done) => setTimeout(done, 10));
        }
        release.resolve();
        assert.ok(waiting, "Native writer must wait on Evry's version row");
        await update;
        await native.query("commit");
        await assertRefused(plan, await effect);
        assert.ok(failures.get("deadlock")?.includes("40P01"));
        assert.equal(attempts.get("deadlock"), 2);
      } finally {
        release.resolve();
        await native.query("rollback");
        native.release();
      }
    }
  );
  console.log(
    `PRODUCTION_LEADERSHIP_PROOF=${JSON.stringify({ passed, attempts: Object.fromEntries(attempts), failures: Object.fromEntries(failures) })}`
  );
} finally {
  await pool.end();
}
