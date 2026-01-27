"use client";

import { useEffect, useRef } from "react";
import { updateProgress, recordView } from "@/lib/wiki/progress";

interface ProgressTrackerProps {
  slug: string;
  children: React.ReactNode;
  /** Scroll percentage threshold to mark as completed (0-1) */
  completionThreshold?: number;
  /** Debounce delay for scroll position updates (ms) */
  debounceMs?: number;
}

/**
 * Wraps article content and tracks reading progress.
 * - Records view on mount (sets to in_progress if not completed)
 * - Tracks scroll position with debouncing
 * - Auto-marks completed when user scrolls past threshold
 */
export function ProgressTracker({
  slug,
  children,
  completionThreshold = 0.85,
  debounceMs = 1500,
}: ProgressTrackerProps) {
  const lastSavedPosition = useRef(0);
  const isCompleted = useRef(false);
  const hasScrolled = useRef(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const maxScrollPosition = useRef(0);

  // Record view on mount
  useEffect(() => {
    recordView(slug);
    
    // Reset refs for new article
    lastSavedPosition.current = 0;
    isCompleted.current = false;
    hasScrolled.current = false;
    maxScrollPosition.current = 0;
  }, [slug]);

  // Scroll tracking
  useEffect(() => {
    // Find the scrollable container - look for overflow-y-auto ancestor
    const findScrollableContainer = (): HTMLElement | Window => {
      let element = document.querySelector('article')?.parentElement;
      while (element) {
        const style = window.getComputedStyle(element);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return element;
        }
        element = element.parentElement;
      }
      return window;
    };

    const scrollContainer = findScrollableContainer();
    const isWindow = scrollContainer === window;

    const calculateScrollProgress = () => {
      let scrollTop: number;
      let scrollHeight: number;
      let clientHeight: number;

      if (isWindow) {
        scrollTop = window.scrollY;
        scrollHeight = document.documentElement.scrollHeight;
        clientHeight = window.innerHeight;
      } else {
        const el = scrollContainer as HTMLElement;
        scrollTop = el.scrollTop;
        scrollHeight = el.scrollHeight;
        clientHeight = el.clientHeight;
      }

      const scrollableHeight = scrollHeight - clientHeight;
      if (scrollableHeight <= 50) return 0;
      return Math.min(scrollTop / scrollableHeight, 1);
    };

    const handleScroll = () => {
      hasScrolled.current = true;
      const position = calculateScrollProgress();
      
      // Track maximum scroll position
      if (position > maxScrollPosition.current) {
        maxScrollPosition.current = position;
      }

      // Already marked complete, skip
      if (isCompleted.current) return;

      // Clear existing timer
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      // Check if we've crossed the completion threshold
      if (position >= completionThreshold) {
        isCompleted.current = true;
        updateProgress(slug, { status: "completed", scrollPosition: 1 });
        return;
      }

      // Debounce intermediate saves
      if (Math.abs(position - lastSavedPosition.current) >= 0.1) {
        debounceTimer.current = setTimeout(() => {
          lastSavedPosition.current = position;
          updateProgress(slug, { scrollPosition: position });
        }, debounceMs);
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      // Save final state on unmount
      if (hasScrolled.current && !isCompleted.current) {
        const finalPosition = maxScrollPosition.current;
        if (finalPosition > 0) {
          if (finalPosition >= completionThreshold) {
            updateProgress(slug, { status: "completed", scrollPosition: 1 });
          } else if (finalPosition > lastSavedPosition.current) {
            updateProgress(slug, { scrollPosition: finalPosition });
          }
        }
      }
    };
  }, [slug, completionThreshold, debounceMs]);

  return <>{children}</>;
}
