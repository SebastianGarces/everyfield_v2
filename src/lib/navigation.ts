import type { LucideIcon } from "lucide-react";
import {
  BookOpenText,
  Building2,
  CalendarCheck,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  PiggyBank,
  Users,
  UsersRound,
} from "lucide-react";

export type NavItem = {
  title: string;
  href?: string;
  icon?: LucideIcon;
  items?: NavItem[];
  isDisabled?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const mainNavItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Wiki",
    href: "/wiki",
    icon: BookOpenText,
  },
  {
    title: "People & CRM",
    href: "/people",
    icon: Users,
    isDisabled: true,
  },
  {
    title: "Vision Meetings",
    href: "/vision-meetings",
    icon: CalendarCheck,
    isDisabled: true,
  },
  {
    title: "Tasks",
    href: "/tasks",
    icon: ListChecks,
    isDisabled: true,
  },
  {
    title: "Documents",
    href: "/documents",
    icon: FileText,
    isDisabled: true,
  },
  {
    title: "Financial",
    href: "/financial",
    icon: PiggyBank,
    isDisabled: true,
  },
  {
    title: "Ministry Teams",
    href: "/teams",
    icon: UsersRound,
    isDisabled: true,
  },
  {
    title: "Communication",
    href: "/communication",
    icon: MessageSquare,
    isDisabled: true,
  },
  {
    title: "Facilities",
    href: "/facilities",
    icon: Building2,
    isDisabled: true,
  },
];

export const wikiNavSections: NavSection[] = [
  {
    title: "Home",
    items: [
      { title: "Quick Start", href: "/wiki/quick-start", isDisabled: true },
      {
        title: "What Phase Am I In?",
        href: "/wiki/phase-check",
        isDisabled: true,
      },
      {
        title: "How to Use This Wiki",
        href: "/wiki/how-to-use",
        isDisabled: true,
      },
    ],
  },
  {
    title: "The Journey",
    items: [
      {
        title: "Phase 0: Discovery",
        href: "/wiki/journey/phase-0",
        isDisabled: true,
      },
      {
        title: "Phase 1: Core Group Development",
        href: "/wiki/journey/phase-1",
        isDisabled: true,
        items: [
          {
            title: "Vision Meetings",
            href: "/wiki/journey/phase-1/vision-meetings",
            isDisabled: true,
          },
          {
            title: "Building Your Network",
            href: "/wiki/journey/phase-1/building-network",
            isDisabled: true,
          },
          {
            title: "Follow-Up",
            href: "/wiki/journey/phase-1/follow-up",
            isDisabled: true,
          },
          {
            title: "Formalizing Commitment",
            href: "/wiki/journey/phase-1/commitment",
            isDisabled: true,
          },
          {
            title: "Core Group Assignments",
            href: "/wiki/journey/phase-1/assignments",
            isDisabled: true,
          },
        ],
      },
      {
        title: "Phase 2: Launch Team Formation",
        href: "/wiki/journey/phase-2",
        isDisabled: true,
      },
      {
        title: "Phase 3: Training & Preparation",
        href: "/wiki/journey/phase-3",
        isDisabled: true,
      },
      {
        title: "Phase 4: Pre-Launch",
        href: "/wiki/journey/phase-4",
        isDisabled: true,
      },
      {
        title: "Phase 5: Launch Sunday",
        href: "/wiki/journey/phase-5",
        isDisabled: true,
      },
      {
        title: "Phase 6: Post-Launch",
        href: "/wiki/journey/phase-6",
        isDisabled: true,
      },
    ],
  },
  {
    title: "Ministry Teams",
    items: [
      {
        title: "Overview & Org Chart",
        href: "/wiki/teams/overview",
        isDisabled: true,
      },
      { title: "Team 1", href: "/wiki/teams/team-1", isDisabled: true },
      { title: "Team 2", href: "/wiki/teams/team-2", isDisabled: true },
      { title: "Team 3", href: "/wiki/teams/team-3", isDisabled: true },
      { title: "Team 4", href: "/wiki/teams/team-4", isDisabled: true },
      { title: "Team 5", href: "/wiki/teams/team-5", isDisabled: true },
      { title: "Team 6", href: "/wiki/teams/team-6", isDisabled: true },
      { title: "Team 7", href: "/wiki/teams/team-7", isDisabled: true },
      { title: "Team 8", href: "/wiki/teams/team-8", isDisabled: true },
      { title: "Team 9", href: "/wiki/teams/team-9", isDisabled: true },
      { title: "Team 10", href: "/wiki/teams/team-10", isDisabled: true },
    ],
  },
  {
    title: "Frameworks & Concepts",
    items: [
      { title: "The 4 C's", href: "/wiki/frameworks/4-cs", isDisabled: true },
      {
        title: "8 Critical Success Factors",
        href: "/wiki/frameworks/success-factors",
        isDisabled: true,
      },
      {
        title: "The Ministry Funnel",
        href: "/wiki/frameworks/ministry-funnel",
        isDisabled: true,
      },
      {
        title: "The 4 Pillars",
        href: "/wiki/frameworks/4-pillars",
        isDisabled: true,
      },
      {
        title: "Meeting Objectives",
        href: "/wiki/frameworks/meeting-objectives",
        isDisabled: true,
      },
      {
        title: "The 5 Interview Criteria",
        href: "/wiki/frameworks/interview-criteria",
        isDisabled: true,
      },
    ],
  },
  {
    title: "Administrative",
    items: [
      { title: "Legal Setup", href: "/wiki/admin/legal", isDisabled: true },
      {
        title: "Financial Management",
        href: "/wiki/admin/financial",
        isDisabled: true,
      },
      { title: "Facilities", href: "/wiki/admin/facilities", isDisabled: true },
      { title: "Technology", href: "/wiki/admin/technology", isDisabled: true },
    ],
  },
  {
    title: "Templates & Downloads",
    items: [
      {
        title: "Commitment Documents",
        href: "/wiki/templates/commitments",
        isDisabled: true,
      },
      {
        title: "Vision Meeting Materials",
        href: "/wiki/templates/vision-meetings",
        isDisabled: true,
      },
      {
        title: "Budget Worksheets",
        href: "/wiki/templates/budgets",
        isDisabled: true,
      },
      {
        title: "Checklists by Team",
        href: "/wiki/templates/checklists",
        isDisabled: true,
      },
      {
        title: "Letter Templates",
        href: "/wiki/templates/letters",
        isDisabled: true,
      },
    ],
  },
  {
    title: "Training Library",
    items: [
      {
        title: "Video Content",
        href: "/wiki/training/videos",
        isDisabled: true,
      },
      {
        title: "Case Studies",
        href: "/wiki/training/case-studies",
        isDisabled: true,
      },
      {
        title: "Network Resources",
        href: "/wiki/training/resources",
        isDisabled: true,
      },
    ],
  },
];
