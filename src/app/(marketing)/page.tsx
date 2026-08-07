import type { Metadata } from "next";

import { FeatureSwitcher } from "./_components/feature-switcher";
import { InviteForm } from "./_components/invite-form";
import { PhaseTabs } from "./_components/phase-tabs";
import { ShotOverlay } from "./_components/shot";
import { BeyondDashboard } from "./_components/vignettes/beyond-dashboard";
import { DocCardOverlay } from "./_components/vignettes/doc-card";
import { EngineFocus } from "./_components/vignettes/engine-focus";
import { EngineScorecard } from "./_components/vignettes/engine-scorecard";
import {
  FsTeamsMobile,
  FsTeamsOverlay,
} from "./_components/vignettes/fs-teams";
import {
  FsWikiProgressMobile,
  FsWikiProgressOverlay,
} from "./_components/vignettes/fs-wiki-progress";
import { HeroDashboard } from "./_components/vignettes/hero-dashboard";
import {
  CoreGroupPipeline,
  LaunchTeamCommitted,
} from "./_components/vignettes/journey-people";
import { LaunchPrepChecklist } from "./_components/vignettes/launch-prep-checklist";
import { LaunchSunday } from "./_components/vignettes/launch-sunday";
import {
  MeetingsBoard,
  MeetingsBoardCompact,
} from "./_components/vignettes/meetings-board";
import { NetworkHealth } from "./_components/vignettes/network-health";
import {
  PeoplePipeline,
  PeoplePipelineCompact,
} from "./_components/vignettes/people-pipeline";
import {
  TaskFollowups,
  TaskFollowupsCompact,
} from "./_components/vignettes/task-followups";
import { TeamTraining } from "./_components/vignettes/team-training";

export const metadata: Metadata = {
  title: "EveryField — Your church plant, understood.",
  description:
    "EveryField puts a proven planting methodology to work on your real progress — the people, meetings, and momentum that get you to launch Sunday — and tells you what deserves your attention this week.",
};

