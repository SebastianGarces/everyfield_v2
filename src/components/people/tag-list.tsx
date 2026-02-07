import type { Tag } from "@/lib/people/types";
import { TagBadge } from "./tag-badge";

interface TagListProps {
  tags: Tag[];
  size?: "sm" | "md";
}

export function TagList({ tags, size = "sm" }: TagListProps) {
  if (!tags || tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <TagBadge key={tag.id} tag={tag} size={size} />
      ))}
    </div>
  );
}
