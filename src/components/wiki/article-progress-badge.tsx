import { Badge } from "@/components/ui/badge";
import { Check, BookOpen, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ArticleProgressBadgeProps {
  status: "not_started" | "in_progress" | "completed";
  className?: string;
}

/**
 * Displays article reading status as a simple badge.
 */
export function ArticleProgressBadge({
  status,
  className,
}: ArticleProgressBadgeProps) {
  if (status === "completed") {
    return (
      <Badge
        variant="secondary"
        className={cn(
          "bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400",
          className
        )}
      >
        <Check className="mr-1 h-3 w-3" />
        Complete
      </Badge>
    );
  }

  if (status === "in_progress") {
    return (
      <Badge
        variant="secondary"
        className={cn(
          "bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
          className
        )}
      >
        <BookOpen className="mr-1 h-3 w-3" />
        Started
      </Badge>
    );
  }

  // not_started
  return (
    <Badge
      variant="outline"
      className={cn("text-muted-foreground", className)}
    >
      <Circle className="mr-1 h-3 w-3" />
      Not started
    </Badge>
  );
}
