import Link from "next/link";
import { DM_Mono, DM_Sans, Newsreader, Outfit } from "next/font/google";

import { Lockup } from "@/components/logo";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { MarketingNav } from "./_components/nav";
// PROTOTYPE — landing story ruling (A · Today / B · Journal / C · Hybrid).
// The switcher, the init script and every `pv` class on the page come out
// together once the ruling lands.
import { LpProtoInit } from "./_components/proto/lp-proto-init";
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

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`marketing ${outfit.variable} ${newsreader.variable} ${dmSans.variable} ${dmMono.variable}`}
    >
      {/* re-applies the stored choice before first paint; React never manages
          <html> attributes, so this cannot mismatch on hydration */}
      <LpProtoInit />
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
      <PrototypeSwitcher
        attribute="data-lp-proto"
        storageKey="lp-proto"
        label="Landing"
        options={[
          {
            id: "a",
            label: "A · Today",
            hint: "Current page: two tabbed hubs (features + phases)",
          },
          {
            id: "b",
            label: "B · Journal",
            hint: "Chaptered story — features woven through as rows, giant index for coverage",
          },
          {
            id: "c",
            label: "C · Hybrid",
            hint: "Story chapters, but the phase journey keeps its tabs",
          },
          {
            id: "d",
            label: "D · Simple",
            hint: "70% less text, one animated flow, plain language, origin story",
          },
        ]}
      />
    </div>
  );
}
