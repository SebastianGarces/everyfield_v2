import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// These tests generate and inspect SQL. They never connect or execute cleanup SQL.
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "discovery294-capture-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, "input.json");
  writeFileSync(
    input,
    JSON.stringify({
      run: "offline-capture-294",
      emailDomain: "example.invalid",
      passwordHash:
        "$argon2id$v=19$m=19456,t=2,p=1$" +
        Buffer.alloc(16).toString("base64").replaceAll("=", "") +
        "$" +
        Buffer.alloc(32).toString("base64").replaceAll("=", ""),
      seatTokens: { associated: "1".repeat(64), empty: "2".repeat(64) },
    }),
    { mode: 0o600 }
  );
  function generate(name, capture) {
    const output = join(directory, name);
    const args = [
      "scripts/proofs/discovery-preview-294-fixture.mjs",
      input,
      output,
    ];
    if (capture) {
      const path = join(directory, `${name}-capture.json`);
      writeFileSync(path, JSON.stringify(capture), { mode: 0o600 });
      args.push(path);
    }
    const result = spawnSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 10000,
    });
    return { result, output };
  }
  const first = generate("initial");
  assert.equal(first.result.status, 0, first.result.stderr);
  const manifest = JSON.parse(
    readFileSync(join(first.output, "manifest.json"), "utf8")
  );
  return {
    generate,
    manifest,
    initial: readFileSync(join(first.output, "cleanup.sql"), "utf8"),
  };
}
function roots(sql) {
  const matched = sql.match(
    /FROM jsonb_array_elements\('((?:''|[^'])*)'::jsonb\) x/
  );
  assert.ok(matched, "cleanup must use an explicit root list");
  return JSON.parse(matched[1].replaceAll("''", "'"));
}
function guard(sql, manifest) {
  const begin = sql.indexOf(
    "FOR r IN SELECT id,email,name FROM public.users WHERE email IN ("
  );
  const end = sql.indexOf("-- Every root is exact-ID", begin);
  assert.ok(begin > 0 && end > begin);
  const preflight = sql.slice(begin, end);
  for (const signup of manifest.signup)
    assert.ok(preflight.includes(`'${signup.email}'`));
  assert.match(preflight, /FOR UPDATE LOOP/);
  assert.match(preflight, /captured\.table_name='users'/);
  assert.match(preflight, /captured\.id=r\.id::text/);
  assert.match(preflight, /captured\.expected->>'id'=r\.id::text/);
  assert.match(preflight, /captured\.expected->>'email'=r\.email/);
  assert.match(
    preflight,
    /captured\.expected->>'name'\) IS NOT DISTINCT FROM r\.name/
  );
  assert.match(
    preflight,
    /IF NOT EXISTS[\s\S]*RAISE EXCEPTION 'Signup account missing or mismatched/
  );
  assert.ok(
    end < sql.indexOf("DELETE FROM public."),
    "guard precedes row deletion"
  );
  assert.doesNotMatch(preflight, /\bLIKE\b|\bILIKE\b|email\s*~/i);
  assert.match(sql, /Uncaptured or foreign root dependency/);
  assert.match(sql, /Foreign tenant dependency/);
  assert.match(sql, /DELETE FROM auth_attempts WHERE identifier IN \(/);
  assert.doesNotMatch(sql, /\bTRUNCATE\b|\bCASCADE\b/i);
}

test("missing signup captures generate a refusal preflight before deletion (SQL not executed)", (t) => {
  const f = fixture(t);
  guard(f.initial, f.manifest);
  const initialRoots = roots(f.initial);
  for (const signup of f.manifest.signup)
    assert.ok(!initialRoots.some((row) => row.email === signup.email));
});

test("complete signup and transfer captures generate matching owned roots (SQL not executed)", (t) => {
  const f = fixture(t);
  const capture = {
    run: f.manifest.run,
    signupUsers: f.manifest.signup.map((signup, index) => ({
      id: `11111111-1111-4111-8111-11111111111${index}`,
      name: signup.name,
      email: signup.email,
    })),
    createdPlants: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        plantedBy: f.manifest.accounts.transfer.id,
        name: f.manifest.transferPlantName,
      },
    ],
  };
  const generated = f.generate("complete", capture);
  assert.equal(generated.result.status, 0, generated.result.stderr);
  const sql = readFileSync(join(generated.output, "cleanup.sql"), "utf8");
  guard(sql, f.manifest);
  const capturedRoots = roots(sql);
  for (const signup of capture.signupUsers)
    assert.deepEqual(
      capturedRoots.find((row) => row.id === signup.id),
      { table: "users", ...signup }
    );
  assert.ok(
    capturedRoots.some(
      (row) =>
        row.table === "churches" && row.id === capture.createdPlants[0].id
    )
  );
  assert.ok(
    capturedRoots.every(
      (row) => !row.email || row.email.startsWith(`d294+${f.manifest.run}.`)
    )
  );
});

test("foreign or mismatched capture identities are rejected offline; generated predicates stay exact-email scoped", (t) => {
  const f = fixture(t);
  for (const candidate of [
    { name: "Foreign account", email: "foreign@example.invalid" },
    { name: "Wrong captured name", email: f.manifest.signup[0].email },
  ]) {
    const generated = f.generate(candidate.name.replaceAll(" ", "-"), {
      run: f.manifest.run,
      signupUsers: [
        { id: "33333333-3333-4333-8333-333333333333", ...candidate },
      ],
      createdPlants: [],
    });
    assert.notEqual(generated.result.status, 0);
    assert.match(generated.result.stderr, /Unknown signup capture/);
  }
  guard(f.initial, f.manifest);
  assert.ok(
    !roots(f.initial).some((row) => row.email === "foreign@example.invalid")
  );
});
