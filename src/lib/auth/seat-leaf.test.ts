import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  SRC,
  codeOf,
  rel,
  resolveModule,
  staticValueSpecifiers,
} from "./server-action-surface";

// ============================================================================
// THE NO-DATABASE SEAM UNDER `seat-rules.ts`.
//
// Asking "may this account do X" must not cost a database connection.
// `@/lib/auth/session` calls `neon(process.env.DATABASE_URL!)` at module scope,
// so any module that reaches it — however indirectly — throws on import when
// the variable is unset.
//
// #498 BROKE THIS AND NOTHING SAID SO. The sets, the table and `assertSeatFor`
// shipped in `./seats` beside `requireSeat`, which imports `verifySession`. So
// `src/lib/onboarding/declare-journey.ts` — whose own docblock promises its
// rules "can be driven by a test through `DeclareJourneyDeps` without a request
// or a database" — became unimportable without one. Every test still passed:
// the suite runs with `DATABASE_URL` set, so the seam is invisible to it.
//
// TWO ASSERTIONS, because the seam has two halves that fail differently:
//
//   1. THE LEAF HOLDS. `seat-rules.ts` reaches nothing that reaches `@/db`, and
//      the walk is transitive — the edge that broke it was two modules away.
//   2. `./seats` DOES NOT RE-EXPORT IT. A re-export would give one authority
//      policy two import paths, one of which drags the database, and the next
//      reader would take the shorter name. That is exactly the failure
//      `@/lib/invitations/register-path` shipped once — a leaf broken by an
//      `export … from`, not by an import — and the reason `@/lib/auth/access`
//      carries a comment refusing to re-serve `./tenancy`.
// ============================================================================

const SEAT_RULES = path.join(SRC, "lib", "auth", "seat-rules.ts");
const SEATS = path.join(SRC, "lib", "auth", "seats.ts");
const DB = path.join(SRC, "db", "index.ts");

/**
 * Every module `entry` reaches through STATIC value edges, transitively.
 *
 * `staticValueSpecifiers` and not `valueSpecifiers`: a deferred
 * `await import("@/db")` is what SATISFIES this rule elsewhere in the repo, so
 * counting the dynamic form would fail the very code written to obey it.
 */
function staticGraphOf(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of staticValueSpecifiers(codeOf(file))) {
      const target = resolveModule(file, specifier);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }

  return [...seen];
}

test("the seat rules reach nothing that opens a database connection", () => {
  const graph = staticGraphOf(SEAT_RULES);

  assert.ok(
    !graph.includes(DB),
    `src/lib/auth/seat-rules.ts reaches @/db, whose module scope calls neon(DATABASE_URL). Asking whether an account holds a capability must not cost a connection — the guard that MINTS is ./seats, and it is the one allowed to.\n  reached: ${graph.map(rel).join("\n  reached: ")}`
  );

  // …and it reaches the session module by no route either, which is the edge
  // that actually broke: `@/db` was two hops away through it.
  assert.ok(
    !graph.includes(path.join(SRC, "lib", "auth", "session.ts")),
    "seat-rules.ts reaches @/lib/auth/session — that is the import the split exists to remove"
  );

  // The one value edge it is allowed, so the seam is a claim about a real
  // graph rather than about an empty one.
  assert.ok(
    graph.includes(path.join(SRC, "lib", "auth", "tenancy.ts")),
    "seat-rules.ts no longer reads the tenancy predicates — the walk is looking at the wrong file"
  );
});

test("the guard module does not re-serve the leaf", () => {
  const code = codeOf(SEATS);

  assert.ok(
    !/export\s*\*\s*from\s*["']\.\/seat-rules["']/.test(code),
    "src/lib/auth/seats.ts re-exports the leaf, which gives the sets and predicates a second import path — through a module that imports the database"
  );
  assert.ok(
    !/export\s*\{[^}]*\}\s*from\s*["']\.\/seat-rules["']/.test(code),
    "same rule, named form: a re-export here is the shorter name the next reader will take"
  );

  // It still USES the leaf — the guard is `verifySession` plus `holdsSeatFor`,
  // so an import edge in this direction is the arrangement, not a violation.
  assert.match(code, /from ["']@\/lib\/auth\/seat-rules["']/);
});

test("the onboarding rules are importable with no DATABASE_URL", () => {
  // The property in prose, as a property about the graph. `declare-journey.ts`
  // promises a test can drive it "without a request or a database", and
  // `create-church.ts` says the same; the second one legitimately reaches `@/db`
  // for its own statements, so only the first is asserted here.
  const graph = staticGraphOf(
    path.join(SRC, "lib", "onboarding", "declare-journey.ts")
  );

  assert.ok(
    !graph.includes(DB),
    `src/lib/onboarding/declare-journey.ts reaches @/db, so importing it without DATABASE_URL throws and its docblock is false.\n  reached: ${graph.map(rel).join("\n  reached: ")}`
  );
});
