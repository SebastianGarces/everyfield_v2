import type { ActivityItem } from "@/lib/dashboard/service";
import {
  AlertCircle,
  CalendarCheck,
  CheckCircle2,
  MessageSquare,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Icon mapping
// ============================================================================

const ACTIVITY_ICONS: Record<
  ActivityItem["type"],
  { icon: typeof UserPlus; color: string }
> = {
  person_created: {
    icon: UserPlus,
    color: "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
  },
  status_changed: {
    icon: Sparkles,
    color: "text-purple-600 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400",
  },
  commitment_recorded: {
    icon: CheckCircle2,
    color: "text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400",
  },
  note_added: {
    icon: MessageSquare,
    color: "text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-400",
  },
  meeting_completed: {
    icon: CalendarCheck,
    color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  task_completed: {
    icon: CheckCircle2,
    color: "text-teal-600 bg-teal-100 dark:bg-teal-900/30 dark:text-teal-400",
  },
};

// ============================================================================
// Helpers
// ============================================================================

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ============================================================================
// Component
// ============================================================================

interface ActivityFeedProps {
  activities: ActivityItem[];
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Recent Activity</h2>
        <div className="mt-6 flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            No activity yet. Start by adding people, scheduling meetings, or
            creating tasks.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Recent Activity</h2>
      <div className="mt-4 space-y-0">
        {activities.map((activity, index) => {
          const config = ACTIVITY_ICONS[activity.type];
          const Icon = config.icon;

          return (
            <div
              key={activity.id}
              className={cn(
                "flex items-start gap-3 py-3",
                index < activities.length - 1 && "border-b"
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  config.color
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{activity.description}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatTimeAgo(activity.timestamp)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
