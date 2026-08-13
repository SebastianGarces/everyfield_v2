"use client";

import {
  PrototypeSwitcher,
  prototypeInitScript,
} from "@/components/prototype-switcher";
import {
  PROTO_429_ATTRIBUTE,
  PROTO_429_OPTIONS,
  PROTO_429_STORAGE_KEY,
} from "@/lib/people/status-colors.proto429";
import { Proto429ThemeToggle } from "./proto-429-theme-toggle";

/**
 * PROTOTYPE ONLY — never merge. The bench for the #429 ruling on the /people
 * status-badge colour scale.
 *
 * `"use client"` is load-bearing, not habit. `prototypeInitScript` is exported
 * from a client module, so calling it from a Server Component is an RSC
 * boundary violation — and one the build does NOT catch: `pnpm build` was green
 * while every request to /people 500'd with "Attempted to call
 * prototypeInitScript() from the server". The switcher's docblock says to
 * render the script "in the same layout", which is true of the wiki-TOC
 * precedent because that layout was already a client component. Ours is not, so
 * the bench owns the boundary instead.
 *
 * Rendered BEFORE the page content so the init script runs before first paint
 * and a reload does not flash the default option. Both controls are `fixed`, so
 * sitting first in the DOM costs nothing visually.
 */
export function Proto429Bench() {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: prototypeInitScript(
            PROTO_429_ATTRIBUTE,
            PROTO_429_STORAGE_KEY,
            [...PROTO_429_OPTIONS]
          ),
        }}
      />
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        <PrototypeSwitcher
          attribute={PROTO_429_ATTRIBUTE}
          storageKey={PROTO_429_STORAGE_KEY}
          label="#429 badge scale"
          options={[
            {
              id: "current",
              label: "Current",
              hint: "Today's palette, untouched — four statuses fail AA, worst 1.91:1 (Following Up)",
            },
            {
              id: "a",
              label: "A · Darkened solids",
              hint: "Same hue families, every fill darkened until white clears 4.5:1 in both themes",
            },
            {
              id: "b",
              label: "B · Tinted editorial",
              hint: "Pale same-hue ground, deep same-hue ink, hairline border; the dark theme mirrors it",
            },
            {
              id: "c",
              label: "C · Ink + colour dot",
              hint: "One neutral badge for every status; the colour survives only as a square dot",
            },
            {
              id: "d",
              label: "D · Funnel scale",
              hint: "One green hue as an ordered intensity ramp, with Following Up pulled out in danger",
            },
          ]}
        />
        <div className="bg-card flex items-center gap-1 rounded-full border px-2 py-1.5 shadow-lg">
          <span className="text-muted-foreground px-2 text-xs font-semibold tracking-wide uppercase">
            Theme
          </span>
          <Proto429ThemeToggle />
        </div>
      </div>
    </>
  );
}
