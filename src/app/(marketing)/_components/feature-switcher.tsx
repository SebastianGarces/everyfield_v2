"use client";

import { useState } from "react";

import type { Embeds } from "./embeds";
import { Shot, ShotOverlay, type ShotSource } from "./shot";
import { useInView } from "./use-in-view";
import { usePrefetchShots } from "./use-prefetch-shots";
import { useTablistKeys } from "./use-tablist-keys";

type Overlay = ShotSource & { alt: string; style: React.CSSProperties };

type Feature = {
  key: string;
  title: string;
  description: string;
  art: string;
  /** A panel is either a crop or a live embed (see embeds.ts) — the crop
   *  fields are absent on the panels that became the app's own surfaces. */
  desktop?: ShotSource;
  mobile?: ShotSource;
  alt?: string;
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
    // live: PeoplePipeline — the person cards AND the Core Group stat card
    // that used to be the sec-core-61 overlay (page.tsx builds them)
    anchor: "start",
  },
  {
    key: "meetings",
    title: "Meetings",
    description:
      "Vision meetings, orientations, team nights — planned, run, and followed up, with attendance feeding your momentum picture.",
    art: "/marketing/meetings.webp",
    // live: MeetingsBoard — the app's own meeting cards, both compositions
    anchor: "end",
  },
  {
    key: "tasks",
    title: "Tasks",
    description:
      "Every follow-up tracked to done — and meeting attendance creates the follow-up tasks for you, automatically.",
    art: "/marketing/teams-tasks.webp",
    // live: TaskFollowups — the task rows AND the meeting card that created
    // them, which used to be the r5-meetcards overlay
    anchor: "start",
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
    alt: "The Team Health Dashboard — staffing, training, and attendance compared across all eleven ministry teams.",
    // the primary stays a capture: the health dashboard is client-only for its
    // recharts radar (~100kB gz) and this page ships none of it. Live instead:
    // FsTeamsOverlay / FsTeamsMobile, the app's real ministry-team tiles.
    anchor: "end",
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
    alt: "The Launch Day Guide chapter, open in the wiki with the whole journey outlined beside it.",
    // the article crop stays — prose is the one thing a screenshot renders
    // perfectly. Live instead: FsWikiProgressOverlay / FsWikiProgressMobile.
    anchor: "start",
  },
  {
    key: "guides",
    title: "Guides & documents",
    description:
      "Help where you need it — the interview guide opens beside the interview, and print-ready documents come filled in with your church's details.",
    art: "/marketing/c1-field.webp",
    desktop: {
      src: "/marketing/shots/r8-personguide.webp",
      width: 2880,
      height: 1800,
    },
    mobile: {
      src: "/marketing/shots/r8-guide.webp",
      width: 1036,
      height: 1740,
    },
    alt: "Hannah Carr's profile with the Interview Guide open beside it — her interview came back Qualified on all five criteria, and The 5 Interview Criteria is open right where the interview happens.",
    anchor: "start",
    flush: true,
    // the profile crop stays; the document card floating on it is live
    // (DocCardOverlay), where the r8-doccard capture used to sit
  },
] as const;

const PREFETCH = FEATURES.flatMap((f) => [
  ...(f.desktop ? [f.desktop.src] : []),
  ...(f.overlays?.map((o) => o.src) ?? []),
  f.art,
]);

const KEYS = FEATURES.map((f) => f.key);
const tabId = (key: string) => `fs-tab-${key}`;
const panelId = (key: string) => `fs-panel-${key}`;

export function FeatureSwitcher({ embeds = {} }: { embeds?: Embeds }) {
  const [active, setActive] = useState<string>(FEATURES[0].key);
  const activeFeature = FEATURES.find((f) => f.key === active) ?? FEATURES[0];
  const onTabKeyDown = useTablistKeys(KEYS, setActive);
  usePrefetchShots(PREFETCH);
  // The entrance choreography (primary settles, overlays land after) is pure
  // CSS keyframes: display:none→flex on tab switch restarts them for free.
  // This gate holds the FIRST run until the section is actually on screen —
  // without it the load-time animation finishes before anyone scrolls here.
  const { ref: switchRef, inView: seen } = useInView<HTMLDivElement>(0.18);

  return (
    <>
      {/* Desktop: tab strip on top, the full-width panel below */}
      <div ref={switchRef} className={seen ? "fswitch fs-seen" : "fswitch"}>
        <div
          className="fswitch-tabs"
          role="tablist"
          aria-label="Features"
          onKeyDown={onTabKeyDown}
        >
          {FEATURES.map((feature) => (
            <button
              key={feature.key}
              type="button"
              role="tab"
              id={tabId(feature.key)}
              aria-controls={panelId(feature.key)}
              aria-selected={feature.key === active}
              tabIndex={feature.key === active ? 0 : -1}
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
        {/* keyed so each activation remounts it and replays its entrance */}
        <p className="fs-desc" key={activeFeature.key}>
          {activeFeature.description}
        </p>
        {FEATURES.map((feature) => (
          <div
            key={feature.key}
            id={panelId(feature.key)}
            role="tabpanel"
            aria-labelledby={tabId(feature.key)}
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
            {/* a live embed replaces the crop outright; otherwise the crop.
                mobile source: this pane is hidden under 900px, but Chromium
                still fetches lazy images in hidden subtrees — resolve them to
                the (already downloaded) mobile crop instead of the desktop one */}
            {embeds[feature.key]?.visual ??
              (feature.desktop ? (
                <Shot
                  desktop={feature.desktop}
                  mobile={feature.mobile}
                  alt={feature.alt ?? ""}
                />
              ) : null)}
            {feature.overlays?.map((overlay, i) => (
              <ShotOverlay
                key={overlay.src}
                overlay={{
                  ...overlay,
                  style: {
                    ...overlay.style,
                    "--ov-i": i,
                  } as React.CSSProperties,
                }}
              />
            ))}
            {embeds[feature.key]?.overlay}
          </div>
        ))}
      </div>

      {/* Mobile: stacked story sections — visual first, nothing behind taps */}
      <div className="fswitch-stack">
        {FEATURES.map((feature) => {
          const crop = feature.mobile ?? feature.desktop;
          return (
            <article key={feature.key} className="fstack-item">
              <div
                className="fstack-shot"
                style={{ backgroundImage: `url("${feature.art}")` }}
              >
                {embeds[feature.key]?.mobile ??
                  (crop ? (
                    <Shot desktop={crop} alt={feature.alt ?? ""} />
                  ) : null)}
              </div>
              <h3 className="lp-h3">{feature.title}</h3>
              <p className="fstack-d">{feature.description}</p>
            </article>
          );
        })}
      </div>
    </>
  );
}
