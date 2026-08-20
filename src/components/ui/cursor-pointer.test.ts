import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sourceReader } from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// `cursor-pointer` ON EVERY CLICKABLE (AGENTS.md), GUARDED WHERE THE CLASS IS
// WRITTEN — NOT AT EVERY CALL SITE.
//
// The rule stands on two rungs, and each one is asserted here once:
//
//   1. `globals.css` gives the cursor to every NATIVE clickable — a `<button>`,
//      an `a[href]`, anything carrying `role="button"` or `tabindex="0"`. No
//      class is involved, so no call site can drop it.
//   2. The shadcn bases below render an element rung 1 cannot reach — a Radix
//      `div[role="option"]`, a `div[role="menuitem"]` — or are the primitive a
//      whole surface leans on. For those the class string in `src/components/ui/`
//      IS the rule, and `pnpm dlx shadcn@latest add select` overwrites it.
//
// That second case is why this file exists (#502): the app had per-call-site
// scans asserting `<SelectItem className="cursor-pointer">` in a handful of
// features, and nothing at all on `select.tsx`. A CLI re-add would have taken
// the cursor off every select in the product with every one of those scans
// still green.
//
// Anchors are DECLARATIONS read through `sourceReader`, so a renamed or deleted
// component throws here instead of quietly asserting on some other function's
// copy of the class.
// ----------------------------------------------------------------------------

const UI_DIR = path.join(process.cwd(), "src/components/ui");

function read(file: string): string {
  return readFileSync(path.join(UI_DIR, file), "utf8");
}

interface ClickableBase {
  /** File under `src/components/ui/`. */
  readonly file: string;
  /** The declaration that owns the class string. */
  readonly from: string;
  /** The next declaration — the end of the span, never a comment. */
  readonly to: string;
  /** What the browser gets, and why the class is the only thing holding it. */
  readonly renders: string;
}

const CLICKABLE_BASES: readonly ClickableBase[] = [
  {
    file: "select.tsx",
    from: "function SelectTrigger(",
    to: "function SelectContent(",
    renders: "a native button — but every select in the app opens through it",
  },
  {
    file: "select.tsx",
    from: "function SelectItem(",
    to: "function SelectSeparator(",
    renders: 'div[role="option"] — globals.css cannot reach it',
  },
  {
    file: "dropdown-menu.tsx",
    from: "function DropdownMenuItem(",
    to: "function DropdownMenuCheckboxItem(",
    renders: 'div[role="menuitem"] — globals.css cannot reach it',
  },
  {
    file: "dropdown-menu.tsx",
    from: "function DropdownMenuCheckboxItem(",
    to: "function DropdownMenuRadioGroup(",
    renders: 'div[role="menuitemcheckbox"] — globals.css cannot reach it',
  },
  {
    file: "dropdown-menu.tsx",
    from: "function DropdownMenuRadioItem(",
    to: "function DropdownMenuLabel(",
    renders: 'div[role="menuitemradio"] — globals.css cannot reach it',
  },
  {
    file: "dropdown-menu.tsx",
    from: "function DropdownMenuSubTrigger(",
    to: "function DropdownMenuSubContent(",
    renders: 'div[role="menuitem"] — globals.css cannot reach it',
  },
  {
    file: "command.tsx",
    from: "function CommandItem(",
    to: "function CommandShortcut(",
    renders: 'div[role="option"] — globals.css cannot reach it',
  },
  {
    file: "checkbox.tsx",
    from: "function Checkbox(",
    to: "export { Checkbox }",
    renders: "a native button, and the label beside it is not one",
  },
  {
    file: "radio-group.tsx",
    from: "function RadioGroupItem(",
    to: "export { RadioGroup, RadioGroupItem }",
    renders: "a native button, and the label beside it is not one",
  },
  {
    file: "tabs.tsx",
    from: "function TabsTrigger(",
    to: "function TabsContent(",
    renders: "a native button — the tab strip is a navigation surface",
  },
  {
    file: "sidebar.tsx",
    from: "const sidebarMenuButtonVariants = cva(",
    to: "function SidebarMenuButton(",
    renders: "a button OR an `asChild` Slot, which can be anything at all",
  },
];

test("every interactive shadcn base carries cursor-pointer in its own class", () => {
  for (const base of CLICKABLE_BASES) {
    const span = sourceReader(read(base.file), base.file).span(
      base.from,
      base.to
    );

    assert.match(
      span,
      /\bcursor-pointer\b/,
      `${base.file} › ${base.from} lost cursor-pointer — it renders ${base.renders}`
    );
  }
});

test("globals.css keeps the native rung: button, role=button, a[href], tabindex=0", () => {
  // The rung the inventory above deliberately does NOT duplicate. Deleting a
  // selector from this list silently un-guards every plain `<Button>` and
  // `<Link>` in the product, which is why no call site scans for it any more.
  const globals = sourceReader(
    readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8"),
    "globals.css"
  );
  const selectors = globals.span("button:not(:disabled)", "cursor: pointer;");

  for (const selector of [
    '[role="button"]:not(:disabled)',
    "a[href]",
    '[tabindex="0"]',
  ]) {
    assert.ok(
      selectors.includes(selector),
      `globals.css no longer gives the pointer to ${selector}`
    );
  }
});

test("no base in src/components/ui/ carries cursor-pointer outside the inventory", () => {
  // The ratchet. A primitive that gains the class without an entry here is a
  // primitive nothing re-checks after the next `shadcn add`.
  for (const file of readdirSync(UI_DIR).filter((f) => f.endsWith(".tsx"))) {
    const found = (read(file).match(/\bcursor-pointer\b/g) ?? []).length;
    const guarded = CLICKABLE_BASES.filter((b) => b.file === file).length;

    assert.equal(
      found,
      guarded,
      `${file} writes cursor-pointer ${found} time(s) but ${guarded} are guarded — add the declaration to CLICKABLE_BASES`
    );
  }
});
