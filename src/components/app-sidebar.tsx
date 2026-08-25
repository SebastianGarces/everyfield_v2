"use client";

import { MessageSquare } from "lucide-react";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { NavMain } from "@/components/nav-main";
import { SidebarIdentity } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { AssociationOrgType } from "@/db/schema";
import type { AssignedPlant } from "@/lib/coaching/assignments";
import {
  assignedPlantsNavSection,
  isPathWithin,
  mainNavItems,
  networkAdminNavItems,
  resolveActiveNavHref,
  sendingChurchNavItems,
} from "@/lib/navigation";

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: {
    name: string;
    email: string;
    initials: string;
    /**
     * The ROUTE this account's picture is served from, or undefined for an
     * account with none — in which case the initials render (CS-004, #617).
     * Resolved in the layout: the stored key never crosses into a client
     * component, so it never reaches the RSC payload.
     */
    avatarSrc?: string;
  };
  /**
   * The KIND of oversight org this account's tenancy is, or null for a plant
   * seat or a coach — resolved server-side by `oversightOrgOf`.
   *
   * The nav has always keyed off the tenancy rather than the seat, and now says
   * so: an org Member sees the same navigation as its Owner (ruling 185 (3)),
   * so a seat here would be a distinction the nav does not make.
   */
  orgType: AssociationOrgType | null;
  hasChurch: boolean;
  /**
   * The plants this account actively coaches — read server-side from
   * `coach_assignments` (AS-011, #496).
   *
   * A SECOND REACH, NOT A SECOND TENANCY. It is a list rather than a flag
   * because an account may coach several plants, and it sits beside `orgType`
   * rather than inside it because the two are independent: an oversight Owner
   * who also coaches a plant has both, and each is drawn in its own section.
   * Empty for almost everybody, which is why the section is omitted rather than
   * emptied.
   *
   * A PROMISE, NOT A LIST, and required rather than defaulted (#569). The
   * layout starts the read and hands it over unawaited, so the shell paints
   * without waiting on a join that answers nothing for nearly every account;
   * `AssignedPlantsGroup` below unwraps it under its own `<Suspense>`. A
   * default would have to be a promise built during render, which `use()` would
   * treat as a new one on every pass — so the one caller passes it always.
   */
  assignedPlants: Promise<readonly AssignedPlant[]>;
  /** Server-decided: whether the current user is a platform admin. */
  isPlatformAdmin?: boolean;
};

function getNavConfig(orgType: AssociationOrgType | null) {
  switch (orgType) {
    case "sending_church":
      return {
        items: sendingChurchNavItems,
        label: "Management",
      };
    case "network":
      return {
        items: networkAdminNavItems,
        label: "Management",
      };
    default:
      return {
        items: mainNavItems,
        label: "Platform",
      };
  }
}

/**
 * The Assigned plants section, and the only place the coaching read is awaited.
 *
 * It is its own component so that the `use()` suspends HERE — under the
 * boundary its caller wraps it in — rather than suspending the sidebar, which
 * has nothing to do with coaching and is the first thing a planter sees (#569).
 * The rest of the nav, the header and the page are painted while this waits.
 *
 * The promise it is given never rejects (`assignedPlantsSafely`), so there is no
 * error boundary here to pair with the Suspense one: a failed read arrives as an
 * empty list and takes the same branch a planter who coaches nobody takes.
 */
function AssignedPlantsGroup({
  plants,
}: {
  plants: Promise<readonly AssignedPlant[]>;
}) {
  const pathname = usePathname();
  const coaching = assignedPlantsNavSection(React.use(plants));
  const coachingActive = coaching
    ? resolveActiveNavHref(pathname, coaching.items)
    : null;

  return (
    <>
      {/* Rendered only when there is at least one active assignment —
          `assignedPlantsNavSection` returns null otherwise, so the heading and
          the rows appear and disappear together (#496). */}
      {coaching && (
        <SidebarGroup>
          <SidebarGroupLabel>{coaching.title}</SidebarGroupLabel>
          <SidebarMenu>
            {coaching.items.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  isActive={item.href === coachingActive}
                >
                  <Link href={item.href ?? "#"} className="cursor-pointer">
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )}
    </>
  );
}

export function AppSidebar({
  user,
  orgType,
  hasChurch,
  assignedPlants,
  isPlatformAdmin = false,
  ...props
}: AppSidebarProps) {
  const navConfig = getNavConfig(orgType);
  const pathname = usePathname();
  const adminActive = isPathWithin(pathname, "/admin");

  return (
    <Sidebar
      collapsible="icon"
      className="top-10 h-[calc(100svh-2.5rem)]"
      {...props}
    >
      <SidebarContent>
        <NavMain
          items={navConfig.items}
          label={navConfig.label}
          hasChurch={hasChurch}
        />
        {/* Assigned plants, streamed in. The fallback is nothing, not a
            skeleton: the section is absent for almost every account, so a
            placeholder would promise a shelf that is about to vanish. */}
        <React.Suspense fallback={null}>
          <AssignedPlantsGroup plants={assignedPlants} />
        </React.Suspense>
        {/* Admin group is rendered only when the server marks the user as a
            platform admin — invisible to everyone else. */}
        {isPlatformAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Feedback"
                  isActive={adminActive}
                >
                  <Link href="/admin/feedback" className="cursor-pointer">
                    <MessageSquare />
                    <span>Feedback</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-sidebar-border border-t">
        <div className="flex justify-end group-data-[collapsible=icon]:justify-center">
          <SidebarTrigger aria-label="Toggle sidebar" />
        </div>
        <SidebarIdentity user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
