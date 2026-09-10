import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

import { buttonVariants } from "@/components/ui/button";
import { resolveTargetBox } from "@/lib/testing/tailwind-box";
import { cn } from "@/lib/utils";

const MINIMUM_TARGET_PX = 24;
const ROOT = process.cwd();
const SWEPT_DIRS = ["src/components", "src/app"];

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
interface DismissControl {
  readonly location: string;
  readonly classes: string;
  readonly sourceHash?: string;
  readonly externallyPositioned?: boolean;
}

function attribute(node: Opening, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (item): item is ts.JsxAttribute =>
      ts.isJsxAttribute(item) && item.name.getText() === name
  );
}

/** Only unconditional literals contribute. Conditional sizing cannot prove a floor. */
function staticClasses(node: ts.Node | undefined): string {
  if (!node) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isJsxExpression(node)) return staticClasses(node.expression);
  if (ts.isCallExpression(node) && node.expression.getText() === "cn") {
    return node.arguments.map(staticClasses).join(" ");
  }
  return "";
}

/** Text-labelled buttons are outside this icon-target guard. Hidden labels count as icons. */
function hasPaintedText(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return node.text.trim().length > 0;
  if (ts.isJsxExpression(node))
    return node.expression ? hasPaintedText(node.expression) : false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text.trim().length > 0;
  if (ts.isTemplateExpression(node)) return true;
  if (ts.isConditionalExpression(node))
    return hasPaintedText(node.whenTrue) && hasPaintedText(node.whenFalse);
  if (ts.isJsxElement(node)) {
    const classes = staticClasses(
      attribute(node.openingElement, "className")?.initializer
    );
    if (classes.split(/\s+/).includes("sr-only")) return false;
    return node.children.some(hasPaintedText);
  }
  return false;
}

/**
 * Parse controls, not files: a second removal button in an already measured
 * file is independently checked. Comments, forwarding props and status icons
 * outside buttons cannot manufacture a target. Labels, handlers and X glyphs
 * catch removal controls even when one of those signals is missing.
 *
 * This checks the control's own unconditional classes. A consumer can still
 * shrink a shared Close through a descendant selector on its content wrapper;
 * that needs browser hit-testing. Conditional classes and inline styles also
 * require browser verification. Text-labelled buttons use their layout width
 * and are outside this icon-only guard.
 */
