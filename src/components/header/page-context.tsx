"use client";

import Link from "next/link";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

import { resolveBreadcrumbTrail } from "./breadcrumb-trail";
import { useHeader, type HeaderBreadcrumbItem } from "./header-context";

/**
 * Compact page-owned context for the authenticated canvas. A standalone row
 * sits in the canvas above independent surfaces; an attached row becomes the
 * header of a same-width primary surface. Server-known `items` let attached
 * pages render the correct trail and geometry in the initial HTML while the
 * HeaderProvider continues to own the actions portal.
 */
export function PageContext({
  attachment = "standalone",
  className,
  items,
}: {
  attachment?: "standalone" | "attached";
  className?: string;
  items?: HeaderBreadcrumbItem[];
}) {
  const { breadcrumbs, setActionsContainer } = useHeader();
  const trail = resolveBreadcrumbTrail(items ?? breadcrumbs);

  return (
    <div
      data-slot="page-context"
      data-breadcrumb-depth={trail.length}
      data-attachment={attachment}
      className={cn(
        "flex min-h-10 shrink-0 items-center gap-3 px-1",
        attachment === "attached" &&
          "bg-card min-h-14 rounded-t-xl border border-b-0 px-4",
        className
      )}
    >
      <Breadcrumb className="min-w-0 overflow-hidden">
        <BreadcrumbList className="flex-nowrap overflow-hidden">
          {trail.map((crumb, index) => (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link className="truncate" href={crumb.href}>
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate">
                    {crumb.label}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="min-w-0 flex-1" />
      <div
        ref={setActionsContainer}
        data-slot="page-actions"
        className="flex shrink-0 flex-wrap items-center justify-end gap-2"
      />
    </div>
  );
}
