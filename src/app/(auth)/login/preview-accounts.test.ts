import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { stripComments } from "@/lib/testing/source-span";

import {
  EVAL_PLANTER_KEYS,
  isPreviewAccountPickerEnabled,
  listPreviewAccounts,
} from "./preview-accounts";

// ============================================================================
// THE PREVIEW ACCOUNT PICKER IS AUTOFILL, AND THESE ARE THE THREE THINGS THAT
// KEEP IT THAT WAY (#146).
//
//   1. THE GATE. `VERCEL_ENV === "preview"` and nothing else. Production, local
//      development and a bare node process all get an empty roster, so the
//      addresses have no way onto a page that is not a preview.
//   2. THE PASSWORDS ARE THE SEEDS'. The picker fills `password123` for a
//      `seed-dev-db.ts` account and `eval-password-123` for a
//      `seed-phase-engine-eval.ts` one. Copied constants drift; these are
//      checked against the scripts that hashed them, so a re-key goes red here
//      instead of filling a password that no longer opens anything.
//   3. THE ROSTER NEVER ENTERS A CLIENT BUNDLE. It reaches the browser as a
//      prop of a preview render. Every `"use client"` module therefore imports
//      the module with `import type`, which TypeScript erases, or not at all —
//      that is what makes a grep of `.next/static` for a seeded address come up
//      empty on a production build.
//
// And one guard this feature must not have touched: the dev account switcher's
// `NODE_ENV === "development" && !process.env.VERCEL`, asserted below as a
// literal so a widening edit cannot pass as a refactor.
// ============================================================================

const SRC = path.join(process.cwd(), "src");
const LOGIN_DIR = path.join(SRC, "app/(auth)/login");
const SEED_DEV = path.join(process.cwd(), "scripts/seed-dev-db.ts");
const SEED_EVAL = path.join(process.cwd(), "scripts/seed-phase-engine-eval.ts");

/** Run `body` with `VERCEL_ENV` set to `value`, then put the env back. */
function withVercelEnv(value: string | undefined, body: () => void): void {
  const before = process.env.VERCEL_ENV;
  if (value === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = value;
  try {
    body();
  } finally {
    if (before === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = before;
  }
}

const previewRoster = () => {
  let roster: ReturnType<typeof listPreviewAccounts> = [];
  withVercelEnv("preview", () => {
    roster = listPreviewAccounts();
  });
  return roster;
};

// ---------------------------------------------------------------- 1. the gate

test("the roster exists on a preview and nowhere else", () => {
  withVercelEnv("preview", () => {
    assert.ok(isPreviewAccountPickerEnabled());
    assert.ok(listPreviewAccounts().length > 0, "preview roster is empty");
  });

  for (const env of ["production", "development", undefined]) {
    withVercelEnv(env, () => {
      assert.equal(
        isPreviewAccountPickerEnabled(),
        false,
        `the picker opened on VERCEL_ENV=${String(env)}`
      );
      assert.deepEqual(
        listPreviewAccounts(),
        [],
        `an address leaked on VERCEL_ENV=${String(env)}`
      );
    });
  }
});

// ------------------------------------------------- 2. the passwords are real

test("both password sets match the seed script that hashed them", () => {
  const devSource = readFileSync(SEED_DEV, "utf8");
  const evalSource = readFileSync(SEED_EVAL, "utf8");

  // Explicitly annotated: `assert.ok` is an assertion function, and TypeScript
  // refuses to narrow through one unless the name it narrows was declared with
  // a type.
  const devPassword: string | undefined = /const DEV_PASSWORD = "([^"]+)"/.exec(
    devSource
  )?.[1];
  const evalPassword: string | undefined =
    /const EVAL_PASSWORD = "([^"]+)"/.exec(evalSource)?.[1];

  assert.ok(
    devPassword,
    "DEV_PASSWORD is no longer declared in seed-dev-db.ts"
  );
  assert.ok(
    evalPassword,
    "EVAL_PASSWORD is no longer declared in seed-phase-engine-eval.ts"
  );
  // The issue's own example, so a reader of the diff can see which is which.
  assert.equal(devPassword, "password123");
  assert.equal(evalPassword, "eval-password-123");

  for (const account of previewRoster()) {
    if (account.password === null) continue;
    const expected: string = account.email.includes("@eval.phase-engine.")
      ? evalPassword
      : devPassword;
    assert.equal(
      account.password,
      expected,
      `${account.email} would be filled with the wrong seed's password`
    );
  }
});

test("every filled address is one a seed script creates", () => {
  const devSource = readFileSync(SEED_DEV, "utf8");
  const evalKeys = new Set(evalProfileKeys());

  for (const account of previewRoster()) {
    const [local, domain] = account.email.split("@");

    if (domain === "eval.phase-engine.everyfield.app") {
      if (local === "network-admin") {
        assert.ok(
          readFileSync(SEED_EVAL, "utf8").includes(
            "email: `network-admin@${EVAL_EMAIL_DOMAIN}`"
          ),
          "the eval network admin is no longer seeded under that address"
        );
        continue;
      }
      const key = local.replace(/^planter-/, "");
      assert.ok(
        evalKeys.has(key),
        `${account.email} names an eval profile that no longer exists`
      );
      continue;
    }

    assert.ok(
      devSource.includes(`email: \`${local}@\${DEV_EMAIL_DOMAIN}\``),
      `${account.email} is not seeded by seed-dev-db.ts`
    );
  }
});

