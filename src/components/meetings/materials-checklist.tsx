"use client";

import { useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleChecklistItemAction } from "@/app/(dashboard)/meetings/actions";
import type { MeetingChecklistItem } from "@/db/schema";
import {
  MaterialsChecklistView,
  type MaterialsChecklistItemView,
} from "./materials-checklist-view";

interface MaterialsChecklistProps {
  items: MeetingChecklistItem[];
  summary: { total: number; checked: number };
}

/**
 * The interactive host: it owns the toggle transition and nothing else. All the
 * markup lives in `MaterialsChecklistView`, which this component feeds an
 * interactive checkbox through the row-control slot.
 */
export function MaterialsChecklist({
  items,
  summary,
}: MaterialsChecklistProps) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = (itemId: string, currentlyChecked: boolean) => {
    startTransition(async () => {
      await toggleChecklistItemAction(itemId, !currentlyChecked);
    });
  };

  const renderControl = (item: MaterialsChecklistItemView) => (
    <Checkbox
      id={item.id}
      checked={item.isChecked}
      onCheckedChange={() => handleToggle(item.id, item.isChecked)}
      disabled={isPending}
      className="cursor-pointer"
    />
  );

  return (
    <MaterialsChecklistView
      items={items}
      summary={summary}
      renderControl={renderControl}
    />
  );
}
