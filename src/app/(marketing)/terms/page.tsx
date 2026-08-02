import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of use — EveryField",
  description:
    "How EveryField is offered during the invite-only alpha: what it costs, what we promise, and what we ask of you.",
};

export default function TermsPage() {
  return (
    <section className="lp-legal">
      <div className="lp-legal-inner">
        <h1>Terms of use</h1>
        <p className="lp-legal-date">Last updated 1 August 2026</p>
        <p className="lp-legal-lead">
          EveryField is in invite-only alpha. These terms are short on purpose.
          They describe how the software is offered today. Fuller terms will
          replace them before EveryField opens beyond the alpha cohort, and we
          will not spring that on you.
        </p>

        <h2>Who this is for</h2>
        <p>
          Access is by invitation — through a sending church, through a network,
          or directly from us. Your account is yours. Don&rsquo;t hand your
          sign-in to someone else; invite them instead.
        </p>

        <h2>What it costs</h2>
        <p>
          Nothing during the alpha. There is no card on file and no subscription
          to cancel. If EveryField ever starts charging your church or your
          network, we will tell you before it happens and you will have to agree
          to it.
        </p>

        <h2>Alpha software is offered as it is</h2>
        <p>
          We work carefully, but alpha software breaks. Features change, move,
          and sometimes disappear. We can&rsquo;t promise EveryField will always
          be available or always be right. Keep your own copy of anything you
          can&rsquo;t afford to lose — signed commitments, financial records,
          documents that carry legal weight.
        </p>

        <h2>Your church&rsquo;s records are yours</h2>
        <p>
          The people, meetings, tasks, teams, and documents you put into
          EveryField belong to your church. We don&rsquo;t claim ownership of
          them and we don&rsquo;t sell them.{" "}
          <Link href="/privacy">Privacy</Link> covers what we store and who can
          see it.
        </p>

        <h2>What we ask of you</h2>
        <ul>
          <li>
            Use EveryField for your own plant, or for the plants you oversee.
          </li>
          <li>
            Only record information about people you have a real reason to hold,
            and handle it the way you would want yours handled.
          </li>
          <li>Don&rsquo;t try to reach data belonging to another church.</li>
          <li>
            Don&rsquo;t use EveryField to send anything unlawful, harassing, or
            deceptive.
          </li>
        </ul>

        <h2>Ending it</h2>
        <p>
          You can stop at any time. Ask us to delete your church&rsquo;s data
          and we will delete it. We can end access to an account that is being
          misused or is putting other churches at risk, and we will tell you
          why.
        </p>

        <h2>When these terms change</h2>
        <p>
          We date this page every time it changes. If a change affects you
          materially, we will email you before it takes effect.
        </p>

        <h2>Questions</h2>
        <p>
          Email <a href="mailto:hello@everyfield.app">hello@everyfield.app</a>.
          A person reads it.
        </p>
      </div>
    </section>
  );
}
