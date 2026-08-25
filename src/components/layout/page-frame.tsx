import * as React from "react";

import { cn } from "@/lib/utils";

/** Gray, padded scroll frame shared by authenticated page bodies. */
export function PageCanvas({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-canvas"
      className={cn(
        "bg-background h-full min-h-0 overflow-auto p-3 sm:p-4",
        className
      )}
      {...props}
    />
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
