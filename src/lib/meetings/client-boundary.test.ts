import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  SRC,
  TS_FILES,
  codeOf,
  declaresDirective,
  isUseClientModule,
  rel,
  resolveModule,
  valueSpecifiers,
} from "@/lib/auth/server-action-surface";

// ----------------------------------------------------------------------------
// THE CLIENT-BUNDLE BOUNDARY AROUND src/lib/meetings/service.ts
//
// `service.ts` opens with `@/db`, ten schema tables and drizzle, so ONE
// `"use client"` module that reaches it ships the database client to the
// browser, silently. `copy.ts` and `agenda.ts` exist so a client component
// never has to; `ruled-copy.test.ts` pins the near half of that split (both
// siblings import nothing). This file pins the far half.
//
// `import "server-only"` is the repo's usual rail (`src/lib/auth/admin.ts:1`)
// and CANNOT be used here — see the accepted residual in
// memory/invariants.md. The package is a Next.js build-time alias: under
// `pnpm test` (tsx, no `react-server` export condition) `import "server-only"`
// is an unresolvable module, and forcing the condition on the runner breaks the
// suites that render email with `react-dom/server`.
//
// So the guard is this walk instead. It is NOT the compiler and does not claim
// to be: the compiler rejects the edge at build time, this rejects it at the
// same CI step that runs the tests. What it does check is the whole property
// rather than one hop of it — no client component reaches `service.ts`,
// directly or through any non-server-action module — over every client entry in
// the repo rather than over the one that exists today.
//
// The module-graph helpers are IMPORTED, not restated. They live in
// `src/lib/auth/server-action-surface.ts` beside the rule they were written
// for, and `src/lib/invitations/service.test.ts` runs the same walk over its
// own domain (§1d, "no client component can pull the logic layer into the
// browser"). A second copy here would be a second thing to keep correct, and
// the copy that existed for one round was direct-import-only: it missed every
// two-hop path, side-effect and dynamic imports, re-exports, and any specifier
// that resolved through `index.ts`.
// ----------------------------------------------------------------------------

/**
 * The two reads a bundle walk needs, so the SAME walk runs over the real source
 * tree and over an in-memory fixture. A guard that cannot be shown failing is a
 * guard nobody has checked — three source-text assertions over another route's
 * actions file passed while the property they described was false
 * (memory/invariants.md, the /register readers).
 */
type ModuleGraph = {
  /** A module's code, comments stripped. */
  codeOf: (file: string) => string;
  /** The file a specifier names, or `null` when it leaves the source tree. */
  resolve: (from: string, specifier: string) => string | null;
};

/**
 * Every module reachable from `entries` along VALUE edges, with the chain that
 * got there.
 *
 * Two things make it a bundle walk rather than an import walk:
 *
 * - A `"use server"` module is a BOUNDARY, not an edge. The client receives a
 *   reference and the body stays on the server, so client → `actions.ts` →
 *   `service.ts` is not a bundle path. Traversing it would fail this test the
 *   moment any meetings UI calls a server action.
 * - Type-only imports are already dropped by `valueSpecifiers`: they are erased
 *   at compile time and add no edge. Side-effect imports, dynamic `import()`
 *   and value re-exports are all kept, because every one of them emits.
 */
function bundleReach(
  entries: string[],
  graph: ModuleGraph
): { seen: Set<string>; pathTo: (file: string) => string[] } {
  const seen = new Set<string>();
  const parents = new Map<string, string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const full = queue.pop()!;
    if (seen.has(full)) continue;
    seen.add(full);

    const code = graph.codeOf(full);
    if (declaresDirective(code, "use server")) continue;

    for (const specifier of valueSpecifiers(code)) {
      const resolved = graph.resolve(full, specifier);
      if (resolved === null || seen.has(resolved)) continue;
      if (!parents.has(resolved)) parents.set(resolved, full);
      queue.push(resolved);
    }
  }

  // `parents` is a forest: a node is given a parent only before it is seen, and
  // a seen node is never re-parented, so walking up always terminates.
  const pathTo = (file: string): string[] => {
    const hops = [file];
    for (let at = parents.get(file); at; at = parents.get(at)) hops.push(at);
    return hops.reverse();
  };

  return { seen, pathTo };
}

const SERVICE = path.join(SRC, "lib/meetings/service.ts");

/**
 * Every db-touching module in the domain, not just the biggest one.
 *
 * The rule is about `@/db` reaching the browser, so it binds each module that
 * opens with it. `response-queries.ts` (VM-014) was carved out of `service.ts`
 * and is the same graph behind a different specifier; naming only `service.ts`
 * would let the split quietly move the edge out from under the guard.
 */
const DB_MODULES = [
  SERVICE,
  path.join(SRC, "lib/meetings/response-queries.ts"),
];

