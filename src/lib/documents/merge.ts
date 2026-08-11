// ============================================================================
// Document Templates — Merge data (F6)
// ============================================================================
//
// Resolves auto-fill defaults for a template's merge fields from the church
// profile and the current user, and merges them with planter-supplied values.
// ============================================================================

import { APP_TIME_ZONE } from "@/lib/datetime";
import { parseTargetDate } from "@/lib/launch/countdown";
import type { DocumentMergeValues, DocumentTemplate } from "./types";

export interface MergeContext {
  churchName: string;
  /** Current user's display name, used for pastor_name auto-fill. */
  userName: string | null;
  /**
   * The plant's launch day as stored (`launches.target_date`, YYYY-MM-DD), or
   * null when it has no launch or no date yet. NOT a church column — migration
   * 0032 dropped `churches.launch_date` and the launch entity owns it (LS-001).
   * Both surfaces — `(dashboard)/documents/page.tsx` and
   * `api/documents/[templateId]/route.ts` — resolve it through
   * `resolveDocumentMergeContext` (`./merge-context.ts`), so the dialog's
   * preview and the generated file name the same day. Null here means the
   * plant has no launch row or no day named yet, and `{{launch_date}}` renders
   * empty (#306).
   */
  launchDate: string | null;
}

function formatLaunchDate(launchDate: string | null): string {
  if (!launchDate) return "";
  // A stored launch day is a WALL CLOCK, so both halves of this are pinned:
  // `parseTargetDate` reads it at UTC midnight, and the formatter names
  // `APP_TIME_ZONE` explicitly. Without the zone `Intl` follows the RUNTIME's,
  // which is UTC on the server and the visitor's in a browser — the document
  // would name a different day depending on where it was rendered
  // (memory/invariants.md → Date & Time Rendering).
  const parsed = parseTargetDate(launchDate);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", {
    timeZone: APP_TIME_ZONE,
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
