/** Add a bounded S3-compatible store to an owned preview. Ordinary preview-local down owns cleanup. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const directory = realpathSync(process.argv[2]);
assert.ok(directory.startsWith("/private/tmp/"));
assert.ok(!lstatSync(process.argv[2]).isSymbolicLink());
const manifest = join(directory, "ownership.json");
const configPath = join(directory, "preview.json");
const state = JSON.parse(readFileSync(manifest, "utf8"));
assert.equal(state.directory, directory);
assert.match(state.id, /^ef-preview-[a-f0-9]{12}$/);
assert.equal(state.ready, true);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const name = `${state.id}-s3`;
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const save = () => {
  writeFileSync(manifest, JSON.stringify(state, null, 2), { mode: 0o600 });
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
};
const exists = () => docker(["ps", "-aq", "--filter", `name=^/${name}$`]);
function verifyOwner() {
  assert.equal(
    docker([
      "inspect",
      "--format",
      '{{ index .Config.Labels "everyfield.preview" }}',
      name,
    ]),
    state.id
  );
}
const oldEnv = { ...state.env },
  oldConfigEnv = { ...config.env },
  oldContainers = [...state.containers];
const alreadyRecorded = Boolean(state.documentStorage);
if (!alreadyRecorded) {
  assert.ok(!exists(), "Refusing an unrecorded existing container");
  state.documentStorage = {
    name,
    bucket: `documents-${state.id}`,
    accessKeyId: `ef_${randomBytes(10).toString("hex")}`,
    secretAccessKey: randomBytes(32).toString("hex"),
  };
  state.containers.push(name);
  save(); // Record ownership before resource creation so interrupted setup is cleanable.
}
assert.equal(state.documentStorage.name, name);
const storage = state.documentStorage;
let created = false;
try {
  if (exists()) {
    verifyOwner();
    if (docker(["inspect", "--format", "{{.State.Running}}", name]) !== "true")
      docker(["start", name]);
  } else {
    const envFile = join(directory, "document-storage.env");
    writeFileSync(
      envFile,
      `MINIO_ROOT_USER=${storage.accessKeyId}\nMINIO_ROOT_PASSWORD=${storage.secretAccessKey}\nGOMEMLIMIT=256MiB\nGOMAXPROCS=1\n`,
      { mode: 0o600 }
    );
    docker([
      "run",
      "-d",
      "--name",
      name,
      "--label",
      `everyfield.preview=${state.id}`,
      "--network",
      state.id,
      "--memory",
      "512m",
      "--memory-swap",
      "512m",
      "--cpus",
      "1",
      "--mount",
      "type=tmpfs,destination=/data,tmpfs-size=268435456",
      "-p",
      "127.0.0.1::9000",
      "--env-file",
      envFile,
      "cgr.dev/chainguard/minio:latest",
      "server",
      "/data",
      "--console-address",
      ":9001",
    ]);
    created = true;
  }
  verifyOwner();
  const port = docker(["port", name, "9000/tcp"]);
  assert.match(port, /^127\.0\.0\.1:\d+$/);
  const endpoint = `http://${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (
        (
          await fetch(`${endpoint}/minio/health/live`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Owned storage did not become ready");
  const credentials = {
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
  };
  const client = new S3Client({
    region: "us-east-1",
    endpoint,
    credentials,
    forcePathStyle: true,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404) throw error;
    await client.send(new CreateBucketCommand({ Bucket: storage.bucket }));
  }
  const env = {
    AWS_REGION: "us-east-1",
    AWS_ENDPOINT_URL_S3: endpoint,
    AWS_ACCESS_KEY_ID: storage.accessKeyId,
    AWS_SECRET_ACCESS_KEY: storage.secretAccessKey,
    AWS_BUCKET_NAME: storage.bucket,
  };
  Object.assign(state.env, env);
  Object.assign(config.env, env);
  storage.imageId = docker(["inspect", "--format", "{{.Image}}", name]);
  save();
  console.log(
    `Owned bounded document store ready: ${name}; ordinary preview-local down removes it.`
  );
} catch (error) {
  if ((created || !alreadyRecorded) && exists()) {
    verifyOwner();
    docker(["rm", "-f", name]);
  }
  if (!alreadyRecorded) {
    state.env = oldEnv;
    config.env = oldConfigEnv;
    state.containers = oldContainers;
    delete state.documentStorage;
    save();
  }
  throw error;
}
