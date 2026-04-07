import { CalendarPlus, ListChecks, UserPlus, Users } from "lucide-react";
import Link from "next/link";

const ACTIONS = [
  {
    label: "Add Person",
    href: "/people/new",
    icon: UserPlus,
    color: "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
  },
  {
    label: "Schedule Meeting",
    href: "/meetings/new",
    icon: CalendarPlus,
    color:
      "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400",
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

export function QuickActions() {
  return (
    <div className="bg-card rounded-xl border p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Quick Actions</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="bg-background hover:border-foreground/15 flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all hover:shadow-sm"
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${action.color}`}
            >
              <action.icon className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium">{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
