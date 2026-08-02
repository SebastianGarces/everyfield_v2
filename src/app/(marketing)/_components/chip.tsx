"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

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
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={style}
      className={["chip", className, shown ? "chip-in" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="chip-sq" aria-hidden="true" />
      {children}
    </div>
  );
}