test("no client component reaches a meetings data-access module", () => {
  for (const file of DB_MODULES) {
    assert.ok(
      TS_FILES.includes(file),
      `${rel(file)} does not exist — this guard is watching a file that moved`
    );
  }

  // Same semicolon-agnostic prologue rule as the server side: a `"use client"`
  // written without one is still a client entry, and missing it would take the
  // whole subtree it imports out of the walk.
  const entries = TS_FILES.filter(isUseClientModule);

  // A walk that found nothing passes for free. `src` has well over a hundred
  // client components; a floor of fifty says the directory moved, not that the
  // repo stopped having any.
  assert.ok(
    entries.length > 50,
    `the walk found only ${entries.length} client modules — it is looking in the wrong place`
  );

  const { seen, pathTo } = bundleReach(entries, {
    codeOf,
    resolve: resolveModule,
  });

  for (const file of DB_MODULES) {
    if (seen.has(file)) {
      assert.fail(
        `a "use client" module reaches ${rel(
          file
        )}, which opens with @/db and drizzle — take the symbol from copy.ts, agenda.ts or response-card.ts, or pass it down as a prop:\n  ${pathTo(
          file
        )
          .map(rel)
          .join(" → ")}`
      );
    }
  }
});

// ----------------------------------------------------------------------------
// The walk, shown failing on the shapes it forbids.
//
// Module ids here ARE their specifiers, so the fixture reads as the import
// graph it describes.
// ----------------------------------------------------------------------------

const FIXTURE_SERVICE = "@/lib/meetings/service";

function walkFixture(modules: Record<string, string>): {
  reaches: boolean;
  chain: string;
} {
  const entries = Object.keys(modules).filter((id) =>
    declaresDirective(modules[id]!, "use client")
  );

  const { seen, pathTo } = bundleReach(entries, {
    codeOf: (id) => modules[id] ?? "",
    resolve: (_from, specifier) =>
      Object.hasOwn(modules, specifier) ? specifier : null,
  });

  return {
    reaches: seen.has(FIXTURE_SERVICE),
    chain: pathTo(FIXTURE_SERVICE).join(" → "),
  };
}

const DB_GRAPH = 'import { db } from "@/db";\n';

test("the walk catches a client component that imports the service directly", () => {
  const direct = walkFixture({
    "@/components/meetings/pretend": `"use client";\nimport { getMeeting } from "${FIXTURE_SERVICE}";\n`,
    [FIXTURE_SERVICE]: DB_GRAPH,
  });

  assert.ok(direct.reaches, "a direct value import is caught");
  assert.equal(
    direct.chain,
    `@/components/meetings/pretend → ${FIXTURE_SERVICE}`
  );
});

test("the walk catches it through a plain helper — the hop a direct check misses", () => {
  // The reason this walk is transitive. A `"use client"` component importing a
  // no-directive helper that imports `service.ts` ships the whole db graph, and
  // a check that only reads the client file's own import list sees nothing.
  const twoHop = walkFixture({
    "@/components/meetings/pretend": `"use client";\nimport { label } from "@/lib/meetings/helper";\n`,
    "@/lib/meetings/helper": `export { getMeeting } from "${FIXTURE_SERVICE}";\n`,
    [FIXTURE_SERVICE]: DB_GRAPH,
  });

  assert.ok(twoHop.reaches, "a two-hop path is caught");
  assert.equal(
    twoHop.chain,
    `@/components/meetings/pretend → @/lib/meetings/helper → ${FIXTURE_SERVICE}`
  );
});

test("the walk catches the edge kinds that are not `import … from`", () => {
  const sideEffect = walkFixture({
    "@/components/meetings/pretend": `"use client";\nimport "${FIXTURE_SERVICE}";\n`,
    [FIXTURE_SERVICE]: DB_GRAPH,
  });
  assert.ok(
    sideEffect.reaches,
    "a bare side-effect import emits and is caught"
  );

  const dynamic = walkFixture({
    "@/components/meetings/pretend": `"use client";\nconst load = async () => await import("${FIXTURE_SERVICE}");\n`,
    [FIXTURE_SERVICE]: DB_GRAPH,
  });
  assert.ok(dynamic.reaches, "a dynamic import emits and is caught");
});

test("a type-only import is not an edge — it is erased", () => {
  const typeOnly = walkFixture({
    "@/components/meetings/pretend": `"use client";\nimport type { AgendaSection } from "${FIXTURE_SERVICE}";\n`,
    [FIXTURE_SERVICE]: DB_GRAPH,
  });

  assert.ok(!typeOnly.reaches, "a type-only import adds no bundle edge");
});

test("a server action is a boundary, not an edge", () => {
  // Without this skip the guard would go red the moment any meetings UI calls a
  // server action — a false positive, and the kind that gets a guard deleted.
  const throughAction = walkFixture({
    "@/components/meetings/pretend": `"use client";\nimport { saveMeeting } from "@/app/meetings/actions";\n`,
    "@/app/meetings/actions": `"use server";\nimport { getMeeting } from "${FIXTURE_SERVICE}";\n`,
    [FIXTURE_SERVICE]: DB_GRAPH,
  });

  assert.ok(
    !throughAction.reaches,
    "the body stays on the server; the client gets a reference"
  );
});
