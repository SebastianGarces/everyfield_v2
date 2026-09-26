// Read-only inventory. Never prints connection strings, credentials or row content.
// Run: pnpm exec tsx scripts/audit-retired-agent-db.ts /path/to/.env.local
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: process.argv[2] ?? ".env.local", quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const tables = await sql`
    select schemaname, tablename from pg_tables
    where schemaname = 'public'
      and (tablename like 'evry\\_%' escape '\\'
        or tablename like 'eve\\_%' escape '\\'
        or tablename like 'assistant\\_%' escape '\\'
        or tablename = 'communication_failed_retries')
    order by tablename
  `;
  const counts = [];
  for (const table of tables) {
    const name = String(table.tablename);
    if (
      !/^(evry|eve|assistant)_[a-z0-9_]+$/.test(name) &&
      name !== "communication_failed_retries"
    ) {
      throw new Error("Unexpected agent table name");
    }
    const [count] = await sql.query(
      `select count(*)::text as rows from public."${name}"`
    );
    counts.push({ table: name, rows: count.rows });
  }
  const dependencies = await sql`
    select c.conname, c.conrelid::regclass::text as source_table,
      c.confrelid::regclass::text as referenced_table
    from pg_constraint c
    join pg_class target on target.oid = c.confrelid
    join pg_namespace n on n.oid = target.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and (target.relname like 'evry\\_%' escape '\\'
        or target.relname like 'eve\\_%' escape '\\'
        or target.relname like 'assistant\\_%' escape '\\'
        or target.relname = 'communication_failed_retries')
    order by source_table, c.conname
  `;
  const ledger = await sql`
    select hash, created_at::text from drizzle.__drizzle_migrations order by created_at
  `;
  console.log(
    JSON.stringify(
      {
        mode: "read-only",
        tables: counts,
        incomingForeignKeys: dependencies,
        ledger,
      },
      null,
      2
    )
  );
}

main().catch(() => {
  console.error("Read-only agent database audit failed; no changes were made.");
  process.exitCode = 1;
});
