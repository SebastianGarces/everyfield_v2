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
      <div className="links">
        <a className="nav-jump" href="#product">
          How it works
        </a>
        <a className="nav-jump" href="#networks">
          For networks
        </a>
        <Link href="/login">Sign in</Link>
      </div>
      <a className="btn primary" href="#request-invite">
        Request an invite
      </a>
    </nav>
  );
}
