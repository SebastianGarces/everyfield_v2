"use client";

import { MessageSquare, Sprout } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { FeedbackButton } from "@/components/feedback/feedback-button";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { UserRole } from "@/db/schema/user";
import {
  mainNavItems,
  networkAdminNavItems,
  sendingChurchNavItems,
} from "@/lib/navigation";

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: {
    name: string;
    email: string;
    initials: string;
    role: UserRole;
  };
  hasChurch: boolean;
  /** Server-decided: whether the current user is a platform admin. */
  isPlatformAdmin?: boolean;
};

function getNavConfig(role: UserRole) {
  switch (role) {
    case "sending_church_admin":
      return {
        items: sendingChurchNavItems,
        label: "Management",
        subtitle: "Sending Church",
        homeHref: "/oversight",
      };
    case "network_admin":
      return {
        items: networkAdminNavItems,
        label: "Management",
        subtitle: "Network",
        homeHref: "/oversight",
      };
    default:
      return {
        items: mainNavItems,
        label: "Platform",
        subtitle: "Church Planting",
        homeHref: "/dashboard",
      };
  }
}

export function AppSidebar({
  user,
  hasChurch,
  isPlatformAdmin = false,
  ...props
}: AppSidebarProps) {
  const navConfig = getNavConfig(user.role);
  const pathname = usePathname();
  const adminActive = pathname.startsWith("/admin");

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={navConfig.homeHref}>
                <div className="bg-ef text-ef-dark flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Sprout className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">EveryField</span>
                  <span className="truncate text-xs">{navConfig.subtitle}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={navConfig.items}
          label={navConfig.label}
          hasChurch={hasChurch}
        />
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
      <SidebarFooter>
        <FeedbackButton />
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
