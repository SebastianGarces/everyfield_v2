"use client";

import { cn } from "@/lib/utils";
import {
  FileText, BarChart3, Users, Star, Package, Send, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MeetingType } from "@/db/schema";

interface MeetingTabsProps {
  meetingId: string;
  meetingType: MeetingType;
  meetingStatus: string;
}

type TabDefinition = { id: string; label: string; href: string; icon: LucideIcon };

export function MeetingTabs({ meetingId, meetingType, meetingStatus }: MeetingTabsProps) {
  const pathname = usePathname();
  const isCompleted = meetingStatus === "completed";
  const isVision = meetingType === "vision_meeting";
  const base = `/meetings/${meetingId}`;

  const tabs: TabDefinition[] = [
    { id: "details", label: "Details", href: base, icon: FileText },
    { id: "attendance", label: "Attendance", href: `${base}/attendance`, icon: Users },
  ];

  // Guest List is available for all meeting types when not completed
  if (!isCompleted) {
    tabs.push(
      { id: "invitations", label: "Guest List", href: `${base}/invitations`, icon: Send },
    );
  }

  // Vision-specific tabs
  if (isVision) {
    if (isCompleted) {
      tabs.push(
        { id: "evaluation", label: "Evaluation", href: `${base}/evaluation`, icon: Star },
        { id: "analytics", label: "Analytics", href: `${base}/analytics`, icon: BarChart3 }
      );
    } else {
      tabs.push(
        { id: "logistics", label: "Logistics", href: `${base}/logistics`, icon: Package }
      );
    }
  }

  return (
    <div className="border-b">
      <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === "details" ? pathname === base : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={cn(
                "cursor-pointer flex items-center gap-2 border-b-2 px-1 py-4 text-sm font-medium whitespace-nowrap transition-colors",
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
