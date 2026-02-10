"use client";

import { ChevronRight, Rocket } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { type NavItem } from "@/lib/navigation";

export function NavMain({
  items,
  label = "Platform",
  hasChurch = true,
}: {
  items: NavItem[];
  label?: string;
  hasChurch?: boolean;
}) {
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const isActive = item.href ? pathname.startsWith(item.href) : false;
          const hasSubItems = item.items && item.items.length > 0;
          const needsChurch = item.requiresChurch && !hasChurch;
          const isEffectivelyDisabled = item.isDisabled || needsChurch;

          const disabledLabel = item.isDisabled
            ? "COMING SOON"
            : needsChurch
              ? "CHURCH REQUIRED"
              : null;

          if (hasSubItems) {
            return (
              <Collapsible
                key={item.title}
                asChild
                defaultOpen={isActive}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={isActive}
                      disabled={isEffectivelyDisabled}
                    >
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                      {disabledLabel && (
                        <span className="text-muted-foreground ml-auto text-[10px] font-medium">
                          {disabledLabel}
                        </span>
                      )}
                      <ChevronRight
                        className={`${isEffectivelyDisabled ? "ml-2" : "ml-auto"} transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90`}
                      />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={
                              subItem.href ? pathname === subItem.href : false
                            }
                          >
                            <Link
                              href={subItem.href || "#"}
                              aria-disabled={subItem.isDisabled}
                              className={
                                subItem.isDisabled
                                  ? "pointer-events-none opacity-50"
                                  : ""
                              }
                            >
                              <span>{subItem.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            );
          }

          // Wrap church-required disabled items in a hover card
          if (needsChurch) {
            return (
              <SidebarMenuItem key={item.title}>
                <HoverCard openDelay={200} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <SidebarMenuButton
                      isActive={false}
                      aria-disabled="true"
                      className="pointer-events-auto cursor-not-allowed opacity-50"
                    >
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="right"
                    sideOffset={8}
                    className="w-72"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Rocket className="text-primary h-4 w-4" />
                        <p className="text-sm font-semibold">
                          Get started with {item.title}
                        </p>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Create your church plant from the dashboard to unlock{" "}
                        {item.title} and all other planting tools.
                      </p>
                      <div className="flex items-center gap-3 text-xs">
                        <Link
                          href="/dashboard"
                          className="text-primary cursor-pointer font-medium hover:underline"
                        >
                          Go to Dashboard
                        </Link>
                        <span className="text-muted-foreground">·</span>
                        <Link
                          href="/wiki"
                          className="text-muted-foreground cursor-pointer hover:underline"
                        >
                          Explore the Wiki
                        </Link>
                      </div>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </SidebarMenuItem>
            );
          }

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={isActive}
                disabled={item.isDisabled}
              >
                <Link
                  href={item.href || "#"}
                  aria-disabled={item.isDisabled}
                  className={
                    item.isDisabled ? "pointer-events-none opacity-50" : ""
                  }
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  {item.isDisabled && (
                    <span className="text-muted-foreground ml-auto text-[10px] font-medium">
                      COMING SOON
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
