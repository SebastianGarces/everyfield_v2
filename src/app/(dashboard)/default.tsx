// The implicit `children` slot's fallback, required once this layout gained the
// `@settings` slot (Next 16 fails the build without a `default.tsx` for every
// slot, `children` included).
//
// It is only reached when Next cannot recover which route `children` was on —
// never on a cold load of a settings URL, where the real `/settings/*` route
// matches `children` and draws the modal itself. Rendering nothing leaves the
// dashboard shell (sidebar and header) standing, which is the right ground for
// whatever the `@settings` slot is showing over it.
export default function DashboardChildrenDefault() {
  return null;
}
