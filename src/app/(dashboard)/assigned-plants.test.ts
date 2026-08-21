import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, mock, test } from "node:test";

import { notFound, redirect } from "next/navigation";

import type { AssignedPlant } from "@/lib/coaching/assignments";
import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

import { assignedPlantsSafely } from "./assigned-plants";

// ----------------------------------------------------------------------------
// THE SHELL DOES NOT WAIT ON THE COACHING QUERY (#569).
//
// Two halves, asserted two ways. The FAILURE half is behaviour and is executed
// here: a loader that blows up resolves to an empty list, so the sidebar draws
// what it draws for everybody else — no Assigned plants section — instead of the
// layout throwing and taking every dashboard route with it.
//
// The DELAY half cannot be executed by this process at all. Both subjects are
// components that need a session, a database and a renderer: `DashboardLayout`
// is an async Server Component behind `getCurrentSession`, and `AppSidebar` is a
// `"use client"` module that reads `usePathname`. So that half is asserted on
// the SOURCE, through the reader that throws when an anchor moves — the same
// choice `crawler.test.ts` makes about the same file, and for the same reason.
// What has to stay true is the SHAPE: the layout starts the read and does not
// await it, and the one place it IS awaited sits under a Suspense boundary.
// ----------------------------------------------------------------------------

const SRC = path.join(process.cwd(), "src");
const read = (...segments: string[]) =>
  readFileSync(path.join(SRC, ...segments), "utf8");

const LAYOUT = sourceReader(
  stripComments(read("app", "(dashboard)", "layout.tsx")),
  "(dashboard)/layout.tsx (comments stripped)"
);
const SIDEBAR = sourceReader(
  stripComments(read("components", "app-sidebar.tsx")),
  "app-sidebar.tsx (comments stripped)"
);

test("the layout starts the coaching read without awaiting it", () => {
  const body = LAYOUT.after("export default async function DashboardLayout");

  assert.match(
    body,
    /const assignedPlants = assignedPlantsSafely\(user\.id\)/,
    "the layout must hand the coaching read to the sidebar as a promise"
  );
  assert.doesNotMatch(
    body,
    /await\s+assignedPlants/,
    "an await here is the whole dashboard shell waiting on a coach_assignments join that returns nothing for nearly every account (#569)"
  );
  assert.doesNotMatch(
    body,
    /assignedPlantsFor\(/,
    "the layout must go through assignedPlantsSafely, so a failing join degrades to no section rather than to a broken shell"
  );
});

test("the shell awaits the request itself and nothing else", () => {
  // The general form of the rule, and the reason this file is not a third
  // hand-written guard after #227 and #569. Both bugs were the same edit: a
  // per-request read added above the returned tree of a layout that runs on
  // EVERY dashboard route, in a file that argues against exactly that thirty
  // lines up. Prose in the file did not stop the second one.
  //
  // So the layout's awaits are an ALLOWLIST. The three below are what the
  // render cannot be decided without: who is asking, what they asked for, and
  // how they left the sidebar. Everything else a dashboard route needs is
  // either a page's job or a slot's — read below a `<Suspense>` boundary,
  // through a loader that reports failure as a value.
  const body = LAYOUT.after("export default async function DashboardLayout");
  const awaited = [...body.matchAll(/await\s+([\w$.]+)\(/g)].map((m) => m[1]);

  assert.deepEqual(
    awaited,
    ["getCurrentSession", "headers", "cookies"],
    "a new await in the dashboard layout delays EVERY dashboard route and fails all of them if it throws — read it in a Suspense slot instead (`./notification-badge`, `./assigned-plants`), or change this list deliberately"
  );
});

test("the one place the promise is unwrapped sits under a Suspense boundary", () => {
  const group = SIDEBAR.span(
    "function AssignedPlantsGroup",
    "export function AppSidebar"
  );

  assert.match(
    group,
    /React\.use\(plants\)/,
    "AssignedPlantsGroup is the component that waits, which is what keeps the wait off the rest of the sidebar"
  );

  const sidebar = SIDEBAR.after("export function AppSidebar");

  assertInOrder(
    sidebar,
    "app-sidebar.tsx",
    ["<React.Suspense", "<AssignedPlantsGroup", "</React.Suspense>"],
    "the coaching read suspends whatever boundary is nearest — outside this one, that is the shell"
  );
  assert.doesNotMatch(
    sidebar,
    /React\.use\(/,
    "AppSidebar itself must not unwrap the promise: a use() up here suspends the whole sidebar, boundary or not"
  );
});

// ----------------------------------------------------------------------------
// The failure path. The fault is injected at the loader, which is where a real
// one appears: `assignedPlantsFor` is a two-table join, and the layout runs it
// on every dashboard route.
// ----------------------------------------------------------------------------

// The degraded path logs on purpose. Silenced here so an expected log does not
// read as a test failure.
beforeEach(() => {
  mock.method(console, "error", () => {});
});

class AssignmentsUnavailable extends Error {
  constructor() {
    super('relation "coach_assignments" does not exist');
    this.name = "AssignmentsUnavailable";
  }
}

test("a rejecting assignments query degrades to no section, not to a broken shell", async () => {
  const plants = await assignedPlantsSafely("user-1", async () => {
    throw new AssignmentsUnavailable();
  });

  // Empty is what the sidebar reads as "draw nothing" — the same branch a
  // planter who coaches nobody takes, which is nearly everybody.
  assert.deepEqual(plants, []);
});

test("a loader that throws synchronously degrades the same way", async () => {
  const plants = await assignedPlantsSafely("user-1", () => {
    throw new AssignmentsUnavailable();
  });

  assert.deepEqual(plants, []);
});

test("the happy path is unchanged — the assignments pass straight through", async () => {
  const assigned: AssignedPlant[] = [
    { churchId: "church-a", churchName: "Grace City" },
    { churchId: "church-b", churchName: "Hope Chapel" },
  ];
  const seen: string[] = [];

  const plants = await assignedPlantsSafely("user-1", async (coachUserId) => {
    seen.push(coachUserId);
    return assigned;
  });

  assert.deepEqual(plants, assigned);
  // The id reaches the loader untouched, so the nav lists the assignments of
  // the account that asked and of no other.
  assert.deepEqual(seen, ["user-1"]);
});

// ----------------------------------------------------------------------------
// What must still escape: a Next.js control-flow error is thrown, but it is an
// instruction to the framework, not a failure. Swallowing one would turn a
// working redirect into a silently empty sidebar.
// ----------------------------------------------------------------------------

test("a redirect() thrown under the assignments read is rethrown, not swallowed", async () => {
  await assert.rejects(
    assignedPlantsSafely("user-1", async () => {
      redirect("/login");
    }),
    (error: unknown) => error instanceof Error
  );
});

test("a notFound() thrown under the assignments read is rethrown, not swallowed", async () => {
  await assert.rejects(
    assignedPlantsSafely("user-1", async () => {
      notFound();
    }),
    (error: unknown) => error instanceof Error
  );
});

test("a control-flow error wrapped as a cause is still rethrown", async () => {
  await assert.rejects(
    assignedPlantsSafely("user-1", async () => {
      try {
        redirect("/login");
      } catch (cause) {
        throw new Error("assignments read failed", { cause });
      }
    }),
    (error: unknown) => error instanceof Error
  );
});
