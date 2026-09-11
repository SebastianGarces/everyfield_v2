"use client";

import { LogOut, Settings } from "lucide-react";

import { useAuthenticatedNavigationIntent } from "@/components/authenticated-navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/lib/auth/actions";
import { SettingsLink } from "@/components/settings/settings-link";
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
 * The account menu in the global app bar.
 *
 * The trigger is the requested gear; the dropdown keeps the existing identity,
 * Settings hash link and logout action. The avatar falls back to initials when
 * no picture exists or its private object is unavailable.
 */
export function NavUser({ user }: NavUserProps) {
  const recordNavigationIntent = useAuthenticatedNavigationIntent();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Account menu"
          className="text-app-bar-foreground hover:text-app-bar-foreground cursor-pointer hover:bg-white/10 focus-visible:ring-white/70 data-[state=open]:bg-white/10"
        >
          <Settings aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-64 rounded-lg"
        side="bottom"
        align="end"
        sideOffset={4}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage src={user.avatarSrc} alt="" className="rounded-lg" />
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
          <form
            action={logout}
            className="w-full"
            onSubmit={(event) => {
              if (!event.defaultPrevented) recordNavigationIntent("/login");
            }}
          >
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut className="size-4" />
              Log out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The non-interactive account identity anchored at the foot of the sidebar. */
export function SidebarIdentity({ user }: NavUserProps) {
  return (
    <div
      data-slot="sidebar-identity"
      className="flex w-full min-w-0 items-center gap-2 overflow-hidden px-1 py-1 md:px-0"
    >
      <Avatar className="size-8 shrink-0 rounded-lg">
        <AvatarImage src={user.avatarSrc} alt="" className="rounded-lg" />
        <AvatarFallback className="rounded-lg">{user.initials}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">{user.name}</span>
        <span className="text-muted-foreground truncate text-xs">
          {user.email}
        </span>
      </div>
    </div>
  );
}
