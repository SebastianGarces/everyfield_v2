// ============================================================================
// THE CLIENT-BUNDLE WALK, shared by the bundle guards.
//
// A `"use client"` module and everything it value-imports is emitted to the
// browser. A test renderer cannot see a server module leaking across that
// boundary — it runs in node, where the import succeeds — so the guards walk
// the import graph in source instead. Extracted from
// `template-picker.bundle.test.ts` when the same outage class recurred on
// /phase (#602); the rationale for walking rather than `import "server-only"`
// is documented there.
//
// The parsing primitives — file enumeration, comment stripping, specifier
// extraction, module resolution, directive detection — are the auth surface
// reader's, imported rather than copied: `server-action-surface.ts` exists so
// a second caller imports the walker, and it is the ONE module allowed to
// name the server directive in ordinary string literals (the seat-guard
// sweep's single exemption). Only the client-side closure lives here.
//
// Nothing here is imported by application code — it reads the filesystem and
// is for tests and scripts only.
// ============================================================================

import {
  TS_FILES,
  codeOf,
  isUseClientModule,
  isUseServerModule,
  rel,
  resolveModule,
  valueSpecifiers,
} from "@/lib/auth/server-action-surface";

/**
 * Every module the browser would load for `entry`, with the parent that pulled
 * each one in so a failure can print the chain rather than just the verdict.
 *
 * A server-actions module is a BOUNDARY, not an import: the client receives a
 * reference and the body stays on the server. So client → actions module →
 * `@/db` is not a bundle path, and traversing it would make a guard fail on
 * correct code.
 */
export function clientClosure(entry: string): {
  seen: Set<string>;
  parents: Map<string, string>;
} {
  const seen = new Set<string>();
  const parents = new Map<string, string>();
  const queue = [entry];

  while (queue.length > 0) {
    const full = queue.pop()!;
    if (seen.has(full)) continue;
    seen.add(full);

    if (full !== entry && isUseServerModule(full)) {
      continue;
    }

    for (const specifier of valueSpecifiers(codeOf(full))) {
      const resolved = resolveModule(full, specifier);
      if (resolved === null || seen.has(resolved)) continue;
      parents.set(resolved, full);
      queue.push(resolved);
    }
  }

  return { seen, parents };
}

/** entry → … → target, so a failure names the edge to delete. */
export function chainTo(target: string, parents: Map<string, string>): string {
  const steps = [target];
  let at = parents.get(target);
  while (at !== undefined && !steps.includes(at)) {
    steps.push(at);
    at = parents.get(at);
  }
  return steps.reverse().map(rel).join("\n  → ");
}

/** Every non-test source module whose prologue declares the client directive. */
export function clientEntries(): string[] {
  return TS_FILES.filter(
    (full) =>
      !full.endsWith(".test.ts") &&
      !full.endsWith(".test.tsx") &&
      isUseClientModule(full)
  );
}
