"use client";

import { Badge } from "@/components/ui/badge";
import {
  PersonWithTags,
  PipelineColumn as PipelineColumnType,
} from "@/lib/people/types";
import { cn } from "@/lib/utils";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect, useRef, useState } from "react";
import invariant from "tiny-invariant";
import { isCardData, PipelineCard } from "./pipeline-card";

// ============================================================================
// Data helpers — used to identify column drop targets
// ============================================================================

const COLUMN_TYPE = "pipeline-column";

export type ColumnDragData = {
  type: typeof COLUMN_TYPE;
  columnId: string;
};

export function getColumnData(columnId: string): ColumnDragData {
  return { type: COLUMN_TYPE, columnId };
}

export function isColumnData(
  data: Record<string, unknown>
): data is ColumnDragData {
  return data.type === COLUMN_TYPE;
}

// ============================================================================
// Component
// ============================================================================

interface PipelineColumnProps {
  column: PipelineColumnType;
  people: PersonWithTags[];
}

export function PipelineColumn({ column, people }: PipelineColumnProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    invariant(el);

    return dropTargetForElements({
      element: el,
      canDrop({ source }) {
        return isCardData(source.data);
      },
      getData() {
        return getColumnData(column.id);
      },
      onDragEnter() {
        setIsDraggedOver(true);
      },
      onDragLeave() {
        setIsDraggedOver(false);
      },
      onDrop() {
        setIsDraggedOver(false);
      },
    });
  }, [column.id]);

  return (
    <div
      ref={ref}
      className={cn(
        "bg-muted/50 flex h-full max-w-[320px] min-w-[280px] flex-col rounded-lg border border-border/50 transition-colors duration-200",
        isDraggedOver && "border-primary/25 bg-primary/4 ring-2 ring-primary/40"
      )}
    >
      {/* Sticky column header */}
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-lg bg-inherit px-4 pt-3 pb-2">
        <h3 className="text-foreground/70 text-xs font-semibold tracking-wide uppercase">
          {column.title}
        </h3>
        <Badge
          variant="secondary"
          className="bg-background text-foreground h-5 min-w-5 border px-1.5 text-[11px] font-medium"
        >
          {people.length}
        </Badge>
      </div>

      {/* Cards list */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pt-2 pb-3">
        {people.length === 0 ? (
          <div
            className={cn(
              "flex min-h-[60px] items-center justify-center rounded-md border border-dashed text-xs transition-colors",
              isDraggedOver
                ? "border-primary/40 text-primary/60"
                : "border-muted-foreground/30 text-muted-foreground/70"
            )}
          >
            {isDraggedOver ? "Drop here" : "No people"}
          </div>
        ) : (
          people.map((person) => (
            <PipelineCard
              key={person.id}
              person={person}
              columnId={column.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
