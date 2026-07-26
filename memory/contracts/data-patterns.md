# Data Patterns

## Core Principles

1. **Never store server data in useState** — anti-pattern, leads to stale data
2. **Never use useEffect for data synchronization** — useEffect is for side effects (subscriptions, DOM, external systems)
3. **Use useOptimistic for instant UI feedback** — not useState + manual updates
4. **Server actions call `refresh()`** — the server triggers the client router refresh, not `router.refresh()` from the client

## Recommended Pattern: useOptimistic + refresh()

```tsx
// Client Component — server data arrives as props
const [optimisticItems, updateOptimistic] = useOptimistic(
  items,
  (state, newItem) => [newItem, ...state]
);

const handleAdd = (data) =>
  startTransition(async () => {
    updateOptimistic({ id: "temp", ...data }); // instant
    await addItemAction(data); // server action calls refresh() to reconcile
  });
```

In the action: `refresh()` (from `next/cache`) for mutations affecting the current page; `revalidatePath('/people')` for mutations affecting other pages.

## When Client State IS Appropriate

Valid: UI state (modals, dropdowns, form inputs), pagination cursors, drag-and-drop visual state.

NOT valid: server data (use props), syncing with props (never `useEffect(() => setState(prop), [prop])`).

## Pattern Examples

- **Activity Timeline (useOptimistic)** — `ActivityTimelineClient` owns optimistic add/delete; `ActivityFeed` takes activities as props; `NoteForm` calls the parent handler.
- **Pipeline View (legitimate client state)** — useState for drag-and-drop visuals; the server action calls `refresh()` after the status change.
- **Tag Picker (props only)** — no local state; the parent re-renders with new props after the mutation.
