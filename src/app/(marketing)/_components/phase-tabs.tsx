"use client";

import { useState } from "react";

import { Chip } from "./chip";
import { Shot, ShotOverlay, type ShotSource } from "./shot";
import { usePrefetchShots } from "./use-prefetch-shots";
import { useTablistKeys } from "./use-tablist-keys";

type Overlay = ShotSource & { alt: string; style: React.CSSProperties };

type Phase = {
  key: string;
  tab: string;
  title: string;
  description: string;
  points: readonly string[];
  desktop: ShotSource;
  mobile?: ShotSource;
  alt: string;
  /** Horizontal anchor of the primary crop inside the panel. */
  anchor?: "start" | "end";
  overlay?: Overlay;
  chip?: {
    text: string;
    style: React.CSSProperties;
    mobileStyle?: React.CSSProperties;
  };
};

const PHASES: readonly Phase[] = [
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
    desktop: {
      src: "/marketing/shots/pt-discovery.webp",
      width: 2180,
      height: 1150,
    },
    mobile: {
      src: "/marketing/shots/pt-discovery-m.webp",
      width: 520,
      height: 760,
    },
    alt: "The wiki chapter 'Is Church Planting Your Calling?' with the Phase 0 reading list and reading progress in the sidebar.",
    anchor: "end",
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
    desktop: {
      src: "/marketing/shots/pt-coregroup.webp",
      width: 1720,
      height: 830,
    },
    mobile: {
      src: "/marketing/shots/pt-coregroup-m.webp",
      width: 575,
      height: 830,
    },
    alt: "People cards moving through the pipeline — J. P. Holloway a new prospect from an event, Grace Lin in follow-up from the website.",
    anchor: "start",
    overlay: {
      src: "/marketing/shots/fs-meetings-m.webp",
      width: 760,
      height: 515,
      alt: "Vision Meeting #5 — in 14 days, ~32 estimated.",
      style: { right: "13%", bottom: "20%", width: "min(26%, 380px)" },
    },
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
    desktop: {
      src: "/marketing/shots/pt-launch-team.webp",
      width: 1760,
      height: 810,
    },
    mobile: {
      src: "/marketing/shots/pt-launch-team-m.webp",
      width: 622,
      height: 810,
    },
    alt: "The People screen filtered to the committed — 61 total, Core Group badges on every card.",
    anchor: "end",
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
    desktop: {
      src: "/marketing/shots/r6-team-training.webp",
      width: 2304,
      height: 1440,
    },
    mobile: {
      src: "/marketing/shots/pt-teams-m.webp",
      width: 578,
      height: 695,
    },
    alt: "The Children's Ministry training matrix — who has completed kids ministry & safety training, member by member.",
    anchor: "end",
    overlay: {
      src: "/marketing/shots/r6-twocards.webp",
      width: 588,
      height: 706,
      alt: "Two ministry team cards — Worship Team and Facilities, staffing bars and open roles.",
      // stands on the painting and overlaps only the app's icon rail — the
      // matrix heading and its column headers stay whole
      style: { left: "12.1%", top: "20%", width: "min(24%, 350px)" },
    },
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
    desktop: {
      src: "/marketing/shots/pt-prelaunch.webp",
      width: 2448,
      height: 1513,
    },
    mobile: {
      src: "/marketing/shots/pt-prelaunch-m.webp",
      width: 912,
      height: 445,
    },
    alt: "The Launch Sunday logistics checklist — preparation progress at 4 of 8 ready, promo cards and signage already struck through.",
    anchor: "start",
    chip: {
      text: "4 of 8 ready — and counting",
      style: { left: "7%", bottom: "16%" },
      mobileStyle: { left: 26, top: 28 },
    },
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
    desktop: {
      src: "/marketing/shots/pt-launch-day.webp",
      width: 2340,
      height: 1200,
    },
    mobile: {
      src: "/marketing/shots/pt-launch-day-m.webp",
      width: 775,
      height: 355,
    },
    alt: "The Launch Sunday meeting page — in 28 days, ~120 estimated, and the run sheet: 7:30 setup crew, 8:15 band call, 9:15 doors, 10:00 service.",
  },
  {
    key: "beyond",
    tab: "Beyond",
    title: "From launch high to healthy rhythm.",
    description:
      "The weeks after launch decide the years after launch — momentum stays visible. Trinity Grove launched six weeks ago; this is the other side.",
    points: [
      "Weekly health dashboard: worship, walk, work.",
      "Graduation: hand off to your long-term ChMS when ready.",
    ],
    desktop: {
      src: "/marketing/shots/pt-beyond.webp",
      width: 2448,
      height: 1513,
    },
    mobile: {
      src: "/marketing/shots/pt-beyond-m.webp",
      width: 945,
      height: 900,
    },
    alt: "Trinity Grove's post-launch dashboard: Sunday Gathering week after week — Week 6 completed with 112 attendees.",
    anchor: "end",
    chip: {
      text: "Week 6 · 112 in the room",
      style: { right: "6%", top: "20%" },
      mobileStyle: { right: 22, top: 28, left: "auto" },
    },
  },
] as const;

