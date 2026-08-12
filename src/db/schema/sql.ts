import { sql, type SQL } from "drizzle-orm";

/**
 * Render a value tuple as a SQL literal list for a CHECK constraint —
 * `'a', 'b'` — built from the same `as const` tuple the column types derive
 * from, so the two cannot drift.
 *
 * `sql.raw` with unescaped single quotes — safe ONLY because every argument is
 * a code-defined `as const` tuple in the importing schema file, compiled into
 * the bundle. If a caller ever sources these values from config, a database
 * table, a plugin or anything else that is not a literal in source, this
 * becomes an injection point and must switch to escaping (or to `sql.join` of
 * parameters).
 *
 * Deliberately NOT re-exported from `./index.ts`: it is a schema-authoring
 * helper, not part of the schema's public surface.
 */
export function inList(values: readonly string[]): SQL {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}