test("the eval planter list is the eval profile list", () => {
  assert.deepEqual(
    [...EVAL_PLANTER_KEYS],
    evalProfileKeys(),
    "PROFILES in seed-phase-engine-eval.ts changed — update EVAL_PLANTER_KEYS"
  );
});

test("the two oversight admins carry no in-repo password", () => {
  // `memory/invariants.md`: no in-repo constant may open an account on a
  // database anyone else uses. `SEED_ADMIN_PASSWORD` lives in `.env.local`, so
  // these two rows fill the email only — and this is the assertion that stops a
  // well-meaning edit from "completing" the table.
  const withoutPassword = previewRoster()
    .filter((account) => account.password === null)
    .map((account) => account.email)
    .sort();

  assert.deepEqual(withoutPassword, [
    "admin@everyfield.app",
    "sending-church-admin@everyfield.app",
  ]);

  const source = stripComments(
    readFileSync(path.join(LOGIN_DIR, "preview-accounts.ts"), "utf8")
  );
  assert.doesNotMatch(
    source,
    /SEED_ADMIN_PASSWORD\s*[:=]\s*["'`]/,
    "an admin password was written into the repo"
  );
});

// ------------------------------------- 3. the roster stays off the client

test("no client module imports the roster as a value", () => {
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;

    const code = stripComments(readFileSync(file, "utf8"));
    if (!/^\s*(?:"use client"|'use client')/.test(code)) continue;

    // A VALUE import of the roster module — `import type` is erased by
    // TypeScript and is how the picker and the form take `PreviewAccount`.
    const value =
      /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["'][^"']*preview-accounts["']/m;
    const dynamic = /\bimport\(\s*["'][^"']*preview-accounts["']\s*\)/;

    if (value.test(code) || dynamic.test(code)) {
      offenders.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these client modules would ship the seeded addresses to the browser:\n  ${offenders.join("\n  ")}`
  );
});

test("the picker is a client entry with no action, form or session call", () => {
  const picker = stripComments(
    readFileSync(path.join(LOGIN_DIR, "preview-account-picker.tsx"), "utf8")
  );

  // The premise of the test above — if this stops being a client module the
  // walk is describing something else.
  assert.match(picker, /^\s*"use client"/);

  // The hard guard from #146: autofill, never a grant. No form, no action, no
  // cookie, no session.
  for (const banned of [
    /<form\b/,
    /\baction=/,
    /createSession|setSessionCookie|generateSessionToken/,
    /useActionState/,
  ]) {
    assert.doesNotMatch(
      picker,
      banned,
      `the picker grew ${banned} — it must fill fields and nothing else`
    );
  }
});

test("the login directory publishes no second server-action module", () => {
  // The picker adds no endpoint. `actions.ts` (the real login) and
  // `dev-actions.ts` (the local-only switcher) are the whole list, and a new
  // `"use server"` file here would be exactly the thing the issue rejects.
  const withDirective = readdirSync(LOGIN_DIR)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .filter((name) =>
      /^\s*(?:"use server"|'use server')/.test(
        readFileSync(path.join(LOGIN_DIR, name), "utf8")
      )
    )
    .sort();

  assert.deepEqual(withDirective, ["actions.ts", "dev-actions.ts"]);
});

// ------------------------------------------- the guard that must not have moved

test("the dev account switcher's gate is untouched", () => {
  const source = stripComments(
    readFileSync(path.join(LOGIN_DIR, "dev-accounts.ts"), "utf8")
  );
  assert.match(
    source,
    /return process\.env\.NODE_ENV === "development" && !process\.env\.VERCEL;/,
    "isDevLoginEnabled() changed — the passwordless switcher must stay local-only"
  );

  // And the two sites that call it, so the gate is still checked where it was.
  assert.match(
    stripComments(readFileSync(path.join(LOGIN_DIR, "dev-actions.ts"), "utf8")),
    /if \(!isDevLoginEnabled\(\)\)/
  );
  const page = stripComments(
    readFileSync(path.join(LOGIN_DIR, "page.tsx"), "utf8")
  );
  assert.match(page, /process\.env\.NODE_ENV !== "development"/);
  assert.match(page, /if \(!isDevLoginEnabled\(\)\) return null;/);
});

// ---------------------------------------------------------------- helpers

/** The `key` of every entry in `PROFILES`, in source order. */
function evalProfileKeys(): string[] {
  const source = readFileSync(SEED_EVAL, "utf8");
  const start = source.indexOf("const PROFILES: ChurchProfile[] = [");
  assert.ok(
    start >= 0,
    "PROFILES is no longer declared in seed-phase-engine-eval.ts"
  );
  const end = source.indexOf("\n];", start);
  assert.ok(end > start, "could not find the end of PROFILES");

  return [...source.slice(start, end).matchAll(/^\s+key: "([^"]+)",/gm)].map(
    ([, key]) => key
  );
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