function PhaseVisual({
  phase,
  isMobile,
}: {
  phase: Phase;
  isMobile?: boolean;
}) {
  const cls = [
    "pshot",
    !isMobile && phase.anchor ? `anchor-${phase.anchor}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <Shot
        desktop={isMobile ? (phase.mobile ?? phase.desktop) : phase.desktop}
        mobile={isMobile ? undefined : phase.mobile}
        alt={phase.alt}
      />
      {!isMobile && phase.overlay ? (
        <ShotOverlay overlay={phase.overlay} />
      ) : null}
      {phase.chip ? (
        <Chip
          style={
            isMobile
              ? (phase.chip.mobileStyle ?? phase.chip.style)
              : phase.chip.style
          }
        >
          {phase.chip.text}
        </Chip>
      ) : null}
    </div>
  );
}

const PREFETCH = PHASES.flatMap((p) => [p.desktop.src, p.overlay?.src]);

const KEYS = PHASES.map((p) => p.key);
const tabId = (key: string) => `pt-tab-${key}`;
const panelId = (key: string) => `pt-panel-${key}`;

export function PhaseTabs() {
  const [active, setActive] = useState<string>(PHASES[0].key);
  const onTabKeyDown = useTablistKeys(KEYS, setActive);
  usePrefetchShots(PREFETCH);

  return (
    <>
      {/* Desktop: tabs, one claim + one big visual per phase */}
      <div className="ptabs">
        <div
          className="ptabs-strip"
          role="tablist"
          aria-label="Phases"
          onKeyDown={onTabKeyDown}
        >
          {PHASES.map((phase) => (
            <button
              key={phase.key}
              type="button"
              role="tab"
              id={tabId(phase.key)}
              aria-controls={panelId(phase.key)}
              aria-selected={phase.key === active}
              tabIndex={phase.key === active ? 0 : -1}
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
            id={panelId(phase.key)}
            role="tabpanel"
            aria-labelledby={tabId(phase.key)}
            className={phase.key === active ? "ppanel active" : "ppanel"}
          >
            <div className="ppanel-copy">
              <div>
                <h3 className="lp-h3">{phase.title}</h3>
                <p className="pdesc">{phase.description}</p>
              </div>
              <ul>
                {phase.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <PhaseVisual phase={phase} />
          </div>
        ))}
      </div>

      {/* Mobile: the whole journey as a vertical scroll — stops are named,
          never numbered (the phase names are the product's own vocabulary) */}
      <div className="pjourney">
        {PHASES.map((phase) => (
          <article key={phase.key} className="pj-item">
            <p className="marker">{phase.tab}</p>
            <h3 className="lp-h3">{phase.title}</h3>
            <p className="pdesc">{phase.description}</p>
            <PhaseVisual phase={phase} isMobile />
          </article>
        ))}
      </div>
    </>
  );
}
