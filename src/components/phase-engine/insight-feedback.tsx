"use client";

// ============================================================================
// InsightFeedback — per-insight thumbs up/down + optional comment (PE-014).
//
// Client component. Wires the planter's "useful / not_useful" rating and a
// short comment to the EXISTING feedback action
// (src/app/(dashboard)/phase/feedback-actions.ts). Optimistic UI: the chosen
// rating highlights immediately; on server failure we revert and toast. The
// comment box only appears once a rating is chosen, keeping the surface quiet.
// ============================================================================

import { Loader2, MessageSquare, ThumbsDown, ThumbsUp } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { submitInsightFeedbackAction } from "@/app/(dashboard)/phase/feedback-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { InsightFeedbackRating } from "@/db/schema";

interface InsightFeedbackProps {
  insightId: string;
  /** The current user's existing rating, if any (server-provided). */
  initialRating?: InsightFeedbackRating | null;
  /** The current user's existing comment, if any (server-provided). */
  initialComment?: string | null;
}

export function InsightFeedback({
  insightId,
  initialRating = null,
  initialComment = null,
}: InsightFeedbackProps) {
  // The RATING is server data, so it is `useOptimistic` over the prop rather
  // than `useState` seeded from it (memory/invariants.md → Client/Server Data
  // Synchronization). The action calls `revalidatePath("/phase")`; with local
  // state this component ignored the value that came back, and it carried a
  // hand-rolled rollback that `useOptimistic` gives for free.
  const [rating, setOptimisticRating] = useOptimistic(initialRating);
  // The COMMENT is different and legitimately stays local: it is a DRAFT the
  // planter is typing, not a mirror of a server field. `initialComment` seeds it
  // once, exactly as any edit form seeds an input.
  const [comment, setComment] = useState(initialComment ?? "");
  const [showComment, setShowComment] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(nextRating: InsightFeedbackRating, nextComment: string) {
    startTransition(async () => {
      setOptimisticRating(nextRating);

      const result = await submitInsightFeedbackAction({
        insightId,
        rating: nextRating,
        comment: nextComment.trim() ? nextComment.trim() : undefined,
      });

      if (!result.success) {
        // Nothing to roll back — the optimistic rating reverts to the prop when
        // this transition settles.
        toast.error(result.error);
        return;
      }

      toast.success("Thanks for the feedback");
    });
  }

  function handleRate(nextRating: InsightFeedbackRating) {
    submit(nextRating, comment);
  }

  function handleSaveComment() {
    if (!rating) return;
    submit(rating, comment);
    setShowComment(false);
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Was this helpful?</span>

        <Button
          type="button"
          size="sm"
          variant={rating === "useful" ? "secondary" : "ghost"}
          className="h-7 cursor-pointer gap-1.5 px-2"
          aria-pressed={rating === "useful"}
          aria-label="Mark insight useful"
          disabled={isPending}
          onClick={() => handleRate("useful")}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
          <span className="text-xs">Useful</span>
        </Button>

        <Button
          type="button"
          size="sm"
          variant={rating === "not_useful" ? "secondary" : "ghost"}
          className="h-7 cursor-pointer gap-1.5 px-2"
          aria-pressed={rating === "not_useful"}
          aria-label="Mark insight not useful"
          disabled={isPending}
          onClick={() => handleRate("not_useful")}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
          <span className="text-xs">Not useful</span>
        </Button>

        {rating && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              "h-7 cursor-pointer gap-1.5 px-2",
              showComment && "text-foreground"
            )}
            aria-expanded={showComment}
            onClick={() => setShowComment((open) => !open)}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="text-xs">
              {comment.trim() ? "Edit comment" : "Add comment"}
            </span>
          </Button>
        )}

        {isPending && (
          <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
        )}
      </div>

      {showComment && rating && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What made this insight useful or not? (optional)"
            rows={2}
            maxLength={2000}
            disabled={isPending}
            className="min-h-0 resize-none text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="cursor-pointer"
              disabled={isPending}
              onClick={() => setShowComment(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="cursor-pointer"
              disabled={isPending}
              onClick={handleSaveComment}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
