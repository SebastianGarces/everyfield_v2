import type { Metadata } from "next";
import Image from "next/image";

import { FeatureSwitcher } from "./_components/feature-switcher";
import { InviteForm } from "./_components/invite-form";
import { PhaseTabs } from "./_components/phase-tabs";

export const metadata: Metadata = {
  title: "EveryField — Your church plant, understood.",
  description:
    "EveryField puts a proven planting methodology to work on your real progress — the people, meetings, and momentum that get you to launch Sunday — and tells you what deserves your attention this week.",
};

export default function LandingPage() {
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
              <Image
                className="shot-img"
                src="/marketing/shots/dashboard.webp"
                alt="The EveryField dashboard for Redemption Hill Church in pre-launch: core group of 61, 142 people in the pipeline, zero overdue tasks, and recent activity."
                width={2880}
                height={1800}
                sizes="(max-width: 1012px) 100vw, 980px"
                priority
              />
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
          <FeatureSwitcher />
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
          <PhaseTabs />
        </div>
      </section>

      <section className="lp-sec lp-art">
        <div className="lp-art-panel">
          <Image
            src="/marketing/c2-field.webp"
            alt=""
            width={1672}
            height={941}
            sizes="100vw"
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
          <div className="stats">
            <div className="stat-cell lead">
              <p className="n">86–90%</p>
              <p className="lbl">
                of plants with real assessment, training, and coaching are still
                alive at year four.
              </p>
            </div>
            <div className="stat-cell base">
              <p className="n">68%</p>
              <p className="lbl">
                of unsupported plants make it that far. Support is the
                difference — EveryField is how you give it consistently.
              </p>
            </div>
          </div>
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
