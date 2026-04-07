import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DbType = NeonHttpDatabase<typeof schema>;

let cached: DbType | undefined;

function init(): DbType {
  if (!cached) {
    cached = drizzle(neon(process.env.DATABASE_URL!), { schema });
  }
  return cached;
}

// Lazy-initialized proxy: defers `neon()` until the first property access so
// Next.js's build-time page-data collection (which has no DATABASE_URL) does
// not crash on module evaluation.
export const db = new Proxy({} as DbType, {
  get(_target, prop) {
    const real = init();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type Database = DbType;
