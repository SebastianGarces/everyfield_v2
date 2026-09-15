// Full versioned-history and 0076 down proof, disposable loopback database only.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const target = new URL(process.env.PROVENANCE_PG_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
assert.equal(target.pathname, "/proof830");
const pgModule = pathToFileURL(resolve(process.env.PG_MODULE ?? "")).href;
const { default: pg } = await import(pgModule);
const client = new pg.Client({ connectionString: target.href });
const temporary = mkdtempSync(join(tmpdir(), "provenance830-migrate-"));
const migrations = resolve("src/db/migrations");
const journal = JSON.parse(
  readFileSync(join(migrations, "meta/_journal.json"), "utf8")
);
const leadership = journal.entries.at(-1);
assert.equal(leadership.tag, "0076_team_leader_provenance");
assert.equal(leadership.idx, 76);
const reviewedWiki = "17a9753dc64dad2a510a8693ac72d4dcc781224b";
const previousJournal = JSON.parse(
  execFileSync(
    "git",
    ["show", `${reviewedWiki}:src/db/migrations/meta/_journal.json`],
    { encoding: "utf8" }
  )
);
assert.deepEqual(journal.entries.slice(0, -1), previousJournal.entries);
for (const name of execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", reviewedWiki, "src/db/migrations"],
  { encoding: "utf8" }
)
  .trim()
  .split("\n")) {
  if (name.endsWith("_journal.json")) continue;
  assert.deepEqual(
    readFileSync(name),
    execFileSync("git", ["show", `${reviewedWiki}:${name}`]),
    name
  );
}
const snapshot75 = JSON.parse(
  readFileSync(join(migrations, "meta/0075_snapshot.json"), "utf8")
);
const snapshot76 = JSON.parse(
  readFileSync(join(migrations, "meta/0076_snapshot.json"), "utf8")
);
assert.equal(snapshot76.prevId, snapshot75.id);
const stripped = structuredClone(snapshot76);
stripped.id = snapshot75.id;
stripped.prevId = snapshot75.prevId;
delete stripped.tables["public.ministry_teams"].columns.leader_source;
delete stripped.tables["public.ministry_teams"].columns.leader_role_id;
delete stripped.tables["public.ministry_teams"].checkConstraints
  .ministry_teams_leader_provenance_check;
assert.deepEqual(stripped, snapshot75);
console.log(
  "PASS: prior SQL/snapshot bytes and journal entries preserved; snapshot76 descends75 with only provenance additions"
);
const baseline = join(temporary, "baseline");
mkdirSync(join(baseline, "meta"), { recursive: true });
const prior = journal.entries.slice(0, -1);
for (const entry of prior)
  copyFileSync(
    join(migrations, `${entry.tag}.sql`),
    join(baseline, `${entry.tag}.sql`)
  );