function discoverControls(code: string, file: string): DismissControl[] {
  const source = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const controls: DismissControl[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const tag = opening.tagName.getText(source);
      if (
        /^(?:button|Button|DialogClose|(?:Dialog|Sheet)Primitive\.Close)$/.test(
          tag
        )
      ) {
        const signals = ["aria-label", "title", "onClick"]
          .map(
            (name) =>
              attribute(opening, name)?.initializer?.getText(source) ?? ""
          )
          .join(" ");
        const children = node.children
          .map((child) => child.getText(source))
          .join(" ");
        const dismiss =
          /remove|clear|dismiss|close/i.test(signals + children) ||
          /<(?:X|XIcon)\b/.test(children) ||
          /Close$/.test(tag);
        if (dismiss && !node.children.some(hasPaintedText)) {
          let classes = staticClasses(
            attribute(opening, "className")?.initializer
          );
          if (tag === "Button") {
            const sizeAttribute = attribute(opening, "size");
            const sizeName = sizeAttribute
              ? staticClasses(sizeAttribute.initializer)
              : "default";
            const size = (
              [
                "default",
                "xs",
                "sm",
                "lg",
                "icon",
                "icon-xs",
                "icon-sm",
                "icon-lg",
              ] as const
            ).find((value) => value === sizeName);
            assert.ok(size, `${file}: teach the guard Button size ${sizeName}`);
            let base = buttonVariants({ size });
            // Explicit width AND height replace the inherited size shorthand.
            // Keep conflicting declarations within the caller's own string:
            // resolveTargetBox must still refuse those rather than guess.
            if (
              /(?:^|\s)w-\S+/.test(classes) &&
              /(?:^|\s)h-\S+/.test(classes)
            ) {
              base = base
                .split(/\s+/)
                .filter((candidate) => !candidate.startsWith("size-"))
                .join(" ");
            }
            classes = cn(base, classes);
          }
          const line =
            source.getLineAndCharacterOfPosition(opening.getStart(source))
              .line + 1;
          controls.push({
            location: `${file}:${line}`,
            classes,
            sourceHash: createHash("sha256")
              .update(node.getText(source))
              .digest("hex"),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return controls;
}

function tsxFilesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return tsxFilesUnder(full);
      return entry.name.endsWith(".tsx") ? [full] : [];
    }
  );
}

/** Sonner owns its button markup and positioning; our shipped classNames owns its overlay. */
function toastControl(): DismissControl {
  const file = "src/components/ui/sonner.tsx";
  const code = readFileSync(path.join(ROOT, file), "utf8");
  const source = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const classes: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "closeButton"
    ) {
      classes.push(staticClasses(node.initializer));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(
    classes.length,
    1,
    "sonner must expose exactly one measured closeButton class string"
  );
  return { location: file, classes: classes[0], externallyPositioned: true };
}

async function assertTarget(control: DismissControl): Promise<void> {
  const resolved = await resolveTargetBox(control.classes);
  const overlay =
    resolved.after.width !== null || resolved.after.height !== null;
  const box = overlay ? resolved.after : resolved.self;
  if (overlay) {
    assert.ok(
      resolved.after.centred,
      `${control.location}: the hit overlay must be absolutely positioned and centred`
    );
    assert.ok(
      control.externallyPositioned ||
        /(?:^|\s)(?:relative|absolute|fixed|sticky)(?:\s|$)/.test(
          control.classes
        ),
      `${control.location}: the control must establish the overlay's containing block; add relative`
    );
    assert.ok(
      !/(?:^|\s)static(?:\s|$)/.test(control.classes),
      `${control.location}: static positioning detaches the overlay`
    );
  }
  for (const axis of ["width", "height"] as const) {
    const measured = box[axis];
    assert.ok(
      measured !== null && measured >= MINIMUM_TARGET_PX,
      `${control.location}: ${overlay ? "hit overlay" : "button"} ${axis} is ${measured ?? "undeclared"}, below ${MINIMUM_TARGET_PX}px. Use an explicit box or positioned hit-area-6; keep the painted glyph and layout unchanged. Compiled classes: ${control.classes}`
    );
  }
}

test("every icon dismissal/removal in components and app compiles to at least 24x24", async () => {
  const controls = SWEPT_DIRS.flatMap(tsxFilesUnder).flatMap((file) =>
    discoverControls(readFileSync(path.join(ROOT, file), "utf8"), file)
  );
  assert.ok(
    controls.length > 10,
    "the sweep must reach feature controls, not just shared UI"
  );
  // Pre-existing, UNMEASURED control: this Button's width comes from padding.
  // commitment-form is actively owned by Evri #813, so #652 cannot change it.
  // No target-size pass is claimed for it. Pin its entire JSX, not its file:
  // a second control or any markup change must be reviewed independently.
  const legacy = controls.filter(
    (control) =>
      control.location.startsWith(
        "src/components/people/commitment-form.tsx:"
      ) &&
      control.sourceHash ===
        "f34e72c47441c5a2ba5a5f89953b634fa535e676e3896c9813a852ea482cef63"
  );
  assert.equal(
    legacy.length,
    1,
    "the unmeasured commitment attachment control changed; retire or review its exact fingerprint"
  );
  const failures: string[] = [];
  for (const control of [
    ...controls.filter((control) => control !== legacy[0]),
    toastControl(),
  ]) {
    try {
      await assertTarget(control);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(
        message.startsWith(control.location)
          ? message
          : `${control.location}: ${message}`
      );
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("discovery catches two controls in one file, dynamic labels, handlers, and unlabeled X buttons", () => {
  const controls = discoverControls(
    `
    <div>
      <button className="relative hit-area-6" aria-label={\`Remove \${name}\`}><X /></button>
      <button className="size-4" onClick={clearSelection}><Trash2 /></button>
      <Button size="icon"><X /></Button>
      <button className="size-6"><span className="sr-only">Dismiss</span><X /></button>
      <button className="size-4" aria-label="Clear">{pending ? "Clearing" : <X />}</button>
      <button>Clear all</button>
      <Button onClick={remove}>{pending ? "Removing" : "Remove person"}</Button>
      <Button><X />{"Clear selection"}</Button>
      <X />
      <DialogContent showCloseButton />
    </div>`,
    "fixture.tsx"
  );
  assert.equal(controls.length, 5);
  assert.equal(new Set(controls.map((control) => control.location)).size, 5);
});

test("guard refuses a second undersized control and an overlay without a containing block", async () => {
  const controls = discoverControls(
    `<div>
    <button className="size-6" aria-label="Close"><X /></button>
    <button className="size-4" aria-label="Remove"><X /></button>
    <button className="hit-area-6" aria-label="Clear"><X /></button>
    <button className="relative hit-area-6" aria-label="Dismiss"><X /></button>
  </div>`,
    "fixture.tsx"
  );
  await assertTarget(controls[0]);
  await assert.rejects(assertTarget(controls[1]), /below 24px/);
  await assert.rejects(assertTarget(controls[2]), /containing block/);
  await assertTarget(controls[3]);
});

test("Button size defaults and explicit axis overrides use the shipped variants", async () => {
  const controls = discoverControls(
    `<div>
    <Button size="icon" className="h-8 w-8" aria-label="Remove"><X /></Button>
    <Button size="icon-xs" aria-label="Close"><X /></Button>
    <Button size="icon" className="h-4 w-4" aria-label="Clear"><X /></Button>
  </div>`,
    "fixture.tsx"
  );
  assert.equal(controls.length, 3);
  await assertTarget(controls[0]);
  await assertTarget(controls[1]);
  await assert.rejects(assertTarget(controls[2]), /below 24px/);
});
