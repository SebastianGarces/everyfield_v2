"use client";

import { useEffect } from "react";
import { updateProgress, recordView } from "@/lib/wiki/progress";
import {
  readingPosition,
  resumeScrollTop,
  scheduleReadingRestore,
} from "@/lib/wiki/resume";
import type { WikiProgressStatus } from "@/db/schema";

// History entries survive Back/Forward, while a full reload gets a new document.
const resumeDocumentId = crypto.randomUUID();

interface ProgressTrackerProps {
  slug: string;
  children: React.ReactNode;
  resume?: boolean;
  initialProgress?: {
    status: WikiProgressStatus;
    scrollPosition: number | null;
  };
  completionThreshold?: number;
  debounceMs?: number;
}

export function ProgressTracker({
  slug,
  children,
  resume = false,
  initialProgress,
  completionThreshold = 0.85,
  debounceMs = 1500,
}: ProgressTrackerProps) {
  const initialPosition = readingPosition(initialProgress?.scrollPosition);
  const initiallyCompleted = initialProgress?.status === "completed";

  useEffect(() => {
    void recordView(slug);
    const article = document.querySelector("article");
    if (!article) return;
    let parent = article.parentElement;
    while (
      parent &&
      !["auto", "scroll"].includes(window.getComputedStyle(parent).overflowY)
    )
      parent = parent.parentElement;
    const container = parent ?? document.documentElement;
    const scrollTarget = parent ?? window;
    let userInteracted = false;
    let completed = initiallyCompleted;
    let lastSaved = initialPosition;
    let maxPosition = initialPosition;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;

    // Native fragment targeting handles decoding and malformed hashes. Wait for
    // layout before placing it, just as for saved progress, so a streamed page
    // or reload can find a heading that did not exist at initial navigation.
    const fragment = article.querySelector<HTMLElement>(":target");
    const consumed = window.history.state?.wikiResume;
    const shouldRestore =
      resume &&
      !window.location.hash &&
      !(consumed?.slug === slug && consumed?.document === resumeDocumentId);
    let cancelRestore = () => {};
    const consumeResume = () => {
      window.history.replaceState(
        {
          ...window.history.state,
          wikiResume: { slug, document: resumeDocumentId },
        },
        ""
      );
    };
    if (fragment || shouldRestore) {
      cancelRestore = scheduleReadingRestore(
        [
          document.fonts.ready,
          ...Array.from(article.querySelectorAll("img"), (image) =>
            image.decode()
          ),
        ],
        () => {
          frame = requestAnimationFrame(() => {
            if (userInteracted) return;
            if (fragment) {
              fragment.scrollIntoView({ block: "start" });
            } else {
              consumeResume();
              container.scrollTop = resumeScrollTop(
                initialPosition,
                container.scrollHeight,
                container.clientHeight
              );
            }
          });
        }
      );
    }
    const noteInteraction = () => {
      if (!userInteracted && shouldRestore) consumeResume();
      userInteracted = true;
      cancelRestore();
      cancelAnimationFrame(frame);
    };
    const handleScroll = () => {
      if (!userInteracted || completed) return;
      const height = container.scrollHeight - container.clientHeight;
      if (height <= 50) return;
      const position = Math.max(0, Math.min(container.scrollTop / height, 1));
      maxPosition = Math.max(maxPosition, position);
      clearTimeout(timer);
      if (position >= completionThreshold) {
        completed = true;
        void updateProgress(slug, { status: "completed", scrollPosition: 1 });
      } else if (Math.abs(position - lastSaved) >= 0.1) {
        timer = setTimeout(() => {
          lastSaved = position;
          void updateProgress(slug, { scrollPosition: position });
        }, debounceMs);
      }
    };
    scrollTarget.addEventListener("scroll", handleScroll, { passive: true });
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      container.addEventListener(event, noteInteraction, { passive: true });
    return () => {
      cancelRestore();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      scrollTarget.removeEventListener("scroll", handleScroll);
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
        container.removeEventListener(event, noteInteraction);
      if (userInteracted && !completed && maxPosition > lastSaved)
        void updateProgress(slug, { scrollPosition: maxPosition });
    };
  }, [
    slug,
    resume,
    initialPosition,
    initiallyCompleted,
    completionThreshold,
    debounceMs,
  ]);

  return <>{children}</>;
}
