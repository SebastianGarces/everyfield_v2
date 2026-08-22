"use client";

import { ChevronsUpDown, LogOut, Settings } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { logout } from "@/lib/auth/actions";
import { SettingsLink } from "@/components/settings/settings-modal";
import { DEFAULT_SETTINGS_SECTION } from "@/lib/settings/sections";

type NavUserProps = {
  user: {
    name: string;
    email: string;
    initials: string;
    /**
     * The route this account's picture is served from, or undefined for an
     * account with none (CS-004, #617).
     *
     * A ROUTE, NOT A KEY. The layout resolves it, so nothing here holds a
     * storage key it could leak into the markup — and the route it names checks
     * the session before it reads a byte.
     */
    avatarSrc?: string;
  };
};

/**
 * The account block at the foot of the sidebar.
 *
 * TWO AVATARS, ONE ACCOUNT: the trigger and the dropdown's own header repeat
 * the same face, name and address, because the dropdown covers the trigger on
 * mobile. Both fall back to initials, which is what an account with no picture
 * shows and what a picture whose object has gone missing shows too — the route
 * answers 404 and Radix keeps the fallback rendered.
 */
export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                {/* Empty alt: the name and the address sit beside it, so a
                    description here would be a third reading of the same fact. */}
                <AvatarImage
                  src={user.avatarSrc}
                  alt=""
                  className="rounded-lg"
                />
                <AvatarFallback className="rounded-lg">
                  {user.initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={user.avatarSrc}
                    alt=""
                    className="rounded-lg"
                  />
                  <AvatarFallback className="rounded-lg">
                    {user.initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user.name}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                {/* A FRAGMENT, NOT A ROUTE (#657): following this is not a
                    navigation at all, so the modal appears over whatever screen
                    the reader is on, that screen is never re-rendered, and
                    Escape takes the one history entry back off again.
                    `SettingsLink` carries the anchor and the reason its click is
                    handled rather than followed.

                    The SECTION is named rather than a bare `#settings`, so the
                    address the reader can copy is the one they are looking at. */}
                <SettingsLink section={DEFAULT_SETTINGS_SECTION}>
                  <Settings />
                  Settings
                </SettingsLink>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action={logout} className="w-full">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2"
                >
                  <LogOut className="size-4" />
                  Log out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
