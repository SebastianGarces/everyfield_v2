import Link from "next/link";
import { DM_Mono, DM_Sans, Newsreader, Outfit } from "next/font/google";

import { Lockup } from "./_components/logo";
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

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`marketing ${outfit.variable} ${newsreader.variable} ${dmSans.variable} ${dmMono.variable}`}
    >
      <MarketingNav />
      <main>{children}</main>
      <footer className="lp-footer">
        <Lockup />
        <span>Built on a proven launch methodology.</span>
        <span>
          <Link href="/terms">Terms</Link> ·{" "}
          <Link href="/privacy">Privacy</Link> · © 2026 EveryField
        </span>
      </footer>
    </div>
  );
}
