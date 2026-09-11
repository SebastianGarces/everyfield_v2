import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { sql } from "drizzle-orm";

import { db } from "@/db";

const READY = "TASK_STRUCTURE_BARRIER_READY";
const WAIT_LIMIT_MS = 10_000;

function psqlCommand(): { command: string; args: string[] } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error("DATABASE_URL is required for a PG barrier");

  const container = process.env.LIVE_DB_PSQL_CONTAINER;
  if (container) {
    const database = new URL(databaseUrl).pathname.slice(1);
    return {
      command: "docker",
      args: [
        "exec",
        "-i",
        "-e",
        "PGPASSWORD=postgres",
        container,
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        database,
      ],
    };
  }

  return {
    command: "psql",
    args: [databaseUrl, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
  };
}

function waitForText(
  process: ChildProcessWithoutNullStreams,
  expected: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for psql output: ${expected}`));
    }, WAIT_LIMIT_MS);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(expected)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`psql exited ${String(code)} before ${expected}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    function cleanup() {
      clearTimeout(timer);
      process.stdout.off("data", onData);
      process.off("exit", onExit);
      process.off("error", onError);
    }
    process.stdout.on("data", onData);
    process.on("exit", onExit);
    process.on("error", onError);
  });
}

export interface PostgresTransactionBarrier {
  release(): Promise<void>;
}

/** Execute one test-only statement through a separate PostgreSQL connection. */
export async function runPostgresStatement(statement: string): Promise<void> {
  const { command, args } = psqlCommand();
  const process = spawn(command, args, { stdio: "pipe" });
  let stderr = "";
  process.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  process.stdin.end(`${statement}\n\\q\n`);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      process.kill("SIGKILL");
      reject(new Error("Timed out running the PostgreSQL test statement"));
    }, WAIT_LIMIT_MS);
    process.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`psql exited ${String(code)}: ${stderr}`));
    });
    process.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Own the same production plant lock that Task hierarchy/dependency triggers
 * take. Tests start competing production writes while this transaction holds
 * the lock, prove both reached Postgres, then release them together.
 */
export async function holdTaskStructureBarrier(
  plantId: string
): Promise<PostgresTransactionBarrier> {
  const { command, args } = psqlCommand();
  const process = spawn(command, args, { stdio: "pipe" });
  let stderr = "";
  process.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  process.stdin.write(
    `begin; select lock_task_structure('${plantId}'::uuid); select '${READY}';\n`
  );
  try {
    await waitForText(process, READY);
  } catch (error) {
    process.kill("SIGKILL");
    throw error;
  }

  return {
    async release() {
      process.stdin.end("commit;\n\\q\n");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          process.kill("SIGKILL");
          reject(new Error("Timed out releasing the Task structure barrier"));
        }, WAIT_LIMIT_MS);
        process.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`psql exited ${String(code)}: ${stderr}`));
        });
      });
    },
  };
}

/** Wait until the expected writers are blocked inside the database trigger. */
export async function waitForTaskStructureWaiters(
  count: number
): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (Date.now() < deadline) {
    const result = await db.execute<{ waiting: number }>(sql`
      select count(*)::int as waiting
      from pg_locks
      where locktype = 'advisory'
        and database = (select oid from pg_database where datname = current_database())
        and granted is false
    `);
    if ((result.rows[0]?.waiting ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} Task structure writers to reach Postgres`);
}