export default function LandingPage() {
  // Every embed below is built HERE, in a server component, and handed to the
  // two switchers as props. They are `"use client"`, and an app component
  // imported across that boundary would ship to the browser — the whole point
  // of these embeds is that they cost no client JavaScript. See _components/
  // embeds.ts.
  //
  // The journey panels each carry their own desktop and phone compositions, so
  // one node serves both trees; the feature switcher renders two independent
  // trees, so those get one node each.
  const coreGroup = <CoreGroupPipeline />;
  const launchTeam = <LaunchTeamCommitted />;
  const training = <TeamTraining />;
  const prelaunch = <LaunchPrepChecklist />;
  const launchSunday = <LaunchSunday />;

  return (
    <>
      <section className="lp-hero">
        <div className="lp-hero-panel">
          <div className="lp-inner">
            <h1 className="lp-hero-h">
              Your&nbsp;church&nbsp;plant, understood.
            </h1>
            <p className="lp-hero-sub">
              EveryField puts a proven planting methodology to work on your real
              progress — the people, meetings, and momentum that get you to{" "}
              <em>launch Sunday</em> — and tells you what deserves your
              attention this week.
            </p>
            <div className="lp-cta-row">
              <a className="btn primary" href="#request-invite">
                Request an invite
              </a>
              <a className="btn ghost" href="#product">
                See how it works
              </a>
            </div>
            <p className="lp-cta-note">
              EveryField is in early access. Invites go out through sending
              networks and churches.
            </p>
            <div className="hero-shot">
              {/* the dashboard itself, not a picture of it — chrome-less, so
                  the LCP candidate is text rather than a 2400px WebP */}
              {/* no chips on the hero — ruled 2026-08-05 (PR #299 decision 1):
                  they obscured the surface they were meant to explain */}
              <HeroDashboard />
            </div>
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-inner">
          <h2 className="lp-h2">
            Planting a church is one of the hardest things you&rsquo;ll ever do.
            Your software shouldn&rsquo;t be one of them.
          </h2>
          <p className="lp-body">
            Most planters run their plant across a CRM built for sales, a
            spreadsheet built for budgets, and a notebook built for nothing in
            particular. None of them know what a vision meeting is. None of them
            know what a healthy core group looks like. EveryField does.
          </p>
        </div>
      </section>

      <section className="lp-sec" id="product">
        <div className="lp-inner">
          <h2 className="lp-h2">One place for the whole work.</h2>
          <FeatureSwitcher
            embeds={{
              people: {
                visual: <PeoplePipeline />,
                mobile: <PeoplePipelineCompact />,
              },
              meetings: {
                visual: <MeetingsBoard />,
                mobile: <MeetingsBoardCompact />,
              },
              tasks: {
                visual: <TaskFollowups />,
                mobile: <TaskFollowupsCompact />,
              },
              // teams and wiki keep their primary crops — a recharts radar and
              // a page of prose — and go live where the claim is
              teams: {
                overlay: <FsTeamsOverlay />,
                mobile: <FsTeamsMobile />,
              },
              wiki: {
                overlay: <FsWikiProgressOverlay />,
                mobile: <FsWikiProgressMobile />,
              },
              guides: { overlay: <DocCardOverlay /> },
            }}
          />
        </div>
      </section>

      <section className="lp-engine on-ink">
        <div className="lp-engine-panel">
          <div className="lp-inner">
            <p className="marker">Plant intelligence</p>
            <h2
              className="lp-h2"
              style={{ marginTop: 16, color: "var(--cream)" }}
            >
              It reads where you actually are. Not where a checklist says you
              should be.
            </h2>
            <p className="lp-body">
              Every week, EveryField looks at your plant&rsquo;s real activity —
              who&rsquo;s committing, how meetings are trending, where momentum
              is building or stalling — and weighs it against a methodology that
              has launched healthy churches for years. You get a short list of
              what matters most right now.
            </p>
            <div className="engine-panes">
              <div
                className="epane"
                style={{ backgroundImage: 'url("/marketing/c1-field.webp")' }}
              >
                {/* drawn live rather than screenshotted: the tiles resolve
                    from neutral into their verdicts, which is the one thing a
                    still of this page could never show */}
                <EngineScorecard />
              </div>
              <div
                className="epane epane-focus"
                style={{ backgroundImage: 'url("/marketing/c2-field.webp")' }}
              >
                {/* the app's own focus panel, live, off the same 2026-07-31
                    assessment the pane beside it grades — one plant, one day,
                    two readings of it */}
                <EngineFocus />
                <ShotOverlay
                  overlay={{
                    src: "/marketing/shots/r5-phasectl.webp",
                    width: 702,
                    height: 886,
                    alt: "Phase control — you decide when to move phases; readiness is advisory and never blocks a change.",
                    // the retired capture was a page region with an empty left
                    // gutter, and .epane-bleed shoved it right so the card
                    // could land in it. A live panel is just the card, so the
                    // pane right-aligns the mount instead (.epane-focus) and
                    // the overlay is trimmed to the gutter that opens.
                    style: { left: "1%", top: "26%", width: "min(24%, 240px)" },
                  }}
                />
              </div>
            </div>
            <ul className="engine-list">
              <li>
                Guidance grounded in a proven launch methodology, not generic
                productivity advice.
              </li>
              <li>
                A weekly read on health: people, meetings, giving, momentum.
              </li>
              <li>
                Advisory, never a gate. You advance when you&rsquo;re ready.
              </li>
            </ul>
            <p className="engine-pull">
              You stay the shepherd; <em>it keeps watch.</em>
            </p>
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-inner">
          <h2 className="lp-h2">From calling to launch Sunday.</h2>
          <p className="lp-body" style={{ marginBottom: 32 }}>
            A proven path under the whole journey — and at every stop, the app
            knows what the work is. Pick a phase.
          </p>
          <PhaseTabs
            embeds={{
              "core-group": { visual: coreGroup, mobile: coreGroup },
              "launch-team": { visual: launchTeam, mobile: launchTeam },
              training: { visual: training, mobile: training },
              "pre-launch": { visual: prelaunch, mobile: prelaunch },
              "launch-sunday": { visual: launchSunday, mobile: launchSunday },
              // desktop only: the mobile journey keeps pt-beyond-m.webp and
              // the chip that goes with it (one claim per visual)
              beyond: { visual: <BeyondDashboard /> },
            }}
          />
        </div>
      </section>

      <section className="lp-sec" id="networks">
        <div className="lp-inner">
          <p className="marker">For sending churches &amp; networks</p>
          <h2 className="lp-h2" style={{ marginTop: 16 }}>
            Send them with more than a prayer.
          </h2>
          <p className="lp-body">
            Whether you send one plant every few years or a hundred a year, you
            see the same thing: portfolio health at a glance — plants on track,
            plants that need attention, and where your coaching hours will
            matter most. Planters control what they share; you see health, not
            their people&rsquo;s private records.
          </p>
          <div className="netshot">
            {/* PlantHealthPortfolio renders its own heading and description,
                so nothing is reconstructed around it */}
            <NetworkHealth />
          </div>
          <div className="stats">
            <div className="stat-cell lead">
              <p className="n">86–90%</p>
              <p className="lbl">
                of plants with real assessment, training, and coaching are still
                going four to five years in.
              </p>
            </div>
            <div className="stat-cell base">
              <p className="n">68%</p>
              <p className="lbl">
                of plants overall make it that far. Support is the difference —
                EveryField is how you give it consistently.
              </p>
            </div>
          </div>
          <p className="stats-src">
            86–90%: Evangelical Covenant Church (86% at four years, for plants
            with training and coaching) and ARC (90% at five years, in network).
            68%: Lifeway Research and Leadership Network, State of church
            planting USA (four-year survival, all plants).
          </p>
        </div>
      </section>

      <section className="lp-cta" id="request-invite">
        <div className="lp-cta-panel">
          <div className="lp-inner">
            <h2 className="lp-h2">Plant with clear eyes.</h2>
            <p className="lp-body">
              EveryField is in early access with a small cohort of planters and
              their sending networks. If that&rsquo;s you, we&rsquo;d love to
              talk.
            </p>
            <InviteForm />
          </div>
        </div>
      </section>
    </>
  );
}
