"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PrototypeSwitcher,
  prototypeInitScript,
} from "@/components/prototype-switcher";
import { PhaseSavePreview } from "./save-preview";
import "./phase-layouts.css";

type Section = "focus" | "health" | "progress" | "signals";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "health", label: "Scorecard" },
  { id: "progress", label: "Progress" },
  { id: "signals", label: "Signals" },
];

// One mounted instance of each card keeps drafts and control IDs intact across
// all three CSS layouts. No variant makes a second read or changes a capability.
export function PhaseLayouts({
  focus,
  care,
  health,
  progress,
  signals,
}: Record<Section | "care", ReactNode>) {
  const [section, setSection] = useState<Section>("focus");
  return (
    <PhaseSavePreview value={true}>
      <script
        dangerouslySetInnerHTML={{
          __html: prototypeInitScript("data-phase-proto", "phase-layout-533", [
            "a",
            "b",
            "c",
          ]),
        }}
      />
      <div className="phase-prototypes space-y-6 pb-24" data-section={section}>
        <aside
          aria-label="About these layout previews"
          className="bg-muted rounded-lg p-4 text-sm"
        >
          <p className="font-medium">Compare three layouts</p>
          <p className="text-muted-foreground mt-1">
            Same live data in each. Forms and drill-downs are available; saves
            are paused for this comparison. Drafts survive layout switches but
            clear on reload.
          </p>
          <p className="phase-description-a mt-2">
            A · Sections keeps one subject on screen, with your private check-in
            alongside it.
          </p>
          <p className="phase-description-b mt-2">
            B · Workbench keeps focus and supporting evidence together, with
            ongoing controls in a side column.
          </p>
          <p className="phase-description-c mt-2">
            C · Unfold starts with focus and your check-in. Open supporting
            sections when you need them.
          </p>
        </aside>
        <div
          className="phase-section-nav flex flex-wrap gap-2"
          role="group"
          aria-label="Plant Intelligence sections"
        >
          {SECTIONS.map(({ id, label }) => (
            <Button
              key={id}
              variant={section === id ? "default" : "outline"}
              aria-pressed={section === id}
              aria-controls={`phase-proto-${id}`}
              onClick={() => setSection(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="phase-layout-grid">
          <div className="phase-focus min-w-0" id="phase-proto-focus">
            {focus}
          </div>
          <div className="phase-care min-w-0">{care}</div>
          <SupportingSection id="health" title="Scorecard & trends">
            {health}
          </SupportingSection>
          <SupportingSection id="progress" title="Phase & milestones">
            {progress}
          </SupportingSection>
          <SupportingSection id="signals" title="Self-attestations">
            {signals}
          </SupportingSection>
        </div>
      </div>
      <PrototypeSwitcher
        attribute="data-phase-proto"
        storageKey="phase-layout-533"
        label="Layout"
        options={[
          { id: "a", label: "A", hint: "Sections: one subject at a time" },
          {
            id: "b",
            label: "B",
            hint: "Workbench: focus and a secondary rail",
          },
          {
            id: "c",
            label: "C",
            hint: "Unfold: supporting sections on demand",
          },
        ]}
      />
    </PhaseSavePreview>
  );
}

function SupportingSection({
  id,
  title,
  children,
}: {
  id: Exclude<Section, "focus">;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      className={`phase-${id} min-w-0`}
      id={`phase-proto-${id}`}
      data-expanded={open}
      aria-label={title}
    >
      <Button
        variant="outline"
        className="phase-disclosure mb-3 h-auto w-full justify-between px-4 py-4 text-base"
        aria-expanded={open}
        aria-controls={`phase-proto-${id}-body`}
        onClick={() => setOpen(!open)}
      >
        {title}
        <ChevronDown aria-hidden="true" className={open ? "rotate-180" : ""} />
      </Button>
      <div
        className="phase-section-body space-y-6"
        id={`phase-proto-${id}-body`}
      >
        {children}
      </div>
    </section>
  );
}
