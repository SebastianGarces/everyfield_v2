---
name: react-email
description: Use when creating email templates with React - welcome emails, password resets, notifications, order confirmations, or transactional emails that need to render across email clients.
---

# React Email

Build and send HTML emails using React components; compiles to HTML that renders across
Gmail, Outlook, Apple Mail, Yahoo. Use for transactional/notification templates that need
cross-client compatibility with TypeScript props. Skip for plain-text emails.

## Hard rules (email clients, not preferences)

- **`pixelBasedPreset` always** — email clients don't support `rem`.
- **Never flexbox/grid** — use `Row`/`Column` (table-based; they won't stack on mobile).
- **Never SVG/WEBP images** — PNG/JPEG only, absolute URLs, `alt` text always.
- **Never media queries** (`sm:`, `md:`) **or `dark:`** — clients don't support them; if asked,
  say so and design mobile-first stacked instead.
- **Always specify border type** (`border-solid`) and `box-border` on buttons.
- **`Preview` immediately after `Body`** opens; `Html` gets `lang`.
- **Never write template vars (`{{name}}`) in JSX** — reference props; put the `{{…}}` pattern
  in `PreviewProps` if a provider-side variable is explicitly wanted.
- Gmail clips emails over **102KB**.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| flexbox/grid | `Row`/`Column` or tables |
| `rem` units | `pixelBasedPreset` |
| SVG images | PNG/JPG |
| media queries | mobile-first stacked layout |
| `{{name}}` in JSX | `{props.name}`; `{{…}}` only in PreviewProps |
| missing border type | `border-solid` etc. |
| fixed dims on content images | `w-full h-auto` (fixed OK for small icons) |

## Practices

Max-width ~600px; always render a plain-text version; typed props + `PreviewProps` on every
template; check the send call's `error`; verified domain for production `from`.

When iterating on an existing template, change only what was asked.

## References (load as needed)

- [references/SETUP.md](references/SETUP.md) — installation, template skeleton, `render()`, sending via Resend
- [references/COMPONENTS.md](references/COMPONENTS.md) — full component reference
- [references/STYLING.md](references/STYLING.md) — styling + shared Tailwind config patterns
- [references/PATTERNS.md](references/PATTERNS.md) — common patterns
- [references/SENDING.md](references/SENDING.md) — provider guide
- [references/I18N.md](references/I18N.md) — next-intl / react-i18next / react-intl
- Docs: https://react.email/docs/llms.txt · CSS support: https://www.caniemail.com
