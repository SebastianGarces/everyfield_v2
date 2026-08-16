"use client";

import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { submitArticleFeedbackAction } from "@/app/(dashboard)/wiki/actions";
import { Button } from "@/components/ui/button";
import type { WikiArticleFeedbackRating } from "@/db/schema";

interface ArticleFeedbackProps {
  articleSlug: string;
  /** The current user's existing rating, if any (server-provided). */
  initialRating?: WikiArticleFeedbackRating | null;
}

export function ArticleFeedback({
  articleSlug,
  initialRating = null,
}: ArticleFeedbackProps) {
  // The rating is server data, so it is `useOptimistic` over the prop rather
  // than `useState` seeded from it. The action calls `refresh()`; with local
  // state this control would ignore the value that came back.
  const [rating, setOptimisticRating] = useOptimistic(initialRating);
  const [isPending, startTransition] = useTransition();

  function handleRate(nextRating: WikiArticleFeedbackRating) {
    startTransition(async () => {
      setOptimisticRating(nextRating);

      const result = await submitArticleFeedbackAction({
        articleSlug,
        rating: nextRating,
      });

      if (!result.success) {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="border-t pt-6">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">
          Was this article helpful?
        </span>

        <Button
          type="button"
          size="sm"
          variant={rating === "helpful" ? "secondary" : "ghost"}
          aria-pressed={rating === "helpful"}
          aria-label="Mark article helpful"
          className="h-7 cursor-pointer gap-1.5 px-2"
          disabled={isPending}
          onClick={() => handleRate("helpful")}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
          <span className="text-xs">Yes</span>
        </Button>

        <Button
          type="button"
          size="sm"
          variant={rating === "unhelpful" ? "secondary" : "ghost"}
          aria-pressed={rating === "unhelpful"}
          aria-label="Mark article unhelpful"
          className="h-7 cursor-pointer gap-1.5 px-2"
          disabled={isPending}
          onClick={() => handleRate("unhelpful")}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
          <span className="text-xs">No</span>
        </Button>

        {isPending && (
          <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
        )}
      </div>
    </div>
  );
}
