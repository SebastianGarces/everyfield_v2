"use client";

import { validateStatusTransition } from "@/lib/people/status.shared";
import { PersonStatus, PersonWithTags, PipelineData } from "@/lib/people/types";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { reorder } from "@atlaskit/pragmatic-drag-and-drop/reorder";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isCardData } from "./pipeline-card";
import { isColumnData, PipelineColumn } from "./pipeline-column";
import { StatusConfirmationModal } from "./status-confirmation-modal";

// ============================================================================
// Types
// ============================================================================

interface PipelineViewProps {
  data: PipelineData;
  onStatusChange: (
    personId: string,
    newStatus: PersonStatus,
    reason?: string
  ) => Promise<void>;
  onReorder: (orderedPersonIds: string[]) => Promise<void>;
}

interface PendingTransition {
  person: PersonWithTags;
  newStatus: PersonStatus;
}

// ============================================================================
// Post-move flash
// ============================================================================

/**
 * Flash a card element after it has been moved to provide visual feedback.
 * Uses the Web Animations API — no extra dependencies needed.
 */
function triggerPostMoveFlash(personId: string) {
  // Wait a frame so React has flushed the DOM update
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-person-id="${personId}"]`);
    if (el instanceof HTMLElement) {
      el.animate(
        [
          { backgroundColor: "hsl(var(--primary) / 0.15)" },
          { backgroundColor: "transparent" },
        ],
        { duration: 700, easing: "cubic-bezier(0.25, 0.1, 0.25, 1.0)" }
      );
    }
  });
}

// ============================================================================
// Component
// ============================================================================

export function PipelineView({
  data,
  onStatusChange,
  onReorder,
}: PipelineViewProps) {
  const [items, setItems] = useState<Record<string, PersonWithTags[]>>(
    data.people
  );

  // Stable ref so async handlers and callbacks always see the latest state
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Stable refs for callbacks so the monitor effect never re-subscribes
  const onReorderRef = useRef(onReorder);
  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // State for confirmation modal
  const [pendingTransition, setPendingTransition] =
    useState<PendingTransition | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // Sync with server data when it changes
  useEffect(() => {
    queueMicrotask(() => {
      setItems(data.people);
      itemsRef.current = data.people;
    });
  }, [data.people]);

  // ────────────────────────────────────────────────────────────────────────
  // Status transition logic
  // ────────────────────────────────────────────────────────────────────────
  const handleStatusTransition = useCallback(
    async (person: PersonWithTags, destColumnId: string) => {
      const destCol = dataRef.current.columns.find(
        (col) => col.id === destColumnId
      );
      if (!destCol) return;

      const isStatusInColumn = destCol.statuses.includes(person.status);
      if (isStatusInColumn) return;

      const newStatus = destCol.statuses[0];
      const transition = validateStatusTransition(
        person.status,
        newStatus,
        person
      );

      if (transition.requiresConfirmation) {
        setPendingTransition({ person, newStatus });
        setConfirmModalOpen(true);
        return;
      }

      // No confirmation needed — proceed immediately
      try {
        const destIds = itemsRef.current[destColumnId]?.map((p) => p.id) ?? [];
        await onReorderRef.current(destIds);
        await onStatusChangeRef.current(person.id, newStatus);
      } catch (error) {
        console.error("Failed to update status", error);
        toast.error("Failed to update status", {
          description: "Please try again.",
        });
        setItems(dataRef.current.people);
        itemsRef.current = dataRef.current.people;
      }
    },
    []
  );

  // ────────────────────────────────────────────────────────────────────────
  // Reorder within a column
  // ────────────────────────────────────────────────────────────────────────
  const reorderCard = useCallback(
    ({
      columnId,
      startIndex,
      finishIndex,
    }: {
      columnId: string;
      startIndex: number;
      finishIndex: number;
    }) => {
      const current = itemsRef.current;
      const columnItems = current[columnId];
      if (!columnItems) return;

      const reordered = reorder({
        list: columnItems,
        startIndex,
        finishIndex,
      });

      const next = { ...current, [columnId]: reordered };
      setItems(next);
      itemsRef.current = next;

      // Post-move flash
      triggerPostMoveFlash(columnItems[startIndex].id);

      // Persist
      onReorderRef.current(reordered.map((p) => p.id)).catch(console.error);
    },
    []
  );

  // ────────────────────────────────────────────────────────────────────────
  // Move card across columns
  // ────────────────────────────────────────────────────────────────────────
  const moveCard = useCallback(
    ({
      startColumnId,
      finishColumnId,
      itemIndexInStartColumn,
      itemIndexInFinishColumn,
    }: {
      startColumnId: string;
      finishColumnId: string;
      itemIndexInStartColumn: number;
      itemIndexInFinishColumn?: number;
    }) => {
      if (startColumnId === finishColumnId) return;

      const current = itemsRef.current;
      const sourceColumn = current[startColumnId];
      const destColumn = current[finishColumnId];
      if (!sourceColumn || !destColumn) return;

      const person = sourceColumn[itemIndexInStartColumn];
      const destinationItems = Array.from(destColumn);
      const insertIndex = itemIndexInFinishColumn ?? destinationItems.length;
      destinationItems.splice(insertIndex, 0, person);

      const next = {
        ...current,
        [startColumnId]: sourceColumn.filter((p) => p.id !== person.id),
        [finishColumnId]: destinationItems,
      };
      setItems(next);
      itemsRef.current = next;

      // Post-move flash
      triggerPostMoveFlash(person.id);

      // Handle status transition
      handleStatusTransition(person, finishColumnId);
    },
    [handleStatusTransition]
  );

  // ────────────────────────────────────────────────────────────────────────
  // Main drag monitor — subscribes once, never re-creates
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    return monitorForElements({
      canMonitor({ source }) {
        return isCardData(source.data);
      },
      onDrop({ source, location }) {
        const dropTargets = location.current.dropTargets;
        if (dropTargets.length === 0) return;

        // Source info
        const sourceData = source.data;
        if (!isCardData(sourceData)) return;

        const sourceColumnId = sourceData.columnId;
        const current = itemsRef.current;
        const sourceColumnItems = current[sourceColumnId];
        if (!sourceColumnItems) return;

        const itemIndex = sourceColumnItems.findIndex(
          (p) => p.id === sourceData.personId
        );
        if (itemIndex === -1) return;

        // ── Dropped on a column only (1 drop target) ─────────────────
        if (dropTargets.length === 1) {
          const [destColumnRecord] = dropTargets;
          if (!isColumnData(destColumnRecord.data)) return;
          const destColumnId = destColumnRecord.data.columnId;

          if (sourceColumnId === destColumnId) {
            // Same column — reorder to end
            const finishIndex = getReorderDestinationIndex({
              startIndex: itemIndex,
              indexOfTarget: sourceColumnItems.length - 1,
              closestEdgeOfTarget: null,
              axis: "vertical",
            });
            reorderCard({
              columnId: sourceColumnId,
              startIndex: itemIndex,
              finishIndex,
            });
            return;
          }

          // Different column — move to end
          moveCard({
            startColumnId: sourceColumnId,
            finishColumnId: destColumnId,
            itemIndexInStartColumn: itemIndex,
          });
          return;
        }

        // ── Dropped on a card within a column (2 drop targets) ───────
        if (dropTargets.length === 2) {
          const [destCardRecord, destColumnRecord] = dropTargets;
          if (
            !isCardData(destCardRecord.data) ||
            !isColumnData(destColumnRecord.data)
          )
            return;

          const destColumnId = destColumnRecord.data.columnId;
          const destColumnItems = current[destColumnId] ?? [];
          const indexOfTarget = destColumnItems.findIndex(
            (p) => p.id === destCardRecord.data.personId
          );
          const closestEdge: Edge | null = extractClosestEdge(
            destCardRecord.data
          );

          // Same column — reorder
          if (sourceColumnId === destColumnId) {
            const finishIndex = getReorderDestinationIndex({
              startIndex: itemIndex,
              indexOfTarget,
              closestEdgeOfTarget: closestEdge,
              axis: "vertical",
            });
            reorderCard({
              columnId: sourceColumnId,
              startIndex: itemIndex,
              finishIndex,
            });
            return;
          }

          // Cross-column move — relative to the target card
          const destinationIndex =
            closestEdge === "bottom" ? indexOfTarget + 1 : indexOfTarget;

          moveCard({
            startColumnId: sourceColumnId,
            finishColumnId: destColumnId,
            itemIndexInStartColumn: itemIndex,
            itemIndexInFinishColumn: destinationIndex,
          });
        }
      },
    });
  }, [reorderCard, moveCard]);

  // ────────────────────────────────────────────────────────────────────────
  // Confirmation modal handlers
  // ────────────────────────────────────────────────────────────────────────
  const handleConfirm = async (reason?: string) => {
    if (!pendingTransition) return;

    const { person, newStatus } = pendingTransition;

    try {
      const destColumn = dataRef.current.columns.find((col) =>
        col.statuses.includes(newStatus)
      );
      if (destColumn && itemsRef.current[destColumn.id]) {
        const destIds = itemsRef.current[destColumn.id].map((p) => p.id);
        await onReorder(destIds);
      }
      await onStatusChange(person.id, newStatus, reason);
    } catch (error) {
      console.error("Failed to update status", error);
      toast.error("Failed to update status", {
        description: "Please try again.",
      });
      setItems(data.people);
      itemsRef.current = data.people;
    }

    setPendingTransition(null);
    setConfirmModalOpen(false);
  };

  const handleCancel = () => {
    setItems(data.people);
    itemsRef.current = data.people;
    setPendingTransition(null);
    setConfirmModalOpen(false);
  };

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex h-full gap-4 overflow-x-auto p-1 pb-4">
        {data.columns.map((column) => (
          <PipelineColumn
            key={column.id}
            column={column}
            people={items[column.id] || []}
          />
        ))}
      </div>

      {/* Confirmation modal for status changes that require confirmation */}
      {pendingTransition && (
        <StatusConfirmationModal
          person={pendingTransition.person}
          newStatus={pendingTransition.newStatus}
          open={confirmModalOpen}
          onOpenChange={(open) => {
            if (!open) handleCancel();
          }}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}
