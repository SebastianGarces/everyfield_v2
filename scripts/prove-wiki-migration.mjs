/**
 * Versioned #62 migration proof on an EMPTY, task-owned local PostgreSQL DB.
 * Requires pg in a temporary runtime, not installed into this repository:
 *   npm install --prefix /tmp/issue62-migration-runtime pg
 *   WIKI_SCRATCH_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5562/issue62_migration \
 *   WIKI_SCRATCH_PG_MODULE=/tmp/issue62-migration-runtime/node_modules/pg/lib/index.js \
 *   node scripts/prove-wiki-migration.mjs
 * The database is disposable: the down proof leaves the applied ledger intact.
 * Never reuse it after rollback. No shared ledger is read or rewritten.
 */
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
import { spawnSync } from "node:child_process";

const target = new URL(process.env.WIKI_SCRATCH_DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
assert.match(target.pathname, /^\/issue62_[a-z0-9_]+$/);
const pgModule = pathToFileURL(
  resolve(process.env.WIKI_SCRATCH_PG_MODULE ?? "")
).href;
const { default: pg } = await import(pgModule);
const client = new pg.Client({ connectionString: target.href });
const temporary = mkdtempSync(join(tmpdir(), "issue62-migrate-"));
const migrations = resolve("src/db/migrations");
const journal = JSON.parse(
  readFileSync(join(migrations, "meta/_journal.json"), "utf8")
);
const wiki = journal.entries.at(-1);
assert.equal(wiki.tag, "0075_wiki_progress_sharing");
assert.equal(wiki.idx, 75);
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
  const empty = await client.query(
    "select count(*)::int as n from information_schema.tables where table_schema='public'"
  );
  assert.equal(empty.rows[0].n, 0, "scratch database must start empty");
  migrate("baseline", baseline);
  const oldMax = await client.query(
    "select max(created_at)::text as stamp from drizzle.__drizzle_migrations"
  );
  assert.equal(oldMax.rows[0].stamp, String(prior.at(-1).when));
  const fixture = "62000000-0000-4000-8000-000000000075";
  await client.query(
    "insert into churches(id,name,onboarding_completed_at) values ($1,'issue62 migration default proof',now())",
    [fixture]
  );
  await client.query(
    "insert into church_privacy_settings(church_id,share_people) values ($1,true)",
    [fixture]
  );
  migrate("apply", migrations);
  const columns = await client.query(
    "select column_name,column_default,is_nullable from information_schema.columns where table_name='church_privacy_settings' and column_name='share_wiki'"
  );
  assert.deepEqual(columns.rows, [
    { column_name: "share_wiki", column_default: "false", is_nullable: "NO" },
  ]);
  console.log(JSON.stringify(columns.rows));
  const consent = await client.query(
    "select share_people,share_wiki from church_privacy_settings where church_id=$1",
    [fixture]
  );
  assert.deepEqual(consent.rows, [{ share_people: true, share_wiki: false }]);
  console.log("Existing consent/default:", JSON.stringify(consent.rows));
  const ledger = await client.query(
    "select count(*)::int as n from drizzle.__drizzle_migrations where created_at=$1",
    [wiki.when]
  );
  assert.equal(ledger.rows[0].n, 1);
  migrate("replay", migrations);
  const replayLedger = await client.query(
    "select count(*)::int as n from drizzle.__drizzle_migrations where created_at=$1",
    [wiki.when]
  );
  assert.equal(replayLedger.rows[0].n, 1);
  console.log(
    "PASS: versioned apply, existing-row default, preserved consent, one ledger row after replay"
  );
  console.log(
    '\nrollback: ALTER TABLE "church_privacy_settings" DROP COLUMN "share_wiki";'
  );
  await client.query(
    'ALTER TABLE "church_privacy_settings" DROP COLUMN "share_wiki"'
  );
  const absent = await client.query(
    "select count(*)::int as n from information_schema.columns where table_name='church_privacy_settings' and column_name='share_wiki'"
  );
  assert.equal(absent.rows[0].n, 0);
  const preserved = await client.query(
    "select share_people from church_privacy_settings where church_id=$1",
    [fixture]
  );
  assert.deepEqual(preserved.rows, [{ share_people: true }]);
  console.log("Column count after rollback:", absent.rows[0].n);
  console.log(
    "Existing consent after rollback:",
    JSON.stringify(preserved.rows)
  );
  console.log(
    "PASS: rollback removes only the wiki column; discard this scratch database"
  );
} finally {
  await client.end();
  rmSync(temporary, { recursive: true, force: true });
}
