"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { useHeader } from "./header-context";

/**
 * `children` are SHELL-level controls — rendered on every dashboard route, to
 * the right of the breadcrumbs and before the page's own actions.
 *
 * They come in as a prop rather than being imported here because the header is
 * a client component and the shell's controls (the unread bell) need
 * server-resolved data. Passing them as a rendered node keeps the fetch in the
 * layout, where the session already is, and keeps this component free of it.
 */
export function DashboardHeader({ children }: { children?: ReactNode }) {
  const { breadcrumbs, setActionsContainer } = useHeader();

  const hasBreadcrumbs = breadcrumbs.length > 0;

  return (
    <header className="bg-card flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-4"
      />

      <Breadcrumb>
        <BreadcrumbList>
          {hasBreadcrumbs ? (
            breadcrumbs.map((item, index) => {
              const isLast = index === breadcrumbs.length - 1;

              return (
                <Fragment key={index}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {isLast || !item.href ? (
                      <BreadcrumbPage>{item.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link href={item.href}>{item.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              );
            })
          ) : (
            <BreadcrumbItem>
              <BreadcrumbPage>Dashboard</BreadcrumbPage>
            </BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      {/* Spacer pushes actions to the right */}
      <div className="flex-1" />

      {/* Shell-level controls, present on every route */}
      {children}

      {/* Portal target for page-specific actions */}
      <div ref={setActionsContainer} className="flex items-center gap-2" />
    </header>
  );
}
