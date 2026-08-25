import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface DetailHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  leading?: ReactNode;
  metadata?: ReactNode;
  trailing?: ReactNode;
  summary?: ReactNode;
  className?: string;
  responsive?: boolean;
}

/**
 * The presentation contract shared by authenticated detail-page headers.
 *
 * Feature components keep ownership of their labels, actions, permission
 * gates and state. This component only keeps their visual hierarchy aligned.
 */
export function DetailHeader({
  title,
  eyebrow,
  leading,
  metadata,
  trailing,
  summary,
  className,
  responsive = false,
}: DetailHeaderProps) {
  return (
    <div className={cn("space-y-4 pb-4", className)} data-slot="detail-header">
      <div
        className={cn(
          "flex items-start justify-between",
          responsive &&
            "flex-col gap-4 md:flex-row md:items-start md:justify-between"
        )}
      >
        <div className="flex min-w-0 items-start gap-4">
          {leading}
          <div className="min-w-0 space-y-1">
            {eyebrow && (
              <div
                className="mb-1 flex items-center gap-2"
                data-slot="detail-header-eyebrow"
              >
                {eyebrow}
              </div>
            )}
            <h1
              className="text-2xl font-bold tracking-tight"
              data-slot="detail-header-title"
            >
              {title}
            </h1>
            {metadata && (
              <div
                className="text-muted-foreground flex flex-wrap items-center gap-4 text-sm"
                data-slot="detail-header-metadata"
              >
                {metadata}
              </div>
            )}
          </div>
        </div>

        {trailing && (
          <div
            className="flex items-center gap-3"
            data-slot="detail-header-trailing"
          >
            {trailing}
          </div>
        )}
      </div>

      {summary && <div data-slot="detail-header-summary">{summary}</div>}
    </div>
  );
}
