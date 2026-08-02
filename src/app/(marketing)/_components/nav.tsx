"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Lockup } from "@/components/logo";

export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={scrolled ? "lp-nav scrolled" : "lp-nav"}>
      <Link href="/" aria-label="EveryField home">
        <Lockup className="logo" />
      </Link>
      {/* the nav rides every marketing route, so its jumps are rooted at the
          landing page — a bare fragment points nowhere from /terms or /privacy */}
      <div className="links">
        <a className="nav-jump" href="/#product">
          How it works
        </a>
        <a className="nav-jump" href="/#networks">
          For networks
        </a>
        <Link href="/login">Sign in</Link>
      </div>
      {/* the full label wraps the bar to two lines under 360px; CSS swaps in
          the short one, and only ever shows one — so it is the accessible name */}
      <a className="btn primary" href="/#request-invite">
        <span className="cta-full">Request an invite</span>
        <span className="cta-short">Get an invite</span>
      </a>
    </nav>
  );
}
