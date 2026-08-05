import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpenText,
  Church,
  MailPlus,
  CalendarCheck,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";

export type NavItem = {
  title: string;
  href?: string;
  icon?: LucideIcon;
  items?: NavItem[];
  isDisabled?: boolean;
  requiresChurch?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

/**
 * A path belongs to an href when it *is* that href or sits under it — the `/`
 * boundary matters, so `/oversight-archive` is not inside `/oversight`.
 */
export function isPathWithin(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The single href a route lights up, resolved longest-match-first.
 *
 * An index route is a prefix of its own siblings (`/oversight` vs
 * `/oversight/health`), so a plain prefix test lights up two items at once.
 * Every caller must go through this so exactly one nav item reads as active.
 */
export function resolveActiveNavHref(
  pathname: string,
  items: NavItem[]
): string | null {
  const hrefs = items.flatMap((item) => [
    ...(item.href ? [item.href] : []),
    ...(item.items ?? []).flatMap((sub) => (sub.href ? [sub.href] : [])),
  ]);

  let active: string | null = null;
  for (const href of hrefs) {
    if (!isPathWithin(pathname, href)) continue;
    if (active === null || href.length > active.length) active = href;
  }
  return active;
}

export const mainNavItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Plant Intelligence",
    href: "/phase",
    icon: Sparkles,
    requiresChurch: true,
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
    requiresChurch: true,
  },
  {
    title: "Meetings",
    href: "/meetings",
    icon: CalendarCheck,
    requiresChurch: true,
  },
  {
    title: "Tasks",
    href: "/tasks",
    icon: ListChecks,
    requiresChurch: true,
  },
  {
    title: "Documents",
    href: "/documents",
    icon: FileText,
    requiresChurch: true,
  },
  // Sprint A: hidden until built - see gap-report-2026-06.md
  // {
  //   title: "Financial",
  //   href: "/financial",
  //   icon: PiggyBank,
  //   isDisabled: true,
  // },
  {
    title: "Ministry Teams",
    href: "/teams",
    icon: UsersRound,
    requiresChurch: true,
  },
  {
    title: "Communication",
    href: "/communication",
    icon: MessageSquare,
    requiresChurch: true,
  },
  // Sprint A: hidden until built - see gap-report-2026-06.md
  // {
  //   title: "Facilities",
  //   href: "/facilities",
  //   icon: Building2,
  //   isDisabled: true,
  // },
];

/**
 * Navigation items shown to sending church admins.
 * These appear instead of the planter-focused mainNavItems.
 *
 * A nav item here MUST have a page under `src/app/(dashboard)/oversight/` —
 * an oversight admin has no other way in, so a link to a route that does not
 * exist is a 404 with no recovery (#260). `navigation.test.ts` asserts the
 * page file exists for every href below; add the item back in the same change
 * that adds its `page.tsx`, not before.
 *
 * "Invitations" came BACK in #23, in the same change that added
 * `/oversight/invitations/page.tsx` — which is the rule above, honoured.
 * "Church Plants" came back the same way in #303 (OV-001/OV-002), with
 * `/oversight/plants/page.tsx` and its `[id]` detail in the same change.
 *
 * Still hidden: "Settings" (/oversight/settings) — and it is not merely
 * unbuilt, it is OUT of alpha by ruling (FRD non-goals; org profile and admin
 * management belong with core team accounts, board #185), so this one does not
 * come back when a page appears.
 */
export const sendingChurchNavItems: NavItem[] = [
  {
    title: "Portfolio",
    href: "/oversight",
    icon: LayoutDashboard,
  },
  {
    title: "Church Plants",
    href: "/oversight/plants",
    icon: Church,
  },
  {
    title: "Plant Health",
    href: "/oversight/health",
    icon: Activity,
  },
  {
    title: "Invitations",
    href: "/oversight/invitations",
    icon: MailPlus,
  },
];

/**
 * Navigation items shown to network admins.
 * These appear instead of the planter-focused mainNavItems.
 *
 * Same rule as `sendingChurchNavItems`: every href needs a real page.
 *
 * "Invitations" came BACK in #23 with its page; "Church Plants" in #303 with
 * `/oversight/plants` and its `[id]` detail.
 *
 * Still hidden until built (#260): "Sending Churches"
 * (/oversight/sending-churches). "Settings" (/oversight/settings) stays hidden
 * permanently for alpha — dropped by ruling, not merely unbuilt (FRD
 * non-goals; board #185).
 */
export const networkAdminNavItems: NavItem[] = [
  {
    title: "Network Overview",
    href: "/oversight",
    icon: LayoutDashboard,
  },
  {
    title: "Church Plants",
    href: "/oversight/plants",
    icon: Church,
  },
  {
    title: "Plant Health",
    href: "/oversight/health",
    icon: Activity,
  },
  {
    title: "Invitations",
    href: "/oversight/invitations",
    icon: MailPlus,
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
