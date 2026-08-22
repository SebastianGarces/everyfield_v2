"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleChecklistItemAction } from "@/app/(dashboard)/meetings/actions";
import { useCan } from "@/components/shared/viewer-capabilities";
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
  // AS-020: ticking an item is `toggleChecklistItemAction` — `meetings.write`.
  const canWrite = useCan("meetings.write");

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
      renderControl={canWrite ? renderControl : readOnlyControl}
    />
  );
}

/**
 * The read-only row marker — the state, drawn, with nothing to press.
 *
 * IT DOES NOT OMIT `renderControl`, and that distinction is the whole of
 * AS-020 on this tab. Omitting it falls back to the view's `defaultControl`,
 * which exists for the MARKETING EMBED and is deliberately "a controlled,
 * handler-less checkbox that looks exactly like the app's" — a Radix
 * `<Checkbox>` renders `<button role="checkbox">`, so a Member would get a
 * focusable, cursor-pointer control that announces itself as a checkbox to a
 * screen reader and does nothing when pressed. That is a disabled button
 * wearing a better costume, and "hidden, not merely disabled" is the
 * requirement.
 *
 * So the read-only render keeps the INFORMATION and drops the CONTROL: the
 * same box in the same place, as an image with a name, out of the tab order and
 * off the list of things a reader is invited to do. The same shape the teams
 * track's responsibility rows use, for the same reason.
 */
function readOnlyControl(item: MaterialsChecklistItemView) {
  return (
    <span
      role="img"
      aria-label={item.isChecked ? "Ready" : "Not ready"}
      className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${
        item.isChecked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input"
      }`}
    >
      {item.isChecked && <Check className="size-3.5" aria-hidden="true" />}
    </span>
  );
}
