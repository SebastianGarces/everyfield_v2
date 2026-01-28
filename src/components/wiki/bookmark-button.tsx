"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toggleBookmark } from "@/lib/wiki/bookmarks";
import { Bookmark } from "lucide-react";
import { useOptimistic, useTransition } from "react";

interface BookmarkButtonProps {
  slug: string;
  initialBookmarked: boolean;
}

export function BookmarkButton({
  slug,
  initialBookmarked,
}: BookmarkButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticBookmarked, setOptimisticBookmarked] = useOptimistic(
    initialBookmarked,
    (_, newState: boolean) => newState
  );

  const handleToggle = () => {
    startTransition(async () => {
      setOptimisticBookmarked(!optimisticBookmarked);
      await toggleBookmark(slug);
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={handleToggle}
          disabled={isPending}
          aria-label={
            optimisticBookmarked ? "Remove bookmark" : "Bookmark this article"
          }
          className="cursor-pointer"
        >
          <Bookmark
            className={cn(
              "size-7 transition-colors",
              optimisticBookmarked && "text-ef fill-current"
            )}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {optimisticBookmarked ? "Remove bookmark" : "Bookmark"}
      </TooltipContent>
    </Tooltip>
  );
}
