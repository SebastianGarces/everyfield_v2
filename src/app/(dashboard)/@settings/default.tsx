// The `@settings` slot when the URL names no settings section — which is every
// dashboard route, and every cold load of `/settings/*` (an intercepting route
// is bypassed on a full page load, so the real route under `children` draws the
// modal instead).
//
// `null`, never `notFound()`: an unmatched modal slot means "no modal", and a
// named slot with no `default.tsx` fails the build outright in Next 16.
export default function SettingsSlotDefault() {
  return null;
}
