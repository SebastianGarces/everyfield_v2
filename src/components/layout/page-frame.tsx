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
  scrollLayout = "fixed",
  contentFocusTarget,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  frameClassName?: string;
  contentClassName?: string;
  context?: "default" | "none";
  contextAttachment?: "standalone" | "attached";
  /**
   * `flow` lets the hierarchy grow so the canvas padding remains inside the
   * page's scroll range, and lets a lone workspace fill the short-page
   * remainder. `fixed` keeps a definite-height hierarchy for workspaces whose
   * descendants own their scrolling.
   */
  scrollLayout?: "flow" | "fixed";
  contextItems?: HeaderBreadcrumbItem[];
  contentFocusTarget?: boolean;
}) {
  const hasContentFocusTarget = contentFocusTarget ?? context === "default";

  return (
    <div
      data-slot="page-canvas"
      className={cn(
        "bg-background h-full min-h-0 overflow-auto overscroll-x-none overscroll-y-none p-3 sm:p-4",
        className
      )}
      {...props}
    >
      <div
        data-slot="page-hierarchy-frame"
        data-scroll-layout={scrollLayout}
        className={cn(
          "flex min-h-full min-w-0 flex-col gap-3",
          scrollLayout === "fixed" && "h-full",
          contextAttachment === "attached" && "gap-0",
          frameClassName
        )}
      >
        {context === "default" && (
          <PageContext attachment={contextAttachment} items={contextItems} />
        )}
        <div
          id={hasContentFocusTarget ? DASHBOARD_PAGE_CONTENT_ID : undefined}
          tabIndex={hasContentFocusTarget ? -1 : undefined}
          data-slot="page-content"
          className={cn(
            "min-w-0 flex-1 outline-none",
            scrollLayout === "fixed" && "min-h-0",
            scrollLayout === "flow" &&
              "flex flex-col [&>[data-slot=workspace-panel]:only-child]:flex-1",
            contextAttachment === "attached" &&
              "[&>[data-slot=workspace-panel]]:rounded-t-none [&>[data-slot=workspace-panel]]:border-t-0",
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
