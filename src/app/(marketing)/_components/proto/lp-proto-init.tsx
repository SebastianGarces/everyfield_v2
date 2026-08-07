"use client";

// PROTOTYPE — landing story ruling. This file is deleted when the ruling lands;
// no part of it may be imported outside the (marketing) prototype.

import { prototypeInitScript } from "@/components/prototype-switcher";

/**
 * The switcher's before-first-paint init script, wrapped so a SERVER layout can
 * mount it. `prototypeInitScript` is a plain function, but it is exported from
 * a `"use client"` module — so calling it from the server layout is calling a
 * client function from the server, which fails at prerender. The wrapper moves
 * the call to the client side of the boundary; the component still renders
 * during SSR, so the tag is in the initial HTML and runs while the parser is
 * still above the page content.
 *
 * The fallback if this never runs (no JavaScript, script blocked) is variant A:
 * marketing.css gates `html:not([data-lp-proto])` the same way it gates
 * `html[data-lp-proto="a"]`.
 */
export function LpProtoInit() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: prototypeInitScript("data-lp-proto", "lp-proto", [
          "a",
          "b",
          "c",
          "d",
        ]),
      }}
    />
  );
}
