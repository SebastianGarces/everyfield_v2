"use client";

import { useInView } from "../use-in-view";

/**
 * The scroll gate, and nothing else.
 *
 * It exists so the vignettes it wraps can stay server-rendered: the gate is
 * the only part that needs the browser, so it takes `children` and never
 * renders them itself. That is what lets the engine vignette hand it the app's
 * real (server-only) scorecard component.
 *
 * Adds `vg-seen` once the card has crossed into view; every animation in
 * marketing.css hangs off that class, and the base styles are already the
 * finished frame, so a gate that never fires is a resolved card.
 */
export function VignetteGate({
  className,
  threshold = 0.35,
  children,
}: {
  className: string;
  threshold?: number;
  children: React.ReactNode;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(threshold);

  return (
    <div ref={ref} className={inView ? `${className} vg-seen` : className}>
      {children}
    </div>
  );
}