writeFileSync(
  join(baseline, "meta/_journal.json"),
  JSON.stringify({ ...journal, entries: prior })
);
const loader = join(temporary, "pg-loader.mjs");
writeFileSync(
  loader,
  `import {registerHooks} from "node:module"; registerHooks({resolve(s,c,next){return next(s === "pg" ? ${JSON.stringify(pgModule)} : s,c)}});`
);
function migrate(label, directory) {
  const config = join(temporary, `${label}.config.mjs`);
  writeFileSync(
    config,
    `export default ${JSON.stringify({ dialect: "postgresql", out: directory, dbCredentials: { url: target.href } })};`
  );
  console.log(`\n${label}: pnpm db:migrate --config <scratch-${label}-config>`);
  const result = spawnSync("pnpm", ["db:migrate", "--config", config], {
    encoding: "utf8",
    timeout: 120000,
    env: {
      ...process.env,
      DATABASE_URL: target.href,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${loader}`,
      NO_COLOR: "1",
    },
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${label} migration failed`);
}

try {
  await client.connect();
  assert.equal(
    (
      await client.query(
        "select count(*)::int as n from information_schema.tables where table_schema='public'"
      )
    ).rows[0].n,
    0
  );
  migrate("history-through-0075", baseline);
  const ledgerBefore = (
    await client.query(
      "select hash,created_at::text from drizzle.__drizzle_migrations order by created_at"
    )
  ).rows;
  assert.equal(ledgerBefore.length, prior.length);
  for (let i = 0; i < prior.length; i++)
    assert.equal(ledgerBefore[i].created_at, String(prior[i].when));
  const catalog = async () => ({
    columns: (
      await client.query(
        "select table_name,column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema='public' order by table_name,ordinal_position"
      )
    ).rows,
    constraints: (
      await client.query(
        "select c.relname,n.conname,pg_get_constraintdef(n.oid) as definition from pg_constraint n join pg_class c on c.oid=n.conrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' order by c.relname,n.conname"
      )
    ).rows,
  });
  const beforeCatalog = await catalog();
  const church = "83000000-0000-4000-8000-000000000001",
    actor = "83000000-0000-4000-8000-000000000002",
    person = "83000000-0000-4000-8000-000000000003",
    team = "83000000-0000-4000-8000-000000000004",
    empty = "83000000-0000-4000-8000-000000000005",
    role = "83000000-0000-4000-8000-000000000006";
  await client.query(
    "insert into churches(id,name,onboarding_completed_at) values($1,'Migration proof',now())",
    [church]
  );
  await client.query(
    "insert into users(id,email,name,password_hash,seat,church_id) values($1,'migration830@proof.invalid','Proof','unusable','owner',$2)",
    [actor, church]
  );
  await client.query(
    "insert into persons(id,church_id,first_name,last_name,created_by) values($1,$2,'Historical','Leader',$3)",
    [person, church, actor]
  );
  await client.query(
    "insert into ministry_teams(id,church_id,name,leader_id,created_by) values($1,$2,'Historical leader',$3,$4),($5,$2,'Empty team',null,$4)",
    [team, church, person, actor, empty]
  );
  await client.query(
    "insert into team_roles(id,church_id,team_id,name,is_leadership_role,status,created_by) values($1,$2,$3,'Matching historical role',true,'filled',$4)",
    [role, church, team, actor]
  );
  await client.query(
    "insert into team_memberships(church_id,team_id,person_id,role_id,status,created_by) values($1,$2,$3,$4,'active',$5)",
    [church, team, person, role, actor]
  );
  await client.query(
    "insert into church_privacy_settings(church_id,share_people,share_wiki) values($1,true,true)",
    [church]
  );
  const baselineRows = (
    await client.query(
      "select to_jsonb(t) as row from ministry_teams t order by id"
    )
  ).rows;
  const membershipBefore = (
    await client.query(
      "select to_jsonb(t) as row from team_memberships t order by id"
    )
  ).rows;
  const privacyBefore = (
    await client.query(
      "select to_jsonb(t) as row from church_privacy_settings t order by church_id"
    )
  ).rows;
  migrate("apply-0076", migrations);
  assert.deepEqual(
    (
      await client.query(
        "select to_jsonb(t) as row from team_memberships t order by id"
      )
    ).rows,
    membershipBefore
  );
  assert.deepEqual(
    (
      await client.query(
        "select to_jsonb(t) as row from church_privacy_settings t order by church_id"
      )
    ).rows,
    privacyBefore
  );

  assert.deepEqual(
    (
      await client.query(
        "select to_jsonb(t)-'leader_source'-'leader_role_id' as row from ministry_teams t order by id"
      )
    ).rows,
    baselineRows
  );
  assert.deepEqual(
    (
      await client.query(
        "select leader_id,leader_source,leader_role_id from ministry_teams order by id"
      )
    ).rows,
    [
      { leader_id: person, leader_source: "legacy", leader_role_id: null },
      { leader_id: null, leader_source: null, leader_role_id: null },
    ]
  );
  console.log(
    "PASS: historical leader preserved as legacy despite matching active leadership role; empty team stays empty"
  );
  const hash = createHash("sha256")
    .update(readFileSync(join(migrations, `${leadership.tag}.sql`)))
    .digest("hex");
  const applied = (
    await client.query(
      "select hash,created_at::text from drizzle.__drizzle_migrations order by created_at"
    )
  ).rows;
  assert.deepEqual(applied.slice(0, -1), ledgerBefore);
  assert.deepEqual(applied.at(-1), {
    hash,
    created_at: String(leadership.when),
  });
  migrate("replay-all", migrations);
  assert.deepEqual(
    (
      await client.query(
        "select hash,created_at::text from drizzle.__drizzle_migrations order by created_at"
      )
    ).rows,
    applied
  );
  console.log(
    `PASS: all ${journal.entries.length} history entries applied, prior hashes/stamps unchanged, exact 0076 hash ${hash}, timestamp ${leadership.when}, replay no-op`
  );
  for (const [leader, source, sourceRole] of [
    [person, null, null],
    [null, "legacy", null],
    [person, "role", null],
    [person, "explicit", role],
    [person, "legacy", role],
    [person, "unknown", null],
  ]) {
    await assert.rejects(
      client.query(
        "update ministry_teams set leader_id=$1,leader_source=$2,leader_role_id=$3 where id=$4",
        [leader, source, sourceRole, empty]
      ),
      (error) => error.code === "23514"
    );
  }
  await client.query(
    "update ministry_teams set leader_source='explicit' where id=$1",
    [team]
  );
  await client.query(
    "update ministry_teams set leader_id=$1,leader_source='role',leader_role_id=$2 where id=$3",
    [person, role, empty]
  );
  console.log(
    "PASS: production CHECK rejects six malformed states and accepts explicit/derived appointments"
  );
  const preserved = (
    await client.query(
      "select to_jsonb(t)-'leader_source'-'leader_role_id' as row from ministry_teams t order by id"
    )
  ).rows;
  await client.query(
    readFileSync(
      resolve("scripts/proofs/team-leader-provenance-0076.down.sql"),
      "utf8"
    )
  );
  assert.deepEqual(await catalog(), beforeCatalog);
  assert.deepEqual(
    (
      await client.query(
        "select to_jsonb(t) as row from ministry_teams t order by id"
      )
    ).rows,
    preserved
  );
  assert.deepEqual(
    (
      await client.query(
        "select to_jsonb(t) as row from team_memberships t order by id"
      )
    ).rows,
    membershipBefore
  );
  assert.deepEqual(
    (
      await client.query(
        "select to_jsonb(t) as row from church_privacy_settings t order by church_id"
      )
    ).rows,
    privacyBefore
  );
  assert.deepEqual(
    (
      await client.query(
        "select hash,created_at::text from drizzle.__drizzle_migrations order by created_at"
      )
    ).rows,
    applied
  );
  console.log(
    "PASS: 0076 down restores prior columns/constraints, preserves leader IDs, memberships, wiki consent and ledger; discard scratch DB"
  );
} finally {
  await client.end();
  rmSync(temporary, { recursive: true, force: true });
}
