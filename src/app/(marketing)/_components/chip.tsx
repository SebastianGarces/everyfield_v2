"use client";

import { type CSSProperties } from "react";

import { useInView } from "./use-in-view";

/**
 * Floating annotation card that sits ON a product crop and carries its one
 * claim. Reveals when scrolled into view; prefers-reduced-motion gets the
 * final frame via CSS.
 */
export function Chip({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      style={style}
      className={["chip", className, inView ? "chip-in" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="chip-sq" aria-hidden="true" />
      {children}
    </div>
  );
}
