import Link from "next/link";
import { DM_Mono, DM_Sans, Newsreader, Outfit } from "next/font/google";

import { Lockup } from "@/components/logo";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { MarketingNav } from "./_components/nav";
import "./marketing.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
});

/* Inlined rather than imported from prototype-switcher.tsx: that module is
   "use client", and a server component may not CALL a function exported from
   a client module (only render its components). Same output as
   prototypeInitScript("data-mktlink", "mktlink", ["a","b","c","d"]). */
const MKTLINK_INIT =
  'try{var p=localStorage.getItem("mktlink");document.documentElement.setAttribute("data-mktlink",["a","b","c","d"].includes(p)?p:"a")}catch(e){document.documentElement.setAttribute("data-mktlink","a")}';

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* PROTOTYPE HARNESS — marketing prose-link treatment (PR #387).
          Throwaway: unmount this and the CSS block in marketing.css when
          the ruling lands. */}
      <script dangerouslySetInnerHTML={{ __html: MKTLINK_INIT }} />
      <div
        className={`marketing ${outfit.variable} ${newsreader.variable} ${dmSans.variable} ${dmMono.variable}`}
      >
        <MarketingNav />
        <main>{children}</main>
        <footer className="lp-footer">
          <Lockup className="logo" />
          <span>Built on a proven launch methodology.</span>
          <span>
            <a href="mailto:hello@everyfield.app">Contact</a> ·{" "}
            <Link href="/terms">Terms</Link> ·{" "}
            <Link href="/privacy">Privacy</Link> · © 2026 EveryField
          </span>
        </footer>
      </div>
      <PrototypeSwitcher
        attribute="data-mktlink"
        storageKey="mktlink"
        label="Prose links"
        options={[
          {
            id: "a",
            label: "A · Underline",
            hint: "Shipped in this PR: solid green underline, 4px offset",
          },
          {
            id: "b",
            label: "B · Hairline",
            hint: "1px underline at 40% green — the cue, quieter",
          },
          {
            id: "c",
            label: "C · Weight",
            hint: "No underline; semibold instead of the line",
          },
          {
            id: "d",
            label: "D · Flat",
            hint: "Exempt marketing — colour only, 1.36:1 (today on main)",
          },
        ]}
      />
    </>
  );
}
