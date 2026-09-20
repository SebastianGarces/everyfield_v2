import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { startFixtureStack } from "./stack";
import { createFixtureStore } from "./store";

test(
  "0079 applies with pnpm db:migrate, rolls back only its own DDL, and reapplies identically",
  { skip: process.env.EVRY_EVE_MIGRATION_PROOF !== "1", timeout: 180_000 },
  async (t) => {
    const driver = process.env.PG_MODULE;
    assert.ok(
      driver,
      "PG_MODULE must name an installed pg driver used only by the scratch migration process"
    );
    const pgModule = pathToFileURL(resolve(driver)).href;
    const evidence = mkdtempSync(join(tmpdir(), "eve-migration-0079-proof-"));
    const repository = process.cwd();
    const migrations = join(repository, "src/db/migrations");
    const journal = z
      .object({
        version: z.string(),
        dialect: z.string(),
        entries: z.array(
          z.object({
            idx: z.number(),
            version: z.string(),
            when: z.number(),
            tag: z.string(),
            breakpoints: z.boolean(),
          })
        ),
      })
      .parse(
        JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8"))
      );
    const target = journal.entries.at(-1)!;
    assert.equal(target.tag, "0079_huge_random");
    const prior = journal.entries.slice(0, -1);
    const hash = createHash("sha256")
      .update(readFileSync(join(migrations, `${target.tag}.sql`)))
      .digest("hex");
    const baseline = join(evidence, "baseline");
    mkdirSync(join(baseline, "meta"), { recursive: true });
    for (const entry of prior)
      copyFileSync(
        join(migrations, `${entry.tag}.sql`),
        join(baseline, `${entry.tag}.sql`)
      );
    writeFileSync(
      join(baseline, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: prior })
    );
    const loader = join(evidence, "pg-loader.mjs");
    writeFileSync(
      loader,
      `import {registerHooks} from 'node:module'; registerHooks({resolve(s,c,next){return next(s==='pg'?${JSON.stringify(pgModule)}:s,c)}});`
    );
    const stack = await startFixtureStack(repository, { migrate: false });
    try {
      const store = createFixtureStore(stack.container);
      const migrate = (label: string, out: string) => {
        const config = join(evidence, `${label}.config.mjs`);
        writeFileSync(
          config,
          `export default ${JSON.stringify({ dialect: "postgresql", out, dbCredentials: { url: stack.databaseUrl } })};`
        );
        const command = process.env.PNPM_BIN ?? "pnpm";
        const result = spawnSync(command, ["db:migrate", "--config", config], {
          cwd: repository,
          encoding: "utf8",
          timeout: 120_000,
          env: {
            ...process.env,
            DATABASE_URL: stack.databaseUrl,
            PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
            NODE_OPTIONS: `--import=${loader}`,
            NO_COLOR: "1",
          },
        });
        const transcript = `$ ${command} db:migrate --config ${config}\n${result.stdout ?? ""}${result.stderr ?? ""}\nexit=${result.status}\n`;
        writeFileSync(join(evidence, `${label}.log`), transcript);
        process.stdout.write(transcript);
        if (result.error) throw result.error;
        assert.equal(
          result.status,
          0,
          `${label} failed; transcript retained at ${evidence}`
        );
      };
      const catalog = () =>
        store.query(
          `select 'column' kind,column_name name,data_type || ':' || is_nullable || ':' || coalesce(column_default,'') definition from information_schema.columns where table_schema='public' and table_name='evry_eve_sessions' union all select 'index',indexname,indexdef from pg_indexes where schemaname='public' and tablename='evry_eve_sessions' union all select 'constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.evry_eve_sessions') order by kind,name`
        );
      migrate("baseline-through-0078", baseline);
      const ledgerBefore = store.query(
        "select hash,created_at::text from drizzle.__drizzle_migrations order by created_at"
      );
      assert.equal(ledgerBefore.length, prior.length);
      assert.equal(
        store.sql("select to_regclass('public.evry_eve_sessions') is null"),
        "t"
      );
      migrate("apply-0079", migrations);
      const applied = catalog();
      assert.equal(applied.filter((row) => row.kind === "column").length, 8);
      assert.ok(
        applied.some(
          (row) =>
            row.name === "evry_eve_sessions_owner_idx" &&
            String(row.definition).includes("(church_id, user_id, updated_at)")
        )
      );
      assert.equal(
        applied.filter(
          (row) =>
            row.kind === "constraint" &&
            String(row.definition).startsWith("FOREIGN KEY")
        ).length,
        2
      );
      assert.deepEqual(
        store.query(
          `select hash,created_at::text from drizzle.__drizzle_migrations where created_at=${target.when}`
        ),
        [{ hash, created_at: String(target.when) }]
      );
      store.sql(
        "insert into churches(id,name,onboarding_completed_at) values('79000000-0000-4000-8000-000000000001','Eve migration proof',now()); insert into users(id,email,password_hash,seat,church_id) values('79000000-0000-4000-8000-000000000002','migration7900@example.test','unusable','owner','79000000-0000-4000-8000-000000000001'); insert into evry_eve_sessions(id,user_id,church_id) values('eve-migration-proof','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000001');"
      );
      assert.deepEqual(
        store.query(
          "select title,archived_at is null archived,created_at is not null created,updated_at is not null updated,conversation_id is not null conversation from evry_eve_sessions"
        ),
        [
          {
            title: "New conversation",
            archived: true,
            created: true,
            updated: true,
            conversation: true,
          },
        ]
      );
      assert.throws(
        () =>
          store.sql(
            "insert into evry_eve_sessions(id,user_id,church_id) values('unknown-user','79000000-0000-4000-8000-000000000099','79000000-0000-4000-8000-000000000001')"
          ),
        /foreign key constraint/
      );
      assert.throws(
        () =>
          store.sql(
            "insert into evry_eve_sessions(id,conversation_id,user_id,church_id) select 'duplicate-conversation',conversation_id,user_id,church_id from evry_eve_sessions where id='eve-migration-proof'"
          ),
        /unique constraint/
      );
      const rollback = `begin;\ndrop table public.evry_eve_sessions;\ndelete from drizzle.__drizzle_migrations where hash='${hash}' and created_at=${target.when};\ncommit;\n`;
      const rolled = spawnSync(
        "docker",
        [
          "exec",
          "-i",
          stack.container,
          "psql",
          "-U",
          "postgres",
          "-d",
          "eve_fixture",
          "-v",
          "ON_ERROR_STOP=1",
          "-a",
        ],
        { input: rollback, encoding: "utf8" }
      );
      const transcript = `$ disposable-database psql rollback0079\n${rolled.stdout ?? ""}${rolled.stderr ?? ""}\nexit=${rolled.status}\n`;
      writeFileSync(join(evidence, "rollback-0079.log"), transcript);
      process.stdout.write(transcript);
      assert.equal(rolled.status, 0);
      assert.equal(
        store.sql("select to_regclass('public.evry_eve_sessions') is null"),
        "t"
      );
      assert.deepEqual(
        store.query(
          "select hash,created_at::text from drizzle.__drizzle_migrations order by created_at"
        ),
        ledgerBefore
      );
      assert.equal(
        store.sql(
          "select count(*) from churches where id='79000000-0000-4000-8000-000000000001'"
        ),
        "1"
      );
      migrate("reapply-0079", migrations);
      assert.deepEqual(catalog(), applied);
      writeFileSync(
        join(evidence, "assertions.log"),
        "PASS: full prior versioned history applied; 0079 ledger hash/time exact; 8 columns; owner composite index; 2 FKs; default values; foreign-key and duplicate-conversation refusals; rollback removes only Eve table/target ledger row; prior ledger and parent rows preserved; reapply catalog identical.\n"
      );
      t.diagnostic(`Verbatim migration transcripts: ${evidence}`);
    } finally {
      await stack.cleanup();
    }
  }
);
