"use client";

import Image from "next/image";
import { useState } from "react";

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
    shot: "/marketing/shots/wiki-discovery.webp",
    alt: "A wiki chapter in EveryField titled 'Is Church Planting Your Calling?' with reading progress tracked in the sidebar.",
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
    shot: "/marketing/shots/people-pipeline.webp",
    alt: "The people pipeline board in EveryField: columns for prospect, attendee, following up, and interviewed, each with live counts.",
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
    shot: "/marketing/shots/people-launch-team.webp",
    alt: "The People screen filtered to core group, launch team, and leaders — the committed adults counted against the launch floor.",
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
    shot: "/marketing/shots/teams.webp",
    alt: "The Ministry Teams screen in EveryField: eleven teams with leaders, staffing bars, and open roles at a glance.",
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
    shot: "/marketing/shots/launch-checklist.webp",
    alt: "The Launch Sunday logistics checklist in EveryField: preparation progress at 4 of 8 ready, with materials and setup items ticking down.",
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
    shot: "/marketing/shots/launch-run-sheet.webp",
    alt: "The Launch Sunday meeting in EveryField: date, location, expected attendance, and the run sheet — setup crew, band call, doors, service.",
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
    shot: "/marketing/shots/beyond-health.webp",
    alt: "A post-launch dashboard in EveryField: weekly services completed with attendance above one hundred, week after week.",
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
          <div className="pshot">
            <Image
              className="shot-img"
              src={phase.shot}
              alt={phase.alt}
              width={2880}
              height={1800}
              sizes="(max-width: 900px) 100vw, 520px"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
