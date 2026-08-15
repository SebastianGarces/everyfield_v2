"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  clearResponseCardAction,
  recordResponseCardAction,
} from "@/app/(dashboard)/meetings/actions";
import {
  responseCardLabel,
  RESPONSE_CARD_OPTIONS,
  RESPONSE_NOT_RECORDED_LABEL,
} from "@/lib/meetings/response-card";
import type { ResponseCardType } from "@/db/schema/meetings";

// ============================================================================
// VM-014 — capture, one attendee at a time, in the attendance workflow.
//
// The planter is standing with a pile of paper cards, going down the same list
// they just ticked people in on. So the control lives in the attendance row and
// nowhere else: a second screen would mean matching names twice.
//
// STATE. `value` is server data and never enters `useState`
// (memory/contracts/data-patterns.md). It arrives as a prop from the server
// component, `useOptimistic` shows the pick instantly, and the server action
// calls `revalidatePath`, which reconciles. There is no `useEffect` and no
// `router.refresh()` here.
//
// THE SENTINEL. Radix's `Select` cannot carry an empty-string item value, so
// "no card recorded" — a real state, and NOT `not_interested` — is the reserved
// token below. It is module-private and never stored: choosing it calls the
// CLEAR action, which deletes the row, and the absence of a row is what the
// breakdown reads as "handed nothing in".
//
// A REFUSED WRITE IS SAID OUT LOUD. Both actions RETURN their failures rather
// than throwing, and neither revalidates on one — so a discarded result means
// the optimistic value shows, the transition ends, `useOptimistic` falls back to
// the unchanged prop, and the picker snaps back with nothing said. On a
// data-entry control that reads as a mis-click, and the planter moves on
// believing the card was recorded. It is reachable, not theoretical: the write's
// attendance guard refuses when the row was removed in another tab. So the
// result is CHECKED on both branches and raised through the root `<Toaster>` —
// a sibling nothing in this subtree can unmount, which is what a message
// accompanying a revalidation requires (memory/invariants.md → Client/Server
// Data Synchronization), and the same shape `EmailSuppressionNotice` uses.
// ============================================================================

/** Reserved, never a stored value — the CHECK constraint would refuse it. */
const NOT_RECORDED = "__not_recorded__";

interface ResponsePickerProps {
  meetingId: string;
  personId: string;
  /** The attendee's name, so the control says whose card it takes. */
  personName: string;
  /** The stored response, or null when no card was recorded. */
  value: ResponseCardType | null;
  disabled?: boolean;
}

export function ResponsePicker({
  meetingId,
  personId,
  personName,
  value,
  disabled,
}: ResponsePickerProps) {
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(value);

  const handleChange = (next: string) => {
    const parsed = next === NOT_RECORDED ? null : (next as ResponseCardType);

    startTransition(async () => {
      setOptimistic(parsed);

      const result =
        parsed === null
          ? await clearResponseCardAction(meetingId, personId)
          : await recordResponseCardAction(meetingId, {
              personId,
              responseType: parsed,
            });

      // Only the failure is announced: the success is already on screen, and
      // the revalidation the action fired is what makes it permanent.
      if (!result.success) toast.error(result.error);
    });
  };

  return (
    <Select
      value={optimistic ?? NOT_RECORDED}
      onValueChange={handleChange}
      disabled={disabled || isPending}
    >
      {/* The only visible label is the "Response" column header, which does not
          say WHOSE card this is — the same gap issue #159 closed on the
          attendance checkbox. The name goes in the accessible name and stays
          state-free; the trigger already announces its own value. */}
      <SelectTrigger
        size="sm"
        className="w-[11rem] cursor-pointer"
        aria-label={`Response card for ${personName}`}
      >
        {/* The label is rendered explicitly rather than left to `SelectValue`
            to look up: the items live in a portal that does not exist during
            SSR, so a bare `SelectValue` renders an EMPTY trigger on the server
            and fills in only after hydration. A blank control reads as "not
            loaded yet", which is exactly the state this control must never be
            confused with. */}
        <SelectValue>
          {optimistic === null
            ? RESPONSE_NOT_RECORDED_LABEL
            : responseCardLabel(optimistic)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOT_RECORDED} className="cursor-pointer">
          {RESPONSE_NOT_RECORDED_LABEL}
        </SelectItem>
        {RESPONSE_CARD_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="cursor-pointer"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
