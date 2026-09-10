"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./phase-workspace.css";

const SECTIONS = [
  { id: "focus", label: "Focus" },
  { id: "health", label: "Scorecard" },
  { id: "progress", label: "Progress" },
  { id: "signals", label: "Signals" },
] as const;

type Section = (typeof SECTIONS)[number]["id"];

export function PhaseWorkspace({
  intro,
  care,
  ...sections
}: Record<Section | "intro" | "care", ReactNode>) {
  const careRef = useRef<HTMLElement>(null);
  const [careFits, setCareFits] = useState(false);

  useEffect(() => {
    const card = careRef.current;
    const canvas = card?.closest('[data-slot="page-canvas"]');
    if (!card || !canvas) return;

    // Measure the actual scroll viewport and card, including an open check-in
    // form. A card taller than that viewport stays in normal page flow so its
    // last control remains reachable on short screens and at text zoom.
    const measure = () => {
      const inset = Number.parseFloat(getComputedStyle(card).top);
      setCareFits(
        card.getBoundingClientRect().height + 2 * inset <= canvas.clientHeight
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(canvas);
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <div className="phase-workspace" data-slot="plant-intelligence-content">
      <div className="min-w-0 space-y-6">
        {intro}
        <Tabs defaultValue="focus" className="gap-6">
          <TabsList
            aria-label="Plant Intelligence sections"
            className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto"
          >
            {SECTIONS.map(({ id, label }) => (
              <TabsTrigger key={id} value={id} className="min-h-9">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {SECTIONS.map(({ id }) => (
            <TabsContent
              key={id}
              value={id}
              forceMount
              className="min-w-0 space-y-6 data-[state=inactive]:hidden"
            >
              {sections[id]}
            </TabsContent>
          ))}
        </Tabs>
      </div>
      <aside
        ref={careRef}
        className="phase-care"
        data-fits-viewport={careFits}
        aria-label="Personal check-in"
      >
        {care}
      </aside>
    </div>
  );
}
