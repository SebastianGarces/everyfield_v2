#!/usr/bin/env node
import { spawnSync, spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  readdirSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const toolkit = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = process.cwd();
const [command, location] = process.argv.slice(2);
if (!["up", "down", "exec"].includes(command) || !location)
  throw new Error(
    "Usage: node scripts/preview-local.mjs up|down|exec PRIVATE_DIRECTORY [command args]"
  );
const directory = resolve(location);
const stateFile = join(directory, "ownership.json");
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 120000,
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `${cmd} ${args[0]} failed: ${result.stderr ?? result.error}`
    );
  return result.stdout?.trim();
};
const docker = (args, input) => run("docker", args, { input });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readState = () => JSON.parse(readFileSync(stateFile, "utf8"));
const save = (state) =>
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
  });
const cleanEnv = () =>
  Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "USER", "SHELL", "PNPM_HOME"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]])
  );
const envFor = (state) => ({ ...cleanEnv(), ...state.env });
async function waitFor(probe) {
  for (let i = 0; i < 60; i++) {
    try {
      if (await probe()) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("Owned service readiness timed out");
}
async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
if (command === "exec") {
  const state = readState();
  const args = process.argv.slice(4);
  if (!state.ready || !args.length)
    throw new Error("Ready owned stack and command required");
  run(args[0], args.slice(1), {
    cwd: process.cwd(),
    env: envFor(state),
    stdio: "inherit",
    timeout: 600000,
  });
} else if (command === "down") {
  if (!existsSync(stateFile)) {
    console.log("No owned resources recorded");
    process.exit(0);
  }
  const state = readState();
  if (
    lstatSync(directory).isSymbolicLink() ||
    realpathSync(directory) !== state.directory
  )
    throw new Error("Private directory ownership differs");
  if (!/^ef-preview-[a-f0-9]{12}$/.test(state.id))
    throw new Error("Invalid ownership record");
  for (const name of [...state.containers].reverse()) {
    const ids = docker(["ps", "-aq", "--filter", `name=^/${name}$`]);
    if (!ids) continue;
    const label = docker([
      "inspect",
      "--format",
      '{{index .Config.Labels "everyfield.preview"}}',
      name,
    ]);
    if (label !== state.id) throw new Error("Refusing unowned container");
    docker(["rm", "-fv", name]);
  }
  if (docker(["network", "ls", "-q", "--filter", `name=^${state.id}$`])) {
    const label = docker([
      "network",
      "inspect",
      "--format",
      '{{index .Labels "everyfield.preview"}}',
      state.id,
    ]);
    if (label !== state.id) throw new Error("Refusing unowned network");
    docker(["network", "rm", state.id]);
  }
  if (state.mailPid) {
    try {
      const args = run("ps", ["-p", String(state.mailPid), "-o", "args="]);
      if (args.includes(state.mailScript) && args.includes(directory))
        process.kill(state.mailPid, "SIGTERM");
      else
        throw new Error("Mail process identity differs; refusing to stop it");
    } catch (error) {
      if (!String(error).includes("ps -p failed") && error.code !== "ESRCH")
        throw error;
    }
  }
  if (docker(["ps", "-aq", "--filter", `label=everyfield.preview=${state.id}`]))
    throw new Error("Owned containers remain");
  rmSync(directory, { recursive: true });
  console.log(
    `Verified removal of ${state.id} containers, network and private data`
  );
} else {
  if (existsSync(stateFile))
    throw new Error(
      "A stack is already recorded here. Use a new directory or down first."
    );
  for (const file of readdirSync(root).filter(
    (n) => /^\.env(?:\.|$)/.test(n) && n !== ".env.example"
  ))
    throw new Error(
      `Remove inherited ${file} from this worktree before provisioning; never read or edit through its link`
    );
  mkdirSync(directory, { mode: 0o700 });
  const suffix = randomBytes(6).toString("hex");
  const state = {
    id: `ef-preview-${suffix}`,
    database: `ef_preview_${suffix}`,
    containers: [],
    ready: false,
    directory: realpathSync(directory),
  };
  save(state);
  const pg = `${state.id}-pg`,
    proxy = `${state.id}-http`;
  const password = randomBytes(24).toString("hex");
  docker([
    "network",
    "create",
    "--label",
    `everyfield.preview=${state.id}`,
    state.id,
  ]);
  state.containers.push(pg);
  save(state);
  docker([
    "run",
    "-d",
    "--name",
    pg,
    "--label",
    `everyfield.preview=${state.id}`,
    "--network",
    state.id,
    "--mount",
    "type=tmpfs,destination=/var/lib/postgresql/data",
    "-p",
    "127.0.0.1::5432",
    "-e",
    "POSTGRES_USER=postgres",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    `POSTGRES_DB=${state.database}`,
    "pgvector/pgvector:pg17",
  ]);
  await waitFor(() =>
    run("docker", [
      "exec",
      pg,
      "pg_isready",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
    ])
  );
  docker(
    [
      "exec",
      "-i",
      pg,
      "psql",
      "-U",
      "postgres",
      "-d",
      state.database,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    "CREATE SCHEMA neon_control_plane; CREATE TABLE neon_control_plane.endpoints(endpoint_id varchar(255) PRIMARY KEY, allowed_ips varchar(255));"
  );
  state.containers.push(proxy);
  save(state);
  docker([
    "run",
    "-d",
    "--name",
    proxy,
    "--label",
    `everyfield.preview=${state.id}`,
    "--network",
    state.id,
    "-p",
    "127.0.0.1::4444",
    "-e",
    `PG_CONNECTION_STRING=postgres://postgres:${password}@${pg}:5432/${state.database}`,
    "ghcr.io/timowilhelm/local-neon-http-proxy:main",
  ]);
  const proxyPort = docker(["port", proxy, "4444/tcp"]).split(":").at(-1);
  const pgPort = docker(["port", pg, "5432/tcp"]).split(":").at(-1);
  const endpoint = `http://127.0.0.1:${proxyPort}/sql`;
  await waitFor(() =>
    fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(1000) })
  );
  const ws = `${state.id}-ws`;
  state.containers.push(ws);
  save(state);
  docker([
    "run",
    "-d",
    "--name",
    ws,
    "--label",
    `everyfield.preview=${state.id}`,
    "--network",
    state.id,
    "-p",
    "127.0.0.1::80",
    "-e",
    `ALLOW_ADDR_REGEX=^${pg}:5432$`,
    "ghcr.io/neondatabase/wsproxy:latest",
  ]);
  const wsPort = docker(["port", ws, "80/tcp"]).split(":").at(-1);
  const wsEndpoint = `ws://127.0.0.1:${wsPort}/v1?address=${pg}:5432`;
  await waitFor(() => fetch(`http://127.0.0.1:${wsPort}/v1`));
  const mailPort = await freePort();
  const mailSource = readFileSync(
    join(toolkit, "scripts/preview-mail.mjs"),
    "utf8"
  );
  const mailScript = join(directory, "mail-server.mjs");
  writeFileSync(mailScript, mailSource, { flag: "wx", mode: 0o400 });
  state.mailScript = mailScript;
  save(state);
  const mail = spawn(
    process.execPath,
    [mailScript, String(mailPort), join(directory, "mail.jsonl")],
    { detached: true, stdio: "ignore", env: cleanEnv() }
  );
  state.mailPid = mail.pid;
  save(state);
  mail.unref();
  await waitFor(() => fetch(`http://127.0.0.1:${mailPort}/messages`));
  const runtimeSource = readFileSync(
    join(toolkit, "scripts/preview-runtime.mjs"),
    "utf8"
  );
  const runtimeHash = createHash("sha256").update(runtimeSource).digest("hex");
  const runtime = join(directory, `runtime-${runtimeHash}.mjs`);
  writeFileSync(runtime, runtimeSource, { flag: "wx", mode: 0o400 });
  state.runtimeHash = runtimeHash;
  state.toolkitCommit = run("git", ["rev-parse", "HEAD"], { cwd: toolkit });
  state.env = {
    EVERYFIELD_OWNED_PREVIEW: "1",
    EVERYFIELD_PREVIEW_SQL_ENDPOINT: endpoint,
    EVERYFIELD_PREVIEW_RUNTIME_HASH: runtimeHash,
    DATABASE_URL: `postgres://postgres:${password}@localhost:${pgPort}/${state.database}`,
    NODE_OPTIONS: `--import=${runtime}`,
    NEXT_TELEMETRY_DISABLED: "1",
    RESEND_API_KEY: "re_owned_capture_only",
    RESEND_BASE_URL: `http://127.0.0.1:${mailPort}`,
    EMAIL_FROM: "Preview <preview@example.test>",
    UNSUBSCRIBE_TOKEN_SECRET: randomBytes(32).toString("hex"),
    SEED_ADMIN_PASSWORD: randomBytes(24).toString("hex"),
    ADMIN_EMAILS: "owner@preview.example.test",
  };
  save(state);
  // Use the ordinary migration command over the owned websocket proxy.
  run("pnpm", ["db:migrate"], {
    cwd: root,
    env: { ...envFor(state), EVERYFIELD_PREVIEW_WS_ENDPOINT: wsEndpoint },
    stdio: "inherit",
  });
  state.ready = true;
  save(state);
  const config = {
    install: [
      "env",
      "-u",
      "NODE_OPTIONS",
      "pnpm",
      "install",
      "--frozen-lockfile",
    ],
    dev: ["pnpm", "exec", "next", "dev", "--hostname", "127.0.0.1"],
    build: ["pnpm", "exec", "next", "build"],
    start: ["pnpm", "exec", "next", "start", "--hostname", "127.0.0.1"],
    env: { ...state.env, NEXT_PUBLIC_APP_URL: "${PREVIEW_URL}" },
    healthPath: "/login",
    healthStatus: 200,
    timeoutSeconds: 600,
  };
  writeFileSync(
    join(directory, "preview.json"),
    JSON.stringify(config, null, 2) + "\n",
    { mode: 0o600 }
  );
  console.log(
    JSON.stringify({
      owned: state.id,
      database: state.database,
      config: join(directory, "preview.json"),
      mail: state.env.RESEND_BASE_URL + "/messages",
    })
  );
}
