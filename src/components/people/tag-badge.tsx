import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface TagBadgeProps {
  tag: { id: string; name: string; color?: string | null };
  size?: "sm" | "md";
  onRemove?: () => void;
}

const colorMap: Record<string, string> = {
  blue: "bg-blue-100 text-blue-800 hover:bg-blue-200",
  green: "bg-green-100 text-green-800 hover:bg-green-200",
  red: "bg-red-100 text-red-800 hover:bg-red-200",
  yellow: "bg-yellow-100 text-yellow-800 hover:bg-yellow-200",
  purple: "bg-purple-100 text-purple-800 hover:bg-purple-200",
  pink: "bg-pink-100 text-pink-800 hover:bg-pink-200",
  orange: "bg-orange-100 text-orange-800 hover:bg-orange-200",
  gray: "bg-gray-100 text-gray-800 hover:bg-gray-200",
};

export function TagBadge({ tag, size = "sm", onRemove }: TagBadgeProps) {
  let colorClass = "bg-gray-100 text-gray-800 hover:bg-gray-200";
  let customStyle = {};

  if (tag.color) {
    if (tag.color.startsWith("#")) {
      // Hex color - use as background with auto text color (simplified to dark text for now)
      // Ideally we'd calculate contrast, but for now assuming light backgrounds
      customStyle = {
        backgroundColor: tag.color,
        color: "#1f2937", // gray-800
      };
      colorClass = "hover:opacity-90";
    } else if (colorMap[tag.color.toLowerCase()]) {
      colorClass = colorMap[tag.color.toLowerCase()];
    }
  }

  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 font-normal transition-colors",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-sm",
        colorClass,
        onRemove && "pr-1"
      )}
      style={customStyle}
    >
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 focus:outline-none"
        >
          <X className="h-3 w-3" />
          <span className="sr-only">Remove {tag.name} tag</span>
        </button>
      )}
    </Badge>
  );
}
