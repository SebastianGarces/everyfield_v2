"use client";

import { cn } from "@/lib/utils";
import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface TeamTabsProps {
  teamId: string;
}

export function TeamTabs({ teamId }: TeamTabsProps) {
  const pathname = usePathname();

  // Derive activeTab from pathname
  let activeTab: string = "members";
  if (pathname.endsWith("/responsibilities")) activeTab = "responsibilities";
  else if (pathname.endsWith("/training")) activeTab = "training";
  else if (pathname.endsWith("/meetings")) activeTab = "meetings";
  const tabs: {
    id: string;
    label: string;
    href: string;
    icon: LucideIcon;
  }[] = [
    {
      id: "members",
      label: "Members & Roles",
      href: `/teams/${teamId}`,
      icon: Users,
    },
    {
      id: "responsibilities",
      label: "Responsibilities",
      href: `/teams/${teamId}/responsibilities`,
      icon: BookOpen,
    },
    {
      id: "training",
      label: "Training",
      href: `/teams/${teamId}/training`,
      icon: GraduationCap,
    },
    {
      id: "meetings",
      label: "Meetings",
      href: `/teams/${teamId}/meetings`,
      icon: CalendarDays,
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
                "flex items-center gap-2 border-b-2 px-1 py-4 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer",
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
