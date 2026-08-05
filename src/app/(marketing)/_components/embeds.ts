/**
 * The seam that lets the landing page show the app's own components.
 *
 * `feature-switcher.tsx` and `phase-tabs.tsx` are `"use client"`, and an app
 * component imported across a client boundary ships to the browser — Drizzle
 * types, the document catalog, recharts, all of it. So the embeds are built in
 * `page.tsx`, which is a server component, and handed down as props: a server
 * node passed to a client component is RSC-serialised and never enters the
 * client bundle.
 *
 * One shape for both switchers, keyed by their own feature/phase key. A key
 * with no entry keeps its capture, so the two can be mixed panel by panel —
 * which is the point: some surfaces (a wiki article, a person's profile) are
 * better as art-directed crops, and those stay crops.
 */
export type Embed = {
  /** Replaces the primary crop in the desktop pane. */
  visual?: React.ReactNode;
  /** Replaces the primary crop in the mobile composition (stack / journey). */
  mobile?: React.ReactNode;
  /** A live card floated on the primary, after the image overlays. Desktop
   *  only, the same rule the `ShotOverlay` images follow. */
  overlay?: React.ReactNode;
};

export type Embeds = Partial<Record<string, Embed>>;
