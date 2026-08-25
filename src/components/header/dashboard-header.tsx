"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { resolveBreadcrumbTrail } from "./breadcrumb-trail";
import { useHeader } from "./header-context";

/**
 * `children` are optional context-level controls — rendered to the right of
 * the breadcrumbs and before the page's own actions.
 *
 * Keeping this slot preserves the existing header API for a route that needs a
 * stable control before its portal actions. Account-wide controls now live in
 * the global app bar above this page-context bar.
 */
export function DashboardHeader({ children }: { children?: ReactNode }) {
  const { breadcrumbs, setActionsContainer } = useHeader();

  // One rule, one place: the last declared crumb names the current page, and the
  // "Dashboard" fallback applies only to a page that declared nothing (#261).
  const trail = resolveBreadcrumbTrail(breadcrumbs);

  return (
    <header className="bg-card flex h-16 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
      <Breadcrumb className="min-w-0 overflow-hidden">
        <BreadcrumbList>
          {trail.map((crumb, index) => (
            <Fragment key={index}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      {/* Spacer pushes actions to the right */}
      <div className="min-w-0 flex-1" />

      {/* Shell-level controls, present on every route */}
      {children}

      {/* Portal target for page-specific actions */}
      <div
        ref={setActionsContainer}
        className="flex shrink-0 items-center gap-2"
      />
    </header>
  );
}
