import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sourceReader, stripComments } from "@/lib/testing/source-span";
import { resolveTargetBox } from "@/lib/testing/tailwind-box";

// ----------------------------------------------------------------------------
// EVERY SHARED DISMISS CONTROL CLEARS WCAG 2.5.8's 24x24 FLOOR (#639).
//
// The defect this file was written for: `DialogContent`'s Close carried
// `absolute top-4 right-4` and nothing else that touched its box, so the button
// was exactly as big as the glyph inside it — 16x16 — in EVERY dialog in the
// product, because the primitive is shared by all of them. `SheetContent` had
// the same class string and the same 16x16, and sonner's toast close button sat
// at 20x20 from its own stylesheet.
//
// WHY THE ASSERTION IS A COMPILED NUMBER AND NOT A CLASS NAME. The obvious test
// here is `assert.match(classes, /size-6/)`, and it is worth nothing: it proves
// somebody typed a class, not that anything is 24 CSS px. It survives a retuned
// `--spacing`, a later class in the same string overriding the earlier one, and
// a utility renamed by a major version — all three of which change the pixels
// while leaving the six characters in place. So the class string is read out of
// the shipped source and handed to the PROJECT'S OWN Tailwind, and what gets
// compared against 24 is the width and height that compiler emits.
//
// WHAT THE NUMBER IS TAKEN FROM matters as much (`tailwind-box.ts` has the
// detail): only declarations at the TOP LEVEL of the compiled rule count as the
// element's own box. A Tailwind variant compiles to a nested rule, so the
// `[&_svg:not([class*='size-'])]:size-4` that made the old button LOOK 16px
// wide cannot be mistaken for the button's own width — it never was one. That
// distinction is precisely the bug: the glyph had a size and the target did not.
//
// THE GLYPH DOES NOT GROW. Each fix pairs the bigger box with a smaller offset
// (`top-4 right-4` -> `top-3 right-3` around a 24px box centres the same 16px X
// at the same 16px inset), or leaves the painted control alone entirely and
// extends the hit area with a centred `::after`. The target changed; the design
// did not.
// ----------------------------------------------------------------------------

/** WCAG 2.5.8 Level AA. The floor, not the goal. */
const MINIMUM_TARGET_PX = 24;

const UI_DIR = path.join(process.cwd(), "src/components/ui");
const SETTINGS_DIR = path.join(process.cwd(), "src/components/settings");

/**
 * Every directory that may hold a dismiss control, and therefore every
 * directory the sweep at the foot of this file reads.
 *
 * `src/components/ui/` alone was the original scope, and it was the scope of
 * the DEFECT: a shared primitive is wrong everywhere at once. It stopped being
 * the whole scope when the settings modal refused `DialogContent`'s Close and
 * drew its own — two hand-placed buttons, in a directory nothing here read,
 * growing their own 24px box on trust (#657 review). A local control is not a
 * smaller version of the problem; it is the same 16x16 target with no shared
 * primitive to fix it in.
 */
const SWEPT_DIRS: readonly string[] = [UI_DIR, SETTINGS_DIR];

/**
 * How a control reaches the floor — and therefore where the box is measured.
 *
 * `box`: the control's own border-box is >= 24. Available whenever nothing is
 * painted at the smaller size, which is the case for a bare X that only shows
 * an opacity change on hover: growing its box changes no pixel a reader sees.
 *
 * `overlay`: the PAINTED control must stay its current size — sonner's close
 * button is a bordered 20px circle, and resizing it would redesign every toast
 * in the product — so the hit area is extended by a centred `::after` instead,
 * the technique the better-accessibility skill's hit-areas reference prescribes
 * for exactly this case.
 */
type Mechanism = "box" | "overlay";

interface DismissControl {
  /**
   * The file, relative to `src/components/ui/` — so a control that lives in
   * another swept directory is spelled the way `path.relative` spells it
   * (`"../settings/settings-modal.tsx"`), and one string serves both the read
   * below and the sweep at the foot of the file.
   */
  readonly file: string;
  /** Successive narrowing spans, outermost first, ending on the class string. */
  readonly anchors: readonly (readonly [from: string, to: string])[];
  /** The text immediately before the class string literal. */
  readonly attribute: string;
  /** Which box carries the target. */
  readonly mechanism: Mechanism;
  /** What a reader is aiming at, for the failure message. */
  readonly control: string;
}

const DISMISS_CONTROLS: readonly DismissControl[] = [
  {
    file: "dialog.tsx",
    anchors: [
      ["function DialogContent(", "function DialogHeader("],
      ["<DialogPrimitive.Close", "<XIcon"],
    ],
    attribute: "className=",
    mechanism: "box",
    control:
      "the X on every dialog in the app — settings, the command palette, and 25 call sites besides",
  },
  {
    file: "sheet.tsx",
    anchors: [
      ["function SheetContent(", "function SheetHeader("],
      ["<SheetPrimitive.Close", "<XIcon"],
    ],
    attribute: "className=",
    mechanism: "box",
    control: "the X on every sheet",
  },
  {
    file: "sonner.tsx",
    anchors: [["const Toaster = ", "export { Toaster }"]],
    attribute: "closeButton:",
    mechanism: "overlay",
    control:
      "the toast close button — painted by sonner's own stylesheet at 20x20",
  },
  {
    file: "../settings/settings-modal.tsx",
    anchors: [["function SettingsClose(", "<XIcon"]],
    attribute: "className=",
    mechanism: "box",
    control:
      "the settings modal's Close — drawn twice (the stacked corner X, and the section pane's bar at md) from this one class string",
  },
];

