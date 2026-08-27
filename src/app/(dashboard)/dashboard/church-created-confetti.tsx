"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";

type ConfettiInstance = ReturnType<typeof confetti.create>;
type Timer = number;

interface ChurchCreatedConfettiEnvironment {
  createConfetti: () => ConfettiInstance;
  now: () => number;
  matchMedia: (query: string) => { matches: boolean };
  requestAnimationFrame: (callback: () => void) => number;
  cancelAnimationFrame: (handle: number) => void;
  setTimeout: (callback: () => void, delay: number) => Timer;
  clearTimeout: (handle: Timer) => void;
}

const colors = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

function browserEnvironment(): ChurchCreatedConfettiEnvironment {
  return {
    // A created instance owns its canvas and reset handle. Calling `confetti.reset`
    // would instead stop every dashboard celebration using the library default.
    createConfetti: () =>
      confetti.create(undefined, {
        disableForReducedMotion: true,
        resize: true,
      }),
    now: Date.now,
    matchMedia: window.matchMedia.bind(window),
    requestAnimationFrame: (callback) =>
      window.requestAnimationFrame(() => callback()),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  };
}

/** Starts the celebration and returns the cleanup React calls when this mount leaves. */
export function startChurchCreatedConfetti(
  environment: ChurchCreatedConfettiEnvironment = browserEnvironment()
) {
  if (environment.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {};
  }

  const fire = environment.createConfetti();
  const duration = 3000;
  const end = environment.now() + duration;
  const timers: Timer[] = [];
  let frame: number | null = null;
  let stopped = false;

  const launch = (options: Parameters<ConfettiInstance>[0]) => {
    if (!stopped) fire(options);
  };

  const schedule = (callback: () => void, delay: number) => {
    timers.push(
      environment.setTimeout(() => {
        if (!stopped) callback();
      }, delay)
    );
  };

  // Continuous stream from both sides
  const continuousStream = () => {
    if (stopped) return;

    launch({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.6 },
      colors,
    });
    launch({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.6 },
      colors,
    });

    if (environment.now() < end) {
      frame = environment.requestAnimationFrame(continuousStream);
    }
  };

  // Big initial bursts across the screen
  launch({
    particleCount: 150,
    spread: 100,
    origin: { x: 0.5, y: 0.4 },
    colors,
  });
  launch({
    particleCount: 80,
    angle: 60,
    spread: 80,
    origin: { x: 0, y: 0.5 },
    colors,
  });
  launch({
    particleCount: 80,
    angle: 120,
    spread: 80,
    origin: { x: 1, y: 0.5 },
    colors,
  });

  // Start the continuous stream
  continuousStream();

  // Extra bursts staggered throughout
  schedule(() => {
    launch({
      particleCount: 100,
      spread: 120,
      origin: { x: 0.3, y: 0.5 },
      colors,
    });
    launch({
      particleCount: 100,
      spread: 120,
      origin: { x: 0.7, y: 0.5 },
      colors,
    });
  }, 500);

  schedule(() => {
    launch({
      particleCount: 120,
      spread: 160,
      origin: { x: 0.5, y: 0.3 },
      colors,
    });
  }, 1000);

  schedule(() => {
    launch({
      particleCount: 80,
      spread: 100,
      origin: { x: 0.2, y: 0.6 },
      colors,
    });
    launch({
      particleCount: 80,
      spread: 100,
      origin: { x: 0.8, y: 0.6 },
      colors,
    });
  }, 1500);

  schedule(() => {
    launch({
      particleCount: 150,
      spread: 180,
      origin: { x: 0.5, y: 0.5 },
      colors,
    });
  }, 2200);

  return () => {
    if (stopped) return;
    stopped = true;

    for (const timer of timers) environment.clearTimeout(timer);
    if (frame !== null) environment.cancelAnimationFrame(frame);
    fire.reset();
  };
}

export function ChurchCreatedConfetti() {
  const router = useRouter();

  useEffect(() => {
    const stopConfetti = startChurchCreatedConfetti();

    // Clean up URL (strip ?churchCreated param without navigation)
    router.replace("/dashboard", { scroll: false });

    return stopConfetti;
  }, [router]);

  return null;
}
