import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  description?: string;
  variant?: "default" | "warning" | "success";
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  variant = "default",
}: MetricCardProps) {
  return (
    <div className="bg-card rounded-xl border p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm font-medium">{title}</p>
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            variant === "warning" &&
              "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
            variant === "success" &&
              "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
            variant === "default" && "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3">
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        {description && (
          <p className="text-muted-foreground mt-1 text-xs">{description}</p>
        )}
      </div>
    </div>
  );
}
