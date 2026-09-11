// Full versioned-history and 0077 down proof, disposable loopback database only.
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

const target = new URL(process.env.DISCOVERY_MIGRATION_PG_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
assert.equal(target.pathname, "/proof294");
const pgModule = pathToFileURL(resolve(process.env.PG_MODULE ?? "")).href;
const { default: pg } = await import(pgModule);
const client = new pg.Client({ connectionString: target.href });
const temporary = mkdtempSync(join(tmpdir(), "discovery294-migrate-"));
const migrations = resolve("src/db/migrations");
const journal = JSON.parse(
  readFileSync(join(migrations, "meta/_journal.json"), "utf8")
);
const discovery = journal.entries.at(-1);
assert.equal(discovery.tag, "0077_discovery_profiles");
assert.equal(discovery.idx, 77);
const reviewedWiki = "35e6fa086875c265c6a2c6176a01788eb92c0dc6";
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
const snapshot76 = JSON.parse(
  readFileSync(join(migrations, "meta/0076_snapshot.json"), "utf8")
);
const snapshot77 = JSON.parse(
  readFileSync(join(migrations, "meta/0077_snapshot.json"), "utf8")
);
assert.equal(snapshot77.prevId, snapshot76.id);
const stripped = structuredClone(snapshot77);
stripped.id = snapshot76.id;
stripped.prevId = snapshot76.prevId;
assert.ok(stripped.tables["public.discovery_profiles"]);
delete stripped.tables["public.discovery_profiles"];
for (const [tableName, column, index] of [
  [
    "public.organization_invitations",
    "target_user_id",
    "org_invitations_target_user_id_idx",
  ],
  [
    "public.association_events",
    "discovery_user_id",
    "association_events_discovery_user_idx",
  ],
]) {
  const table = stripped.tables[tableName];
  assert.ok(table.columns[column]);
  assert.ok(table.indexes[index]);
  delete table.columns[column];
  delete table.indexes[index];
  const newFks = Object.keys(table.foreignKeys).filter(
    (key) => !(key in snapshot76.tables[tableName].foreignKeys)
  );
  assert.equal(newFks.length, 1);
  assert.deepEqual(table.foreignKeys[newFks[0]].columnsFrom, [column]);
  assert.equal(table.foreignKeys[newFks[0]].tableTo, "users");
  delete table.foreignKeys[newFks[0]];
}
for (const check of [
  "association_events_subject_type_check",
  "association_events_subject_check",
]) {
  assert.match(
    stripped.tables["public.association_events"].checkConstraints[check].value,
    /discovery/
  );
  stripped.tables["public.association_events"].checkConstraints[check] =
    snapshot76.tables["public.association_events"].checkConstraints[check];
}
assert.deepEqual(stripped, snapshot76);
console.log(
  "PASS: immutable history through76 preserved; snapshot77 descends76 with only discovery additions"
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

const ledger = async () =>
  (
    await client.query(
      "select hash,created_at::text from drizzle.__drizzle_migrations order by created_at"
    )
  ).rows;
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
  indexes: (
    await client.query(
      "select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname"
    )
  ).rows,
});
const preservedTables = [
  "sending_networks",
  "churches",
  "users",
  "persons",
  "ministry_teams",
  "team_roles",
  "team_memberships",
  "church_privacy_settings",
  "wiki_progress",
  "wiki_bookmarks",
  "organization_invitations",
  "association_events",
];
const rows = async (includeDiscoveryColumns = false) =>
  Object.fromEntries(
    await Promise.all(
      preservedTables.map(async (table) => [
        table,
        (
          await client.query(
            `select to_jsonb(t) ${includeDiscoveryColumns ? "" : "- 'target_user_id' - 'discovery_user_id'"} as row from "${table}" t order by to_jsonb(t)::text`
          )
        ).rows,
      ])
    )
  );
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
  migrate("history-through-0076", baseline);
  const ledgerBefore = await ledger();
  assert.equal(ledgerBefore.length, prior.length);
  for (let i = 0; i < prior.length; i++)
    assert.deepEqual(ledgerBefore[i], {
      hash: createHash("sha256")
        .update(readFileSync(join(migrations, `${prior[i].tag}.sql`)))
        .digest("hex"),
      created_at: String(prior[i].when),
    });
  const beforeCatalog = await catalog();
  const church = "29400000-0000-4000-8000-000000000001",
    actor = "29400000-0000-4000-8000-000000000002",
    person = "29400000-0000-4000-8000-000000000003",
    team = "29400000-0000-4000-8000-000000000004",
    role = "29400000-0000-4000-8000-000000000005",
    explorer = "29400000-0000-4000-8000-000000000006",
    network = "29400000-0000-4000-8000-000000000007",
    invitation = "29400000-0000-4000-8000-000000000008",
    discoveryInvitation = "29400000-0000-4000-8000-000000000009";
  await client.query(
    "insert into sending_networks(id,name) values($1,'Prior network')",
    [network]
  );
  await client.query(
    "insert into churches(id,name,onboarding_completed_at,sending_network_id) values($1,'Migration proof',now(),$2)",
    [church, network]
  );
  await client.query(
    "insert into users(id,email,name,password_hash,seat,church_id) values($1,'migration294@proof.invalid','Proof','unusable','owner',$2),($3,'explorer294@proof.invalid','Explorer','unusable',null,null)",
    [actor, church, explorer]
  );
  await client.query(
    "insert into persons(id,church_id,first_name,last_name,created_by) values($1,$2,'Historical','Leader',$3)",
    [person, church, actor]
  );
  await client.query(
    "insert into ministry_teams(id,church_id,name,leader_id,leader_source,leader_role_id,created_by) values($1,$2,'Derived leader',$3,'role',$4,$5)",
    [team, church, person, role, actor]
  );
  await client.query(
    "insert into team_roles(id,church_id,team_id,name,is_leadership_role,status,created_by) values($1,$2,$3,'Leadership role',true,'filled',$4)",
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
  await client.query(
    "insert into wiki_progress(user_id,article_slug,status,scroll_position,completed_at) values($1,'migration-proof','completed',0.75,now())",
    [explorer]
  );
  await client.query(
    "insert into wiki_bookmarks(user_id,article_slug) values($1,'migration-proof')",
    [explorer]
  );
  await client.query(
    "insert into organization_invitations(id,type,inviter_user_id,invitee_email,target_church_id,sending_network_id,status,responded_by,responded_at) values($1,'church_to_network',$2,'migration294@proof.invalid',$3,$4,'accepted',$2,now())",
    [invitation, actor, church, network]
  );
  await client.query(
    "insert into association_events(subject_type,church_id,org_type,org_id,event,actor_user_id,source_invitation_id) values('church',$1,'network',$2,'associated',$3,$4)",
    [church, network, actor, invitation]
  );
  const beforeRows = await rows();
  migrate("apply-0077", migrations);
  assert.deepEqual(await rows(), beforeRows);
  const applied = await ledger();
  const hash = createHash("sha256")
    .update(readFileSync(join(migrations, `${discovery.tag}.sql`)))
    .digest("hex");
  assert.deepEqual(applied.slice(0, -1), ledgerBefore);
  assert.deepEqual(applied.at(-1), {
    hash,
    created_at: String(discovery.when),
  });
  console.log(
    "PASS: 0077 preserves all seeded membership, role provenance, wiki progress/bookmarks/consent, old invitation and audit rows"
  );
  await client.query(
    "insert into discovery_profiles(user_id,sending_network_id) values($1,$2)",
    [explorer, network]
  );
  await client.query(
    "insert into organization_invitations(id,type,inviter_user_id,invitee_email,target_user_id,sending_network_id,status) values($1,'discovery_to_network',$2,'explorer294@proof.invalid',$3,$4,'accepted')",
    [discoveryInvitation, actor, explorer, network]
  );
  await client.query(
    "insert into association_events(subject_type,discovery_user_id,org_type,org_id,event,actor_user_id,source_invitation_id) values('discovery',$1,'network',$2,'associated',$1,$3)",
    [explorer, network, discoveryInvitation]
  );
  await assert.rejects(
    client.query(
      "insert into discovery_profiles(user_id) values('29400000-0000-4000-8000-000000000099')"
    ),
    (error) => error.code === "23503"
  );
  for (const [subject, churchId, discoveryId] of [
    ["discovery", church, explorer],
    ["discovery", null, null],
    ["church", church, explorer],
  ]) {
    await assert.rejects(
      client.query(
        "insert into association_events(subject_type,church_id,discovery_user_id,org_type,org_id,event,actor_user_id) values($1,$2,$3,'network',$4,'associated',$5)",
        [subject, churchId, discoveryId, network, actor]
      ),
      (error) => error.code === "23514"
    );
  }
  console.log(
    "PASS: discovery FK and exactly-one-subject CHECK enforce real migrated data"
  );
  const beforeReplay = await rows(true),
    catalog77 = await catalog();
  const profilesBeforeReplay = (
    await client.query("select * from discovery_profiles order by user_id")
  ).rows;
  migrate("replay-all", migrations);
  assert.deepEqual(await ledger(), applied);
  assert.deepEqual(await rows(true), beforeReplay);
  assert.deepEqual(await catalog(), catalog77);
  assert.deepEqual(
    (await client.query("select * from discovery_profiles order by user_id"))
      .rows,
    profilesBeforeReplay
  );
  console.log(
    `PASS: all ${journal.entries.length} history entries applied; exact77 hash ${hash}, timestamp ${discovery.when}; replay is a schema/data/ledger no-op`
  );
  await client.query(
    readFileSync(
      resolve("scripts/proofs/discovery-profile-0077.down.sql"),
      "utf8"
    )
  );
  assert.deepEqual(await catalog(), beforeCatalog);
  assert.deepEqual(await rows(), beforeRows);
  assert.deepEqual(await ledger(), applied);
  console.log(
    "PASS: down77 restores exact76 columns/constraints/indexes, preserves all seeded membership/wiki/leadership and old invitation/audit data; ledger intentionally unchanged; discard scratch DB"
  );
} finally {
  await client.end();
  rmSync(temporary, { recursive: true, force: true });
}
