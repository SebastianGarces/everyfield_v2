// ============================================================================
// Rich Text Editor — toolbar spec
// ============================================================================
//
// The toolbar's shape and its class names, kept OUT of the client component so
// they can be asserted without a DOM. The project's hard rule — every clickable
// carries `cursor-pointer` — is a rule about the class string, so the class
// string is the thing under test (`rich-text-editor-controls.test.ts`), and the
// component has no second spelling of it to drift from.
// ============================================================================

/**
 * The formatting commands the editor offers.
 *
 * `bold`, `italic` and the two list commands are `document.execCommand` names
 * and are passed straight through. `link` is ours: it opens the link row rather
 * than running a command, because a link needs a URL before it can be applied.
 */
export type RichTextCommand =
  | "bold"
  | "italic"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "link";

/** Which lucide icon the control draws. Resolved in the client component. */
export type RichTextControlIcon =
  | "bold"
  | "italic"
  | "list"
  | "list-ordered"
  | "link";

export interface RichTextControlSpec {
  command: RichTextCommand;
  /** Accessible name. Sentence case — the control is an object, not a sentence. */
  label: string;
  icon: RichTextControlIcon;
  /** Shown in the tooltip/title after the label. */
  shortcut?: string;
}

export const RICH_TEXT_CONTROLS: RichTextControlSpec[] = [
  { command: "bold", label: "Bold", icon: "bold", shortcut: "⌘B" },
  { command: "italic", label: "Italic", icon: "italic", shortcut: "⌘I" },
  { command: "link", label: "Link", icon: "link", shortcut: "⌘K" },
  { command: "insertUnorderedList", label: "Bulleted list", icon: "list" },
  {
    command: "insertOrderedList",
    label: "Numbered list",
    icon: "list-ordered",
  },
];

/**
 * The one class string every toolbar control wears.
 *
 * `cursor-pointer` is not decoration here — it is the project rule for anything
 * clickable, and these controls are `<button>`s inside a toolbar that the
 * global stylesheet does not reach for, so it is stated explicitly.
 */
export const RICH_TEXT_CONTROL_CLASS =
  "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-transparent text-sm transition-colors focus-visible:ring-ring/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** Pressed state for a control whose formatting is active at the caret. */
export const RICH_TEXT_CONTROL_ACTIVE_CLASS =
  "bg-muted text-foreground border-border";

export const RICH_TEXT_CONTROL_IDLE_CLASS =
  "text-muted-foreground hover:bg-muted hover:text-foreground";

/** The class a toolbar control wears, given whether its format is active. */
export function richTextControlClass(isActive: boolean): string {
  return `${RICH_TEXT_CONTROL_CLASS} ${
    isActive ? RICH_TEXT_CONTROL_ACTIVE_CLASS : RICH_TEXT_CONTROL_IDLE_CLASS
  }`;
}

// ---------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------
//
// The sanitiser emits nine elements, and SOMETHING has to say how they look.
// Tailwind's own reset flattens `<ul>` and `<ol>`, so a body with no rules at
// all renders a planter's bulleted list as unbulleted, unindented lines — on
// the screen they typed it into.
//
// There are exactly TWO spellings below, one per MEDIUM, and the difference
// between them is deliberate rather than drift. It used to be four copies in
// four components, and they had already drifted: the editor and the message
// reader said `mb-2` and `text-primary`, the COM-015 preview said `mb-3` and
// `#0b7a3f`, and the task detail page's hand-rolled fourth copy said one of
// each. Whichever spelling you need, take it from here.

/**
 * Rich text in the APP's voice — the editor's canvas, and every read-only
 * surface that renders a stored body (`RichText` in `./rich-text.tsx`).
 *
 * Typography and colour are the product's own, because the reader is looking
 * at EveryField.
 */
export const RICH_TEXT_PROSE_CLASS = [
  "text-sm break-words",
  "[&_p]:mb-2 [&_p:last-child]:mb-0",
  "[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
].join(" ");

/**
 * Rich text in the EMAIL's voice — the COM-015 preview only.
 *
 * Not a drifted copy of the constant above: the preview's whole job is to show
 * what the RECIPIENT will see, and the recipient sees `CommunicationEmail`'s
 * inline styles in their own mail client, not this app's theme. The spacing and
 * the link colour are that template's, spelled here in Tailwind so the preview
 * can wear them. Change the email, change this; change the app, change the one
 * above.
 */
export const EMAIL_RICH_TEXT_PROSE_CLASS = [
  "leading-relaxed text-[#4b5563]",
  "[&_p]:mb-3 [&_p:last-child]:mb-0",
  "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_a]:text-[#0b7a3f] [&_a]:underline",
].join(" ");
