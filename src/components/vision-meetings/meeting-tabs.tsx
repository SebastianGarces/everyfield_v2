"use client";

import { cn } from "@/lib/utils";
import {
  BarChart3,
  FileText,
  Package,
  Send,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface MeetingTabsProps {
  meetingId: string;
  meetingStatus: string;
}

type TabDefinition = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
};

export function MeetingTabs({ meetingId, meetingStatus }: MeetingTabsProps) {
  const pathname = usePathname();
  const isCompleted = meetingStatus === "completed";
  const base = `/vision-meetings/${meetingId}`;

  // Build tabs based on meeting status
  const tabs: TabDefinition[] = [
    {
      id: "details",
      label: "Details",
      href: base,
      icon: FileText,
    },
  ];

  if (isCompleted) {
    // Completed meeting tabs
    tabs.push(
      {
        id: "attendance",
        label: "Attendance",
        href: `${base}/attendance`,
        icon: Users,
      },
      {
        id: "evaluation",
        label: "Evaluation",
        href: `${base}/evaluation`,
        icon: Star,
      },
      {
        id: "analytics",
        label: "Analytics",
        href: `${base}/analytics`,
        icon: BarChart3,
      }
    );
  } else {
    // Planning mode tabs
    tabs.push(
      {
        id: "attendance",
        label: "Attendance",
        href: `${base}/attendance`,
        icon: Users,
      },
      {
        id: "invitations",
        label: "Invitations",
        href: `${base}/invitations`,
        icon: Send,
      },
      {
        id: "logistics",
        label: "Logistics",
        href: `${base}/logistics`,
        icon: Package,
      }
    );
  }

  return (
    <div className="border-b">
      <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive =
            tab.id === "details"
              ? pathname === base
              : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={cn(
                "flex cursor-pointer items-center gap-2 border-b-2 px-1 py-4 text-sm font-medium whitespace-nowrap transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground border-transparent hover:border-gray-300"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
