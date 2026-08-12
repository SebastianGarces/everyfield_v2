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

/**
 * A framed aside — an icon and its colour say what KIND of aside it is.
 *
 * `data-print-callout` writes that same type out in words, because the icon is
 * the whole signal and an icon does not survive every way this article is read.
 * It is a `data-print-*` marker, beside `data-print-root` and `data-print-hide`;
 * the one reader of THIS marker is the PDF download (`article-pdf/extract.ts` →
 * `PRINT_CALLOUT_ATTRIBUTE`), which frames the box and prints this word in the
 * icon's place rather than letting a **Warning** arrive as ordinary prose
 * (ruling on PR #391, 2026-08-12). The print stylesheet needs no marker: the
 * browser prints the box the screen already draws. The two strings are held
 * together by a test, not by a shared import — `article-actions.test.ts` calls
 * this component and reads the attribute off it.
 *
 * A screen reader gets the word from the `sr-only` label, since the icon
 * carries no accessible name and nothing else here says which kind of aside
 * this is. That label is `data-print-hide`: on paper and in the PDF the box and
 * the printed type already say it, so without the marker the word would reach
 * a reader TWICE — and inside a list item, a blockquote or a table cell, where
 * everything flattens to one line, it would weld itself to the sentence
 * ("Confirm the room. WarningChecklists are not optional.").
 */
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
      data-print-callout={config.title}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 h-5 w-5 shrink-0", config.iconClass)}
      />
      <span className="sr-only" data-print-hide="">
        {config.title}
      </span>
      <div className="prose-p:my-0 text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}
