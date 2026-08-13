"use client";

// ============================================================================
// Rich Text Editor (COM-017 / T-021)
// ============================================================================
//
// ONE editor for the whole product. Message composition is the first consumer;
// task descriptions are the second. Two editors with different behaviour in one
// product is a worse outcome than either alone, which is why this component and
// `@/lib/rich-text/sanitize` were built as a pair.
//
// It is a `contentEditable` surface, not a framework: the formatting commands
// are the browser's own, the toolbar's shape lives in
// `rich-text-editor-controls.ts`, and every path that can bring foreign markup
// in — paste above all — goes through the sanitiser BEFORE the markup reaches
// the DOM. The server sanitises again on the way to storage; this is the
// courtesy pass, never the gate.
//
// The value is HTML. Callers hold it as ordinary form state and hand it back;
// legacy plain-text values are accepted and converted by `toRichTextHtml`, so
// a template written before COM-017 loads into the editor unchanged.
// ============================================================================

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  isRichTextEmpty,
  sanitizeEditorHtml,
  toRichTextHtml,
} from "@/lib/rich-text/format";
import {
  escapeHtml,
  sanitizeRichText,
  sanitizeUrl,
} from "@/lib/rich-text/sanitize";
import {
  RICH_TEXT_CONTROLS,
  RICH_TEXT_PROSE_CLASS,
  richTextControlClass,
  type RichTextCommand,
  type RichTextControlIcon,
} from "./rich-text-editor-controls";

const ICONS: Record<RichTextControlIcon, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  link: LinkIcon,
  list: List,
  "list-ordered": ListOrdered,
};

/** Commands whose pressed state the browser can report at the caret. */
const STATEFUL_COMMANDS = RICH_TEXT_CONTROLS.map((c) => c.command).filter(
  (command) => command !== "link"
);

export interface RichTextEditorHandle {
  /**
   * Insert plain text at the caret. Merge-field inserters use this — a
   * `{{first_name}}` token is text, and must land where the author was typing.
   */
  insertText: (text: string) => void;
  focus: () => void;
}

export interface RichTextEditorProps {
  /** HTML, or legacy plain text, which is converted on the way in. */
  value: string;
  /** Called with sanitised HTML on every edit. */
  onChange: (html: string) => void;
  placeholder?: string;
  id?: string;
  /** Accessible name. Required unless an external `<Label htmlFor>` names it. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  editorClassName?: string;
  onFocus?: () => void;
  disabled?: boolean;
  ref?: React.Ref<RichTextEditorHandle>;
}

/** Escape pasted plain text and keep its line breaks, inline. */
function plainTextToInlineHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br>");
}

/**
 * A bare domain is what people actually type into a link box. Assume https
 * rather than storing a relative path that resolves to nothing in an inbox.
 */
function normalizeTypedUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme =
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("/")
      ? trimmed
      : `https://${trimmed}`;
  return sanitizeUrl(withScheme);
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  id,
  className,
  editorClassName,
  onFocus,
  disabled = false,
  ref,
  ...aria
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  // What we last handed the parent. The parent hands it straight back as
  // `value`, and writing that back into the DOM would move the caret to the
  // start on every keystroke — so the sync effect below compares against this
  // and only writes when the value changed somewhere OTHER than in here.
  const lastEmittedRef = useRef<string>("");
  const savedRangeRef = useRef<Range | null>(null);

  const [activeCommands, setActiveCommands] = useState<Record<string, boolean>>(
    {}
  );
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  // Derived, never stored: the placeholder's visibility is a fact about the
  // value we were given, and a second copy of it in state is a copy that goes
  // stale the moment a template is picked.
  const isEmpty = isRichTextEmpty(value);

  const emitChange = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    // Block-normalised, not just sanitised: an author who has typed without
    // touching the toolbar leaves a bare text node here, and a tag-free value
    // reads as legacy plain text to every consumer downstream — which escapes
    // it a second time. `sanitizeEditorHtml` is where that stops.
    const html = sanitizeEditorHtml(el.innerHTML);
    lastEmittedRef.current = html;
    onChange(html);
  }, [onChange]);

  // Props are the source of truth; the DOM is a view of them. This writes only
  // when the two genuinely disagree (a template was picked, a form was reset).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastEmittedRef.current) return;

    const next = toRichTextHtml(value);
    if (el.innerHTML !== next) el.innerHTML = next;
    lastEmittedRef.current = value;
  }, [value]);

  const refreshActiveCommands = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const command of STATEFUL_COMMANDS) {
      try {
        next[command] = document.queryCommandState(command);
      } catch {
        next[command] = false;
      }
    }
    setActiveCommands(next);
  }, []);

  // Toolbar pressed states follow the caret, so Bold reads as pressed when the
  // caret sits inside bold text. UI state only — nothing here is server data.
  useEffect(() => {
    const handleSelectionChange = () => {
      const el = editorRef.current;
      const selection = document.getSelection();
      if (!el || !selection || selection.rangeCount === 0) return;
      if (!el.contains(selection.anchorNode)) return;
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
      refreshActiveCommands();
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [refreshActiveCommands]);

  const placeCaretAtEnd = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const restoreSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = savedRangeRef.current;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      placeCaretAtEnd();
      return;
    }
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [placeCaretAtEnd]);

  useImperativeHandle(
    ref,
    () => ({
      insertText(text: string) {
        const el = editorRef.current;
        if (!el || disabled) return;
        restoreSelection();
        document.execCommand("insertText", false, text);
        emitChange();
      },
      focus() {
        editorRef.current?.focus();
      },
    }),
    [disabled, emitChange, restoreSelection]
  );

  const openLinkEditor = useCallback(() => {
    const selection = document.getSelection();
    const el = editorRef.current;
    if (
      selection &&
      selection.rangeCount > 0 &&
      el?.contains(selection.anchorNode)
    ) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
    const anchor =
      selection?.anchorNode instanceof Element
        ? selection.anchorNode.closest("a")
        : (selection?.anchorNode?.parentElement?.closest("a") ?? null);

    setLinkUrl(anchor?.getAttribute("href") ?? "");
    setLinkError(null);
    setLinkOpen(true);
  }, []);

  const runCommand = useCallback(
    (command: RichTextCommand) => {
      if (disabled) return;
      if (command === "link") {
        openLinkEditor();
        return;
      }
      const el = editorRef.current;
      if (!el) return;
      restoreSelection();
      try {
        // Ask for tags, not inline styles — `<b>` survives the sanitiser,
        // `<span style>` does not.
        document.execCommand("styleWithCSS", false, "false");
      } catch {
        // Not every engine exposes it; the sanitiser copes either way.
      }
      document.execCommand(command);
      refreshActiveCommands();
      emitChange();
    },
    [
      disabled,
      emitChange,
      openLinkEditor,
      refreshActiveCommands,
      restoreSelection,
    ]
  );

  const applyLink = useCallback(() => {
    const safe = normalizeTypedUrl(linkUrl);
    if (!safe) {
      setLinkError("Enter a web address starting with http:// or https://");
      return;
    }

    restoreSelection();
    const selection = document.getSelection();
    const collapsed = !selection || selection.isCollapsed;

    if (collapsed) {
      // Nothing selected: the URL becomes its own link text.
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeHtml(safe)}">${escapeHtml(safe)}</a>`
      );
    } else {
      document.execCommand("createLink", false, safe);
    }

    setLinkOpen(false);
    setLinkUrl("");
    setLinkError(null);
    emitChange();
  }, [emitChange, linkUrl, restoreSelection]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");
      // Sanitised BEFORE it reaches the DOM: a pasted `<img onerror>` never
      // gets to exist, let alone to be stored.
      const safe = html
        ? sanitizeRichText(html)
        : plainTextToInlineHtml(text ?? "");
      if (!safe) return;
      document.execCommand("insertHTML", false, safe);
      emitChange();
    },
    [emitChange]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        openLinkEditor();
      }
    },
    [openLinkEditor]
  );

  return (
    <div
      className={cn(
        "border-input focus-within:border-ring focus-within:ring-ring/50 overflow-hidden rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]",
        disabled && "opacity-60",
        className
      )}
    >
      <div
        role="toolbar"
        aria-label="Text formatting"
        aria-controls={id}
        className="bg-muted/40 flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1"
      >
        {RICH_TEXT_CONTROLS.map((control) => {
          const Icon = ICONS[control.icon];
          const isActive =
            control.command === "link"
              ? linkOpen
              : Boolean(activeCommands[control.command]);

          return (
            <button
              key={control.command}
              type="button"
              // The toolbar must not steal the caret, or the command would have
              // nothing to apply itself to.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runCommand(control.command)}
              disabled={disabled}
              aria-pressed={isActive}
              aria-label={control.label}
              title={
                control.shortcut
                  ? `${control.label} (${control.shortcut})`
                  : control.label
              }
              className={richTextControlClass(isActive)}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {linkOpen && (
        <div className="bg-muted/20 flex flex-wrap items-center gap-2 border-b px-2 py-2">
          <Input
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkOpen(false);
              }
            }}
            placeholder="https://example.com"
            aria-label="Link address"
            aria-invalid={linkError !== null}
            className="h-8 flex-1"
            autoFocus
          />
          <Button
            type="button"
            size="sm"
            className="cursor-pointer"
            onClick={applyLink}
          >
            Add link
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="cursor-pointer"
            onClick={() => setLinkOpen(false)}
          >
            Cancel
          </Button>
          {linkError && (
            <p className="text-destructive w-full text-xs">{linkError}</p>
          )}
        </div>
      )}

      <div className="relative">
        {isEmpty && placeholder && (
          <p
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-3 left-3 text-sm"
          >
            {placeholder}
          </p>
        )}
        <div
          ref={editorRef}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-label={aria["aria-label"]}
          aria-labelledby={aria["aria-labelledby"]}
          contentEditable={!disabled}
          suppressContentEditableWarning
          spellCheck
          onInput={emitChange}
          onBlur={emitChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onFocus={onFocus}
          data-empty={isEmpty ? "true" : "false"}
          className={cn(
            "min-h-[240px] w-full overflow-auto px-3 py-3 outline-none",
            // The canvas wears the same prose rules the read-only surfaces do,
            // so what an author sees while typing is what a reader gets.
            RICH_TEXT_PROSE_CLASS,
            editorClassName
          )}
        />
      </div>
    </div>
  );
}
