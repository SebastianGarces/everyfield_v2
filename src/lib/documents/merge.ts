// ============================================================================
// Document Templates — Merge data (F6)
// ============================================================================
//
// Resolves auto-fill defaults for a template's merge fields from the church
// profile and the current user, and merges them with planter-supplied values.
// ============================================================================

import type { DocumentMergeValues, DocumentTemplate } from "./types";

interface MergeContext {
  churchName: string;
  /** Current user's display name, used for pastor_name auto-fill. */
  userName: string | null;
  /** Church launch date as stored (YYYY-MM-DD) or null. */
  launchDate: string | null;
}

function formatLaunchDate(launchDate: string | null): string {
  if (!launchDate) return "";
  // Stored as a date-only string; format without timezone drift.
  const parsed = new Date(`${launchDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Resolve the auto-fill default for each merge field on a template.
 * Returns a map keyed by field key (only fields with an `autoFill` source).
 */
export function buildAutoFillDefaults(
  template: DocumentTemplate,
  context: MergeContext
): DocumentMergeValues {
  const sources: Record<"church_name" | "pastor_name" | "launch_date", string> =
    {
      church_name: context.churchName,
      pastor_name: context.userName ?? "",
      launch_date: formatLaunchDate(context.launchDate),
    };

  const defaults: DocumentMergeValues = {};
  for (const field of template.mergeFields) {
    if (field.autoFill) {
      defaults[field.key] = sources[field.autoFill] ?? "";
    }
  }
  return defaults;
}

/**
 * Merge planter-supplied values over the resolved auto-fill defaults, so a
 * template always renders with a complete value map (missing keys -> "").
 */
export function resolveMergeValues(
  template: DocumentTemplate,
  context: MergeContext,
  provided: DocumentMergeValues
): DocumentMergeValues {
  const defaults = buildAutoFillDefaults(template, context);
  const resolved: DocumentMergeValues = {};
  for (const field of template.mergeFields) {
    const value = provided[field.key];
    resolved[field.key] =
      value !== undefined && value !== "" ? value : (defaults[field.key] ?? "");
  }
  return resolved;
}
