"use client";

import { useState } from "react";

import {
  ChecklistShot,
  CommitmentsShot,
  HealthShot,
  PipelineShot,
  RunSheetShot,
  TrainingShot,
  WikiShot,
} from "./app-mocks";

const PHASES = [
  {
    key: "discovery",
    tab: "Discovery",
    title: "Discern the calling before you bet the family on it.",
    description:
      "Discovery is for learning and honest self-assessment — EveryField gives you the map before you start walking.",
    points: [
      "The wiki: the whole methodology, readable in order.",
      "Foundations workspace: your 4 Pillars, your vision, written down.",
    ],
    shot: <WikiShot />,
  },
  {
    key: "core-group",
    tab: "Core group",
    title: "Grow a room of committed people, not a list of maybes.",
    description:
      "The core group phase lives in people and vision meetings — EveryField tracks both and shows you the conversion that matters.",
    points: [
      "People pipeline: contact → attended → committed.",
      "Vision meeting attendance, trend over trend.",
    ],
    shot: <PipelineShot />,
  },
  {
    key: "launch-team",
    tab: "Launch team",
    title: "Commitment cards signed. A launch date on the wall.",
    description:
      "The core group becomes a launch team — EveryField tracks commitments and starts the countdown.",
    points: [
      "Commitment tracking against your 50-adult floor.",
      "Launch-date timeline with task templates unlocked.",
    ],
    shot: <CommitmentsShot />,
  },
  {
    key: "training",
    tab: "Training",
    title: "Every team staffed, every member trained.",
    description:
      "Training readiness across the eight ministry areas, visible at a glance.",
    points: [
      "Ministry team rosters and training completion.",
      "Meeting series for corporate and team-specific training.",
    ],
    shot: <TrainingShot />,
  },
  {
    key: "pre-launch",
    tab: "Pre-launch",
    title: "Three weeks out. Nothing left to chance.",
    description:
      "The final integration sprint — dry runs, promotion, and a checklist that ends at zero.",
    points: [
      "Pre-launch checklist counting down to Sunday.",
      "Dry-run meetings with role assignments.",
    ],
    shot: <ChecklistShot />,
  },
  {
    key: "launch-sunday",
    tab: "Launch Sunday",
    title: "One Sunday. Everything you built, public.",
    description: "Day-of execution and honest numbers afterward.",
    points: [
      "Launch-day run sheet by team and hour.",
      "Attendance and follow-up capture, same day.",
    ],
    shot: <RunSheetShot />,
  },
  {
    key: "beyond",
    tab: "Beyond",
    title: "From launch high to healthy rhythm.",
    description:
      "The weeks after launch decide the years after launch — momentum stays visible.",
    points: [
      "Weekly health dashboard: worship, walk, work.",
      "Graduation: hand off to your long-term ChMS when ready.",
    ],
    shot: <HealthShot />,
  },
] as const;

export function PhaseTabs() {
  const [active, setActive] = useState<(typeof PHASES)[number]["key"]>(
    PHASES[0].key
  );

  return (
    <div className="ptabs">
      <div className="ptabs-strip" role="tablist" aria-label="Phases">
        {PHASES.map((phase) => (
          <button
            key={phase.key}
            type="button"
            role="tab"
            aria-selected={phase.key === active}
            className={
              phase.key === active
                ? "ptab active cursor-pointer"
                : "ptab cursor-pointer"
            }
            onClick={() => setActive(phase.key)}
          >
            {phase.tab}
          </button>
        ))}
      </div>
      {PHASES.map((phase) => (
        <div
          key={phase.key}
          className={phase.key === active ? "ppanel active" : "ppanel"}
        >
          <div>
            <h3 className="lp-h3">{phase.title}</h3>
            <p className="pdesc">{phase.description}</p>
            <ul>
              {phase.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
          <div className="pshot">{phase.shot}</div>
        </div>
      ))}
    </div>
  );
}
