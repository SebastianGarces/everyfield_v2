import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ============================================================================
// VM-017 — the meetings invitation subtree is DELETED, and stays deleted.
//
// VM-017 (per-invite tracking, an inviter leaderboard) was dropped from the
// meetings FRD, but the code it had grown was left behind: two components, a
// query module and two `"use server"` actions, none of them reachable from any
// route. The 2026-07 docs audit flagged the whole thing as dead.
//
// Removal is only half the job. Every export of a `"use server"` module is a
// POSTable endpoint with no UI in front of it (memory/invariants.md →
// Authentication), so re-adding `createInvitationAction` "just to keep the
// query around" silently reopens a write path onto a table nothing reads. The
// same is true of the module it called: an exported `createInvitation` here is
// one import away from being an endpoint again.
//
// So this file is a guard, not a unit test. It pins the ABSENCE:
//
//   1. The four deleted files are absent.
//   2. `meetings/actions.ts` exports neither invitation action, and imports
//      nothing from the deleted modules.
//   3. Nothing anywhere under `src/` imports the deleted modules — the check
//      that catches a re-add arriving from some other workstream's branch.
//
// The `invitations` TABLE is deliberately untouched: dropping it is a
// migration for no user-visible benefit. Its rows keep their column semantics
// and its oversight namesake (`src/lib/invitations/**`, org invitations — a
// different feature that shares a noun) is unaffected. This file must never be
// widened to assert anything about either.
// ============================================================================

const SRC = path.join(process.cwd(), "src");

const DELETED_FILES = [
  "components/meetings/invitation-tracker.tsx",
  "components/meetings/invitation-leaderboard.tsx",
  "lib/meetings/invitations.ts",
  "lib/validations/vision-meetings.ts",
] as const;

// Module specifiers that resolve to a deleted file. Relative forms are listed
// because a re-add would most likely land beside its importer.
const DEAD_SPECIFIERS = [
  "@/lib/meetings/invitations",
  "@/lib/validations/vision-meetings",
  "@/components/meetings/invitation-tracker",
  "@/components/meetings/invitation-leaderboard",
  "./invitations",
  "./invitation-tracker",
  "./invitation-leaderboard",
  "./vision-meetings",
] as const;

function read(relative: string): string {
  return readFileSync(path.join(SRC, relative), "utf8");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// ============================================================================
// 1. The files are gone
// ============================================================================

test("VM-017: the dead invitation subtree files are absent", () => {
  for (const relative of DELETED_FILES) {
    assert.equal(
      existsSync(path.join(SRC, relative)),
      false,
      `${relative} was deleted by VM-017 and must not come back`
    );
  }
});

// ============================================================================
// 2. The actions module no longer exposes the endpoints
// ============================================================================

test("VM-017: meetings/actions.ts exports neither invitation action", () => {
  const actions = read("app/(dashboard)/meetings/actions.ts");

  assert.match(
    actions,
    /^"use server";/,
    "guard assumes actions.ts is a server-action module; if that changed, the reasoning above needs revisiting"
  );

  for (const symbol of [
    "createInvitationAction",
    "updateInvitationStatusAction",
  ]) {
    assert.equal(
      actions.includes(symbol),
      false,
      `${symbol} is a POSTable endpoint onto a table nothing reads — VM-017 removed it`
    );
  }
});

test("VM-017: meetings/actions.ts imports nothing from the deleted modules", () => {
  const actions = read("app/(dashboard)/meetings/actions.ts");

  assert.equal(actions.includes("@/lib/meetings/invitations"), false);
  assert.equal(actions.includes("@/lib/validations/vision-meetings"), false);

  // The two schemas the deleted actions parsed with still live in
  // `validations/meetings.ts` (shared file, not ours to prune) — but this
  // module must no longer pull them in.
  for (const schema of [
    "invitationCreateSchema",
    "invitationStatusUpdateSchema",
  ]) {
    assert.equal(
      actions.includes(schema),
      false,
      `${schema} is only ever used by the removed actions`
    );
  }
});

// ============================================================================
// 3. Nothing under src/ still imports the deleted modules
// ============================================================================

test("VM-017: no module under src/ imports a deleted invitation module", () => {
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    // This guard file names the specifiers on purpose.
    if (file.endsWith("invitation-subtree-removed.test.ts")) continue;

    const source = readFileSync(file, "utf8");
    for (const specifier of DEAD_SPECIFIERS) {
      const importRe = new RegExp(
        `from\\s+["']${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`
      );
      if (importRe.test(source)) {
        offenders.push(`${path.relative(SRC, file)} → ${specifier}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `dangling imports of modules VM-017 deleted:\n${offenders.join("\n")}`
  );
});
