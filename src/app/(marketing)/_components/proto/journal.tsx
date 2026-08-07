// PROTOTYPE — landing story ruling. This file is deleted when the ruling lands;
// no part of it may be imported outside the (marketing) prototype.
//
// The "Field Journal" structure from docs/explorations/landing-editorial.md,
// built as variants B and C behind the prototype switcher. Everything here is a
// dumb server component: the live app embeds are built in page.tsx (they cost
// no client JavaScript only as long as they never cross a "use client"
// boundary — see _components/embeds.ts) and arrive as children.

import type { ReactNode } from "react";

/* ---------- the credibility strip ---------- */

const STRIP = [
  { n: "96", label: "playbook articles" },
  { n: "7", label: "phases, calling → beyond" },
  { n: "6", label: "tools in one place" },
  { n: "1", label: "assessment that reads them all" },
] as const;

export function JrStrip() {
  return (
    <>
      <div className="jr-strip">
        {STRIP.map((cell) => (
          <div key={cell.n}>
            <p className="jr-strip-n">{cell.n}</p>
            <p className="jr-strip-l">{cell.label}</p>
          </div>
        ))}
      </div>
      <p className="jr-strip-tag">
        Built on the Launch Playbook — the methodology, not a template pack
      </p>
    </>
  );
}

/* ---------- a chapter's visual pane ----------
   The pane grammar is .fswitch-shot's, replicated in marketing.css: one
   reserved height, the art as ground, corner registration marks, and the
   desktop composition swapped for a phone one at 900px. .jr-desk is
   `display: contents` on desktop, so the embed and anything floated on it are
   direct flex children of the pane exactly as they are inside a tab panel —
   which is what keeps the .vg-fs-* percentage insets landing where they were
   composed. */

export function JrShot({
  art,
  children,
  mobile,
}: {
  art: string;
  children: ReactNode;
  mobile: ReactNode;
}) {
  return (
    <div
      className="jr-shot anchor-start"
      style={{ backgroundImage: `url("${art}")` }}
    >
      <div className="jr-desk">{children}</div>
      <div className="jr-mob">{mobile}</div>
    </div>
  );
}

/* ---------- features as reading matter, not cards ---------- */

export type JrRow = { title: string; body: string };

export function JrRows({
  rows,
  className,
}: {
  rows: readonly JrRow[];
  className?: string;
}) {
  return (
    <dl className={className ? `jr-rows ${className}` : "jr-rows"}>
      {rows.map((row) => (
        <div className="jr-row" key={row.title}>
          <dt className="jr-row-t">{row.title}</dt>
          <dd className="jr-row-b">{row.body}</dd>
        </div>
      ))}
    </dl>
  );
}

export const CH1_ROWS: readonly JrRow[] = [
  {
    title: "The Launch Playbook, searchable",
    body: "Ninety-six articles of field-tested methodology — vision, people, money, facilities — organized by the phase you’re actually in.",
  },
  {
    title: "Guides & documents",
    body: "The interview guide opens beside the interview, and print-ready documents — bylaws, budgets, covenants — come filled in with your church’s details.",
  },
  {
    title: "Phase guides",
    body: "Each phase explains itself: what it’s for, what good looks like, and what usually goes wrong.",
  },
];

export const CH2_ROWS: readonly JrRow[] = [
  {
    title: "People, from visitor to committed",
    body: "A CRM shaped for planting: every family’s journey from first conversation to core-group commitment, with follow-ups that don’t slip.",
  },
  {
    title: "Meetings & RSVPs",
    body: "Vision nights, orientations, team gatherings — scheduled, run, and followed up, with attendance feeding your momentum picture.",
  },
  {
    title: "Ministry teams",
    body: "Define the teams a launch needs, fill the roles, and see the gaps before Sunday morning does.",
  },
  {
    title: "Tasks & projects",
    body: "Every follow-up tracked to done — and meeting attendance creates the follow-up tasks for you, automatically.",
  },
  {
    title: "Notifications that respect you",
    body: "The system speaks up when something needs you — and stays quiet when it doesn’t.",
  },
];

