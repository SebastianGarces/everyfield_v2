"use client";

import { Sprout } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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

export function AppSidebar({ user, hasChurch, ...props }: AppSidebarProps) {
  const navConfig = getNavConfig(user.role);

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
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
