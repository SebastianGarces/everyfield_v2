#!/usr/bin/env node
// Task-owned, disposable proof. Ignores DATABASE_URL and never reuses a stack.
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const suffix = randomUUID().slice(0, 8);
const network = `discovery-294-${suffix}`;
const postgres = `${network}-pg`;
const proxy = `${network}-proxy`;
const password = randomUUID();
const database = "discovery_294_proof";
const owned = [];
let networkCreated = false;

function docker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `Docker ${args[0]} failed: ${result.stderr || result.error}`
    );
  }
  return result.stdout.trim();
}

function cleanup() {
  const failures = [];
  for (const id of [...owned].reverse()) {
    try {
      docker(["rm", "-fv", id]);
      if (docker(["ps", "-aq", "--filter", `id=${id}`])) {
        throw new Error(`Owned container remains: ${id}`);
      }
      owned.splice(owned.indexOf(id), 1);
    } catch (error) {
      failures.push(error);
    }
  }
  if (networkCreated) {
    try {
      docker(["network", "rm", network]);
      if (docker(["network", "ls", "-q", "--filter", `name=^${network}$`])) {
        throw new Error(`Owned network remains: ${network}`);
      }
      networkCreated = false;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Owned scratch cleanup failed");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

try {
  docker(["network", "create", network]);
  networkCreated = true;
  owned.push(
    docker([
      "run",
      "-d",
      "--name",
      postgres,
      "--network",
      network,
      "--memory",
      "256m",
      "--cpus",
      "1",
      "--mount",
      "type=tmpfs,destination=/var/lib/postgresql/data",
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      `POSTGRES_DB=${database}`,
      "postgres:17-alpine",
    ])
  );
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync(
      "docker",
      [
        "exec",
        "-e",
        `PGPASSWORD=${password}`,
        postgres,
        "psql",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-Atqc",
        "select 1",
      ],
      { stdio: "ignore" }
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Owned scratch Postgres did not become ready");
  docker(
    [
      "exec",
      "-i",
      postgres,
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    `
      CREATE SCHEMA neon_control_plane;
      CREATE TABLE neon_control_plane.endpoints (
        endpoint_id varchar(255) PRIMARY KEY, allowed_ips varchar(255)
      );
    `
  );
  owned.push(
    docker([
      "run",
      "-d",
      "--name",
      proxy,
      "--network",
      network,
      "--memory",
      "256m",
      "--cpus",
      "1",
      "-p",
      "127.0.0.1::4444",
      "-e",
      `PG_CONNECTION_STRING=postgres://postgres:${password}@${postgres}:5432/${database}`,
      "ghcr.io/timowilhelm/local-neon-http-proxy:main",
    ])
  );
  const port = docker(["port", proxy, "4444/tcp"]).split(":").at(-1);
  const endpoint = `http://127.0.0.1:${port}/sql`;
  ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(1000),
      });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error("Owned scratch Neon proxy did not become ready");
  console.log(`Scratch proof on owned stack ${network}`);
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "--test",
      "src/lib/discovery/conversion-policy.test.ts",
      "src/lib/discovery/profile-repository-live.test.ts",
    ],
    {
      cwd,
      stdio: "inherit",
      timeout: 120_000,
      env: {
        ...process.env,
        DISCOVERY_PROFILE_PROOF: "1",
        DISCOVERY_PROFILE_PG: postgres,
        DISCOVERY_PROFILE_ENDPOINT: endpoint,
        DISCOVERY_PROFILE_DATABASE_URL: `postgres://postgres:${password}@localhost/${database}`,
      },
    }
  );
  if (result.status !== 0)
    throw new Error(`Proof failed: ${result.status ?? result.error}`);
} finally {
  cleanup();
  console.log("Verified owned scratch containers and network removed");
}
