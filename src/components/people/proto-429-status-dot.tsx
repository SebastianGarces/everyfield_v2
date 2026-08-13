import { PROTO_429_DOT_CLASSES } from "@/lib/people/status-colors.proto429";
import type { PersonStatus } from "@/lib/people/types";
import { cn } from "@/lib/utils";

/**
 * PROTOTYPE ONLY — never merge. Option C of the #429 ruling: the status colour
 * demoted from the badge's fill to a square mark before the label, so the label
 * itself is always ink on a neutral badge.
 *
 * Present in the DOM for every option and revealed only under `c`, which is
 * what makes the switch instant and the comparison honest. `aria-hidden`
 * because the word beside it already says the status — the dot is redundant by
 * construction, which is also why it owes no contrast floor of its own.
 */
export function Proto429StatusDot({ status }: { status: PersonStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "hidden size-2 shrink-0 rounded-none [[data-proto-429=c]_&]:block",
        PROTO_429_DOT_CLASSES[status]
      )}
    />
  );
}
