// The implicit `children` slot's fallback, required once this layout gained the
// `@settings` slot (Next 16 fails the build without a `default.tsx` for every
// slot, `children` included).
//
// It is reached whenever Next cannot recover which route `children` was on —
// which is every route in this group, not only the settings ones.
//
// AND IT IS WHAT A COLD LOAD OF A SETTINGS URL RENDERS BEHIND THE MODAL (#640,
// #646). No `/settings/*` page lives under `children` any more — every route
// that draws the modal is in the `@settings` slot — so a pasted
// `/settings/church` leaves `children` with no match and lands here. Rendering
// nothing leaves the dashboard shell (sidebar and header) standing, which is the
// right ground for the modal the slot is showing over it.
//
// The alternative, a `children` copy of the settings route, is what #646 was:
// `children` stays pinned at the URL the document booted on, so returning to
// that section put a second dialog beside the slot's.
export default function DashboardChildrenDefault() {
  return null;
}
