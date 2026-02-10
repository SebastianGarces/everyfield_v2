"use client";

import { cn } from "@/lib/utils";
import {
  Activity,
  ClipboardCheck,
  LayoutDashboard,
  MessageSquare,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

interface PersonTabsProps {
  personId: string;
  activeTab: "overview" | "activity" | "assessments" | "teams" | "communication";
}

export function PersonTabs({ personId, activeTab }: PersonTabsProps) {
  const tabs: {
    id: string;
    label: string;
    href: string;
    icon: LucideIcon;
  }[] = [
    {
      id: "overview",
      label: "Overview",
      href: `/people/${personId}`,
      icon: LayoutDashboard,
    },
    {
      id: "activity",
      label: "Activity",
      href: `/people/${personId}/activity`,
      icon: Activity,
    },
    {
      id: "assessments",
      label: "Assessments",
      href: `/people/${personId}/assessments?tab=interviews`,
      icon: ClipboardCheck,
    },
    {
      id: "teams",
      label: "Teams & Training",
      href: `/people/${personId}/teams`,
      icon: Users,
    },
    {
      id: "communication",
      label: "Communication",
      href: `/people/${personId}/communication`,
      icon: MessageSquare,
    },
  ];

  return (
    <div className="border-b">
      <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={cn(
                "flex items-center gap-2 border-b-2 px-1 py-4 text-sm font-medium whitespace-nowrap transition-colors",
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
