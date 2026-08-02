"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One-shot scroll trigger: true once the element has crossed `threshold`
 * visibility, then stays true (the observer disconnects). Drives entrance
 * choreography for chips and the feature-switcher vignettes.
 */
export function useInView<T extends HTMLElement>(threshold = 0.5) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return { ref, inView };
}
