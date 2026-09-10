import type { HeaderBreadcrumbItem } from "@/components/header/header-context";
import type { EvryPageContext } from "@/lib/evry/resolvers/contract";

export type VisibleEvryPageContext = Readonly<{
  key: string;
  label: string;
  wire: EvryPageContext;
}>;

const RECORD_ROUTES = [
  {
    kind: "person",
    pattern: /^\/people\/([^/]+)(?:\/|$)/,
    reserved: new Set(["new"]),
    fallbackLabel: "Person record",
  },
  {
    kind: "meeting",
    pattern: /^\/meetings\/([^/]+)(?:\/|$)/,
    reserved: new Set(["new"]),
    fallbackLabel: "Meeting record",
  },
  {
    kind: "team",
    pattern: /^\/teams\/([^/]+)(?:\/|$)/,
    reserved: new Set(["health", "org-chart"]),
    fallbackLabel: "Team record",
  },
  {
    kind: "task",
    pattern: /^\/tasks\/([^/]+)(?:\/|$)/,
    reserved: new Set(["new", "templates"]),
    fallbackLabel: "Task record",
  },
] as const;

function finalBreadcrumbLabel(
  breadcrumbs: readonly HeaderBreadcrumbItem[]
): string | null {
  const value = breadcrumbs.at(-1)?.label.trim();
  return value ? value : null;
}

/**
 * Turn the visible route into a display chip and a minimal wire hint.
 *
 * The label is presentation only and never crosses the request boundary. The
 * server resolves the record id again inside the authenticated plant before it
 * persists or uses the hint.
 */
export function visibleEvryPageContextFor(
  pathname: string,
  breadcrumbs: readonly HeaderBreadcrumbItem[]
): VisibleEvryPageContext | null {
  if (pathname === "/phase" || pathname.startsWith("/phase/")) {
    return {
      key: "plant_intelligence:current",
      label: finalBreadcrumbLabel(breadcrumbs) ?? "Plant Intelligence",
      wire: { kind: "plant_intelligence", recordId: "current" },
    };
  }

  if (pathname === "/launch" || pathname.startsWith("/launch/")) {
    return {
      key: "launch:current",
      label: finalBreadcrumbLabel(breadcrumbs) ?? "Launch",
      wire: { kind: "launch", recordId: "current" },
    };
  }

  for (const route of RECORD_ROUTES) {
    const recordId = route.pattern.exec(pathname)?.[1];
    if (!recordId || route.reserved.has(recordId)) continue;

    return {
      key: `${route.kind}:${recordId}`,
      label: finalBreadcrumbLabel(breadcrumbs) ?? route.fallbackLabel,
      wire: { kind: route.kind, recordId },
    };
  }

  return null;
}
