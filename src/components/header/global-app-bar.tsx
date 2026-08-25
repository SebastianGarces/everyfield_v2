"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { FeedbackButton } from "@/components/feedback/feedback-button";
import { Mark } from "@/components/logo";
import { NavUser } from "@/components/nav-user";
import type { TenancyShell } from "@/lib/navigation";

import { MobileSidebarTrigger } from "./mobile-sidebar-trigger";

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
      <div
        data-slot="global-app-brand"
        className="flex min-w-0 items-center gap-1 md:w-64 md:shrink-0"
      >
        <MobileSidebarTrigger />
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
