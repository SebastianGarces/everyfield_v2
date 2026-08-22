// THE CLOSE-BY-NAVIGATING CASE.
//
// A client-side navigation to a route the `@settings` slot does not match leaves
// the slot's last match on screen — that is how parallel routes behave, and it
// would strand the modal over whatever the reader clicked through to. Matching
// every other path to a component that renders nothing is what dismisses it.
//
// A required catch-all, never `[[...catchAll]]`: Next's slot normalizer does not
// support the optional form, and it deliberately declines to push a catch-all
// into an intercepting route, so this cannot swallow `(.)settings`.
export default function SettingsSlotCatchAll() {
  return null;
}
