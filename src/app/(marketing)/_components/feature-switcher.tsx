"use client";

import { useState } from "react";

import { GivingShot, MeetingsShot, PeopleShot, TeamsShot } from "./app-mocks";

const FEATURES = [
  {
    key: "people",
    title: "People",
    description:
      "Every contact from first conversation to committed core group member — follow-ups, commitments, the 4 C's.",
    art: "/marketing/people.webp",
    shot: <PeopleShot />,
  },
  {
    key: "meetings",
    title: "Meetings",
    description:
      "Vision meetings, orientations, team nights — planned, run, and followed up, with attendance feeding your momentum picture.",
    art: "/marketing/meetings.webp",
    shot: <MeetingsShot />,
  },
  {
    key: "teams",
    title: "Teams & tasks",
    description:
      "Ministry teams staffed and trained; tasks tracked against the road to launch.",
    art: "/marketing/teams-tasks.webp",
    shot: <TeamsShot />,
  },
  {
    key: "giving",
    title: "Giving",
    description:
      "Commitments, trends, and what launch actually costs. Aggregate only — never transactions.",
    art: "/marketing/giving.webp",
    shot: <GivingShot />,
  },
] as const;

export function FeatureSwitcher() {
  const [active, setActive] = useState<(typeof FEATURES)[number]["key"]>(
    FEATURES[0].key
  );
  const activeFeature = FEATURES.find((f) => f.key === active) ?? FEATURES[0];

  return (
    <div className="fswitch">
      <div
        className="fswitch-shot"
        style={{ backgroundImage: `url("${activeFeature.art}")` }}
      >
        {FEATURES.map((feature) => (
          <div
            key={feature.key}
            className={
              feature.key === active ? "shot-view active" : "shot-view"
            }
          >
            {feature.shot}
          </div>
        ))}
      </div>
      <div className="fswitch-list" role="tablist" aria-label="Features">
        {FEATURES.map((feature) => (
          <button
            key={feature.key}
            type="button"
            role="tab"
            aria-selected={feature.key === active}
            className={
              feature.key === active
                ? "fs-item active cursor-pointer"
                : "fs-item cursor-pointer"
            }
            onClick={() => setActive(feature.key)}
          >
            <span className="t">{feature.title}</span>
            <span className="d">{feature.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
