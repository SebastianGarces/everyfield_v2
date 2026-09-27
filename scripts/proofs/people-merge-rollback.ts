/** Rehearse the inverse DDL on a clone inside an owned disposable container.
 * Never edit migration history; discard the clone after a committed rollback. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { personMergeReferences } from "@/lib/people/merge-references";

const directory = process.argv[2];
assert.ok(directory?.startsWith("/private/tmp/"));
const state = JSON.parse(readFileSync(`${directory}/ownership.json`, "utf8"));
assert.match(state.id, /^ef-preview-[a-f0-9]{12}$/);
assert.match(state.database, /^ef_preview_[a-f0-9]{12}$/);
const container = `${state.id}-pg`;
const docker = (args: string[], input?: string) =>
  execFileSync("docker", args, {
    input,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
assert.equal(
  docker([
    "inspect",
    "--format",
    '{{index .Config.Labels "everyfield.preview"}}',
    container,
  ]).trim(),
  state.id
);
const psql = (database: string, input: string) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    input
  );
const scratch = `ef_merge_rollback_${crypto.randomUUID().replaceAll("-", "")}`;
try {
  psql("postgres", `CREATE DATABASE ${scratch};`);
  const dump = docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    state.database,
    "--no-owner",
    "--no-privileges",
  ]);
  psql(scratch, dump);
  const inverse = [
    "BEGIN;",
    ...[...new Set(personMergeReferences.map((ref) => ref.table))].map(
      (table) => `DROP TRIGGER ${table}_merged_person_guard ON ${table};`
    ),
    "DROP TRIGGER persons_merged_update_guard ON persons;",
    "DROP FUNCTION guard_merged_person_reference();",
    "DROP FUNCTION guard_merged_person_update();",
    "DROP TABLE person_merges;",
    "COMMIT;",
  ].join("\n");
  console.log(inverse);
  console.log(psql(scratch, inverse));
  const proof = psql(
    scratch,
    `DO $$ DECLARE person_row persons; BEGIN
    IF to_regclass('person_merges') IS NOT NULL THEN RAISE EXCEPTION 'receipt remains'; END IF;
    IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname LIKE '%merged%guard') THEN RAISE EXCEPTION 'guard remains'; END IF;
    SELECT * INTO person_row FROM persons WHERE deleted_at IS NOT NULL LIMIT 1;
    IF person_row.id IS NULL THEN RAISE EXCEPTION 'retired proof row missing'; END IF;
    INSERT INTO person_activities(church_id,person_id,activity_type,performed_by) VALUES(person_row.church_id,person_row.id,'note_added',person_row.created_by);
    UPDATE persons SET notes='Ordinary update after rollback' WHERE id=person_row.id;
    RAISE NOTICE 'PASS: committed inverse removes merge guards and restores ordinary FK/profile writes';
  END $$;`
  );
  console.log(proof);
} finally {
  console.log(
    psql("postgres", `DROP DATABASE IF EXISTS ${scratch} WITH (FORCE);`)
  );
}
