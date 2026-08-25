import * as React from "react";

import type { HeaderBreadcrumbItem } from "@/components/header/header-context";
import { PageContext } from "@/components/header/page-context";
import { DASHBOARD_PAGE_CONTENT_ID } from "@/lib/dashboard/main-region";
import { cn } from "@/lib/utils";

/** Gray, padded scroll frame shared by authenticated page bodies. */
export function PageCanvas({
  className,
  contentClassName,
  contextItems,
  frameClassName,
  context = "default",
  contextAttachment = "standalone",
  children,
  ...props
}: React.ComponentProps<"div"> & {
  frameClassName?: string;
  contentClassName?: string;
  context?: "default" | "none";
  contextAttachment?: "standalone" | "attached";
  contextItems?: HeaderBreadcrumbItem[];
}) {
  return (
    <div
      data-slot="page-canvas"
      className={cn(
        "bg-background h-full min-h-0 overflow-auto p-3 sm:p-4",
        className
      )}
      {...props}
    >
      <div
        data-slot="page-hierarchy-frame"
        className={cn(
          "flex h-full min-h-full min-w-0 flex-col gap-3",
          contextAttachment === "attached" &&
            "[[data-auth-page-hierarchy=b]_&]:gap-0",
          frameClassName
        )}
      >
        {context === "default" && (
          <PageContext attachment={contextAttachment} items={contextItems} />
        )}
        <div
          id={context === "default" ? DASHBOARD_PAGE_CONTENT_ID : undefined}
          tabIndex={context === "default" ? -1 : undefined}
          data-slot="page-content"
          className={cn(
            "min-h-0 min-w-0 flex-1 outline-none",
            contextAttachment === "attached" &&
              "[[data-auth-page-hierarchy=b]_&]:[&>[data-slot=workspace-panel]]:rounded-t-none [[data-auth-page-hierarchy=b]_&]:[&>[data-slot=workspace-panel]]:border-t-0",
            contentClassName
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** The neutral, rounded surface that contains one page-level workspace. */
export function WorkspacePanel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="workspace-panel"
      className={cn(
        "bg-card text-card-foreground min-h-0 min-w-0 rounded-xl border shadow-sm",
        className
      )}
      {...props}
    />
  );
}

/** Responsive two-panel geometry for detail and editor workspaces. */
export function SplitWorkspace({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="split-workspace"
      className={cn(
        "grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]",
        className
      )}
      {...props}
    />
  );
}
