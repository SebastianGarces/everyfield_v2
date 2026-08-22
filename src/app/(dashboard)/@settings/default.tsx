// The `@settings` slot when the URL names no settings section — which is every
// dashboard route. A cold load of `/settings/*` does NOT reach this file: the
// slot carries a non-intercepting `settings/[section]` beside its interceptor,
// so a full page load matches there (#640, #646).
//
// `null`, never `notFound()`: an unmatched modal slot means "no modal", and a
// named slot with no `default.tsx` fails the build outright in Next 16.
export default function SettingsSlotDefault() {
  return null;
}