/** Variant D's three promises — the same hairline rows, in plain language.
 *  No product nouns a planter would have to learn first: no CRM, no portfolio,
 *  no assessment. What it knows, what you do next, who is with you. */
export const D_ROWS: readonly JrRow[] = [
  {
    title: "Know your people",
    body: "Every family you’re reaching, remembered — who came, who’s ready for more, who needs a call.",
  },
  {
    title: "Know your next step",
    body: "A proven playbook tells you what this season is for and what to do in it.",
  },
  {
    title: "Never walk alone",
    body: "Your sending church can see how it’s going and show up when it matters.",
  },
];

export const NETWORK_ROWS: readonly JrRow[] = [
  {
    title: "Progress dashboards at every scale",
    body: "A single plant or a whole network — phase, health, and momentum, rendered from the same assessment the planter sees.",
  },
  {
    title: "Observations, not verdicts",
    body: "Network-facing insights are conservative, cite what they observe, and never expose more than the plant’s privacy settings allow. Planters always see their assessment first.",
  },
];

/* ---------- the governance promise, on the ink panel ----------
   Numerals are cream, not green: DESIGN.md bans green on ink by ruling, and
   ruling #188 holds for every variant. */

const TRIAD = [
  {
    n: "01",
    title: "The system counts",
    body: "Every number is computed from your real activity. The AI is never allowed to guess a fact.",
  },
  {
    n: "02",
    title: "The judge interprets",
    body: "An assessment grounded in the Playbook weighs your signals against the methodology — and cites its sources.",
  },
  {
    n: "03",
    title: "You decide",
    body: "Insights advise, never block. Advance, wait, or push back — the phase is yours to call.",
  },
] as const;

export function JrTriad({ className }: { className?: string }) {
  return (
    <ol className={className ? `jr-triad ${className}` : "jr-triad"}>
      {TRIAD.map((cell) => (
        <li className="jr-triad-cell" key={cell.n}>
          <p className="jr-triad-n">{cell.n}</p>
          <h3 className="jr-triad-t">{cell.title}</h3>
          <p className="jr-triad-b">{cell.body}</p>
        </li>
      ))}
    </ol>
  );
}

/* ---------- the feature index — coverage as one typographic object ----------
   Rows are plain text on purpose: there is nowhere on a landing page for them
   to go, so they get no href, no handler and no cursor-pointer. The arrow is a
   hover affordance for the eye only, and is hidden from assistive tech. */

const INDEX = [
  { n: "01", name: "Launch Playbook wiki", note: "96 articles of methodology" },
  { n: "02", name: "People CRM", note: "visitor → committed" },
  { n: "03", name: "Meetings & RSVPs", note: "vision nights to launch day" },
  { n: "04", name: "Ministry teams", note: "roles, gaps, coverage" },
  { n: "05", name: "Tasks & projects", note: "the launch, broken down" },
  {
    n: "06",
    name: "Guides & documents",
    note: "proven drafts, not blank pages",
  },
  { n: "07", name: "Notifications", note: "signal, no noise" },
  { n: "08", name: "Progress dashboard", note: "the plant at a glance" },
  {
    n: "09",
    name: "Plant Intelligence",
    note: "the assessment that reads it all",
  },
  { n: "10", name: "Network oversight", note: "every field, seen" },
] as const;

export function JrIndex() {
  return (
    <>
      <h2 className="jr-index-head">The index — everything inside</h2>
      <ol className="jr-index-list">
        {INDEX.map((row) => (
          <li className="jr-index-row" key={row.n}>
            <span className="jr-index-n">{row.n}</span>
            <span className="jr-index-name">
              {row.name}
              <span className="jr-index-arrow" aria-hidden="true">
                →
              </span>
            </span>
            <span className="jr-index-note">{row.note}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
