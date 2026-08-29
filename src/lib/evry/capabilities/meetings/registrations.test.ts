import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import ts from "typescript";

import inventory from "@/lib/evry/capabilities/inventory.generated.json";
import generated from "@/lib/evry/capabilities/meetings/inventory.generated.json";
import { generateMeetingsCapabilityInventory } from "../../../../../ops/evry/meetings-inventory";

import {
  MEETINGS_ACTION_CONTRACTS,
  MEETINGS_CAPABILITY_SURFACES,
  MEETINGS_EXCLUDED_OPERATIONS,
} from "./catalog";
import {
  MEETINGS_EFFECT_OPERATION_IDENTITIES,
  MEETINGS_OPERATION_REGISTRATIONS,
  MEETINGS_READ_OPERATION_IDENTITIES,
} from "./registrations";

test("generated Meetings inventory is current and has no unclassified surface", () => {
  const actual = generateMeetingsCapabilityInventory();
  assert.deepEqual(actual, generated);
  assert.deepEqual(actual.summary, {
    actions: 25,
    routes: 10,
    readOperations: 30,
    exclusions: 2,
    readCapabilities: 4,
    effectCapabilities: 25,
    unclassified: 0,
  });
});

const PAGE_SOURCES = [
  "src/app/(dashboard)/meetings/page.tsx",
  "src/app/(dashboard)/meetings/new/page.tsx",
  "src/app/(dashboard)/meetings/[id]/layout.tsx",
  "src/app/(dashboard)/meetings/[id]/page.tsx",
  "src/app/(dashboard)/meetings/[id]/attendance/page.tsx",
  "src/app/(dashboard)/meetings/[id]/analytics/page.tsx",
  "src/app/(dashboard)/meetings/[id]/evaluation/page.tsx",
  "src/app/(dashboard)/meetings/[id]/invitations/page.tsx",
  "src/app/(dashboard)/meetings/[id]/logistics/page.tsx",
  "src/app/(dashboard)/meetings/[id]/outcomes/page.tsx",
  "src/app/(dashboard)/teams/[teamId]/meetings/page.tsx",
] as const;

const AUTHORITATIVE_READ_EXPORTS = new Map<string, ReadonlySet<string>>([
  [
    "@/lib/meetings/service",
    new Set([
      "getAttendanceSummary",
      "getChecklist",
      "getChecklistSummary",
      "getEvaluation",
      "getEvaluationTrend",
      "getFollowUpCompletion",
      "getMeeting",
      "hasMeetingHistory",
      "listAttendees",
      "listMeetings",
    ]),
  ],
  ["@/lib/meetings/locations", new Set(["listLocations"])],
  ["@/lib/meetings/guest-list", new Set(["getGuestList"])],
  [
    "@/lib/meetings/response-queries",
    new Set(["getMeetingResponseBreakdown", "listMeetingResponses"]),
  ],
  [
    "@/lib/meetings/analytics",
    new Set(["getAttendanceTrend", "getMeetingSummaryStats"]),
  ],
  ["@/lib/communication/service", new Set(["getMeetingCommunications"])],
  ["@/lib/documents/contextual", new Set(["getMeetingContextualTemplates"])],
]);

function discoveredReadOperations(): readonly string[] {
  const discovered: string[] = [];
  for (const source of PAGE_SOURCES) {
    const text = readFileSync(source, "utf8");
    const ast = ts.createSourceFile(
      source,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    for (const statement of ast.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.importClause?.namedBindings ||
        !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        continue;
      }
      const allowed = AUTHORITATIVE_READ_EXPORTS.get(
        statement.moduleSpecifier.text
      );
      if (!allowed) continue;
      for (const element of statement.importClause.namedBindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (allowed.has(imported)) {
          discovered.push(`read-operation:${source} → ${imported}`);
        }
      }
    }
    if (
      source === "src/app/(dashboard)/meetings/[id]/page.tsx" &&
      /\.from\(churches\)/.test(text)
    ) {
      discovered.push(`read-operation:${source} → churches`);
    }
  }
  return discovered.toSorted();
}

test("Meetings registrations bijectively cover generated actions and routes", () => {
  assert.equal(MEETINGS_CAPABILITY_SURFACES.length, 35);
  assert.equal(MEETINGS_EFFECT_OPERATION_IDENTITIES.length, 25);
  assert.equal(MEETINGS_READ_OPERATION_IDENTITIES.length, 4);
  assert.equal(Object.keys(MEETINGS_ACTION_CONTRACTS).length, 25);

  const registeredSurfaces = MEETINGS_OPERATION_REGISTRATIONS.flatMap(
    ({ surfaceIdentities }) => surfaceIdentities
  );
  assert.equal(
    new Set(registeredSurfaces).size,
    registeredSurfaces.length,
    "one authoritative surface must belong to one semantic operation"
  );

  const generatedActions = inventory.entries
    .filter(
      (entry) =>
        entry.kind === "action" &&
        entry.source === "src/app/(dashboard)/meetings/actions.ts"
    )
    .map(({ identity }) => identity)
    .toSorted();
  assert.deepEqual(
    registeredSurfaces
      .filter((identity) => identity.startsWith("action:"))
      .toSorted(),
    generatedActions
  );

  const generatedRoutes = inventory.entries
    .filter(
      (entry) => entry.kind === "route" && entry.parityCapability === "meetings"
    )
    .map(({ identity }) => identity)
    .toSorted();
  assert.deepEqual(
    registeredSurfaces
      .filter((identity) => identity.startsWith("route:"))
      .toSorted(),
    generatedRoutes
  );
});

test("every nested Meetings page data read belongs to exactly one read operation", () => {
  const registered = MEETINGS_OPERATION_REGISTRATIONS.filter(
    ({ operationKind }) => operationKind === "read"
  )
    .flatMap(({ surfaceIdentities }) => surfaceIdentities)
    .filter((identity) => identity.startsWith("read-operation:"))
    .toSorted();

  assert.deepEqual(registered, discoveredReadOperations());
});

test("operation kind is independent from application permission", () => {
  for (const registration of MEETINGS_OPERATION_REGISTRATIONS) {
    assert.equal(registration.parityCapability, "meetings");
    if (registration.operationKind === "read") {
      assert.equal(registration.actionLabel, null);
      assert.equal(
        registration.applicationCapability,
        registration.identity === "meetings.read.schedule"
          ? "meetings.write"
          : "read"
      );
      continue;
    }
    assert.equal(registration.applicationCapability, "meetings.write");
    assert.ok(registration.actionLabel);
    assert.ok(registration.argumentKeys.length > 0);
  }
});

test("non-surface service operations remain explicit exclusions", () => {
  assert.deepEqual(
    MEETINGS_EXCLUDED_OPERATIONS.map(({ identity }) => identity),
    [
      "read-import:src/lib/meetings/locations.ts → getLocation",
      "effect-import:src/lib/meetings/locations.ts → deactivateLocation",
    ]
  );
});
