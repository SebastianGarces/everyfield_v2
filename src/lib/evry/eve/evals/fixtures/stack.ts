import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { join } from "node:path";

/** One migrated, ephemeral DB for a suite. Random names never target an existing container. */
export async function startFixtureStack(repository: string) {
  const name = `evry-eve-fixture-${randomBytes(6).toString("hex")}`;
  const pg = `${name}-pg`;
  const proxy = `${name}-proxy`;
  const docker = (...args: string[]) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  let pgCreated = false;
  let proxyCreated = false;
  let networkCreated = false;
  async function cleanup() {
    if (proxyCreated) docker("rm", "-fv", proxy);
    if (pgCreated) docker("rm", "-fv", pg);
    if (networkCreated) docker("network", "rm", name);
  }
  try {
    docker("network", "create", name);
    networkCreated = true;
    docker(
      "run",
      "-d",
      "--name",
      pg,
      "--network",
      name,
      "--mount",
      "type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=1073741824",
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=main",
      "-p",
      "127.0.0.1::5432",
      "pgvector/pgvector:pg16"
    );
    pgCreated = true;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        docker("exec", pg, "pg_isready", "-h", "127.0.0.1", "-U", "postgres");
        ready = true;
        break;
      } catch {
        await setTimeout(500);
      }
    }
    if (!ready) throw new Error("Fixture Postgres did not become ready");
    const psql = (database: string, input: string) =>
      execFileSync(
        "docker",
        [
          "exec",
          "-i",
          pg,
          "psql",
          "-U",
          "postgres",
          "-d",
          database,
          "-v",
          "ON_ERROR_STOP=1",
          "-q",
        ],
        { input, stdio: ["pipe", "pipe", "pipe"] }
      );
    psql(
      "main",
      "create schema neon_control_plane; create table neon_control_plane.endpoints(endpoint_id varchar(255) primary key,allowed_ips varchar(255)); create database eve_fixture;"
    );
    for (const file of readdirSync(join(repository, "src/db/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort())
      psql(
        "eve_fixture",
        readFileSync(join(repository, "src/db/migrations", file), "utf8")
      );
    docker(
      "run",
      "-d",
      "--name",
      proxy,
      "--network",
      name,
      "-e",
      `PG_CONNECTION_STRING=postgres://postgres:postgres@${pg}:5432/main`,
      "-p",
      "127.0.0.1::4444",
      "ghcr.io/timowilhelm/local-neon-http-proxy:main"
    );
    proxyCreated = true;
    const pgPort = docker("port", pg, "5432/tcp").split(":").at(-1)!;
    const proxyPort = docker("port", proxy, "4444/tcp").split(":").at(-1)!;
    const proxyUrl = `http://127.0.0.1:${proxyPort}/sql`;
    ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await fetch(proxyUrl, { method: "POST" });
        ready = true;
        break;
      } catch {
        await setTimeout(500);
      }
    }
    if (!ready) throw new Error("Fixture Neon proxy did not become ready");
    return {
      container: pg,
      databaseUrl: `postgresql://postgres:postgres@localhost:${pgPort}/eve_fixture`,
      proxyUrl,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
