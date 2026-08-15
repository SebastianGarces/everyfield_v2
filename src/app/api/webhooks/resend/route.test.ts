import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ============================================================================
// THE WEBHOOK ROUTE'S MODULE GRAPH (#263 item 2, via #324 WS2).
//
// The finding from the #251 review was that this route pulled the whole
// dispatcher in for one string constant. The behaviour of the route is covered
// where the decisions live — `channels/delivery-events.test.ts` for what an
// event MEANS, `channels/suppression.test.ts` for what a suppression WRITES.
// What is left to prove here is the shape of the import graph, and it can only
// be proved statically: the offending edge was TRANSITIVE
// (route → channels/delivery-events → dispatch), so nobody reading this route's
// import list would have seen it, and no runtime assertion distinguishes "the
// dispatcher was imported" from "the dispatcher was imported and unused".
//
// WHY IT MATTERS beyond tidiness. `src/lib/notifications/dispatch.ts` opens with
// `@/db`, the schema barrel and the Resend client, and it is the ONE module in
// F11 that calls a provider. A route reached by an unauthenticated POST from the
// public internet should carry the smallest graph that does its job; every
// module in it is code that runs on a request that has not yet been
// authenticated, and every export of it is one refactor away from being reached.
// ============================================================================

const ROOT = process.cwd();
const ROUTE = "src/app/api/webhooks/resend/route.ts";
const DISPATCHER = "src/lib/notifications/dispatch.ts";
const LEAF = "src/lib/notifications/permanent-failure.ts";

/** Every module specifier a file imports or re-exports from. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  // `import … from "x"`, `export … from "x"`, bare `import "x"`, and the
  // `import("x")` form. Deliberately one regex over the source rather than a
  // parser: this repo has no AST dependency, and a specifier is a literal.
  const pattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) found.push(match[1]);
  return found;
}

/** Resolve a specifier to a repo-relative source file, or null if external. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join("src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.join(path.dirname(fromFile), specifier);
  } else {
    return null; // A package, or `next/server`.
  }

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (/\.tsx?$/.test(candidate) && existsSync(path.join(ROOT, candidate))) {
      return candidate.split(path.sep).join("/");
    }
  }
  return null;
}

/** Depth-first walk of the static import graph rooted at `entry`. */
function moduleGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const specifier of specifiersOf(source)) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }

  return seen;
}

test("the walker actually walks — the route's own imports are reachable", () => {
  // A graph walker that silently resolved nothing would pass every assertion
  // below while proving nothing at all. Pin two edges it must find: one direct,
  // one transitive.
  const graph = moduleGraph(ROUTE);

  assert.ok(
    graph.has("src/lib/notifications/channels/delivery-events.ts"),
    "the walker did not find the route's own direct import — specifier resolution is broken"
  );
  assert.ok(
    graph.has(LEAF),
    `the walker did not reach ${LEAF}, which delivery-events imports — transitive resolution is broken`
  );
});

test("the webhook route does not import the dispatcher, at any depth", () => {
  const graph = moduleGraph(ROUTE);

  assert.equal(
    graph.has(DISPATCHER),
    false,
    `${DISPATCHER} is back in the webhook route's graph. It was removed in #263 item 2: the route needed one constant, \`PERMANENT_FAILURE_PREFIX\`, which now lives in the import-free leaf ${LEAF}. Import the leaf, not the dispatcher.\n\nReachable from the route:\n${[...graph].sort().join("\n")}`
  );
});

test("the constant the route's graph needs still resolves, from the leaf", async () => {
  // "The import is gone" is only half the acceptance criterion; the other half
  // is that the webhook still reaches the value. Imported through the same
  // module the route's graph reaches it through.
  const { notificationDeliveryOutcome } =
    await import("@/lib/notifications/channels/delivery-events");
  const { PERMANENT_FAILURE_PREFIX } =
    await import("@/lib/notifications/permanent-failure");

  const outcome = notificationDeliveryOutcome({
    type: "email.bounced",
    bounceType: "Permanent",
  });

  assert.equal(outcome.kind, "failed");
  assert.ok(outcome.kind === "failed");
  assert.equal(outcome.permanent, true);
  assert.ok(
    outcome.error.startsWith(PERMANENT_FAILURE_PREFIX),
    "the permanence marker is no longer written onto a hard bounce — `channelEligibility` will retry it"
  );
});

test("the leaf stays a leaf", () => {
  // The whole point of the module is that it imports nothing. The moment it
  // takes a type from `@/db` (or anything else), the edge this change cut
  // reappears under a new name.
  const graph = moduleGraph(LEAF);

  assert.deepEqual(
    [...graph],
    [LEAF],
    `${LEAF} imports something. It exists to be import-free — a leaf with a dependency is just another node.`
  );
});

test("the dispatcher does not re-export the constant it moved out", () => {
  // A re-export would keep the trunk serving the leaf's contents, and callers
  // would keep reaching for the trunk — which is how the graph closed over in
  // the first place.
  const dispatcher = readFileSync(path.join(ROOT, DISPATCHER), "utf8");

  assert.doesNotMatch(
    dispatcher,
    /export\s*\{[^}]*PERMANENT_FAILURE_PREFIX/,
    "dispatch.ts re-exports PERMANENT_FAILURE_PREFIX — import `@/lib/notifications/permanent-failure` directly instead"
  );
});
