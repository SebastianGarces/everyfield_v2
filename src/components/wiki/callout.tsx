import { cn } from "@/lib/utils";
import {
  AlertCircle,
  BookOpen,
  Lightbulb,
  AlertTriangle,
  Info,
} from "lucide-react";

type CalloutType = "insight" | "important" | "tip" | "warning" | "scripture";

interface CalloutProps {
  type?: CalloutType;
  children: React.ReactNode;
  className?: string;
}

const calloutConfig: Record<
  CalloutType,
  {
    icon: React.ElementType;
    title: string;
    containerClass: string;
    iconClass: string;
  }
> = {
  insight: {
    icon: Lightbulb,
    title: "Insight",
    containerClass:
      "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/50",
    iconClass: "text-blue-600 dark:text-blue-400",
  },
  important: {
    icon: AlertCircle,
    title: "Important",
    containerClass:
      "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  tip: {
    icon: Info,
    title: "Tip",
    containerClass:
      "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/50",
    iconClass: "text-green-600 dark:text-green-400",
  },
  warning: {
    icon: AlertTriangle,
    title: "Warning",
    containerClass:
      "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50",
    iconClass: "text-red-600 dark:text-red-400",
  },
  scripture: {
    icon: BookOpen,
    title: "Scripture",
    containerClass:
      "border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/50",
    iconClass: "text-purple-600 dark:text-purple-400",
  },
};

export function Callout({ type = "tip", children, className }: CalloutProps) {
  const config = calloutConfig[type];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "my-6 flex gap-3 rounded-lg border p-4",
        config.containerClass,
        className
      )}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", config.iconClass)} />
      <div className="prose-p:my-0 text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}
