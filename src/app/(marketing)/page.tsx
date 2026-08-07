import type { Metadata } from "next";

import { FeatureSwitcher } from "./_components/feature-switcher";
import { InviteForm } from "./_components/invite-form";
import { PhaseTabs } from "./_components/phase-tabs";
import { FlowVignette } from "./_components/proto/flow-vignette";
import {
  CH1_ROWS,
  CH2_ROWS,
  D_ROWS,
  JrIndex,
  JrRows,
  JrShot,
  JrStrip,
  JrTriad,
  NETWORK_ROWS,
} from "./_components/proto/journal";
import { Shot, ShotOverlay } from "./_components/shot";
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

// PROTOTYPE — landing story ruling (A · Today / B · Journal / C · Hybrid).
// Every `pv` class below is variant gating from marketing.css's fenced
// prototype block, and comes out with the losing variants once Sebastian has
// ruled. `pv pv-a` is today's page; `pv pv-b pv-c` is the Field Journal copy
// both story variants share. An element with no `pv` class is shared by all
// three — which is how the heavy live embeds stay mounted exactly once.

const WIKI_SHOT = {
  src: "/marketing/shots/r5-wiki.webp",
  width: 2360,
  height: 1648,
};
const WIKI_ALT =
  "The Launch Day Guide chapter, open in the wiki with the whole journey outlined beside it.";

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
            <h1 className="lp-hero-h pv pv-a">
              Your&nbsp;church&nbsp;plant, understood.
            </h1>
            <p className="lp-hero-sub pv pv-a">
              EveryField puts a proven planting methodology to work on your real
              progress — the people, meetings, and momentum that get you to{" "}
              <em>launch Sunday</em> — and tells you what deserves your
              attention this week.
            </p>

            <p className="marker pv pv-b pv-c">For church planters</p>
            <h1 className="lp-hero-h pv pv-b pv-c" style={{ marginTop: 16 }}>
              Every church begins in an open field.
            </h1>
            <p className="lp-hero-sub pv pv-b pv-c">
              EveryField is the one place to learn the way, gather your people,
              and measure what matters — from first calling to launch Sunday,
              guided by a field-tested playbook.
            </p>

            <h1 className="lp-hero-h pv pv-d">
              Everything for your church plant, in one simple place.
            </h1>
            <p className="lp-hero-sub pv pv-d">
              The people you&rsquo;re reaching, the meetings you&rsquo;re
              planning, and what to do next — EveryField keeps it together, so
              Sunday can come without the scramble.
            </p>

            <div className="lp-cta-row">
              <a className="btn primary" href="#request-invite">
                Request an invite
              </a>
              <a className="btn ghost pv pv-a" href="#product">
                See how it works
              </a>
              <a className="btn ghost pv pv-b pv-c" href="#product">
                Read the journey
              </a>
              {/* D carries one CTA and no second ask — neither ghost is
                  gated for it */}
            </div>
            <p className="lp-cta-note pv pv-a pv-b pv-c">
              EveryField is in early access. Invites go out through sending
              networks and churches.
            </p>
            {/* D's hero is text standing on the painting — no product surface
                at all, which is the whole premise of the variant */}
            <div className="hero-shot pv pv-a pv-b pv-c">
              {/* the dashboard itself, not a picture of it — chrome-less, so
                  the LCP candidate is text rather than a 2400px WebP */}
              {/* no chips on the hero — ruled 2026-08-05 (PR #299 decision 1):
                  they obscured the surface they were meant to explain */}
              <HeroDashboard />
            </div>
          </div>
        </div>
      </section>

      <section className="lp-sec pv pv-a">
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

      <section className="jr-strip-sec pv pv-b pv-c">
        <div className="lp-inner">
          <JrStrip />
        </div>
      </section>

      {/* the jump target the nav and both hero ghosts point at. It is its own
          zero-height element rather than an id on the feature-switcher section,
          because that section only exists in variant A. */}
      <div id="product" />

      {/* ---- VARIANT D · Simple ------------------------------------------
          D's whole page body is these three sections plus the hero and CTA
          copy blocks in the shared sections above and below. They sit
          together here rather than scattered through the arc because every
          neighbour is hidden in D anyway, and one contiguous block is what a
          reader needs to judge the variant. Everything else on this page —
          problem statement, strip, chapters, switcher, engine, phase tabs,
          networks, index — is hidden in D. */}

      <section className="lp-sec jr-flow-sec pv pv-d">
        <div className="lp-inner">
          <h2 className="lp-h2">What a week looks like</h2>
          <p className="lp-body">
            From a vision night in a living room to Sunday morning — EveryField
            does its quiet work in the background.
          </p>
          <FlowVignette />
        </div>
      </section>

      <section className="lp-sec pv pv-d">
        <div className="lp-inner">
          {/* no heading: after the week, the three promises ARE the argument */}
          <JrRows rows={D_ROWS} />
        </div>
      </section>

      {/* DRAFT origin story — placeholder built from what we know; Sebastian
          must replace with the true telling before this ever ships */}
      <section className="lp-sec pv pv-d">
        <div className="lp-inner">
          <h2 className="lp-h2">How it started</h2>
          <p className="lp-body">
            EveryField began in 2026, built hand-in-hand with church planters
            and the networks that send them. We watched planters run their
            plants out of spreadsheets, group chats, and memory — and started
            building something better, one real launch at a time.
          </p>
          <p className="lp-body">
            A founding group of plants uses EveryField today, on the road to
            their launch Sundays. What they need next is what we build next.
          </p>
        </div>
      </section>

      <section className="lp-sec jr-chapter pv pv-b pv-c">
        <div className="lp-inner">
          <p className="marker">Chapter I</p>
          <h2 className="lp-h2" style={{ marginTop: 16 }}>
            Know the way before you walk it
          </h2>
          <p className="lp-body">
            The Launch Playbook lives inside EveryField as a 96-article wiki —
            searchable, phase-aware, and linked from everything you do. The
            documents you&rsquo;ll need are already drafted.
          </p>
          <JrShot
            art="/marketing/c2-field.webp"
            mobile={<FsWikiProgressMobile />}
          >
            <Shot desktop={WIKI_SHOT} alt={WIKI_ALT} />
            <FsWikiProgressOverlay />
          </JrShot>
          <JrRows rows={CH1_ROWS} />
        </div>
      </section>

      <section className="lp-sec pv pv-a">
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

      <section className="lp-sec jr-chapter pv pv-b pv-c">
        <div className="lp-inner">
          <p className="marker">Chapter II</p>
          <h2 className="lp-h2" style={{ marginTop: 16 }}>
            Tend the field, all of it
          </h2>
          <p className="lp-body">
            A plant is people, meetings, teams, and a hundred follow-ups —
            usually scattered across five tools. Here the work happens in one
            place, so the whole story stays together.
          </p>
          {/* PeoplePipeline also mounts inside variant A's feature switcher.
              Both are presentational server components carrying no ids, so the
              double mount costs nothing but markup. */}
          <JrShot
            art="/marketing/people.webp"
            mobile={<PeoplePipelineCompact />}
          >
            <PeoplePipeline />
          </JrShot>
          <JrRows rows={CH2_ROWS} />
        </div>
      </section>

      <section className="lp-engine on-ink pv pv-a pv-b pv-c">
        <div className="lp-engine-panel">
          <div className="lp-inner">
            <p className="marker pv pv-a">Plant intelligence</p>
            <h2
              className="lp-h2 pv pv-a"
              style={{ marginTop: 16, color: "var(--cream)" }}
            >
              It reads where you actually are. Not where a checklist says you
              should be.
            </h2>
            <p className="lp-body pv pv-a">
              Every week, EveryField looks at your plant&rsquo;s real activity —
              who&rsquo;s committing, how meetings are trending, where momentum
              is building or stalling — and weighs it against a methodology that
              has launched healthy churches for years. You get a short list of
              what matters most right now.
            </p>

            <p className="marker pv pv-b pv-c">
              Chapter III · The differentiator
            </p>
            <h2 className="lp-h2 pv pv-b pv-c" style={{ marginTop: 16 }}>
              Intelligence that reads your field
            </h2>
            <p className="lp-body pv pv-b pv-c">
              Every tool in EveryField feeds one assessment. The system counts
              what&rsquo;s true, a judge grounded in the Playbook interprets it,
              and you decide what to do — nothing is ever gated.
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

            <ul className="engine-list pv pv-a">
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
            <p className="engine-pull pv pv-a">
              You stay the shepherd; <em>it keeps watch.</em>
            </p>

            <JrTriad className="pv pv-b pv-c" />
            <p className="jr-coda pv pv-b pv-c">
              Assessments run quietly in the background and are waiting when you
              arrive — with what changed since last time. You see yours before
              anyone else does.
            </p>
          </div>
        </div>
      </section>

      <section className="lp-sec pv pv-a pv-c">
        <div className="lp-inner">
          <h2 className="lp-h2 pv pv-a">From calling to launch Sunday.</h2>
          <p className="lp-body pv pv-a" style={{ marginBottom: 32 }}>
            A proven path under the whole journey — and at every stop, the app
            knows what the work is. Pick a phase.
          </p>

          <p className="marker pv pv-c">Chapter IV · The journey</p>
          <h2 className="lp-h2 pv pv-c" style={{ marginTop: 16 }}>
            From calling to launch Sunday.
          </h2>
          <p className="lp-body pv pv-c" style={{ marginBottom: 32 }}>
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

      <section className="lp-sec pv pv-a pv-b pv-c" id="networks">
        <div className="lp-inner">
          <p className="marker pv pv-a">For sending churches &amp; networks</p>
          <h2 className="lp-h2 pv pv-a" style={{ marginTop: 16 }}>
            Send them with more than a prayer.
          </h2>
          <p className="lp-body pv pv-a">
            Whether you send one plant every few years or a hundred a year, you
            see the same thing: portfolio health at a glance — plants on track,
            plants that need attention, and where your coaching hours will
            matter most. Planters control what they share; you see health, not
            their people&rsquo;s private records.
          </p>

          {/* the chapter number is the only thing that differs: B has no
              journey chapter, so oversight is IV there and V in C */}
          <p className="marker pv pv-b">Chapter IV</p>
          <p className="marker pv pv-c">Chapter V</p>
          <h2 className="lp-h2 pv pv-b pv-c" style={{ marginTop: 16 }}>
            Every field, seen
          </h2>
          <p className="lp-body pv pv-b pv-c">
            For sending churches and networks: an honest health view of every
            plant you&rsquo;ve sent — whether that&rsquo;s one this decade or a
            hundred this year.
          </p>

          <div className="netshot">
            {/* PlantHealthPortfolio renders its own heading and description,
                so nothing is reconstructed around it */}
            <NetworkHealth />
          </div>
          <JrRows rows={NETWORK_ROWS} className="pv pv-b pv-c" />
          {/* the evidence does not vary with structure — every variant keeps
              the survival stats and their sources */}
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

      <section className="lp-sec jr-index-sec pv pv-b">
        <div className="lp-inner">
          <JrIndex />
        </div>
      </section>

      <section className="lp-cta" id="request-invite">
        <div className="lp-cta-panel">
          <div className="lp-inner">
            <h2 className="lp-h2 pv pv-a">Plant with clear eyes.</h2>
            <p className="lp-body pv pv-a">
              EveryField is in early access with a small cohort of planters and
              their sending networks. If that&rsquo;s you, we&rsquo;d love to
              talk.
            </p>

            <p className="marker pv pv-b pv-c">
              The work starts at first light
            </p>
            <h2 className="lp-h2 pv pv-b pv-c" style={{ marginTop: 16 }}>
              Break ground.
            </h2>
            <p className="lp-body pv pv-b pv-c">
              EveryField is in alpha with a founding cohort of planters and
              sending networks. Your field is waiting.
            </p>

            <h2 className="lp-h2 pv pv-d">Help us build it.</h2>
            <p className="lp-body pv pv-d">
              EveryField is young, and that&rsquo;s the point — the planters who
              join now shape what it becomes. Request an invite, tell us about
              your plant, and help us build a better journey for every field.
            </p>

            <InviteForm />
          </div>
        </div>
      </section>
    </>
  );
}
