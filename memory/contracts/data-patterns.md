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

In the repo: `ActivityTimelineClient` owns optimistic add/delete while `ActivityFeed` takes
activities as props; the pipeline view keeps useState for drag-and-drop visuals only and lets the
action's `refresh()` carry the status change; the tag picker holds no local state at all.
