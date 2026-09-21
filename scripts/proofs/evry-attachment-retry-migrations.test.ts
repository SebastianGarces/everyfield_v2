import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { z } from "zod";
import { startFixtureStack } from "../../src/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "../../src/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  fixtureId,
} from "../../src/lib/evry/eve/evals/fixtures/manifest";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(repository, "src/db/migrations");
const journalSchema = z.object({
  version: z.string(),
  dialect: z.string(),
  entries: z.array(
    z.object({
      idx: z.number().int(),
      version: z.string(),
      when: z.number().int(),
      tag: z.string(),
      breakpoints: z.boolean(),
    })
  ),
});
type Journal = z.infer<typeof journalSchema>;
const journal = journalSchema.parse(
  JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8"))
);
const targetTags = [
  "0080_communication_failed_retry",
  "0081_evry_session_attachments",
] as const;
function targetHistory() {
  const start = journal.entries.findIndex((e) => e.tag === targetTags[0]);
  assert.ok(start > 0, "Target migrations must have a versioned predecessor");
  assert.equal(journal.entries[start + 1]?.tag, targetTags[1]);
  const entries = journal.entries.slice(0, start + 2);
  assert.ok(
    entries.every(
      (e, index) => index === 0 || e.when > entries[index - 1]!.when
    )
  );
  return { baseline: entries.slice(0, -2), upgrade: entries };
}
function sourceHashes() {
  return [
    ...readdirSync(source)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => join(source, f)),
    ...readdirSync(join(source, "meta"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(source, "meta", f)),
  ]
    .sort()
    .map((file) => ({
      file,
      hash: createHash("sha256").update(readFileSync(file)).digest("hex"),
    }));
}
function fixtureTarget(databaseUrl: string, proxyUrl: string) {
  const target = new URL(databaseUrl),
    proxy = new URL(proxyUrl);
  assert.equal(target.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
  assert.equal(target.pathname, "/eve_fixture");
  assert.equal(target.username, "postgres");
  assert.equal(target.password, "postgres");
  assert.ok(target.port);
  assert.equal(target.search, "");
  assert.equal(proxy.protocol, "http:");
  assert.equal(proxy.hostname, "127.0.0.1");
  assert.equal(proxy.pathname, "/sql");
  assert.ok(proxy.port);
  assert.equal(proxy.username, "");
  assert.equal(proxy.password, "");
  return target;
}
test("0080/0081 proof derives its baseline from the unchanged versioned journal", () => {
  const history = targetHistory();
  assert.deepEqual(
    history.upgrade.slice(-2).map((e) => e.tag),
    targetTags
  );
  assert.equal(history.upgrade.length - history.baseline.length, 2);
  for (const entry of history.upgrade)
    assert.ok(readFileSync(join(source, `${entry.tag}.sql`)).length);
});
test("migration child accepts only the disposable stack's local database and proxy", () => {
  const database = "postgresql://postgres:postgres@localhost:55444/eve_fixture";
  const proxy = "http://127.0.0.1:55445/sql";
  assert.equal(fixtureTarget(database, proxy).pathname, "/eve_fixture");
  for (const [db, endpoint] of [
    ["postgresql://postgres:postgres@shared.example:55444/eve_fixture", proxy],
    [database.replace("eve_fixture", "shared_development"), proxy],
    [database.replace("postgres:postgres", "operator:credential"), proxy],
    [database, "https://database.example/sql"],
  ])
    assert.throws(() => fixtureTarget(db!, endpoint!));
});

/** This proves transactional failed-UPGRADE rollback. It is not a down migration. */
test(
  "normal migrator rolls back a failed 0080/0081 upgrade, then applies and replays safely",
  {
    skip: process.env.EVRY_ATTACHMENT_RETRY_MIGRATIONS_PROOF !== "1",
    timeout: 300_000,
  },
  async (t) => {
    const temporary = mkdtempSync(
      join(tmpdir(), "evry-attachment-retry-migrations-")
    );
    const evidence = join(temporary, "evidence"),
      work = join(temporary, "work");
    mkdirSync(evidence);
    mkdirSync(work);
    console.log(`Verbatim migration evidence: ${evidence}`);
    const beforeSource = sourceHashes(),
      history = targetHistory();
    writeFileSync(
      join(evidence, "source-hashes.json"),
      JSON.stringify(beforeSource, null, 2)
    );
    let stack: Awaited<ReturnType<typeof startFixtureStack>> | null = null;
    const subprocess = (
      label: string,
      command: string,
      args: string[],
      env: NodeJS.ProcessEnv,
      cwd = repository
    ) => {
      const result = spawnSync(command, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      writeFileSync(join(evidence, `${label}.stdout.log`), result.stdout ?? "");
      writeFileSync(join(evidence, `${label}.stderr.log`), result.stderr ?? "");
      writeFileSync(
        join(evidence, `${label}.command.json`),
        JSON.stringify(
          {
            command,
            args,
            status: result.status,
            signal: result.signal,
            error: result.error?.message ?? null,
          },
          null,
          2
        )
      );
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      if (result.error) throw result.error;
      return result;
    };
    // No .env import and no inherited application/provider credentials.
    const cleanEnvironment: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      COREPACK_ENABLE_AUTO_PIN: "0",
      NO_COLOR: "1",
    };
    try {
      const driver = join(work, "driver");
      mkdirSync(driver);
      const npmUserConfig = join(work, "npm-user.config"),
        npmGlobalConfig = join(work, "npm-global.config");
      writeFileSync(npmUserConfig, "");
      writeFileSync(npmGlobalConfig, "");
      // A throwaway, pinned driver supports drizzle-kit without changing repository dependencies.
      assert.equal(
        subprocess(
          "driver-install",
          "npm",
          [
            "install",
            "--prefix",
            driver,
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--package-lock",
            "--save-exact",
            "--registry=https://registry.npmjs.org/",
            "pg@8.16.3",
          ],
          {
            ...cleanEnvironment,
            NPM_CONFIG_USERCONFIG: npmUserConfig,
            NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
          },
          driver
        ).status,
        0
      );
      const pgPath = realpathSync(join(driver, "node_modules/pg/lib/index.js"));
      assert.ok(pgPath.startsWith(`${realpathSync(work)}/`));
      assert.equal(
        JSON.parse(
          readFileSync(join(dirname(pgPath), "../package.json"), "utf8")
        ).version,
        "8.16.3"
      );
      stack = await startFixtureStack(repository, { migrate: false });
      const target = fixtureTarget(stack.databaseUrl, stack.proxyUrl);
      const store = createFixtureStore(stack.container);
      assert.equal(
        store.query(
          "select table_name from information_schema.tables where table_schema='public'"
        ).length,
        0
      );
      // pg is the real registry-installed driver. Only its resolution is supplied; no mocked SQL.
      // Both Neon entry modes get the isolated proxy for the migrator's read-only failure diagnosis.
      const preload = join(work, "isolated-driver.mjs");
      writeFileSync(
        preload,
        `import {registerHooks,createRequire} from 'node:module';
const require=createRequire(${JSON.stringify(pathToFileURL(join(repository, "package.json")).href)});
registerHooks({resolve(s,c,next){return next(s==='pg'?${JSON.stringify(pathToFileURL(pgPath).href)}:s,c)}});
const cjs=require('@neondatabase/serverless');cjs.neonConfig.fetchEndpoint=${JSON.stringify(stack.proxyUrl)};
const esm=await import(${JSON.stringify(pathToFileURL(resolve(repository, "node_modules/@neondatabase/serverless/index.mjs")).href)});esm.neonConfig.fetchEndpoint=${JSON.stringify(stack.proxyUrl)};
const fetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!==${JSON.stringify(new URL(stack.proxyUrl).origin)})throw new Error('Migration proof refuses non-fixture HTTP');return fetch(input,init)};
`
      );
      const migrationSet = (
        name: string,
        entries: Journal["entries"],
        scratch?: { tag: string; sql: string }
      ) => {
        const folder = join(work, name);
        mkdirSync(join(folder, "meta"), { recursive: true });
        for (const entry of entries)
          writeFileSync(
            join(folder, `${entry.tag}.sql`),
            scratch?.tag === entry.tag
              ? scratch.sql
              : readFileSync(join(source, `${entry.tag}.sql`))
          );
        writeFileSync(
          join(folder, "meta/_journal.json"),
          JSON.stringify({ ...journal, entries }, null, 2)
        );
        writeFileSync(
          join(evidence, `${name}.journal.json`),
          readFileSync(join(folder, "meta/_journal.json"))
        );
        if (scratch)
          writeFileSync(join(evidence, `${scratch.tag}.sql`), scratch.sql);
        const config = join(work, `${name}.config.mjs`);
        writeFileSync(
          config,
          `export default ${JSON.stringify({ dialect: "postgresql", out: folder, dbCredentials: { url: target.href } })};\n`
        );
        return config;
      };
      const migrate = (label: string, config: string) =>
        subprocess(label, "pnpm", ["db:migrate", "--config", config], {
          ...cleanEnvironment,
          DATABASE_URL: target.href,
          NODE_OPTIONS: `--import=${preload}`,
        });
      const ledger = () =>
        store.query(
          "select id,hash,created_at::text from drizzle.__drizzle_migrations order by created_at,id"
        );
      const expectedLedger = (entries: Journal["entries"]) =>
        entries.map((e) => ({
          hash: createHash("sha256")
            .update(readFileSync(join(source, `${e.tag}.sql`)))
            .digest("hex"),
          created_at: String(e.when),
        }));
      const ledgerIdentity = (rows: ReturnType<typeof ledger>) =>
        rows.map(({ hash, created_at }) => ({ hash, created_at }));
      const catalog = () => ({
        columns: store.query(
          "select n.nspname,c.relname,c.relkind,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_value from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname in ('public','drizzle') order by n.nspname,c.relname,a.attnum"
        ),
        constraints: store.query(
          "select n.nspname,c.conname,pg_get_constraintdef(c.oid) definition from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','drizzle') order by n.nspname,c.conname"
        ),
        indexes: store.query(
          "select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('public','drizzle') order by schemaname,tablename,indexname"
        ),
      });
      const baselineConfig = migrationSet("baseline", history.baseline);
      assert.equal(migrate("01-baseline-apply", baselineConfig).status, 0);
      assert.deepEqual(
        ledgerIdentity(ledger()),
        expectedLedger(history.baseline)
      );
      const m = createFixtureManifest("migration-0080-0081", 0);
      store.seed(m);
      const message = fixtureId(m.caseId, "historical-message"),
        recipient = fixtureId(m.caseId, "historical-recipient");
      store.sql(`insert into communications(id,church_id,body,status,created_by_id) values ('${message}','${m.ids.plant}','Historical message','failed','${m.ids.actor}');
      insert into communication_recipients(id,church_id,communication_id,person_id,status,error_message) values ('${recipient}','${m.ids.plant}','${message}','${m.ids["core-alex"]}','failed','Unclassified historical failure');`);
      const beforeLedger = ledger(),
        beforeCatalog = catalog(),
        beforeData = store.query(
          `select * from communication_recipients where id='${recipient}'`
        );
      writeFileSync(
        join(evidence, "baseline-state.json"),
        JSON.stringify(
          {
            ledger: beforeLedger,
            catalog: beforeCatalog,
            recipient: beforeData,
          },
          null,
          2
        )
      );
      const last = history.upgrade.at(-1)!;
      const scratchTag = `${String(last.idx + 1).padStart(4, "0")}_evry_expected_failure`;
      const scratchSql = `DO $$ BEGIN
      IF to_regclass('public.communication_failed_retries') IS NULL OR to_regclass('public.evry_eve_attachments') IS NULL OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='communication_recipients' AND column_name='failure_origin') THEN RAISE EXCEPTION 'EVRY_TARGET_MIGRATIONS_NOT_APPLIED'; END IF;
      IF (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at IN (${history.upgrade
        .slice(-2)
        .map((e) => e.when)
        .join(
          ","
        )})) <> 2 THEN RAISE EXCEPTION 'EVRY_TARGET_LEDGER_ROWS_NOT_INSERTED'; END IF;
      UPDATE communication_recipients SET error_message='Must be rolled back' WHERE id='${recipient}';
      RAISE EXCEPTION 'EVRY_EXPECTED_0080_0081_ROLLBACK';
    END $$;\n`;
      const failureConfig = migrationSet(
        "forced-failure",
        [
          ...history.upgrade,
          { ...last, idx: last.idx + 1, when: last.when + 1, tag: scratchTag },
        ],
        { tag: scratchTag, sql: scratchSql }
      );
      const failure = migrate("02-forced-upgrade-rollback", failureConfig);
      assert.notEqual(
        failure.status,
        0,
        "Scratch migration must fail the real migrator"
      );
      // PostgreSQL writes errors to stderr; capture both streams without discarding the actual error line.
      const server = spawnSync("docker", ["logs", stack.container], {
        encoding: "utf8",
      });
      assert.equal(server.status, 0);
      writeFileSync(
        join(evidence, "02-postgres.stdout.log"),
        server.stdout ?? ""
      );
      writeFileSync(
        join(evidence, "02-postgres.stderr.log"),
        server.stderr ?? ""
      );
      assert.match(
        `${server.stdout}\n${server.stderr}`,
        /ERROR:\s+EVRY_EXPECTED_0080_0081_ROLLBACK/
      );
      assert.deepEqual(
        ledger(),
        beforeLedger,
        "Target and scratch ledger rows must roll back"
      );
      assert.deepEqual(
        catalog(),
        beforeCatalog,
        "Both new tables, column, constraints and indexes must roll back"
      );
      assert.deepEqual(
        store.query(
          `select * from communication_recipients where id='${recipient}'`
        ),
        beforeData,
        "Existing data survives failed upgrade"
      );
      writeFileSync(
        join(evidence, "rollback-state.json"),
        JSON.stringify({ ledger: ledger(), catalog: catalog() }, null, 2)
      );
      t.diagnostic(
        "PASS: failed pending batch reached both target migrations and ledger inserts, then rolled back DDL, ledger and data"
      );
      const successConfig = migrationSet("successful-upgrade", history.upgrade);
      assert.equal(migrate("03-successful-upgrade", successConfig).status, 0);
      const afterLedger = ledger(),
        afterCatalog = catalog();
      assert.deepEqual(
        ledgerIdentity(afterLedger),
        expectedLedger(history.upgrade)
      );
      assert.equal(
        store.query("select * from communication_failed_retries").length,
        0
      );
      assert.equal(store.query("select * from evry_eve_attachments").length, 0);
      const historical = store.query(
        `select * from communication_recipients where id='${recipient}'`
      );
      assert.deepEqual(
        historical,
        [{ ...beforeData[0], failure_origin: null }],
        "Historical failures remain unclassified, not newly retryable"
      );
      assert.ok(
        afterCatalog.constraints.some(
          (r) => r.conname === "evry_eve_attachments_kind_check"
        )
      );
      assert.ok(
        afterCatalog.constraints.some(
          (r) => r.conname === "comm_failed_retries_attempt_check"
        )
      );
      writeFileSync(
        join(evidence, "successful-upgrade-state.json"),
        JSON.stringify(
          { ledger: afterLedger, catalog: afterCatalog, recipient: historical },
          null,
          2
        )
      );
      assert.equal(migrate("04-noop-replay", successConfig).status, 0);
      assert.deepEqual(ledger(), afterLedger);
      assert.deepEqual(catalog(), afterCatalog);
      assert.deepEqual(
        store.query(
          `select * from communication_recipients where id='${recipient}'`
        ),
        historical
      );
      assert.deepEqual(
        sourceHashes(),
        beforeSource,
        "Committed migrations and journal remain untouched"
      );
      t.diagnostic(
        "PASS: unchanged 0080/0081 apply successfully; exact hashes/timestamps recorded; second apply is a no-op"
      );
      writeFileSync(
        join(evidence, "result.json"),
        JSON.stringify(
          {
            passed: true,
            scope:
              "transactional failed-upgrade rollback, successful apply and no-op replay",
            downMigrationImplemented: false,
            sharedDatabaseTouched: false,
            targetTags,
            baselineEntries: history.baseline.length,
            upgradeEntries: history.upgrade.length,
          },
          null,
          2
        )
      );
    } finally {
      try {
        if (stack) {
          await stack.cleanup();
          console.log("PASS: owned disposable migration stack removed");
        }
      } finally {
        rmSync(work, { recursive: true, force: true });
        console.log(
          `Temporary driver/configs removed; transcripts retained at ${evidence}`
        );
      }
    }
  }
);
