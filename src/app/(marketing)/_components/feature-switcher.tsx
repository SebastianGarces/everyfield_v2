"use client";

import Image from "next/image";
import { useState } from "react";

const FEATURES = [
  {
    key: "people",
    title: "People",
    description:
      "Every contact from first conversation to committed core group member — follow-ups, commitments, the 4 C's.",
    art: "/marketing/people.webp",
    shot: "/marketing/shots/people.webp",
    alt: "The People screen in EveryField: a pipeline of 142 contacts with statuses, sources, and follow-up state on every card.",
  },
  {
    key: "meetings",
    title: "Meetings",
    description:
      "Vision meetings, orientations, team nights — planned, run, and followed up, with attendance feeding your momentum picture.",
    art: "/marketing/meetings.webp",
    shot: "/marketing/shots/meetings.webp",
    alt: "The Meetings screen in EveryField: upcoming vision meetings, an orientation, a worship team night, and Launch Sunday with locations and countdowns.",
  },
  {
    key: "teams",
    title: "Teams & tasks",
    description:
      "Ministry teams staffed and trained; tasks tracked against the road to launch.",
    art: "/marketing/teams-tasks.webp",
    shot: "/marketing/shots/tasks.webp",
    alt: "The Tasks screen in EveryField: this week's follow-ups and launch prep, prioritized, with due dates and pastoral notes.",
  },
  {
    key: "wiki",
    title: "Wiki",
    description:
      "The whole planting methodology, readable in order — and the app knows which chapter your plant is living in right now.",
    art: "/marketing/giving.webp",
    shot: "/marketing/shots/wiki.webp",
    alt: "The Wiki in EveryField: the full launch playbook organized by phase, with a journey tracker showing the plant currently in pre-launch.",
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
            <Image
              className="shot-img"
              src={feature.shot}
              alt={feature.alt}
              width={2880}
              height={1800}
              sizes="(max-width: 900px) 100vw, 560px"
            />
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
