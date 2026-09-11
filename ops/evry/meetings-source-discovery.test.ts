import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { generateMeetingsCapabilityInventory } from "./meetings-inventory";
import {
  discoverMeetingsActionIdentities,
  discoverMeetingsActionSources,
  discoverMeetingsPageReadOperations,
  discoverMeetingsPageSources,
  meetingsReadIdentity,
} from "./meetings-source-discovery";

const ROUTE_ROOTS = [
  "src/app/(dashboard)/meetings",
  "src/app/(dashboard)/teams/[teamId]/meetings",
] as const;

function temporaryMeetingsRepo(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "meetings-discovery-"));
  for (const routeRoot of ROUTE_ROOTS) {
    const target = path.join(repoRoot, routeRoot);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(process.cwd(), routeRoot), target, { recursive: true });
  }
  return repoRoot;
}

test("Meetings action discovery walks every nested server module", () => {
  assert.deepEqual(discoverMeetingsActionSources(), [
    "src/app/(dashboard)/meetings/actions.ts",
  ]);
  assert.equal(discoverMeetingsActionIdentities().length, 25);
});

test("the Meetings generator refuses a new unclassified action module", () => {
  const repoRoot = temporaryMeetingsRepo();
  const source = path.join(
    repoRoot,
    "src/app/(dashboard)/meetings/nested/new-actions.ts"
  );
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(
    source,
    '"use server";\nexport async function newlyAddedMeetingAction() {}\n'
  );
  try {
    assert.deepEqual(discoverMeetingsActionSources(repoRoot), [
      "src/app/(dashboard)/meetings/actions.ts",
      "src/app/(dashboard)/meetings/nested/new-actions.ts",
    ]);
    assert.throws(
      () => generateMeetingsCapabilityInventory(repoRoot),
      /unclassified=\[action:src\/app\/\(dashboard\)\/meetings\/nested\/new-actions\.ts → newlyAddedMeetingAction\]/
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("Meetings page discovery walks registered pages and route-local layouts", () => {
  const sources = discoverMeetingsPageSources();
  assert.ok(sources.includes("src/app/(dashboard)/meetings/[id]/layout.tsx"));
  assert.ok(
    sources.includes("src/app/(dashboard)/teams/[teamId]/meetings/page.tsx")
  );
  assert.equal(sources.length, 11);
});

test("the Meetings generator refuses an unclassified read in a new page source", () => {
  const repoRoot = temporaryMeetingsRepo();
  const source = path.join(
    repoRoot,
    "src/app/(dashboard)/meetings/@inventory-probe/page.tsx"
  );
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(
    source,
    'import { newlyAddedMeetingRead } from "@/lib/meetings/service";\nexport default async function Page() { await newlyAddedMeetingRead(); return null; }\n'
  );
  const identity = meetingsReadIdentity(
    "src/app/(dashboard)/meetings/@inventory-probe/page.tsx",
    "newlyAddedMeetingRead"
  );
  try {
    assert.ok(discoverMeetingsPageReadOperations(repoRoot).includes(identity));
    assert.throws(
      () => generateMeetingsCapabilityInventory(repoRoot),
      (error) =>
        error instanceof Error &&
        error.message.includes(`unclassified=[${identity}`)
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("the Meetings generator refuses a direct Drizzle table read added to a classified page", () => {
  const repoRoot = temporaryMeetingsRepo();
  const source = path.join(
    repoRoot,
    "src/app/(dashboard)/meetings/[id]/attendance/page.tsx"
  );
  const original = readFileSync(source, "utf8");
  writeFileSync(
    source,
    `import { db as inventoryProbeDb } from "@/db";\nimport { meetingAttendance as inventoryProbeAttendance } from "@/db/schema";\n${original}\nasync function inventoryProbe() { return inventoryProbeDb.select().from(inventoryProbeAttendance); }\nvoid inventoryProbe;\n`
  );
  const operation = meetingsReadIdentity(
    "src/app/(dashboard)/meetings/[id]/attendance/page.tsx",
    "meetingAttendance"
  );
  try {
    assert.ok(discoverMeetingsPageReadOperations(repoRoot).includes(operation));
    assert.throws(
      () => generateMeetingsCapabilityInventory(repoRoot),
      (error) => error instanceof Error && error.message.includes(operation)
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("read discovery sees namespace, default, deferred, and synchronous imported calls", () => {
  const repoRoot = temporaryMeetingsRepo();
  const source = path.join(
    repoRoot,
    "src/app/(dashboard)/meetings/@inventory-call-probes/page.tsx"
  );
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(
    source,
    `import defaultRead from "@/lib/meetings/default-read";\nimport * as reads from "@/lib/meetings/service";\nimport { synchronousMeetingRead } from "@/lib/meetings/synchronous-read";\nexport default async function Page() { const deferred = reads.getMeeting("plant", "meeting"); synchronousMeetingRead(); defaultRead(); await deferred; return null; }\n`
  );
  try {
    const operations = discoverMeetingsPageReadOperations(repoRoot);
    for (const imported of [
      "default",
      "getMeeting",
      "synchronousMeetingRead",
    ]) {
      assert.ok(
        operations.includes(
          meetingsReadIdentity(
            "src/app/(dashboard)/meetings/@inventory-call-probes/page.tsx",
            imported
          )
        ),
        imported
      );
    }
    assert.throws(() => generateMeetingsCapabilityInventory(repoRoot));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("the Meetings generator refuses a function-level server action in a page", () => {
  const repoRoot = temporaryMeetingsRepo();
  const source = path.join(
    repoRoot,
    "src/app/(dashboard)/meetings/@inventory-inline-action/page.tsx"
  );
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(
    source,
    `export default function Page() { async function newlyAddedInlineMeetingAction() { "use server"; } void newlyAddedInlineMeetingAction; return null; }\n`
  );
  const action =
    "action:src/app/(dashboard)/meetings/@inventory-inline-action/page.tsx → newlyAddedInlineMeetingAction";
  try {
    assert.ok(discoverMeetingsActionIdentities(repoRoot).includes(action));
    assert.throws(
      () => generateMeetingsCapabilityInventory(repoRoot),
      (error) =>
        error instanceof Error &&
        error.message.includes(`unclassified=[${action}]`)
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
