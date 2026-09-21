// Run through alpha-migration-baseline.sh. Never targets a shared database.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const main = "a5239fb47edbf3273d50da0e67cd36847f6737f5";
const source = "16b7522d9e51602c749bfb697423851a5a6e0695";
const folder = "src/db/migrations";
const git = (...args) => execFileSync("git", args);
const filesAt = (ref) =>
  git("ls-tree", "-r", "--name-only", ref, folder)
    .toString()
    .trim()
    .split("\n");
const journal = JSON.parse(
  readFileSync(`${folder}/meta/_journal.json`, "utf8")
);
const mainJournal = JSON.parse(
  git("show", `${main}:${folder}/meta/_journal.json`)
);
assert.deepEqual(
  journal.entries.slice(0, mainJournal.entries.length),
  mainJournal.entries
);
assert.deepEqual(
  journal,
  JSON.parse(git("show", `${source}:${folder}/meta/_journal.json`))
);
assert.equal(journal.entries.at(-1).tag, "0079_huge_random");
for (const ref of [main, source]) {
  for (const file of filesAt(ref)) {
    if (file.endsWith("_journal.json")) continue;
    assert.deepEqual(
      readFileSync(file),
      git("show", `${ref}:${file}`),
      `${ref}:${file} changed`
    );
  }
}
console.log(
  "PASS: main migration prefix and pinned 0070–0079 SQL, snapshots, journal preserved"
);
function run(args, env = {}) {
  const result = spawnSync("corepack", ["pnpm", ...args], {
    stdio: "inherit",
    timeout: 120000,
    env: { ...process.env, COREPACK_ENABLE_AUTO_PIN: "0", ...env },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `pnpm ${args[0]} failed`);
}
run(["exec", "tsx", "--test", "src/db/migrations.test.ts"]);
const target = new URL(process.env.ALPHA_MIGRATION_PG_URL ?? "");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.pathname, "/alpha_baseline_proof");
assert.ok(target.port);
assert.equal(target.username, "postgres");
const pgModule = pathToFileURL(resolve(process.env.PG_MODULE ?? "")).href;
const { default: pg } = await import(pgModule);
const client = new pg.Client({ connectionString: target.href });
const temporary = mkdtempSync(join(tmpdir(), "alpha-baseline-proof-"));
const loader = join(temporary, "pg-loader.mjs");
writeFileSync(
  loader,
  `import {registerHooks} from "node:module"; registerHooks({resolve(s,c,next){return next(s === "pg" ? ${JSON.stringify(pgModule)} : s,c)}});`
);
const config = join(temporary, "scratch.config.mjs");
writeFileSync(
  config,
  `export default ${JSON.stringify({ dialect: "postgresql", out: resolve(folder), dbCredentials: { url: target.href } })};`
);
const migrate = () =>
  run(["db:migrate", "--config", config], {
    DATABASE_URL: target.href,
    NODE_OPTIONS: `--import=${loader}`,
    NO_COLOR: "1",
  });
const ledger = async () =>
  (
    await client.query(
      "select id, hash, created_at::text from drizzle.__drizzle_migrations order by created_at"
    )
  ).rows;
const catalog = async () =>
  (
    await client.query(`
  select c.relname, a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod) as type,
    a.attnotnull, pg_get_expr(d.adbin,d.adrelid) as default_value
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where n.nspname='public' order by c.relname,a.attnum`)
  ).rows;
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
  migrate();
  const first = await ledger();
  assert.deepEqual(
    first.map(({ hash, created_at }) => ({ hash, created_at })),
    journal.entries.map((entry) => ({
      hash: createHash("sha256")
        .update(readFileSync(`${folder}/${entry.tag}.sql`))
        .digest("hex"),
      created_at: String(entry.when),
    }))
  );
  const before = await catalog();
  assert.ok(before.some((row) => row.relname === "evry_eve_sessions"));
  assert.ok(before.some((row) => row.relname === "discovery_profiles"));
  assert.ok(
    before.some(
      (row) =>
        row.relname === "ministry_teams" && row.attname === "leader_source"
    )
  );
  console.log(
    `PASS: clean versioned history applied ${first.length} migrations with exact hashes and timestamps`
  );
  migrate();
  assert.deepEqual(await ledger(), first);
  assert.deepEqual(await catalog(), before);
  console.log(
    "PASS: second versioned migration run leaves ledger and catalog unchanged"
  );
} finally {
  await client.end();
  rmSync(temporary, { recursive: true, force: true });
}
