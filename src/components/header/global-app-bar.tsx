"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { FeedbackButton } from "@/components/feedback/feedback-button";
import { Mark } from "@/components/logo";
import { NavUser } from "@/components/nav-user";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { TenancyShell } from "@/lib/navigation";

type GlobalAppBarProps = {
  shell: TenancyShell;
  user: {
    name: string;
    email: string;
    initials: string;
    avatarSrc?: string;
  };
  children?: ReactNode;
};

/**
 * Account-wide chrome that stays stable while the page context changes below.
 *
 * The controls live here rather than being visually moved with CSS because the
 * mobile sidebar trigger and Radix menu/dialog triggers need to remain in DOM
 * reading order at the top of the page. Their actions and state stay in the
 * existing components; this component only composes their presentation.
 */
export function GlobalAppBar({ shell, user, children }: GlobalAppBarProps) {
  return (
    <div
      data-slot="global-app-bar"
      className="bg-app-bar text-app-bar-foreground relative z-30 flex h-10 shrink-0 items-center justify-between gap-2 px-2 sm:px-3"
    >
      <div className="flex min-w-0 items-center gap-1">
        <SidebarTrigger className="text-app-bar-foreground hover:text-app-bar-foreground hover:bg-white/10 focus-visible:ring-white/70 md:hidden" />
        <Link
          href={shell.homeHref}
          aria-label={`EveryField — ${shell.label} home`}
          className="focus-visible:ring-app-bar-foreground/80 flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none"
        >
          <Mark className="text-app-bar-logo w-6 shrink-0" />
          <span className="truncate">{shell.label}</span>
        </Link>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <FeedbackButton />
        {children}
        <NavUser user={user} />
      </div>
    </div>
  );
}
