import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const runner = resolve("scripts/preview-local.mjs");
test("provisioning refuses a pre-existing directory and preserves unrelated files", () => {
  const temp = mkdtempSync(join(tmpdir(), "preview-safety-"));
  const target = join(temp, "unrelated");
  mkdirSync(target);
  writeFileSync(join(target, "sentinel"), "keep this");
  try {
    const result = spawnSync(process.execPath, [runner, "up", target], {
      cwd: temp,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EEXIST/);
    const down = spawnSync(process.execPath, [runner, "down", target], {
      cwd: temp,
      encoding: "utf8",
    });
    assert.equal(down.status, 0);
    assert.equal(readFileSync(join(target, "sentinel"), "utf8"), "keep this");
  } finally {
    rmSync(temp, { recursive: true });
  }
});

test("cleanup refuses a moved or forged directory ownership record before touching resources", () => {
  const temp = mkdtempSync(join(tmpdir(), "preview-ownership-"));
  writeFileSync(
    join(temp, "ownership.json"),
    JSON.stringify({
      id: "ef-preview-0123456789ab",
      directory: "/not-this-directory",
      containers: [],
    })
  );
  try {
    const result = spawnSync(process.execPath, [runner, "down", temp], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /directory ownership differs/);
    assert.ok(readFileSync(join(temp, "ownership.json")));
  } finally {
    rmSync(temp, { recursive: true });
  }
});
