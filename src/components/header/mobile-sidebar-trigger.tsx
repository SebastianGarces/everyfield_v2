"use client";

import { useEffect, useRef } from "react";

import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

/**
 * The mobile trigger that lives outside the sidebar Sheet.
 *
 * The shadcn trigger toggles context state rather than acting as the Sheet's
 * Radix trigger, so Radix cannot return focus to it after Escape. Remembering
 * that this control opened the Sheet lets the shell restore focus without
 * changing the shared shadcn primitive or the sidebar's state ownership.
 */
export function MobileSidebarTrigger() {
  const { isMobile, openMobile } = useSidebar();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedFromTrigger = useRef(false);
  const wasOpen = useRef(openMobile);

  useEffect(() => {
    const sheetClosed = wasOpen.current && !openMobile;
    wasOpen.current = openMobile;

    if (!isMobile || !sheetClosed || !openedFromTrigger.current) return;

    openedFromTrigger.current = false;
    let frame = 0;

    // SheetContent remains mounted while its exit animation runs. Wait until
    // Radix has removed that focus scope, otherwise its final close cleanup can
    // overwrite our focus move and leave the document body active again.
    const restoreAfterSheetUnmounts = () => {
      if (
        document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]')
      ) {
        frame = window.requestAnimationFrame(restoreAfterSheetUnmounts);
        return;
      }

      triggerRef.current?.focus();
    };

    frame = window.requestAnimationFrame(restoreAfterSheetUnmounts);

    return () => window.cancelAnimationFrame(frame);
  }, [isMobile, openMobile]);

  return (
    <SidebarTrigger
      ref={triggerRef}
      aria-label="Toggle sidebar"
      className="text-app-bar-foreground hover:text-app-bar-foreground hover:bg-white/10 focus-visible:ring-white/70 md:hidden"
      onClick={() => {
        if (isMobile && !openMobile) openedFromTrigger.current = true;
      }}
    />
  );
}
