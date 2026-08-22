# Data Patterns

Rules: `../invariants.md` → Client/Server Data Synchronization. This file is the shape they
describe.

```tsx
// Client Component — server data arrives as props, never into useState
const [optimisticItems, updateOptimistic] = useOptimistic(items, (state, newItem) => [
  newItem,
  ...state,
]);

const handleAdd = (data) =>
  startTransition(async () => {
    updateOptimistic({ id: "temp", ...data }); // instant
    await addItemAction(data); // the action calls refresh() to reconcile
  });
```

In the action: `refresh()` (from `next/cache`) for mutations affecting the current page;
`revalidatePath('/people')` for mutations affecting other pages; and `revalidatePath('/', 'layout')`
**before** a `redirect()` when the action itself navigates — the redirect is a client-side
navigation, so it reuses the layout segments both routes share and the destination renders beside
stale chrome without it (`confirmEmailChangeAction`, #658).

**Unless the click is leaving.** A `<Link>` whose `onClick` also fires the action must call it
plainly — no `startTransition`, and no `refresh()` in the action — because each turns the click
into work React owns on the route being LEFT, and either one supersedes the pending navigation.
When one action is reached both ways, the refresh moves out of the action and into the client
caller, which is the only party that knows whether it is staying. Measured on #308's preview: with
either half, the write lands and the navigation does not; with neither, 22 of 22 navigate.

**The leaving caller still reconciles — it waits for its own push to commit.**

```jsx
const markReadOnNavigate = (id) => {
  const leaving = window.location.pathname;
  void markNotificationReadAction(id)
    .then(() => whenPushCommits(leaving)) // pathname changed, then one more frame
    .then(() => router.refresh())
    .catch(() => {});
};
```

Skipping the reconcile altogether is a bug, not a simplification, and it shipped once (#526,
corrected in #527) on the premise that "the destination's own layout renders a fresh count". It does
not. A client-side push REUSES the layout segments the two routes share instead of re-rendering them
(partial rendering — `.next-docs/01-app/02-guides/authentication.mdx:1350` states it as the reason a
session check does not belong in a layout), and the badge that needed reconciling was in exactly such
a shared layout: the feed's own. 25 unread, click a row, land on the person — read in the database,
still 25 in the bell, for the rest of the session.

Two separate waits, both found by measuring, both needed. Chaining on the ACTION is not enough: it
settles in 200–500 ms while the push commits in 180–430 ms, so the two overlap and the refresh still
supersedes the navigation (8 of 11 stranded). Waiting on the URL alone is not enough either: the URL
is written when the router *starts* committing, so the refresh lands inside the destination's own
render and is coalesced away about one time in ten (22/22 navigated, 20/22 counted). Waiting one
frame past the URL change puts it after the paint — **22/22 navigated, 22/22 counted**, median
422 ms. The `.catch` is part of the shape: an unhandled rejection on a page the user has left has
nobody to tell. See `memory/invariants.md` → Client/Server Data Synchronization.

In the repo: `ActivityTimelineClient` owns optimistic add/delete while `ActivityFeed` takes
activities as props; the pipeline view keeps useState for drag-and-drop visuals only and lets the
action's `refresh()` carry the status change; the tag picker holds no local state at all.

## The one cached read: stale-while-revalidate, in the settings modal

Ruled 2026-08-22 (#673). The settings sections are read over `GET /api/settings/sections/<id>` by a
client modal that no route renders, so props cannot carry them. `settings-hash.ts` holds those reads
in a module-scope map keyed (section, `serverRenderId`, attempt) — the answer beside the promise, so
a revisit can paint immediately.

What makes it presentation rather than the state the rule above forbids is WHERE it is read: the
cached view has exactly one caller, as the Suspense **fallback** for the read at the current
`serverRenderId`. So it is on screen only while its own revalidation is in flight, and the fresh
answer replaces it. A write rotates `serverRenderId` (via `refresh()`, as everything else here does),
which is the whole invalidation — nothing new is threaded for it. Failures are held only long enough
to stop the suspended-replay loop and are never cached as content. The bound is the document: module
scope is per-tab memory, and a sign-out is a full navigation.

Do not copy this shape for data a server component can hand down as props. See
`memory/invariants.md` → Client/Server Data Synchronization for the exact terms of the exception.
