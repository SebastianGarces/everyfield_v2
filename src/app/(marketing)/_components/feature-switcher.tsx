"use client";

import { useState } from "react";

import { Shot, ShotOverlay, type ShotSource } from "./shot";
import { usePrefetchShots } from "./use-prefetch-shots";

type Overlay = ShotSource & { alt: string; style: React.CSSProperties };

type Feature = {
  key: string;
  title: string;
  description: string;
  art: string;
  desktop: ShotSource;
  mobile?: ShotSource;
  alt: string;
  /** Horizontal anchor of the primary crop inside the panel. */
  anchor: "start" | "end";
  /** Run the primary flush to the pane's leading edge (no start padding). */
  flush?: boolean;
  /** Layered panels over the primary crop, in stacking order. */
  overlays?: readonly Overlay[];
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
    anchor: "start",
    overlays: [
      {
        src: "/marketing/shots/sec-core-61.webp",
        width: 545,
        height: 302,
        alt: "Core Group stat card: 61 — core group, launch team and leaders.",
        style: { left: "64%", top: "45%", width: "min(26%, 400px)" },
      },
    ],
  },
  {
    key: "meetings",
    title: "Meetings",
    description:
      "Vision meetings, orientations, team nights — planned, run, and followed up, with attendance feeding your momentum picture.",
    art: "/marketing/meetings.webp",
    desktop: {
      src: "/marketing/shots/r7-meetings.webp",
      width: 2368,
      height: 1760,
    },
    mobile: {
      src: "/marketing/shots/fs-meetings-m.webp",
      width: 760,
      height: 515,
    },
    alt: "The Meetings page — vision meetings, orientations, and team nights with status, location, headcount, and countdown.",
    anchor: "end",
  },
  {
    key: "tasks",
    title: "Tasks",
    description:
      "Every follow-up tracked to done — and meeting attendance creates the follow-up tasks for you, automatically.",
    art: "/marketing/teams-tasks.webp",
    desktop: {
      src: "/marketing/shots/r5-tasks.webp",
      width: 2348,
      height: 1194,
    },
    alt: "The Tasks list for Redemption Hill — 13 active, follow-ups with priorities, due dates, and pastoral notes.",
    anchor: "start",
    overlays: [
      {
        src: "/marketing/shots/r5-meetcards.webp",
        width: 1502,
        height: 712,
        alt: "Upcoming meetings — the attendance that creates the follow-up tasks below.",
        style: { right: "3%", top: "58%", width: "min(38%, 560px)" },
      },
    ],
  },
  {
    key: "teams",
    title: "Teams",
    description:
      "Ministry teams staffed and trained — staffing, training, and engagement for every team, on one health dashboard.",
    art: "/marketing/giving.webp",
    desktop: {
      src: "/marketing/shots/r5-teamhealth.webp",
      width: 2880,
      height: 2228,
    },
    mobile: {
      src: "/marketing/shots/r5-teamcards.webp",
      width: 1162,
      height: 1052,
    },
    alt: "The Team Health Dashboard — staffing, training, and attendance compared across all eleven ministry teams.",
    anchor: "end",
    overlays: [
      {
        src: "/marketing/shots/r5-teamcards.webp",
        width: 1162,
        height: 1052,
        alt: "Six ministry team cards — staffing bars, open roles, and status from Senior Pastor to Promotion.",
        style: { left: "26%", top: "30%", width: "min(30%, 460px)" },
      },
    ],
  },
  {
    key: "wiki",
    title: "Wiki",
    description:
      "The whole planting methodology, readable in order — and the app knows which chapter your plant is living in right now.",
    art: "/marketing/c2-field.webp",
    desktop: {
      src: "/marketing/shots/r5-wiki.webp",
      width: 2360,
      height: 1648,
    },
    mobile: {
      src: "/marketing/shots/r5-wikiprog.webp",
      width: 1538,
      height: 1266,
    },
    alt: "The Launch Day Guide chapter, open in the wiki with the whole journey outlined beside it.",
    anchor: "start",
    overlays: [
      {
        src: "/marketing/shots/r5-wikiprog.webp",
        width: 1538,
        height: 1266,
        alt: "My Wiki Progress — overall reading progress and per-phase completion.",
        style: { right: "9%", top: "20%", width: "min(30%, 450px)" },
      },
    ],
  },
  {
    key: "guides",
    title: "Guides & documents",
    description:
      "Help where you need it — the interview guide opens beside the interview, and print-ready documents come filled in with your church's details.",
    art: "/marketing/c1-field.webp",
    desktop: {
      src: "/marketing/shots/r5-personguide.webp",
      width: 2880,
      height: 1800,
    },
    mobile: {
      src: "/marketing/shots/r5-guide.webp",
      width: 1036,
      height: 1740,
    },
    alt: "Jerome Jefferson's profile with the Interview Guide open beside it — The 5 Interview Criteria, right where the interview happens.",
    anchor: "start",
    flush: true,
    overlays: [
      {
        src: "/marketing/shots/r5-documents.webp",
        width: 1916,
        height: 1152,
        alt: "The Documents library — print-ready commitment cards and core-group expectations, generated with church details filled in.",
        style: { right: "3%", top: "14%", width: "min(50%, 740px)" },
      },
    ],
  },
] as const;

const PREFETCH = FEATURES.flatMap((f) => [
  f.desktop.src,
  ...(f.overlays?.map((o) => o.src) ?? []),
  f.art,
]);

export function FeatureSwitcher() {
  const [active, setActive] = useState<string>(FEATURES[0].key);
  const activeFeature = FEATURES.find((f) => f.key === active) ?? FEATURES[0];
  usePrefetchShots(PREFETCH);

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
            className={[
              "fswitch-shot",
              `anchor-${feature.anchor}`,
              feature.flush ? "flush-start" : "",
              feature.key === active ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ backgroundImage: `url("${feature.art}")` }}
          >
            {/* mobile source: this pane is hidden under 900px, but Chromium
                still fetches lazy images in hidden subtrees — resolve them to
                the (already downloaded) mobile crop instead of the desktop one */}
            <Shot
              desktop={feature.desktop}
              mobile={feature.mobile}
              alt={feature.alt}
            />
            {feature.overlays?.map((overlay) => (
              <ShotOverlay key={overlay.src} overlay={overlay} />
            ))}
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
