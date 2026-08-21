import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — EveryField",
  description:
    "What EveryField stores about your church and its people, who can see it, what leaves the building, and what we will never do with it.",
};

export default function PrivacyPage() {
  return (
    <section className="lp-legal">
      <div className="lp-legal-inner">
        <h1>Privacy</h1>
        <p className="lp-legal-date">Last updated 1 August 2026</p>
        <p className="lp-legal-lead">
          You are putting your church&rsquo;s people into this. Here is what we
          store, where it goes, and what we will never do with it — in plain
          words, with nothing awkward hidden further down the page.
        </p>

        <h2>What we store</h2>
        <ul>
          <li>
            <b>Your account.</b> Your name, your email address, a hashed
            password (we never hold the password itself), and your sign-in
            sessions — each one with its IP address, browser, and approximate
            location, so you can recognise a session that isn’t yours.
          </li>
          <li>
            <b>Your plant&rsquo;s records.</b> The people you track and what you
            record about them — names, contact details, addresses, notes,
            assessments, interviews, commitments — plus meetings and attendance,
            tasks, ministry teams, documents you upload, and messages you send
            through EveryField.
          </li>
          <li>
            <b>What breaks.</b> Error reports and a sample of performance
            traces, so we can fix failures instead of guessing at them.
          </li>
        </ul>

        <h2>What we don&rsquo;t do</h2>
        <p>
          We don&rsquo;t sell your data. We don&rsquo;t hand it to advertisers
          or data brokers, and we don&rsquo;t run ad tracking on this site. The
          only cookie we set is the one that keeps you signed in.
        </p>

        <h2>Who can see your plant&rsquo;s data</h2>
        <p>
          Your records are scoped to your church. A coach, a sending church, or
          a network sees only what you turn on — every sharing toggle starts
          off, and you are the one who changes it. Even with sharing on,
          oversight sees aggregate health, never individual people&rsquo;s
          records.
        </p>

        <h2>Plant intelligence and the model provider</h2>
        <p>
          When an assessment runs, we send a snapshot of your plant to OpenAI —
          counts, dates, and phase state, not your database. No names, email
          addresses, phone numbers, addresses, notes, or message bodies are in
          it; people appear as opaque ids with countable attributes.
        </p>
        <p>
          Being straight about the rest: while EveryField is in alpha, that
          traffic is shared with OpenAI, including for improving and training
          their models, and it may sit in their abuse-monitoring storage for up
          to 30 days. We have already opted out of call retention in our own
          code. Sharing is switched off before we take on churches beyond the
          alpha cohort, and we will update this page when it is.
        </p>

        <h2>Email</h2>
        <p>
          Messages you send through EveryField go out through Resend, our email
          provider. Delivery status comes back to us — delivered, opened,
          bounced — so you can tell whether an invitation actually landed.
        </p>

        <h2>How long we keep it</h2>
        <p>
          For as long as your church has an account. Ask us to delete it and we
          delete it.
        </p>

        <h2>Asking us for something</h2>
        <p>
          Email <a href="mailto:hello@everyfield.app">hello@everyfield.app</a>{" "}
          to get a copy of your data, correct something in it, or have it
          deleted. A person reads it, and we come back to you.
        </p>

        <h2>When this page changes</h2>
        <p>
          We date it every time. If the change matters — a new provider, a
          different posture on the model provider — we say so here and email
          you. <Link href="/terms">Terms of use</Link> covers how the software
          itself is offered.
        </p>
      </div>
    </section>
  );
}
