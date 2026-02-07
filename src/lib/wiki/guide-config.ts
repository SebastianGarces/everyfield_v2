// Wiki Guide Configuration
//
// Maps URL path patterns to wiki article slugs for contextual help.
// The WikiGuide component reads the current pathname and shows relevant
// articles in a floating panel.
//
// Pattern rules:
//   - Use a wildcard segment for dynamic path parts (e.g. "/people/[id]/assessments")
//   - Append query params to match on search params (e.g. "/people/[id]/assessments?tab=interviews")
//   - More specific patterns (with query params) take priority over less specific ones
//   - Patterns are matched and the first match wins after sorting by specificity

export type WikiGuideEntry = {
  /** Display label shown in the panel header */
  label: string;
  /** Wiki article slugs to render (first slug is default, others available via tabs) */
  slugs: string[];
};

/**
 * Route pattern → guide entry mapping.
 *
 * Add entries here to enable contextual wiki help on any page.
 * Slugs should match existing wiki article slugs in the database.
 */
export const wikiGuideConfig: Record<string, WikiGuideEntry> = {
  // ── People CRM: Dashboard ───────────────────────────────────────────
  "/people": {
    label: "Core Group Funnel",
    slugs: ["core-group/building-your-core-group/the-core-group-funnel"],
  },

  // ── People CRM: Assessments ──────────────────────────────────────────
  "/people/*/assessments?tab=assessments": {
    label: "Assessments Overview",
    slugs: ["frameworks/the-4-cs"],
  },
  "/people/*/assessments?tab=interviews": {
    label: "Interview Guide",
    slugs: [
      "frameworks/the-5-interview-criteria",
      "core-group/follow-up/interviewing-for-fit",
    ],
  },
  "/people/*/assessments?tab=commitments": {
    label: "Commitment Guide",
    slugs: [
      "core-group/commitment/why-formalized-commitment-matters",
      "core-group/commitment/the-three-key-documents",
      "core-group/commitment/core-group-commitments-explained",
    ],
  },
  "/people/*/assessments/new": {
    label: "4Cs Assessment Guide",
    slugs: ["frameworks/the-4-cs"],
  },
  "/people/*/assessments/interview": {
    label: "Interview Guide",
    slugs: [
      "frameworks/the-5-interview-criteria",
      "core-group/follow-up/interviewing-for-fit",
    ],
  },
  "/people/*/assessments/commitment": {
    label: "Commitment Guide",
    slugs: [
      "core-group/commitment/why-formalized-commitment-matters",
      "core-group/commitment/the-three-key-documents",
      "core-group/commitment/core-group-commitments-explained",
    ],
  },

  // ── Extend: add more routes below ────────────────────────────────────
  // "/vision-meetings/*": {
  //   label: "Vision Meetings Guide",
  //   slugs: ["journey/phase-1/vision-meetings"],
  // },
};

// ════════════════════════════════════════════════════════════════════════
// Pattern matching utilities
// ════════════════════════════════════════════════════════════════════════

/**
 * Parse a pattern into its path and query param parts.
 * e.g. "/people/x/assessments?tab=interviews" -> { path: "/people/x/assessments", params: { tab: "interviews" } }
 */
function parsePattern(pattern: string): {
  path: string;
  params: Record<string, string>;
} {
  const qIndex = pattern.indexOf("?");
  if (qIndex === -1) return { path: pattern, params: {} };

  const path = pattern.slice(0, qIndex);
  const params: Record<string, string> = {};
  const searchStr = pattern.slice(qIndex + 1);

  for (const pair of searchStr.split("&")) {
    const [key, value] = pair.split("=");
    if (key && value !== undefined) {
      params[key] = value;
    }
  }

  return { path, params };
}

/**
 * Match a pathname + search params against a pattern with wildcard support.
 *
 * Pattern rules:
 *   - Path: segments separated by "/", use a wildcard for dynamic parts
 *   - Query: key=value pairs after "?" must all be present in searchParams
 *   - Trailing slashes are normalized away
 *   - Matching is case-sensitive
 */
function matchPattern(
  pattern: string,
  pathname: string,
  searchParams: Record<string, string>
): boolean {
  const { path: patternPath, params: patternParams } = parsePattern(pattern);

  // Match path segments
  const patternParts = patternPath.replace(/\/+$/, "").split("/");
  const pathParts = pathname.replace(/\/+$/, "").split("/");

  if (patternParts.length !== pathParts.length) return false;

  const pathMatches = patternParts.every(
    (part, i) => part === "*" || part === pathParts[i]
  );

  if (!pathMatches) return false;

  // Match query params (all pattern params must be present with matching values)
  for (const [key, value] of Object.entries(patternParams)) {
    if (searchParams[key] !== value) return false;
  }

  return true;
}

/**
 * Count the specificity of a pattern.
 * Query params add extra specificity so "?tab=x" patterns win over bare paths.
 */
function patternSpecificity(pattern: string): number {
  const { path, params } = parsePattern(pattern);
  const pathScore = path.split("/").filter((p) => p !== "*").length;
  const paramScore = Object.keys(params).length;
  return pathScore + paramScore;
}

/**
 * Resolve the current pathname + search params to a WikiGuideEntry, if any.
 * Returns the most specific matching entry, or null if no match.
 */
export function resolveGuideEntry(
  pathname: string,
  searchParams: Record<string, string> = {}
): WikiGuideEntry | null {
  const entries = Object.entries(wikiGuideConfig);

  // Sort by specificity descending so more specific patterns win
  const sorted = entries.sort(
    ([a], [b]) => patternSpecificity(b) - patternSpecificity(a)
  );

  for (const [pattern, entry] of sorted) {
    if (matchPattern(pattern, pathname, searchParams)) {
      return entry;
    }
  }

  return null;
}
