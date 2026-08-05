"use client";

import { useState } from "react";

import { Chip } from "./chip";
import type { Embed, Embeds } from "./embeds";
import { Shot, ShotOverlay, type ShotSource } from "./shot";
import { useInView } from "./use-in-view";
import { usePrefetchShots } from "./use-prefetch-shots";
import { useTablistKeys } from "./use-tablist-keys";
import { RunSheet } from "./vignettes/run-sheet";
import { WeeklyTicker } from "./vignettes/weekly-ticker";

type Overlay = ShotSource & { alt: string; style: React.CSSProperties };

type Phase = {
  key: string;
  tab: string;
  title: string;
  description: string;
  points: readonly string[];
  /** A panel is either a crop or a live embed (see embeds.ts) — the crop
   *  fields are absent on the panels that became the app's own surfaces. */
  desktop?: ShotSource;
  mobile?: ShotSource;
  alt?: string;
  /** Horizontal anchor of the primary crop inside the panel. */
  anchor?: "start" | "end";
  overlay?: Overlay;
  /**
   * A drawn-live moment card floated over the crop, desktop only. A phase that
   * has one does not also get a desktop chip — the vignette carries the claim
   * (one claim per visual). Positioned in marketing.css, not here.
   */
  vignette?: React.ReactNode;
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
    // live: CoreGroupPipeline. The meeting card is inside the embed rather
    // than in `overlay` — the primary is a zoomed live mount whose width
    // changes per band, so a percentage inset would drift onto a status badge.
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
    // live: LaunchTeamCommitted — PeopleList itself, which prints the
    // "Showing 12 of 61 people" line that used to be the panel's claim
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
    // live: TeamTraining — the matrix AND the team tile floating beside it are
    // both the app's own components now, so the tile is inside the embed
    anchor: "end",
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
    // live: LaunchPrepChecklist. This panel was a capture WITH a drawn
    // checklist card over it, and both were pictures of the same surface — so
    // both are now the surface itself, and the hand-drawn vignette is gone.
    // No chip either: the app's own progress card says "4/8 ready" at every
    // width, and the chip would be that claim a second time.
    anchor: "start",
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
    // live: LaunchSunday — the meeting page itself. The run sheet stays a
    // marketing vignette (it is a moment, not a surface) and keeps right: 5%,
    // which is why the meeting page now anchors to the start: at every band
    // the mount's trailing edge clears the run sheet's leading edge.
    anchor: "start",
    vignette: <RunSheet />,
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
    // live on desktop only (BeyondDashboard); the mobile journey keeps its
    // crop and its chip. The desktop embed hugs the trailing edge, so the
    // ticker moved to the left of this pane (see .vg-ticker).
    mobile: {
      src: "/marketing/shots/pt-beyond-m.webp",
      width: 945,
      height: 900,
    },
    alt: "Trinity Grove's post-launch dashboard: Sunday Gathering week after week — Week 6 completed with 112 attendees.",
    anchor: "end",
    vignette: <WeeklyTicker />,
    chip: {
      text: "Week 6 · 112 in the room",
      style: { right: "6%", top: "20%" },
      mobileStyle: { right: 22, top: 28, left: "auto" },
    },
  },
] as const;

function PhaseVisual({
  phase,
  embed,
  isMobile,
}: {
  phase: Phase;
  embed?: Embed;
  isMobile?: boolean;
}) {
  const cls = [
    "pshot",
    !isMobile && phase.anchor ? `anchor-${phase.anchor}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  // a live embed replaces the crop outright, per tree — a panel can be live on
  // desktop and still a crop in the mobile journey (Beyond is)
  const live = isMobile ? embed?.mobile : embed?.visual;
  const crop = isMobile ? (phase.mobile ?? phase.desktop) : phase.desktop;
  return (
    <div className={cls}>
      {live ??
        (crop ? (
          <Shot
            desktop={crop}
            mobile={isMobile ? undefined : phase.mobile}
            alt={phase.alt ?? ""}
          />
        ) : null)}
      {!isMobile && phase.overlay ? (
        <ShotOverlay overlay={phase.overlay} />
      ) : null}
      {!isMobile && embed?.overlay ? embed.overlay : null}
      {!isMobile && phase.vignette ? phase.vignette : null}
      {/* the vignette carries the phase's claim on desktop, so the chip stays
          only where there is no vignette — and on mobile, where vignettes and
          overlay images are both hidden. A live embed claims the same way: it
          prints the app's own numbers, so a chip beside it is the claim twice. */}
      {phase.chip && (isMobile || (!phase.vignette && !embed?.visual)) ? (
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

const PREFETCH = PHASES.flatMap((p) => [p.desktop?.src, p.overlay?.src]);

const KEYS = PHASES.map((p) => p.key);
const tabId = (key: string) => `pt-tab-${key}`;
const panelId = (key: string) => `pt-panel-${key}`;

export function PhaseTabs({ embeds = {} }: { embeds?: Embeds }) {
  const [active, setActive] = useState<string>(PHASES[0].key);
  const onTabKeyDown = useTablistKeys(KEYS, setActive);
  usePrefetchShots(PREFETCH);
  // Same entrance choreography as the feature switcher: pure CSS keyframes on
  // the active panel, restarted for free by the display:none→block swap. The
  // gate holds the FIRST run until the section is on screen.
  const { ref: tabsRef, inView: seen } = useInView<HTMLDivElement>(0.18);

  return (
    <>
      {/* Desktop: tabs, one claim + one big visual per phase */}
      <div ref={tabsRef} className={seen ? "ptabs pt-seen" : "ptabs"}>
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
            <PhaseVisual phase={phase} embed={embeds[phase.key]} />
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
            <PhaseVisual phase={phase} embed={embeds[phase.key]} isMobile />
          </article>
        ))}
      </div>
    </>
  );
}
