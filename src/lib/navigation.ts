import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpenText,
  Building2,
  Church,
  MailPlus,
  CalendarCheck,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Rocket,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";

import type { SeatTenancyType } from "@/lib/auth/tenancy";

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

export type TenancyShell = Readonly<{
  label: "Church Planting" | "Sending Church" | "Sending Network";
  homeHref: "/dashboard" | "/oversight";
}>;

const TENANCY_SHELLS = {
  church: { label: "Church Planting", homeHref: "/dashboard" },
  sending_church: { label: "Sending Church", homeHref: "/oversight" },
  network: { label: "Sending Network", homeHref: "/oversight" },
} as const satisfies Record<SeatTenancyType, TenancyShell>;

/** The account identity and home destination shown by authenticated chrome. */
export function resolveTenancyShell(tenancy: SeatTenancyType): TenancyShell {
  return TENANCY_SHELLS[tenancy];
}

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

/**
 * Navigation items shown to church roles (planter, coach, team member).
 *
 * Every LINKED item here needs a page under `src/app/(dashboard)/` —
 * `navigation.test.ts` reads the App Router tree and fails when an href arrives
 * before its `page.tsx` (#272), the same guard #260 wrote for the oversight
 * lists.
 *
 * This list is the ONE place the guard bends: an unbuilt feature may stay
 * visible as an `isDisabled: true` row, which `nav-main.tsx` renders inert with
 * a COMING SOON label, and the guard passes over it. The oversight lists get no
 * such row — the item is removed until its page lands, because an oversight
 * admin has no other navigation to fall back on.
 */
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
  // LS-004's "nav-level entry". CHURCH-ROLE NAV ONLY, and deliberately absent
  // from both oversight lists: `/launch` is the plant's own surface and answers
  // an oversight admin with a redirect, so offering them the link would be the
  // #260 failure (a nav item that goes nowhere) in a new costume. Oversight
  // reads the same launch date from `/oversight/plants`.
  {
    title: "Launch",
    href: "/launch",
    icon: Rocket,
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
 * "Sending Churches" (/oversight/sending-churches) is absent for a DIFFERENT
 * reason than #260: the page exists as of #303, but it is network-admins-only
 * (OV-009) and refuses this role with `notFound()`. It belongs in
 * `networkAdminNavItems` only, and it stays out of this list even though its
 * page.tsx is now on disk.
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
 * "Invitations" came BACK in #23 with its page; "Church Plants" and "Sending
 * Churches" in #303, each with its own page in the same change
 * (`/oversight/plants` + its `[id]` detail, and `/oversight/sending-churches`).
 *
 * "Sending Churches" is in THIS list and deliberately not in
 * `sendingChurchNavItems` — the roster is network-admins-only (OV-009), and its
 * page answers a sending-church admin with `notFound()`. Offering a link that
 * 404s is the #260 failure in a new costume, so the two halves ship together.
 *
 * Still hidden: "Settings" (/oversight/settings) — permanently for alpha,
 * dropped by ruling rather than merely unbuilt (FRD non-goals; board #185).
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
    title: "Sending Churches",
    href: "/oversight/sending-churches",
    icon: Building2,
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

/**
 * THE COACH'S NAVIGATION, AND THE WHOLE OF IT (AS-011, #496).
 *
 * A coach has no plant of their own, so nothing in `mainNavItems` resolves for
 * them — those pages all read `user.church_id`. What they do have is a list of
 * assignments, and this section IS that list: one row per plant, linking to the
 * only route in the app that names a church in its path.
 *
 * NO SECTION AT ALL WHEN THERE ARE NO ASSIGNMENTS — `null`, not an empty group
 * with a heading. A planter who has never been asked to coach anybody must not
 * carry a permanent empty shelf labelled "Assigned plants", and returning the
 * section rather than the items is what makes "shown" and "omitted" one decision
 * instead of a heading in one file and a list in another.
 *
 * A PURE FUNCTION, so both halves of that decision are testable without
 * rendering: the caller passes what `assignedPlantsFor` read and this returns
 * what the sidebar draws.
 */
export const ASSIGNED_PLANTS_LABEL = "Assigned plants";

export function assignedPlantsNavSection(
  plants: readonly { churchId: string; churchName: string }[]
): NavSection | null {
  if (plants.length === 0) return null;

  return {
    title: ASSIGNED_PLANTS_LABEL,
    items: plants.map((plant) => ({
      title: plant.churchName,
      href: coachedPlantPath(plant.churchId),
      icon: Church,
    })),
  };
}

/**
 * The route an assigned plant opens at. One spelling, shared by the nav and by
 * anything else that has to build it, so a rename is one edit.
 */
export function coachedPlantPath(churchId: string): string {
  return `/coaching/${churchId}`;
}
