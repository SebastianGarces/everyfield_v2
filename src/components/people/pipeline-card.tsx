"use client";

import { Badge } from "@/components/ui/badge";
import { PersonWithTags } from "@/lib/people/types";
import { cn } from "@/lib/utils";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  attachClosestEdge,
  type Edge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { Rocket, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import invariant from "tiny-invariant";

// ============================================================================
// Data helpers — used to identify card data throughout the DnD system
// ============================================================================

const CARD_TYPE = "pipeline-card";

export type CardDragData = {
  type: typeof CARD_TYPE;
  personId: string;
  columnId: string;
  person: PersonWithTags;
};

export function getCardData(
  person: PersonWithTags,
  columnId: string
): CardDragData {
  return { type: CARD_TYPE, personId: person.id, columnId, person };
}

export function isCardData(data: Record<string, unknown>): data is CardDragData {
  return data.type === CARD_TYPE;
}

// ============================================================================
// Drop indicator
// ============================================================================

function DropIndicator({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-0 left-0 z-10 flex items-center",
        edge === "top" ? "-top-2" : "-bottom-2"
      )}
    >
      <div className="bg-primary -ml-1 h-2 w-2 shrink-0 rounded-full" />
      <div className="bg-primary h-[2px] flex-1" />
    </div>
  );
}

// ============================================================================
// Drag state
// ============================================================================

type CardState =
  | { type: "idle" }
  | { type: "preview"; container: HTMLElement }
  | { type: "dragging" }
  | { type: "over"; closestEdge: Edge | null };

const idle: CardState = { type: "idle" };

// ============================================================================
// Component
// ============================================================================

interface PipelineCardProps {
  person: PersonWithTags;
  columnId: string;
}

export function PipelineCard({ person, columnId }: PipelineCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<CardState>(idle);

  useEffect(() => {
    const el = ref.current;
    invariant(el);

    return combine(
      draggable({
        element: el,
        getInitialData: () => getCardData(person, columnId),
        onGenerateDragPreview({ nativeSetDragImage }) {
          setCustomNativeDragPreview({
            getOffset: pointerOutsideOfPreview({ x: "16px", y: "8px" }),
            nativeSetDragImage,
            render({ container }) {
              setState({ type: "preview", container });
              return () => setState({ type: "dragging" });
            },
          });
        },
        onDrop() {
          setState(idle);
        },
      }),
      dropTargetForElements({
        element: el,
        canDrop({ source }) {
          // Only accept other pipeline cards (not ourselves)
          return isCardData(source.data) && source.data.personId !== person.id;
        },
        getData({ input, element }) {
          const data = getCardData(person, columnId);
          return attachClosestEdge(data, {
            input,
            element,
            allowedEdges: ["top", "bottom"],
          });
        },
        onDragEnter({ self }) {
          const edge = extractClosestEdge(self.data);
          setState({ type: "over", closestEdge: edge });
        },
        onDrag({ self }) {
          const edge = extractClosestEdge(self.data);
          setState((current) => {
            if (current.type === "over" && current.closestEdge === edge) {
              return current;
            }
            return { type: "over", closestEdge: edge };
          });
        },
        onDragLeave() {
          setState(idle);
        },
        onDrop() {
          setState(idle);
        },
      })
    );
  }, [person, columnId]);

  const isDragging = state.type === "dragging";

  return (
    <>
      <div
        ref={ref}
        data-person-id={person.id}
        className={cn(
          "relative transition-all duration-150",
          isDragging && "scale-[0.98] opacity-50"
        )}
      >
        {/* Drop indicator — top */}
        {state.type === "over" && state.closestEdge === "top" && (
          <DropIndicator edge="top" />
        )}

        <Link
          href={`/people/${person.id}`}
          className="block"
          onClick={(e) => {
            if (isDragging) e.preventDefault();
          }}
          draggable={false}
        >
          <div
            className={cn(
              "bg-card text-card-foreground rounded-lg border px-3 py-2.5 shadow-xs transition-all duration-150",
              "cursor-grab active:cursor-grabbing",
              "hover:shadow-sm hover:border-foreground/15",
              isDragging && "ring-2 ring-primary/30"
            )}
          >
            {/* Row 1: Name + status icon */}
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium leading-tight">
                {person.firstName} {person.lastName}
              </span>
              {person.status === "leader" && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">
                  <Star className="h-3 w-3 fill-current" />
                </span>
              )}
              {person.status === "launch_team" && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                  <Rocket className="h-3 w-3 fill-current" />
                </span>
              )}
            </div>

            {/* Row 2: Email + source */}
            {(person.email || person.source) && (
              <div className="mt-1 flex items-center gap-1.5">
                {person.email && (
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                    {person.email}
                  </span>
                )}
                {person.source && (
                  <Badge
                    variant="outline"
                    className="h-4 shrink-0 border-border bg-muted px-1.5 py-0 text-[10px] font-medium text-foreground/60"
                  >
                    {person.source.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </Link>

        {/* Drop indicator — bottom */}
        {state.type === "over" && state.closestEdge === "bottom" && (
          <DropIndicator edge="bottom" />
        )}
      </div>

      {/* Native drag preview rendered in portal */}
      {state.type === "preview" &&
        createPortal(
          <div className="max-w-[260px] -rotate-2 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground shadow-xl ring-1 ring-border">
            <p className="truncate text-sm font-medium">
              {person.firstName} {person.lastName}
            </p>
            {person.email && (
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {person.email}
              </p>
            )}
          </div>,
          state.container
        )}
    </>
  );
}