/** The class string this control ships, or a throw naming the anchor that moved. */
function shippedClasses(control: DismissControl): string {
  const label = `${control.file} › ${control.control}`;

  const span = control.anchors.reduce(
    (code, [from, to]) => sourceReader(code, label).span(from, to),
    stripComments(readFileSync(path.join(UI_DIR, control.file), "utf8"))
  );

  const at = sourceReader(span, label).after(control.attribute);
  const literal = /"([^"]*)"/.exec(at);

  if (!literal) {
    throw new Error(`${label}: no class string follows ${control.attribute}`);
  }

  return literal[1];
}

test("every shared dismiss control compiles to a target of at least 24x24", async () => {
  for (const control of DISMISS_CONTROLS) {
    const classes = shippedClasses(control);
    const resolved = await resolveTargetBox(classes);
    const box = control.mechanism === "box" ? resolved.self : resolved.after;

    const where =
      control.mechanism === "box"
        ? "its own border-box"
        : "the ::after that extends its hit area";

    // Size alone is not the property for an overlay. A 24x24 `::after` that is
    // not positioned is an ordinary child: it enlarges nothing, and because a
    // close button is `display: flex` it becomes a flex item and shoves the
    // glyph off centre — a visible regression the size check would call green.
    if (control.mechanism === "overlay") {
      assert.ok(
        resolved.after.centred,
        `${control.file} › ${control.control}: the ::after is not absolutely positioned and centred on the control, so it is sitting INSIDE the control rather than over it. It enlarges no target, and on a flex control it pushes the glyph off centre. Use the \`hit-area-*\` utility from globals.css rather than assembling the positioning by hand.`
      );
    }

    for (const axis of ["width", "height"] as const) {
      const measured = box[axis];

      assert.ok(
        measured !== null && measured >= MINIMUM_TARGET_PX,
        `${control.file} › ${control.control}: ${where} compiles to ${
          measured === null
            ? `NO ${axis} AT ALL, so the target is only ever as big as the glyph that happens to sit inside it — which is how this shipped at 16x16`
            : `${axis} ${measured}px`
        }, under the WCAG 2.5.8 floor of ${MINIMUM_TARGET_PX}px.

This is ${control.control}, so the miss is systemic — it is wrong everywhere at once.

Fix it in this shared primitive, never at a call site, and keep the glyph where it is: pair the bigger box with a smaller offset (a 24px box at top-3/right-3 centres a 16px icon at the same 16px inset as top-4/right-4 did), or extend the hit area with a centred ::after when the painted control has to keep its size.
Measured by compiling "${classes}" through the project's own Tailwind.`
      );
    }
  }
});

/**
 * The tells that a file HAS a dismiss control, so a new one cannot arrive
 * unmeasured.
 *
 * The test above only checks what it has been told about, and `pnpm dlx
 * shadcn@latest add <anything>` is one command away from dropping a fresh 16x16
 * Close into `src/components/ui/` — invisible to an inventory that never
 * re-reads it. `src/components/settings/` is swept for the same reason with a
 * different cause: nothing generates a file there, but the modal already has a
 * precedent for refusing the shared Close and hand-placing its own, and the
 * next surface that does it will copy the modal.
 * `showCloseButton` is deliberately NOT a tell: `command.tsx` forwards that prop
 * to `DialogContent` and owns no control of its own, which is the difference
 * between passing the flag and painting the button.
 *
 * WHAT THIS DOES NOT REACH: a call site that targets the control as a
 * DESCENDANT. Neither Close takes a `className` prop, a `cn()` merge or a
 * `{...props}` spread, so no consumer can shrink one directly — but a content
 * class can still select it, and one does: `sidebar.tsx` passes
 * `[&>button]:hidden` to `SheetContent` to remove its Close entirely.
 * `[&>button]:size-4` would be the same move and nothing here would see it.
 */
const DISMISS_TELL = /sr-only">(?:Close|Dismiss)|(?<![A-Za-z])closeButton\b/;

/** Every `.tsx` under `dir`, at any depth, named as `DismissControl.file` is. */
function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(full);
    return entry.name.endsWith(".tsx") ? [path.relative(UI_DIR, full)] : [];
  });
}

test("no swept directory holds a dismiss control this file has not measured", () => {
  const measured = new Set(DISMISS_CONTROLS.map((control) => control.file));

  const found = SWEPT_DIRS.flatMap(tsxFilesUnder)
    .filter((file) =>
      DISMISS_TELL.test(
        stripComments(readFileSync(path.join(UI_DIR, file), "utf8"))
      )
    )
    .sort();

  assert.deepEqual(
    found,
    [...measured].sort(),
    `the dismiss controls in ${SWEPT_DIRS.map((dir) => path.relative(process.cwd(), dir)).join(" and ")} are no longer the ones this file measures.

A file that paints its own Close is a 24x24 target the test above cannot see until it is listed. Add it to DISMISS_CONTROLS with the anchors that reach its class string — or, if it merely forwards a flag to another primitive's control, it owns no target and the tell is what needs narrowing.

Two Close buttons in one file must be ONE component with one class string before they can be listed: the entry names a file and an anchor, so a second hand-placed control in the same file is a second unmeasured target wearing a measured one's name.`
  );
});
