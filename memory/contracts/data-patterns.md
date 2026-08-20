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
`revalidatePath('/people')` for mutations affecting other pages.

**Unless the click is leaving.** A `<Link>` whose `onClick` also fires the action must call it
plainly — no `startTransition`, and no `refresh()` in the action — because each turns the click
into work React owns on the route being LEFT, and either one supersedes the pending navigation.
When one action is reached both ways, the refresh moves out of the action and into the client
caller, which is the only party that knows whether it is staying. Measured on #308's preview: with
either half, the write lands and the navigation does not; with neither, 22 of 22 navigate.

**The leaving caller still reconciles — it just waits.** `void action(id).then(() => router.refresh()).catch(() => {})`:
the refresh is chained on the action's promise, so it runs after the push has been issued and
re-renders where the user now IS. Skipping it altogether is a bug, not a simplification, and it
shipped once (#526, corrected in #527) on the premise that "the destination's own layout renders a
fresh count". It does not. A client-side push REUSES the layout segments the two routes share
instead of re-rendering them (partial rendering — `.next-docs/01-app/02-guides/authentication.mdx:1350`
states it as the reason a session check does not belong in a layout), and the badge that needed
reconciling was in exactly such a shared layout: the feed's own. 26 unread, click a row, land on the
person — read in the database, still 26 in the bell, for the rest of the session. The `.catch` is
required with it: an unhandled rejection on a page the user has left has nobody to tell.
See `memory/invariants.md` → Client/Server Data Synchronization.

In the repo: `ActivityTimelineClient` owns optimistic add/delete while `ActivityFeed` takes
activities as props; the pipeline view keeps useState for drag-and-drop visuals only and lets the
action's `refresh()` carry the status change; the tag picker holds no local state at all.
