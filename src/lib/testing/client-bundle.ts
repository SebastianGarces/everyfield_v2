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
// ============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const SRC = path.join(process.cwd(), "src");

const CODE_CACHE = new Map<string, string>();

/** A module with its comments removed — guard prose often names `@/db`. */
export function codeOf(file: string): string {
  const cached = CODE_CACHE.get(file);
  if (cached !== undefined) return cached;

  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  CODE_CACHE.set(file, code);
  return code;
}

/**
 * Specifiers whose module is actually EMITTED: value imports, side-effect
 * imports, re-exports and `import()`. `import type` is skipped because
 * TypeScript erases it — a browser-safe module may keep type-only imports
 * from server modules.
 */
export function valueSpecifiers(code: string): string[] {
  const statement =
    /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/gm;
  const sideEffect = /^\s*import\s*["']([^"']+)["']/gm;
  const dynamic = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  return [statement, sideEffect, dynamic].flatMap((pattern) =>
    [...code.matchAll(pattern)].map(([, specifier]) => specifier)
  );
}

/** The file a specifier names, or `null` for a bare package. */
export function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (base === null) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * A module's directive prologue — the run of string literals at the top.
 * Anchored there so `"use server"` inside an array or a regex further down
 * cannot be mistaken for a directive, and written without requiring the
 * semicolon: `"use server"` without one is the same directive (#265 r2).
 */
const PROLOGUE = /^(?:\s*(?:"[^"\n]*"|'[^'\n]*')\s*;?)*/;

export function declaresDirective(code: string, directive: string): boolean {
  const prologue = PROLOGUE.exec(code)?.[0] ?? "";
  return new RegExp(`["']${directive}["']`).test(prologue);
}

export const rel = (full: string): string => path.relative(process.cwd(), full);

/**
 * Every module the browser would load for `entry`, with the parent that pulled
 * each one in so a failure can print the chain rather than just the verdict.
 *
 * A `"use server"` module is a BOUNDARY, not an import: the client receives a
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

    if (full !== entry && declaresDirective(codeOf(full), "use server")) {
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

/** Every `.ts`/`.tsx` source file under `dir` whose prologue is `"use client"`. */
export function clientEntries(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return clientEntries(full);
    if (!full.endsWith(".ts") && !full.endsWith(".tsx")) return [];
    if (full.endsWith(".test.ts") || full.endsWith(".test.tsx")) return [];
    return declaresDirective(codeOf(full), "use client") ? [full] : [];
  });
}
