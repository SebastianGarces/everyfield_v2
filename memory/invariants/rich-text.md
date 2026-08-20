# Rich Text — Stored HTML & the Sanitiser

Why and how, for the Rich Text rules in [`../invariants.md`](../invariants.md). A message body (COM-017) and a task description (T-021) share every module below, which is the point: a second editor or a second sanitiser is the bug this domain exists to prevent.

**Source:** `src/lib/rich-text/sanitize.ts` (the sanitiser and `sanitizeUrl`), `format.ts` (the door, `richTextToPlainText`, `isRichTextEmpty`), `email-segments.ts` (the RSVP splitter), `src/lib/communication/merge.ts` (substitution), `src/lib/tasks/descriptions.ts` (the task write gate), `src/components/shared/rich-text-editor.tsx` and `rich-text.tsx`, `src/lib/email/components/communication-email.tsx`

## The server is the gate, and there is one of everything

- The SERVER sanitises before the insert, because every export of the compose action is a POSTable endpoint that never saw the toolbar. The editor's paste-time pass is a courtesy.
- ONE sanitiser, `sanitizeRichText`, allow-list only: nine elements, `href` on `<a>` the only surviving attribute. Never a second sanitiser, never a regex that "strips script tags".
- A body is sanitised in exactly ONE place per surface, and `RichText` is the ONE read-only renderer, owning the sanitise AND the merge. Sanitising before handing it over corrupts the output; a hand-rolled `dangerouslySetInnerHTML` is a second copy of the component and of the prose classes.

## Two columns, two shapes

- ONE read expression everywhere: `bodyHtml ?? body`, handed to `toRichTextHtml`. A reader that takes `body` alone loses the formatting, and nothing tests it.
- `message_templates` carries the same pair with a `Textarea` editor, so a template writes prose to `body` and leaves `body_html` NULL — a legacy shape, not a dead column.
