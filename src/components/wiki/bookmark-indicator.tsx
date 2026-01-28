import { Bookmark } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Simple bookmark indicator that shows a filled bookmark icon.
 * Use this on article cards to indicate bookmarked status.
 */
export function BookmarkIndicator() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Bookmark className="size-4 fill-current text-ef" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Bookmarked</TooltipContent>
    </Tooltip>
  );
}
