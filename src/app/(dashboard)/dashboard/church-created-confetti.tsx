"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";

function fireFullScreenConfetti() {
  const duration = 3000;
  const end = Date.now() + duration;

  const colors = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  // Continuous stream from both sides
  const frame = () => {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.6 },
      colors,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.6 },
      colors,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  };

  // Big initial bursts across the screen
  confetti({
    particleCount: 150,
    spread: 100,
    origin: { x: 0.5, y: 0.4 },
    colors,
  });
  confetti({
    particleCount: 80,
    angle: 60,
    spread: 80,
    origin: { x: 0, y: 0.5 },
    colors,
  });
  confetti({
    particleCount: 80,
    angle: 120,
    spread: 80,
    origin: { x: 1, y: 0.5 },
    colors,
  });

  // Start the continuous stream
  frame();

  // Extra bursts staggered throughout
  setTimeout(() => {
    confetti({ particleCount: 100, spread: 120, origin: { x: 0.3, y: 0.5 }, colors });
    confetti({ particleCount: 100, spread: 120, origin: { x: 0.7, y: 0.5 }, colors });
  }, 500);

  setTimeout(() => {
    confetti({ particleCount: 120, spread: 160, origin: { x: 0.5, y: 0.3 }, colors });
  }, 1000);

  setTimeout(() => {
    confetti({ particleCount: 80, spread: 100, origin: { x: 0.2, y: 0.6 }, colors });
    confetti({ particleCount: 80, spread: 100, origin: { x: 0.8, y: 0.6 }, colors });
  }, 1500);

  setTimeout(() => {
    confetti({ particleCount: 150, spread: 180, origin: { x: 0.5, y: 0.5 }, colors });
  }, 2200);
}

export function ChurchCreatedConfetti() {
  const router = useRouter();

  useEffect(() => {
    fireFullScreenConfetti();

    // Clean up URL (strip ?churchCreated param without navigation)
    router.replace("/dashboard", { scroll: false });
  }, [router]);

  return null;
}
