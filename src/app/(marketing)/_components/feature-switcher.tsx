"use client";

import { useState } from "react";

import { Shot, type ShotSource } from "./shot";

type Feature = {
  key: string;
  title: string;
  description: string;
  art: string;
  desktop: ShotSource;
  mobile?: ShotSource;
  alt: string;
};

const FEATURES: readonly Feature[] = [
  {
    key: "people",
    title: "People",
    description:
      "Every contact from first conversation to committed core group member — follow-ups, commitments, the 4 C's.",
    art: "/marketing/people.webp",
    desktop: {
      src: "/marketing/shots/fs-people.webp",
      width: 1710,
      height: 828,
    },
    mobile: {
      src: "/marketing/shots/fs-people-m.webp",
      width: 575,
      height: 813,
    },
    alt: "People cards from the Redemption Hill pipeline — Grace Lin following up from the website, contact info and source on every card.",
  },
  {
    key: "meetings",
    title: "Meetings",
    description:
      "Vision meetings, orientations, team nights — planned, run, and followed up, with attendance feeding your momentum picture.",
    art: "/marketing/meetings.webp",
    desktop: {
      src: "/marketing/shots/fs-meetings.webp",
      width: 2295,
      height: 515,
    },
    mobile: {
      src: "/marketing/shots/fs-meetings-m.webp",
      width: 760,
      height: 515,
    },
    alt: "Three upcoming meetings: Worship team night, Orientation #2 at the Riveras' home, and Vision Meeting #5 in 14 days with ~32 estimated.",
  },
  {
    key: "teams",
    title: "Teams & tasks",
    description:
      "Ministry teams staffed and trained; tasks tracked against the road to launch.",
    art: "/marketing/teams-tasks.webp",
    desktop: {
      src: "/marketing/shots/fs-tasks.webp",
      width: 2210,
      height: 640,
    },
    alt: "Follow-up tasks with priorities and pastoral notes — under Sam Torres: 'Plays bass — introduce him to the worship leader.'",
  },
  {
    key: "wiki",
    title: "Wiki",
    description:
      "The whole planting methodology, readable in order — and the app knows which chapter your plant is living in right now.",
    art: "/marketing/giving.webp",
    desktop: {
      src: "/marketing/shots/fs-wiki.webp",
      width: 1595,
      height: 740,
    },
    mobile: {
      src: "/marketing/shots/fs-wiki-m.webp",
      width: 517,
      height: 755,
    },
    alt: "The wiki journey line — currently in Phase 4: Pre-Launch — above the recommended chapter 'The Final 3–4 Weeks'.",
  },
] as const;

export function FeatureSwitcher() {
  const [active, setActive] = useState<string>(FEATURES[0].key);
  const activeFeature = FEATURES.find((f) => f.key === active) ?? FEATURES[0];

  return (
    <>
      {/* Desktop: tab strip on top, the full-width panel below */}
      <div className="fswitch">
        <div className="fswitch-tabs" role="tablist" aria-label="Features">
          {FEATURES.map((feature) => (
            <button
              key={feature.key}
              type="button"
              role="tab"
              aria-selected={feature.key === active}
              className={
                feature.key === active
                  ? "fs-tab active cursor-pointer"
                  : "fs-tab cursor-pointer"
              }
              onClick={() => setActive(feature.key)}
            >
              {feature.title}
            </button>
          ))}
        </div>
        <p className="fs-desc">{activeFeature.description}</p>
        {FEATURES.map((feature) => (
          <div
            key={feature.key}
            className={
              feature.key === active ? "fswitch-shot active" : "fswitch-shot"
            }
            style={{ backgroundImage: `url("${feature.art}")` }}
          >
            <Shot desktop={feature.desktop} alt={feature.alt} />
          </div>
        ))}
      </div>

      {/* Mobile: stacked story sections — visual first, nothing behind taps */}
      <div className="fswitch-stack">
        {FEATURES.map((feature) => (
          <article key={feature.key} className="fstack-item">
            <div
              className="fstack-shot"
              style={{ backgroundImage: `url("${feature.art}")` }}
            >
              <Shot
                desktop={feature.mobile ?? feature.desktop}
                alt={feature.alt}
              />
            </div>
            <h3 className="lp-h3">{feature.title}</h3>
            <p className="fstack-d">{feature.description}</p>
          </article>
        ))}
      </div>
    </>
  );
}
