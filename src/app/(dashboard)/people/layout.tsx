import { type ReactNode } from "react";

import { Proto429ThemeToggle } from "@/components/people/proto-429-theme-toggle";
import {
  PrototypeSwitcher,
  prototypeInitScript,
} from "@/components/prototype-switcher";
import {
  PROTO_429_ATTRIBUTE,
  PROTO_429_OPTIONS,
  PROTO_429_STORAGE_KEY,
} from "@/lib/people/status-colors.proto429";

export const dynamic = "force-dynamic";

/**
 * PROTOTYPE ONLY — never merge the switcher, the init script or the theme
 * toggle. They are here for the #429 ruling on the status-badge colour scale
 * (`src/lib/people/status-colors.proto429.ts`), and this is the layout that
 * owns both surfaces the badge appears on: the list at /people and the profile
 * under /people/[id].
 */
export default function PeopleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-full">
      <script
        dangerouslySetInnerHTML={{
          __html: prototypeInitScript(
            PROTO_429_ATTRIBUTE,
            PROTO_429_STORAGE_KEY,
            [...PROTO_429_OPTIONS]
          ),
        }}
      />
      {children}
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        <PrototypeSwitcher
          attribute={PROTO_429_ATTRIBUTE}
          storageKey={PROTO_429_STORAGE_KEY}
          label="#429 badge scale"
          options={[
            {
              id: "current",
              label: "Current",
              hint: "Today's palette, untouched — four of these fail AA, worst 1.91:1 (Following Up)",
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
    </div>
  );
}
