import type * as React from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ============================================================================
// ONE BLOCK, ONE DENSITY, ONE HEADING RANK — the settings modal's only
// container (review pass 2026-08-23).
//
// The modal had grown three container treatments and three heading sizes: a
// `Card` with `shadow-sm` in Association, a bare `Card` in Team, and a
// hand-rolled `bg-card space-y-3 rounded-lg border px-4 py-4` in Church,
// Sharing and Notifications. Switching sections changed the radius (12px vs
// 8px), the padding (24px vs 16px) and the elevation, so the same rank of thing
// looked like a different rank of thing depending on which rail item you had
// pressed.
//
// WHY THESE VALUES, and not "whatever `Card` ships":
//
//   * `rounded-lg` because the dialog holding these is `rounded-lg`. `Card`'s
//     own `rounded-xl` made every inner corner LARGER than the outer one, which
//     is concentric radius inverted — the block reads as sitting on top of the
//     dialog rather than inside it.
//   * `p-4` and `gap-3` because the pane is ~540px at a 1280px viewport.
//     `Card`'s 24px padding spends a tenth of that width on air per block.
//   * FLAT. These sit under fixed chrome inside a dialog that already carries
//     `shadow-lg`; a second elevation inside it is elevation about nothing.
//
// The BACKGROUND is `Card`'s and is not restated here. It equals the dialog's
// today, which is why the hand-rolled divs' `bg-card` was a no-op — but it is
// the card token's job to say so, and one place is where that stays true if the
// dialog's own surface ever moves.
// ============================================================================

export function SettingsBlock({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <Card className={cn("gap-3 rounded-lg p-4", className)} {...props} />;
}

/**
 * The one heading rank under the modal's own title.
 *
 * Always an `<h2>`, and never `CardTitle`, which renders a `div` — a modal
 * whose panes are five to seven blocks needs a navigable outline under
 * `DialogTitle`, and Team's cards had none. The `id` is required because every
 * block on this surface is owned by a `<section aria-labelledby>`; making it
 * optional is how a section loses its accessible name without anything failing.
 *
 * `description` is the sentence that belongs to the heading rather than to the
 * content below it, kept in the same component so the two never drift apart in
 * spacing.
 */
export function SettingsHeading({
  id,
  description,
  children,
}: {
  id: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  const heading = (
    <h2 id={id} className="text-lg font-semibold tracking-tight">
      {children}
    </h2>
  );

  if (!description) return heading;

  return (
    <div className="space-y-1">
      {heading}
      <p className="text-muted-foreground text-sm text-pretty">{description}</p>
    </div>
  );
}
