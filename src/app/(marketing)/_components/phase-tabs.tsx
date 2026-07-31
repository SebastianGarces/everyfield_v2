"use client";

import { useState } from "react";

import { Chip } from "./chip";
import { Shot, type ShotSource } from "./shot";
import { usePrefetchShots } from "./use-prefetch-shots";

type Overlay = ShotSource & { alt: string; style: React.CSSProperties };

type Phase = {
  key: string;
  num: string;
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
  /** Full-bleed beat: the visual escapes the container to ~92vw. */
  bleed?: boolean;
  chip?: {
    text: string;
    style: React.CSSProperties;
    mobileStyle?: React.CSSProperties;
  };
};

const PHASES: readonly Phase[] = [
  {
    key: "discovery",
    num: "0",
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
    num: "1",
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
      style: { left: "38%", bottom: "8%", width: "min(32%, 470px)" },
    },
  },
  {
    key: "launch-team",
    num: "2",
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
    num: "3",
    tab: "Training",
    title: "Every team staffed, every member trained.",
    description:
      "Training readiness across the eight ministry areas, visible at a glance.",
    points: [
      "Ministry team rosters and training completion.",
      "Meeting series for corporate and team-specific training.",
    ],
    desktop: {
      src: "/marketing/shots/pt-teams.webp",
      width: 2295,
      height: 695,
    },
    mobile: {
      src: "/marketing/shots/pt-teams-m.webp",
      width: 578,
      height: 695,
    },
    alt: "Eight ministry team cards with staffing bars and open roles — Senior Pastor through Children's Ministry.",
    anchor: "start",
  },
  {
    key: "pre-launch",
    num: "4",
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
      width: 2365,
      height: 620,
    },
    mobile: {
      src: "/marketing/shots/pt-prelaunch-m.webp",
      width: 912,
      height: 445,
    },
    alt: "The Launch Sunday header — in 28 days, still Planning — over the preparation progress bar at 4 of 8 ready.",
    bleed: true,
    chip: {
      text: "4 of 8 ready — and counting",
      style: { left: "7%", bottom: "6%" },
      mobileStyle: { left: 12, top: -14 },
    },
  },
  {
    key: "launch-sunday",
    num: "5",
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
    num: "6",
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
      width: 2365,
      height: 955,
    },
    mobile: {
      src: "/marketing/shots/pt-beyond-m.webp",
      width: 945,
      height: 900,
    },
    alt: "Trinity Grove's post-launch dashboard: health stats up top, and Sunday Gathering week after week — Week 6 completed with 112 attendees.",
    bleed: true,
    chip: {
      text: "Week 6 · 112 in the room",
      style: { right: "6%", top: "38%" },
      mobileStyle: { right: 8, top: -14, left: "auto" },
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
    phase.bleed && !isMobile ? "bleed" : "",
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
        <img
          className="shot-img shot-overlay"
          src={phase.overlay.src}
          alt={phase.overlay.alt}
          width={phase.overlay.width}
          height={phase.overlay.height}
          loading="lazy"
          style={phase.overlay.style}
        />
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

export function PhaseTabs() {
  const [active, setActive] = useState<string>(PHASES[0].key);
  usePrefetchShots(PREFETCH);

  return (
    <>
      {/* Desktop: tabs, one claim + one big visual per phase */}
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

      {/* Mobile: the whole journey as a numbered vertical scroll */}
      <div className="pjourney">
        {PHASES.map((phase) => (
          <article key={phase.key} className="pj-item">
            <p className="marker">
              Phase {phase.num} · {phase.tab}
            </p>
            <h3 className="lp-h3">{phase.title}</h3>
            <p className="pdesc">{phase.description}</p>
            <PhaseVisual phase={phase} isMobile />
          </article>
        ))}
      </div>
    </>
  );
}
