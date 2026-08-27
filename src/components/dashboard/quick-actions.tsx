import { CalendarPlus, ListChecks, UserPlus, Users } from "lucide-react";
import Link from "next/link";

import type { Capability } from "@/lib/auth/seat-rules";

/**
 * The four tiles, and — for the two that CREATE something — the verb the
 * destination's form goes on to invoke (AS-020, #499).
 *
 * `requires` sits on the row rather than beside the render, because the tile
 * and its authority are one fact: a tile added later declares its verb here or
 * it is a read. The two reads name none — `/tasks` and the pipeline are the
 * same screens every seat already reaches.
 */
const ACTIONS: readonly {
  label: string;
  href: string;
  icon: typeof UserPlus;
  color: string;
  requires?: Capability;
}[] = [
  {
    label: "Add Person",
    href: "/people/new",
    icon: UserPlus,
    color: "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
    requires: "people.write",
  },
  {
    label: "Schedule Meeting",
    href: "/meetings/new",
    icon: CalendarPlus,
    color:
      "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400",
    requires: "meetings.write",
  },
  {
    label: "View Tasks",
    href: "/tasks",
    icon: ListChecks,
    color:
      "text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400",
  },
  {
    label: "View Pipeline",
    href: "/people?view=pipeline",
    icon: Users,
    color:
      "text-purple-600 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400",
  },
];

const ACTION_CLASS =
  "bg-background hover:border-foreground/15 flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all hover:shadow-sm";

/**
 * THE TWO MODES THIS COMPONENT HAS, AS A UNION rather than as two independent
 * optional props — so neither caller can be written wrong.
 *
 * - The APP mounts it for a signed-in viewer and must say which create verbs
 *   that viewer holds. Required, so a dashboard cannot forget it and quietly
 *   fail open.
 * - A PRESENTATIONAL EMBED (the marketing page) renders the four actions as
 *   inert markup instead of links, because nothing there may be clickable,
 *   focusable or prefetchable. It has no viewer at all, so it names no
 *   capability and shows the whole tile set — that is a screenshot of the
 *   product, not a grant, and `linkStatic` is what makes every tile a `<span>`.
 */
type QuickActionsProps =
  | { linkStatic: true; capabilities?: never }
  | {
      linkStatic?: false;
      /** The verbs the viewer holds, from `holdsSeatFor` in the page above. */
      capabilities: readonly Capability[];
    };

/**
 * The row's own container-query classes, so a filtered set fills the card
 * instead of leaving the columns a full set would have occupied.
 *
 * `@sm` measures the card's usable content width, not the viewport. Three
 * padded tiles fit at that point; four wait for `@lg`, where their labels have
 * room beside the 40px icons. Two reads carry no `requires`, so the set is
 * never smaller than two.
 */
const COLUMNS: Record<number, string> = {
  2: "",
  3: "@sm:grid-cols-3",
  4: "@sm:grid-cols-3 @lg:grid-cols-4",
};

export function QuickActions(props: QuickActionsProps) {
  // AS-020: a create tile a viewer may not use is ABSENT, never dimmed — a
  // dimmed tile still announces a power somebody else has. The two reads have
  // no `requires` and survive every context.
  const shown = props.linkStatic
    ? ACTIONS
    : ACTIONS.filter(
        (action) =>
          action.requires === undefined ||
          props.capabilities.includes(action.requires)
      );

  return (
    <div className="bg-card @container rounded-xl border p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Quick Actions</h2>
      <div className={`mt-4 grid grid-cols-2 gap-3 ${COLUMNS[shown.length]}`}>
        {shown.map((action) => {
          const body = (
            <>
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full ${action.color}`}
              >
                <action.icon className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium">{action.label}</span>
            </>
          );
          return props.linkStatic ? (
            <span key={action.href} className={ACTION_CLASS}>
              {body}
            </span>
          ) : (
            <Link key={action.href} href={action.href} className={ACTION_CLASS}>
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
