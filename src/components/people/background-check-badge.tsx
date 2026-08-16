"use client";

import { Badge } from "@/components/ui/badge";
import { backgroundCheckBadge } from "@/lib/people/background-check";
import { cn } from "@/lib/utils";
import { ShieldCheck } from "lucide-react";

interface BackgroundCheckBadgeProps {
  /** The stored `persons.background_check_status` value. */
  status: string;
  /**
   * Name the subject in the badge itself — an icon and the "Background check:"
   * prefix. For the surfaces where the badge stands among others and nothing
   * around it says what "Cleared" is about: the profile header, a roster row.
   * A labelled field (the Overview tab) leaves it off and reads plainly.
   */
  labelled?: boolean;
  className?: string;
}

/**
 * The ONE badge for a person's background-check status. Both readers — the
 * person profile and the rosters of teams that require a check — render it, so
 * the tint and the wording cannot drift apart between them.
 */
export function BackgroundCheckBadge({
  status,
  labelled = false,
  className,
}: BackgroundCheckBadgeProps) {
  const config = backgroundCheckBadge(status);

  return (
    <Badge variant={config.variant} className={cn(config.className, className)}>
      {labelled && <ShieldCheck className="h-3 w-3" />}
      {labelled
        ? `Background check: ${config.label.toLowerCase()}`
        : config.label}
    </Badge>
  );
}
