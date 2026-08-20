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
caller that stays (`notification-feed.tsx`: `router.refresh()` after the buttons, nothing after a
row click). Measured on #308's preview: with either half, the write lands and the navigation does
not; with neither, 22 of 22 navigate. See `memory/invariants.md` → Client/Server Data
Synchronization.

In the repo: `ActivityTimelineClient` owns optimistic add/delete while `ActivityFeed` takes
activities as props; the pipeline view keeps useState for drag-and-drop visuals only and lets the
action's `refresh()` carry the status change; the tag picker holds no local state at all.
