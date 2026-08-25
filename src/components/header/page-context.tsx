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
import { useHeader } from "./header-context";

/**
 * The page-owned replacement for the retired 64px shell context bar.
 *
 * Direction A leaves this row unboxed in the canvas. Direction B makes the
 * same DOM the header of the adjacent primary surface. Keeping one node means
 * the breadcrumb state and HeaderActions portal never duplicate or remount
 * when the prototype switches.
 */
export function PageContext({ className }: { className?: string }) {
  const { breadcrumbs, setActionsContainer } = useHeader();
  const trail = resolveBreadcrumbTrail(breadcrumbs);

  return (
    <div
      data-slot="page-context"
      data-breadcrumb-depth={trail.length}
      className={cn(
        "flex min-h-10 shrink-0 items-center gap-3 px-1",
        "[[data-auth-page-hierarchy=b]_&]:bg-card [[data-auth-page-hierarchy=b]_&]:min-h-14 [[data-auth-page-hierarchy=b]_&]:rounded-t-xl [[data-auth-page-hierarchy=b]_&]:border [[data-auth-page-hierarchy=b]_&]:border-b-0 [[data-auth-page-hierarchy=b]_&]:px-4",
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
